import { INestApplication } from '@nestjs/common';
import { Operator } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { PrismaService } from '../src/common/prisma.service';
import { Mail, MailService } from '../src/mail/mail.service';
import { ScoringService } from '../src/scoring/scoring.service';
import { signInitData } from '../src/telegram/init-data';
import { startFakeTelegram } from './fake-telegram';
import { createAdmin, createApp, PASSWORD, resetDb, tokenFor, validOperator } from './helpers';

/** Pilot round: operator inbox, booking reports, readiness checks, content safety, notification channels. */
const BOT_TOKEN = '888:pilot-round-token';
let app: INestApplication;
let prisma: PrismaService;
let mail: MailService;
let tg: Awaited<ReturnType<typeof startFakeTelegram>>;
let modToken: string;

beforeAll(async () => {
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  process.env.PORTAL_URL = 'https://portal.example';
  process.env.ADMIN_URL = 'https://admin.example';
  process.env.STAFF_EMAILS = 'ops@platform.example';
  delete process.env.SMTP_URL;
  delete process.env.WEB_REVALIDATE_URL;
  tg = await startFakeTelegram(BOT_TOKEN);
  process.env.TELEGRAM_API_BASE = tg.url;
  ({ app, prisma } = await createApp());
  mail = app.get(MailService);
});
afterAll(async () => {
  await app.close();
  tg.close();
});
beforeEach(async () => {
  await resetDb(prisma);
  tg.messages.length = 0;
  mail.sent.length = 0;
  modToken = await tokenFor(app, (await createAdmin(prisma, 'MODERATOR')).email);
});

const http = () => request(app.getHttpServer());
const bearer = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`);
const asMod = (r: request.Test) => bearer(r, modToken);
const hash = bcrypt.hashSync(PASSWORD, 4);

async function waitFor(match: (m: Mail) => boolean): Promise<Mail> {
  for (let i = 0; i < 50; i++) {
    const found = mail.sent.find(match);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`No such email. Sent: ${mail.sent.map((m) => `${m.to.join(',')}: ${m.subject}`).join(' | ')}`);
}

async function operatorWithLogin(name = 'Alpha Safaris', email = 'staff@alpha.example'): Promise<{ op: Operator; token: string }> {
  const slug = name.toLowerCase().replace(/\W+/g, '-');
  const op = await prisma.operator.create({ data: { ...validOperator, name, slug, countryCode: 'UG', badgeToken: `b-${slug}`, status: 'APPROVED', approvedAt: new Date() } });
  await prisma.account.create({ data: { email, passwordHash: hash, role: 'OPERATOR', operatorId: op.id } });
  const res = await http().post('/portal/auth/login').send({ email, password: PASSWORD }).expect(200);
  return { op, token: res.body.accessToken };
}

describe('operator inbox for traveller questions', () => {
  const askViaMiniApp = (operatorSlug: string, telegramId = 5151) =>
    http()
      .post('/public/telegram/inquiries')
      .set('Authorization', `tma ${signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: telegramId, first_name: 'Ольга', last_name: 'Петрова', username: 'olga_p' }) }, BOT_TOKEN)}`)
      .send({ operatorSlug, message: 'Есть ли свободные места на гориллы в феврале?', travelMonth: '2027-02', groupSize: 2, consent: true })
      .expect(201);

  it('the operator is told about a new question, sees it without the traveller’s contact, answers, and the traveller gets it in Telegram', async () => {
    const { op, token } = await operatorWithLogin();
    const asked = await askViaMiniApp(op.slug);
    const note = await waitFor((m) => m.to.includes('staff@alpha.example'));
    expect(note.subject).toBe('New question from a traveller');
    expect(note.text).toContain('https://portal.example/inbox');

    const inbox = await bearer(http().get('/portal/operator/inquiries'), token).expect(200);
    expect(inbox.body).toHaveLength(1);
    expect(inbox.body[0]).toMatchObject({ id: asked.body.id, status: 'NEW', travellerName: 'Ольга', travelMonth: '2027-02', groupSize: 2, replies: [] });
    expect(JSON.stringify(inbox.body)).not.toMatch(/olga_p|5151|tg:\/\//);

    const answered = await bearer(http().post(`/portal/operator/inquiries/${asked.body.id}/reply`), token).send({ text: 'Да, есть места 12 и 19 февраля.' }).expect(200);
    expect(answered.body).toMatchObject({ status: 'RESPONDED', replies: [{ by: 'operator', deliveredVia: 'TELEGRAM', body: 'Да, есть места 12 и 19 февраля.' }] });
    expect(tg.to(5151)).toEqual([expect.objectContaining({ text: `Ответ на ваш вопрос к ${op.name}:\n\nДа, есть места 12 и 19 февраля.` })]);
    expect(await prisma.auditLog.count({ where: { entityId: asked.body.id, action: 'inquiry.operator_reply' } })).toBe(1);
  });

  it('answers by email when there is no Telegram contact, and refuses when there is no way to reach the traveller', async () => {
    const { op, token } = await operatorWithLogin();
    const byEmail = await prisma.inquiry.create({ data: { operatorId: op.id, channel: 'WEB', contactName: 'Иван', contactInfo: 'ivan@traveller.example', message: 'Сколько стоит?' } });
    const noContact = await prisma.inquiry.create({ data: { operatorId: op.id, channel: 'WEB', message: 'Hello?' } });
    const res = await bearer(http().post(`/portal/operator/inquiries/${byEmail.id}/reply`), token).send({ text: 'От 2450 USD с человека.' }).expect(200);
    expect(res.body.replies[0].deliveredVia).toBe('EMAIL');
    const sent = await waitFor((m) => m.to.includes('ivan@traveller.example'));
    expect(sent.text).toContain('От 2450 USD с человека.');
    await bearer(http().post(`/portal/operator/inquiries/${noContact.id}/reply`), token).send({ text: 'Hello, yes.' }).expect(409);
    expect(await prisma.inquiryReply.count({ where: { inquiryId: noContact.id } })).toBe(0);
  });

  it('operators only see and answer their own questions, and only while approved', async () => {
    const a = await operatorWithLogin('Alpha Safaris', 'a@alpha.example');
    const b = await operatorWithLogin('Beta Tours', 'b@beta.example');
    const user = await prisma.telegramUser.create({ data: { telegramId: BigInt(7001) } });
    const forA = await prisma.inquiry.create({ data: { operatorId: a.op.id, telegramUserId: user.id, message: 'Вопрос для Альфы' } });
    expect((await bearer(http().get('/portal/operator/inquiries'), b.token).expect(200)).body).toEqual([]);
    await bearer(http().post(`/portal/operator/inquiries/${forA.id}/reply`), b.token).send({ text: 'Not mine' }).expect(404);
    await prisma.operator.update({ where: { id: a.op.id }, data: { status: 'SUSPENDED' } });
    await bearer(http().post(`/portal/operator/inquiries/${forA.id}/reply`), a.token).send({ text: 'Answer' }).expect(403);
  });

  it('staff can still answer on the operator’s behalf, recorded as such; staff see the whole thread', async () => {
    const { op, token } = await operatorWithLogin();
    const user = await prisma.telegramUser.create({ data: { telegramId: BigInt(7002) } });
    const q = await prisma.inquiry.create({ data: { operatorId: op.id, telegramUserId: user.id, message: 'Нужен ли трансфер?' } });
    await asMod(http().post(`/admin/inquiries/${q.id}/reply`)).send({ text: 'Трансфер включён.' }).expect(200);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: q.id, action: 'inquiry.reply' } });
    expect(log.metadata).toMatchObject({ onBehalfOf: op.id, deliveredVia: 'TELEGRAM' });
    const mine = await bearer(http().get('/portal/operator/inquiries'), token).expect(200);
    expect(mine.body[0].replies).toEqual([expect.objectContaining({ by: 'staff', body: 'Трансфер включён.' })]);
    await bearer(http().post(`/portal/operator/inquiries/${q.id}/reply`), token).send({ text: 'И гид тоже.' }).expect(200);
    const all = await asMod(http().get('/admin/inquiries')).expect(200);
    expect(all.body.items[0].replies.map((r: { authorAdmin: unknown; authorAccount: unknown }) => [!!r.authorAdmin, !!r.authorAccount])).toEqual([[true, false], [false, true]]);
  });

  it('a question for an operator without a portal login goes to staff', async () => {
    const op = await prisma.operator.create({ data: { ...validOperator, name: 'No Login Co', slug: 'no-login', countryCode: 'UG', badgeToken: 'b-nl', status: 'APPROVED', approvedAt: new Date() } });
    await askViaMiniApp(op.slug, 6161);
    expect((await waitFor((m) => m.subject.startsWith('Traveller question for No Login Co'))).to).toEqual(['ops@platform.example']);
  });

  it('the response-time score counts only the operator’s own answers', async () => {
    const { op, token } = await operatorWithLogin();
    const scoring = app.get(ScoringService);
    const user = await prisma.telegramUser.create({ data: { telegramId: BigInt(7003) } });
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
    // Staff answered within minutes, but the operator never did: after 72 hours it counts as 72 hours.
    const staffOnly = await prisma.inquiry.create({ data: { operatorId: op.id, telegramUserId: user.id, message: 'Q1', createdAt: hoursAgo(100) } });
    await asMod(http().post(`/admin/inquiries/${staffOnly.id}/reply`)).send({ text: 'Staff answer' }).expect(200);
    expect((await scoring.breakdown(op.id)).medianResponseHours).toBe(72);

    // The operator answers another question 1 hour after it arrived (back-dated below): median of 72 and 1.
    const own = await prisma.inquiry.create({ data: { operatorId: op.id, telegramUserId: user.id, message: 'Q2', createdAt: hoursAgo(2) } });
    await bearer(http().post(`/portal/operator/inquiries/${own.id}/reply`), token).send({ text: 'Operator answer' }).expect(200);
    await prisma.inquiryReply.updateMany({ where: { inquiryId: own.id }, data: { createdAt: hoursAgo(1) } });
    expect((await scoring.breakdown(op.id)).medianResponseHours).toBe(36.5);

    // A question staff closed as spam, with no operator answer, doesn't count either way.
    const spam = await prisma.inquiry.create({ data: { operatorId: op.id, telegramUserId: user.id, message: 'spam', createdAt: hoursAgo(90) } });
    await asMod(http().post(`/admin/inquiries/${spam.id}/status`)).send({ status: 'CLOSED' }).expect(200);
    expect((await scoring.breakdown(op.id)).medianResponseHours).toBe(36.5);
  });
});

describe('booked status on quotes', () => {
  async function quoteBetween() {
    const { op, token: opToken } = await operatorWithLogin();
    const dmc = await prisma.dmc.create({ data: { name: 'Северный Ветер', email: 'b2b@dmc.example', status: 'APPROVED' } });
    await prisma.account.create({ data: { email: 'b2b@dmc.example', passwordHash: hash, role: 'DMC', dmcId: dmc.id } });
    const dmcToken = (await http().post('/portal/auth/login').send({ email: 'b2b@dmc.example', password: PASSWORD }).expect(200)).body.accessToken;
    const pkg = await prisma.package.create({ data: { operatorId: op.id, title: 'Bwindi Trek', slug: 'bwindi', countryCode: 'UG', durationDays: 4, status: 'PUBLISHED', descriptionRu: 'Гориллы' } });
    const quote = await prisma.quoteRequest.create({ data: { dmcId: dmc.id, packageId: pkg.id, pax: 4, status: 'QUOTED', quotedPrice: 1800, quotedCurrency: 'USD', quotedAt: new Date() } });
    return { op, opToken, dmc, dmcToken, quote };
  }
  const report = (who: 'dmc' | 'operator', token: string, id: string, body: object) => bearer(http().put(`/portal/${who}/quotes/${id}/booking`), token).send(body);

  it('both sides report; matching reports are confirmed and both can see it; the other side is asked to confirm', async () => {
    const { opToken, dmcToken, quote } = await quoteBetween();
    await report('dmc', dmcToken, quote.id, { outcome: 'BOOKED' }).expect(400); // needs the date
    await report('dmc', dmcToken, quote.id, { outcome: 'BOOKED', bookedOn: '2026-10-05', netPrice: 7200, pax: 4 }).expect(400); // price needs currency
    const first = await report('dmc', dmcToken, quote.id, { outcome: 'BOOKED', bookedOn: '2026-10-05', netPrice: 7200, currency: 'USD', pax: 4 }).expect(200);
    expect(first.body).toMatchObject({ status: 'CLOSED', booking: { state: 'awaiting_other_side' } });
    await waitFor((m) => m.to.includes('staff@alpha.example') && m.subject.startsWith('Please confirm: Северный Ветер reports a booking'));

    const opView = await bearer(http().get('/portal/operator/quotes'), opToken).expect(200);
    expect(opView.body[0].bookingReports).toEqual([expect.objectContaining({ side: 'DMC', outcome: 'BOOKED', pax: 4 })]);
    const confirmed = await report('operator', opToken, quote.id, { outcome: 'BOOKED', bookedOn: '2026-10-06', netPrice: 7200, currency: 'USD', pax: 4 }).expect(200);
    expect(confirmed.body.booking).toEqual({ state: 'confirmed', differences: [] });
    const dmcView = await bearer(http().get('/portal/dmc/quotes'), dmcToken).expect(200);
    expect(dmcView.body[0].booking.state).toBe('confirmed');
  });

  it('disagreeing reports are flagged for staff, and correcting one clears the flag', async () => {
    const { opToken, dmcToken, quote } = await quoteBetween();
    await report('dmc', dmcToken, quote.id, { outcome: 'BOOKED', bookedOn: '2026-10-05', pax: 4 }).expect(200);
    const disputed = await report('operator', opToken, quote.id, { outcome: 'BOOKED', bookedOn: '2026-10-05', pax: 6 }).expect(200);
    expect(disputed.body.booking).toEqual({ state: 'disputed', differences: ['number of travellers'] });
    await waitFor((m) => m.to.includes('ops@platform.example') && m.subject.startsWith('Booking reports disagree'));
    expect((await asMod(http().get('/admin/stats')).expect(200)).body.bookingsDisputed).toBe(1);
    const flagged = await asMod(http().get('/admin/quotes')).expect(200);
    expect(flagged.body[0].booking.state).toBe('disputed');
    await report('operator', opToken, quote.id, { outcome: 'BOOKED', bookedOn: '2026-10-05', pax: 4 }).expect(200);
    expect((await asMod(http().get('/admin/stats')).expect(200)).body.bookingsDisputed).toBe(0);
  });

  it('each side reports only on its own quotes', async () => {
    const { quote } = await quoteBetween();
    const other = await operatorWithLogin('Beta Tours', 'b@beta.example');
    await report('operator', other.token, quote.id, { outcome: 'NOT_BOOKED' }).expect(404);
  });

  it('closing a quote as sold in the DMC portal records the DMC’s report', async () => {
    const { dmcToken, quote } = await quoteBetween();
    await bearer(http().post(`/portal/dmc/quotes/${quote.id}/close`), dmcToken).send({ outcome: 'booked' }).expect(200);
    const r = await prisma.quoteBookingReport.findFirstOrThrow({ where: { quoteRequestId: quote.id } });
    expect(r).toMatchObject({ side: 'DMC', outcome: 'BOOKED' });
    expect(r.bookedOn).not.toBeNull();
  });

  it('monthly report: confirmed bookings per operator and per DMC, others listed for follow-up, CSV export', async () => {
    const { opToken, dmcToken, quote, op } = await quoteBetween();
    await report('dmc', dmcToken, quote.id, { outcome: 'BOOKED', bookedOn: '2026-10-05', netPrice: 7200, currency: 'USD', pax: 4 }).expect(200);
    await report('operator', opToken, quote.id, { outcome: 'BOOKED', bookedOn: '2026-10-05', pax: 4 }).expect(200);
    const pkg2 = await prisma.package.create({ data: { operatorId: op.id, title: 'Lake Tour', slug: 'lake', countryCode: 'UG', durationDays: 2, status: 'PUBLISHED' } });
    const q2 = await prisma.quoteRequest.create({ data: { dmcId: quote.dmcId, packageId: pkg2.id, pax: 2, status: 'QUOTED' } });
    await report('dmc', dmcToken, q2.id, { outcome: 'BOOKED', bookedOn: '2026-11-02', pax: 2 }).expect(200); // not confirmed yet

    const r = await asMod(http().get('/admin/bookings?from=2026-10&to=2026-11')).expect(200);
    expect(r.body.confirmed).toHaveLength(1);
    expect(r.body.confirmed[0]).toMatchObject({ month: '2026-10', operator: { name: 'Alpha Safaris' }, dmc: { name: 'Северный Ветер' }, pax: 4, netPrice: '7200', currency: 'USD' });
    expect(r.body.needsAttention).toEqual([expect.objectContaining({ quoteId: q2.id, state: 'awaiting_other_side', month: '2026-11' })]);
    expect(r.body.byOperator).toEqual([{ month: '2026-10', id: op.id, name: 'Alpha Safaris', bookings: 1, pax: 4 }]);
    expect(r.body.byDmc).toEqual([expect.objectContaining({ month: '2026-10', name: 'Северный Ветер', bookings: 1, pax: 4 })]);
    expect((await asMod(http().get('/admin/bookings?from=2026-12&to=2026-12')).expect(200)).body.confirmed).toEqual([]);
    await asMod(http().get('/admin/bookings?from=2026-11&to=2026-10')).expect(400);

    const csv = await asMod(http().get('/admin/bookings/export.csv?from=2026-10&to=2026-11')).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('bookings-bookings-2026-10-to-2026-11.csv');
    const lines = csv.text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('month,booked_on,operator,dmc,tour,travellers,agreed_net_price,currency,quote_id');
    expect(lines[1]).toBe(`2026-10,2026-10-05,Alpha Safaris,Северный Ветер,Bwindi Trek,4,7200,USD,${quote.id}`);
    const perDmc = await asMod(http().get('/admin/bookings/export.csv?from=2026-10&to=2026-11&view=dmcs')).expect(200);
    expect(perDmc.text.trim().split('\r\n')[1]).toBe('2026-10,Северный Ветер,1,4');
  });

  it('CSV cells are quoted and formulas neutralised', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { toCsv } = require('../src/bookings/bookings.module');
    expect(toCsv(['a', 'b'], [['x, y', '=SUM(A1)'], ['say "hi"', null]])).toBe('a,b\r\n"x, y",\'=SUM(A1)\r\n"say ""hi""",\r\n');
  });
});
