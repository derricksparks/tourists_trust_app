import { INestApplication } from '@nestjs/common';
import { Operator } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { PrismaService } from '../src/common/prisma.service';
import { Mail, MailService } from '../src/mail/mail.service';
import { ScoringService } from '../src/scoring/scoring.service';
import { EmailChannel, NotificationChannel, OperatorNotifier, OutgoingMessage } from '../src/mail/channels';
import { DocumentStore } from '../src/storage/document-store';
import { signInitData } from '../src/telegram/init-data';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
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
  process.env.UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'ttp-pilot-uploads-'));
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

describe('pilot-readiness checks', () => {
  it('health reports uptime and the database check', async () => {
    const res = await http().get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', checks: { database: { ok: true } } });
    expect(res.body.uptimeSeconds).toEqual(expect.any(Number));
    expect(Object.keys(res.body).sort()).toEqual(['checks', 'startedAt', 'status', 'time', 'uptimeSeconds', 'version']);
  });

  it('the test-email script reports each address, including a refused one', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sendTestEmails } = require('../src/cli/send-test-email');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createServer } = require('net');
    const received: string[] = [];
    const server = createServer((socket: import('net').Socket) => {
      let inData = false;
      socket.write('220 test\r\n');
      socket.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().split('\r\n')) {
          if (!line) continue;
          if (inData) {
            if (line === '.') {
              inData = false;
              socket.write('250 2.0.0 queued as TEST1\r\n');
            } else received.push(line);
          } else if (/^(EHLO|HELO)/i.test(line)) socket.write('250 test\r\n');
          else if (/^RCPT TO:<[^>]*refused[^>]*>/i.test(line)) socket.write('550 5.7.1 recipient refused\r\n');
          else if (/^DATA/i.test(line)) {
            inData = true;
            socket.write('354 go\r\n');
          } else if (/^QUIT/i.test(line)) socket.end('221 bye\r\n');
          else socket.write('250 ok\r\n');
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const transport = require('nodemailer').createTransport(`smtp://127.0.0.1:${server.address().port}?ignoreTLS=true`);
      const results = await sendTestEmails(transport, ['me@mail.ru', 'refused@yandex.ru', 'not-an-address'], { from: { name: 'Проверено: Африка', address: 'no-reply@site.example' }, runId: 'RUN1' });
      expect(results.map((r: { ok: boolean }) => r.ok)).toEqual([true, false, false]);
      expect(results[0].detail).toContain('accepted');
      expect(results[1].detail).toMatch(/refused/);
      expect(results[2].detail).toBe('not an email address');
      // Headers and body are encoded (Cyrillic): decode the base64 body and look for the run id.
      const body = Buffer.from(received.filter((l) => /^[A-Za-z0-9+/=]+$/.test(l)).join(''), 'base64').toString('utf8');
      expect(body).toContain('Test RUN1');
    } finally {
      server.close();
    }
  });

  it('the DNS check finds SPF and DMARC, and spots a missing or duplicated record', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { checkSenderDns } = require('../src/cli/send-test-email');
    const zone: Record<string, string[][]> = {
      'good.example': [['v=spf1 include:_spf.provider.example ~all'], ['google-site-verification=x']],
      '_dmarc.good.example': [['v=DMARC1; p=none; rua=mailto:dmarc@good.example']],
      's1._domainkey.good.example': [['v=DKIM1; k=rsa; p=MIIBIjANBg']],
      'double.example': [['v=spf1 include:a ~all'], ['v=spf1 include:b ~all']],
    };
    const resolver = { resolveTxt: async (name: string) => { if (!zone[name]) throw new Error('ENOTFOUND'); return zone[name]; } };
    const good = await checkSenderDns('good.example', 's1', resolver);
    expect(good.map((c: { record: string; ok: boolean }) => [c.record, c.ok])).toEqual([['SPF', true], ['DMARC', true], ['DKIM', true]]);
    const bad = await checkSenderDns('double.example', undefined, resolver);
    expect(bad.map((c: { record: string; ok: boolean }) => [c.record, c.ok])).toEqual([['SPF', false], ['DMARC', false]]);
    expect(bad[0].detail).toContain('merge them into one');
  });
});

describe('restore drill (infra/production/restore-check.sh)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { execFileSync, spawnSync } = require('child_process');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { mkdtempSync, writeFileSync } = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require('path');
  // Needs PostgreSQL 16+ client tools (the server is 16); skipped where they aren't installed.
  const version = spawnSync('pg_dump', ['--version'], { encoding: 'utf8' });
  const hasTools = version.status === 0 && Number(/(\d+)\./.exec(version.stdout)?.[1] ?? 0) >= 16;
  const script = join(__dirname, '../../../infra/production/restore-check.sh');
  const url = new URL(process.env.DATABASE_URL!);
  const pgEnv = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: url.pathname.slice(1), CHECK_DB: 'ttp_restore_check_test' };

  (hasTools ? it : it.skip)('restores the newest backup into a scratch database, checks it and removes it; fails on a broken file', async () => {
    await operatorWithLogin();
    const dir = mkdtempSync(join(require('os').tmpdir(), 'ttp-backups-'));
    execFileSync('pg_dump', ['--format=custom', '-f', join(dir, 'ttp-2026-10-12T0300.dump')], { env: pgEnv });
    const ok = spawnSync('sh', [script], { env: { ...pgEnv, BACKUP_DIR: dir }, encoding: 'utf8' });
    expect(ok.stdout).toContain('PASS: restore check passed');
    expect(ok.stdout).toMatch(/operators: 1 rows/);
    expect(ok.status).toBe(0);
    const left = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_database WHERE datname = 'ttp_restore_check_test'`;
    expect(Number(left[0].n)).toBe(0);

    writeFileSync(join(dir, 'ttp-2026-10-13T0300.dump'), 'not a dump');
    const bad = spawnSync('sh', [script], { env: { ...pgEnv, BACKUP_DIR: dir }, encoding: 'utf8' });
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain('FAIL: not a readable pg_dump archive');
  });
});

describe('content safety: verified on, source, disclaimers', () => {
  let editor: string;
  let superAdmin: string;
  beforeEach(async () => {
    editor = await tokenFor(app, (await createAdmin(prisma, 'CONTENT_EDITOR')).email);
    superAdmin = await tokenFor(app, (await createAdmin(prisma, 'SUPER_ADMIN')).email);
  });
  const guide = { slug: 'kenya-eta', countryCode: 'KE', coveredCountries: ['KE'], visaType: 'eTA', titleRu: 'eTA в Кению', requirementsRu: 'Подайте онлайн.', status: 'PUBLISHED' };

  it('a visa guide counts as verified only with both a date and a source', async () => {
    const created = await bearer(http().post('/admin/visa-guides'), editor).send(guide).expect(201);
    let pub = await http().get('/public/visa-guides/kenya-eta').expect(200);
    expect(pub.body).toMatchObject({ verified: false, verifiedOn: null, sourceUrl: null });

    await bearer(http().patch(`/admin/visa-guides/${created.body.id}`), editor).send({ verifiedOn: '2026-09-28' }).expect(200);
    pub = await http().get('/public/visa-guides/kenya-eta').expect(200);
    expect(pub.body).toMatchObject({ verified: false, verifiedOn: '2026-09-28' });

    await bearer(http().patch(`/admin/visa-guides/${created.body.id}`), editor).send({ sourceUrl: 'https://www.etakenya.go.ke/requirements' }).expect(200);
    pub = await http().get('/public/visa-guides/kenya-eta').expect(200);
    expect(pub.body).toMatchObject({ verified: true, verifiedOn: '2026-09-28', sourceUrl: 'https://www.etakenya.go.ke/requirements' });
    expect((await http().get('/public/visa-guides').expect(200)).body[0].verified).toBe(true);

    // Ticking "facts verified" records today; a future day or a non-web source is refused.
    await bearer(http().patch(`/admin/visa-guides/${created.body.id}`), editor).send({ factsVerified: true }).expect(200);
    expect((await http().get('/public/visa-guides/kenya-eta')).body.verifiedOn).toBe(new Date().toISOString().slice(0, 10));
    await bearer(http().patch(`/admin/visa-guides/${created.body.id}`), editor).send({ verifiedOn: '2099-01-01' }).expect(400);
    await bearer(http().patch(`/admin/visa-guides/${created.body.id}`), editor).send({ sourceUrl: 'ftp://example.com/x' }).expect(400);
    // Clearing the source puts the notice back.
    await bearer(http().patch(`/admin/visa-guides/${created.body.id}`), editor).send({ sourceUrl: null }).expect(200);
    expect((await http().get('/public/visa-guides/kenya-eta')).body.verified).toBe(false);
  });

  it('an insurer counts as verified only with both a date and a source', async () => {
    const base = { name: 'Demo Insurer', countriesCovered: ['UG'], claimsContact: '+7 000 (demo)', published: true };
    const created = await bearer(http().post('/admin/insurers'), editor).send({ ...base, factsVerified: true }).expect(201);
    let pub = await http().get('/public/insurers').expect(200);
    expect(pub.body[0]).toMatchObject({ verified: false, sourceUrl: null });
    expect(pub.body[0].verifiedAt).not.toBeNull();

    await bearer(http().patch(`/admin/insurers/${created.body.id}`), editor).send({ sourceUrl: 'https://insurer.example/terms', verifiedOn: '2026-09-01' }).expect(200);
    pub = await http().get('/public/insurers').expect(200);
    expect(pub.body[0]).toMatchObject({ verified: true, sourceUrl: 'https://insurer.example/terms', verifiedAt: '2026-09-01T00:00:00.000Z' });

    await bearer(http().patch(`/admin/insurers/${created.body.id}`), editor).send({ verifiedOn: null }).expect(200);
    pub = await http().get('/public/insurers').expect(200);
    expect(pub.body[0]).toMatchObject({ verified: false, verifiedAt: null });
  });

  it('disclaimers have standard wording until a super admin replaces it; the change is recorded', async () => {
    const before = await http().get('/public/disclaimers').expect(200);
    expect(before.body.visa).toContain('справочный');
    expect(before.body.insurance).toContain('договор страхования');

    const lawyer = 'Текст юриста для визовых страниц (демо). Проверьте требования на официальном сайте.';
    await bearer(http().put('/admin/settings'), editor).send({ disclaimerVisa: lawyer }).expect(403);
    await asMod(http().put('/admin/settings')).send({ disclaimerVisa: lawyer }).expect(403);
    await bearer(http().put('/admin/settings'), superAdmin).send({ disclaimerVisa: 'short' }).expect(400);
    const saved = await bearer(http().put('/admin/settings'), superAdmin).send({ disclaimerVisa: lawyer }).expect(200);
    expect(saved.body).toMatchObject({ disclaimerVisa: lawyer, disclaimerVisaIsDefault: false, disclaimerInsuranceIsDefault: true });
    expect(saved.body.updated[0]).toMatchObject({ key: 'disclaimer.visa', by: 'Test SUPER_ADMIN' });

    const after = await http().get('/public/disclaimers').expect(200);
    expect(after.body.visa).toBe(lawyer);
    expect(after.body.insurance).toBe(before.body.insurance);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'setting.update' } });
    expect(audit.metadata).toMatchObject({ key: 'disclaimer.visa', after: lawyer });
    // Any staff member can read the settings.
    expect((await bearer(http().get('/admin/settings'), editor).expect(200)).body.disclaimerVisa).toBe(lawyer);
  });
});

describe('document retention', () => {
  let superAdmin: string;
  let store: DocumentStore;
  beforeEach(async () => {
    superAdmin = await tokenFor(app, (await createAdmin(prisma, 'SUPER_ADMIN')).email);
    store = app.get(DocumentStore);
  });
  const addDoc = async (operatorId: string, daysAgo: number, type: 'TOURISM_LICENSE' | 'BUSINESS_REGISTRATION' = 'TOURISM_LICENSE') =>
    prisma.operatorDocument.create({
      data: {
        operatorId, type, storageKey: await store.put(`documents/${operatorId}`, Buffer.from('%PDF-1.4 demo')), originalFilename: 'licence.pdf', contentType: 'application/pdf', sizeBytes: 13,
        createdAt: new Date(Date.now() - daysAgo * 86_400_000), reviewedAt: new Date(), reviewNotes: 'Matches the register',
      },
    });

  it('a super admin sets the period; files past it are listed; nothing is listed without a period', async () => {
    const { op } = await operatorWithLogin();
    const old = await addDoc(op.id, 400);
    await addDoc(op.id, 10, 'BUSINESS_REGISTRATION');
    expect((await asMod(http().get('/admin/documents/retention')).expect(200)).body).toEqual({ retentionDays: null, documents: [] });

    await asMod(http().put('/admin/settings')).send({ documentRetentionDays: 365 }).expect(403);
    await bearer(http().put('/admin/settings'), superAdmin).send({ documentRetentionDays: 5 }).expect(400);
    await bearer(http().put('/admin/settings'), superAdmin).send({ documentRetentionDays: 365 }).expect(200);
    const due = await asMod(http().get('/admin/documents/retention')).expect(200);
    expect(due.body.retentionDays).toBe(365);
    expect(due.body.documents.map((d: { id: string }) => d.id)).toEqual([old.id]);
    expect(due.body.documents[0].operator).toMatchObject({ id: op.id, name: 'Alpha Safaris' });

    // Back to "keep until deleted by hand".
    const cleared = await bearer(http().put('/admin/settings'), superAdmin).send({ documentRetentionDays: null }).expect(200);
    expect(cleared.body.documentRetentionDays).toBeNull();
    expect((await asMod(http().get('/admin/documents/retention'))).body.documents).toEqual([]);
  });

  it('staff delete a licence copy: the file is erased, the record stays, and the history says who and why', async () => {
    const { op, token } = await operatorWithLogin();
    const doc = await addDoc(op.id, 30);
    const editor = await tokenFor(app, (await createAdmin(prisma, 'CONTENT_EDITOR')).email);
    await bearer(http().delete(`/admin/operators/${op.id}/documents/${doc.id}`), editor).send({ reason: 'Retention' }).expect(403);
    await asMod(http().delete(`/admin/operators/${op.id}/documents/${doc.id}`)).send({}).expect(400);

    const res = await asMod(http().delete(`/admin/operators/${op.id}/documents/${doc.id}`)).send({ reason: 'Operator asked us to remove it' }).expect(200);
    expect(res.body.deletedAt).not.toBeNull();
    expect(res.body.deletedBy.name).toBe('Test MODERATOR');
    expect(await store.get(doc.storageKey)).toBeNull();

    const detail = await asMod(http().get(`/admin/operators/${op.id}`)).expect(200);
    expect(detail.body.documents[0]).toMatchObject({ id: doc.id, reviewNotes: 'Matches the register' });
    expect(detail.body.history[0]).toMatchObject({ action: 'operator.document_delete', reason: 'Operator asked us to remove it' });
    expect(detail.body.history[0].metadata).toMatchObject({ documentId: doc.id, type: 'TOURISM_LICENSE' });

    await asMod(http().get(`/admin/operators/${op.id}/documents/${doc.id}/file`)).expect(410);
    await asMod(http().delete(`/admin/operators/${op.id}/documents/${doc.id}`)).send({ reason: 'again' }).expect(410);
    // The operator no longer sees it, and can't open it.
    expect((await bearer(http().get('/portal/operator/application'), token).expect(200)).body.documents).toEqual([]);
    await bearer(http().get(`/portal/operator/documents/${doc.id}/file`), token).expect(404);
  });

  it('a super admin deletes everything past the period at once; each deletion is recorded', async () => {
    const { op } = await operatorWithLogin();
    const a = await addDoc(op.id, 800);
    const b = await addDoc(op.id, 760, 'BUSINESS_REGISTRATION');
    const keep = await addDoc(op.id, 100);
    await bearer(http().put('/admin/settings'), superAdmin).send({ documentRetentionDays: 730 }).expect(200);
    await asMod(http().post('/admin/documents/retention/purge')).expect(403);
    expect((await bearer(http().post('/admin/documents/retention/purge'), superAdmin).expect(200)).body).toEqual({ deleted: 2 });
    const rows = await prisma.operatorDocument.findMany({ where: { operatorId: op.id }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => [r.id, !!r.deletedAt])).toEqual([[a.id, true], [b.id, true], [keep.id, false]]);
    expect(await store.get(keep.storageKey)).not.toBeNull();
    const audits = await prisma.auditLog.findMany({ where: { action: 'operator.document_delete' } });
    expect(audits).toHaveLength(2);
    expect(audits[0].metadata).toMatchObject({ retentionDays: 730 });
    expect((await asMod(http().get('/admin/documents/retention'))).body.documents).toEqual([]);
  });
});

describe('operator notification channel', () => {
  it('defaults to email; operators and staff can set it, only to a channel that exists today', async () => {
    const { op, token } = await operatorWithLogin();
    expect(op.preferredChannel).toBe('EMAIL');
    expect((await bearer(http().get('/portal/operator/application'), token).expect(200)).body.preferredChannel).toBe('EMAIL');

    const refused = await bearer(http().put('/portal/operator/notification-channel'), token).send({ preferredChannel: 'WHATSAPP' }).expect(400);
    expect(JSON.stringify(refused.body)).toContain('WhatsApp notifications are not available yet');
    await bearer(http().put('/portal/operator/notification-channel'), token).send({ preferredChannel: 'PIGEON' }).expect(400);
    await bearer(http().put('/portal/operator/notification-channel'), token).send({ preferredChannel: 'EMAIL' }).expect(200);
    await asMod(http().put(`/admin/operators/${op.id}/notification-channel`)).send({ preferredChannel: 'TELEGRAM' }).expect(400);
    const editor = await tokenFor(app, (await createAdmin(prisma, 'CONTENT_EDITOR')).email);
    await bearer(http().put(`/admin/operators/${op.id}/notification-channel`), editor).send({ preferredChannel: 'EMAIL' }).expect(403);

    // A real change is recorded in the operator's history.
    await prisma.operator.update({ where: { id: op.id }, data: { preferredChannel: 'TELEGRAM' } });
    await asMod(http().put(`/admin/operators/${op.id}/notification-channel`)).send({ preferredChannel: 'EMAIL' }).expect(200);
    const detail = await asMod(http().get(`/admin/operators/${op.id}`)).expect(200);
    expect(detail.body.preferredChannel).toBe('EMAIL');
    expect(detail.body.history[0]).toMatchObject({ action: 'operator.notification_channel', metadata: { from: 'TELEGRAM', to: 'EMAIL' } });
  });

  it('a new channel plugs in: the preferred one is used when it can reach the operator, email otherwise', async () => {
    const sent: { to: string[]; message: OutgoingMessage }[] = [];
    const fakeTelegram: NotificationChannel = {
      kind: 'TELEGRAM',
      addresses: (c) => (c.telegramUsername ? [c.telegramUsername] : []),
      send: async (to, message) => void sent.push({ to, message }),
    };
    const notifier = new OperatorNotifier(prisma, [app.get(EmailChannel), fakeTelegram]);
    const { op } = await operatorWithLogin();
    const message = { subject: 'New question from a traveller', text: 'Hello' };

    expect(await notifier.send(op.id, message)).toEqual({ channel: 'EMAIL', to: ['staff@alpha.example'] });
    await prisma.operator.update({ where: { id: op.id }, data: { preferredChannel: 'TELEGRAM', telegramUsername: 'alpha_ops' } });
    expect(await notifier.send(op.id, message)).toEqual({ channel: 'TELEGRAM', to: ['alpha_ops'] });
    expect(sent).toEqual([{ to: ['alpha_ops'], message }]);
    // Can't reach them on Telegram: falls back to email.
    await prisma.operator.update({ where: { id: op.id }, data: { telegramUsername: null } });
    expect(await notifier.send(op.id, message)).toEqual({ channel: 'EMAIL', to: ['staff@alpha.example'] });
    // The running API has email only, so a stored TELEGRAM preference still reaches them by email.
    await prisma.operator.update({ where: { id: op.id }, data: { telegramUsername: 'alpha_ops' } });
    mail.sent.length = 0;
    expect(await app.get(OperatorNotifier).send(op.id, message)).toEqual({ channel: 'EMAIL', to: ['staff@alpha.example'] });
    expect(mail.sent).toHaveLength(1);
    // Nobody can sign in and no other channel reaches them: nothing is sent.
    await prisma.account.updateMany({ where: { operatorId: op.id }, data: { active: false } });
    await prisma.operator.update({ where: { id: op.id }, data: { telegramUsername: null } });
    expect(await notifier.send(op.id, { subject: 'x', text: 'y' })).toBeNull();
  });
});
