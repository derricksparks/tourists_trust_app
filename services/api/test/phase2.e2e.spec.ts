import { INestApplication } from '@nestjs/common';
import { AdminUser, Operator } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/common/prisma.service';
import { botInternalSecret } from '../src/telegram/bot-api';
import { signInitData } from '../src/telegram/init-data';
import { startFakeTelegram } from './fake-telegram';
import { createAdmin, createApp, resetDb, tokenFor, validOperator } from './helpers';

const BOT_TOKEN = '777:phase2-test-token';
let app: INestApplication;
let prisma: PrismaService;
let tg: Awaited<ReturnType<typeof startFakeTelegram>>;
let moderator: AdminUser;
let modToken: string;
let editorToken: string;

beforeAll(async () => {
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  process.env.SITE_URL = 'https://site.example';
  delete process.env.WEB_REVALIDATE_URL;
  tg = await startFakeTelegram(BOT_TOKEN);
  process.env.TELEGRAM_API_BASE = tg.url;
  ({ app, prisma } = await createApp());
});
afterAll(async () => {
  await app.close();
  tg.close();
});
beforeEach(async () => {
  await resetDb(prisma);
  tg.messages.length = 0;
  tg.blocked.clear();
  moderator = await createAdmin(prisma, 'MODERATOR');
  modToken = await tokenFor(app, moderator.email);
  editorToken = await tokenFor(app, (await createAdmin(prisma, 'CONTENT_EDITOR')).email);
});

const http = () => request(app.getHttpServer());
const asMod = (r: request.Test) => r.set('Authorization', `Bearer ${modToken}`);
const asEditor = (r: request.Test) => r.set('Authorization', `Bearer ${editorToken}`);
const initData = (id: number, username?: string) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: `User${id}`, ...(username && { username }) }) }, BOT_TOKEN);
const asTelegram = (r: request.Test, id: number, username?: string) => r.set('Authorization', `tma ${initData(id, username)}`);
const fromBot = (r: request.Test) => r.set('X-Bot-Secret', botInternalSecret(BOT_TOKEN));

const signup = {
  name: 'Amina Demo',
  languages: ['ru', 'sw', 'en'],
  proficiency: { ru: 'C1', sw: 'native', en: 'C2' },
  specialtyCountryCode: 'TZ',
  specialties: ['safari_guide', 'live_interpretation'],
  bioRu: 'Гид в Аруше.',
  phone: '+255 000',
  consent: true,
};

async function verifiedTranslator(telegramId = 5001) {
  const res = await asTelegram(http().post('/public/telegram/translator-signup'), telegramId, 'amina_tz').send(signup).expect(201);
  await asMod(http().post(`/admin/translators/${res.body.id}/decision`)).send({ decision: 'verify', notes: 'Video call in Russian' }).expect(200);
  return res.body.id as string;
}

describe('translators', () => {
  it('signs up from the Mini App as pending, once', async () => {
    const res = await asTelegram(http().post('/public/telegram/translator-signup'), 5001, 'amina_tz').send(signup).expect(201);
    expect(res.body.status).toBe('PENDING');
    const t = await prisma.translator.findUniqueOrThrow({ where: { id: res.body.id }, include: { telegramUser: true } });
    expect(t).toMatchObject({ telegramUsername: 'amina_tz', specialtyCountryCode: 'TZ' });
    expect(t.telegramUser?.telegramId).toBe(BigInt(5001));
    const again = await asTelegram(http().post('/public/telegram/translator-signup'), 5001).send(signup).expect(409);
    expect(again.body.message).toContain('на проверке');
  });

  it('requires Russian and a level for every language', async () => {
    await asTelegram(http().post('/public/telegram/translator-signup'), 1).send({ ...signup, languages: ['en', 'sw'] }).expect(400);
    await asTelegram(http().post('/public/telegram/translator-signup'), 1).send({ ...signup, proficiency: { ru: 'C1' } }).expect(400);
  });

  it('lists only verified translators, without contact details, and tells them in Telegram', async () => {
    await asTelegram(http().post('/public/telegram/translator-signup'), 5002).send({ ...signup, name: 'Pending Person' }).expect(201);
    await verifiedTranslator();
    expect(tg.to(5001).at(-1)?.text).toContain('опубликован в каталоге');

    const res = await http().get('/public/translators?country=TZ&specialty=safari_guide').expect(200);
    expect(res.body.map((t: { name: string }) => t.name)).toEqual(['Amina Demo']);
    expect(JSON.stringify(res.body)).not.toMatch(/phone|\+255|telegram|amina_tz|spotCheck/);
    expect((await http().get('/public/translators?country=UG')).body).toEqual([]);
  });

  it('only moderators verify, and a reason is kept', async () => {
    const res = await asTelegram(http().post('/public/telegram/translator-signup'), 5001).send(signup).expect(201);
    await asEditor(http().post(`/admin/translators/${res.body.id}/decision`)).send({ decision: 'verify', notes: 'ok ok' }).expect(403);
    await asMod(http().post(`/admin/translators/${res.body.id}/decision`)).send({ decision: 'verify' }).expect(400);
    await asMod(http().post(`/admin/translators/${res.body.id}/decision`)).send({ decision: 'suspend', notes: 'nope' }).expect(409);
  });
});

describe('translation jobs', () => {
  const job = (translatorId: string) => ({
    translatorId, type: 'LIVE', sourceLanguage: 'ru', targetLanguage: 'sw', description: 'Нужна помощь на рынке в Аруше, 2 часа.',
    scheduledAt: '2027-02-10T09:00:00Z', consent: true,
  });

  it('runs offer → accept → handoff → complete → rating', async () => {
    const translatorId = await verifiedTranslator(5001);
    tg.messages.length = 0;
    const created = await asTelegram(http().post('/public/telegram/translation-jobs'), 9001, 'olga_tourist').send(job(translatorId)).expect(201);
    const jobId = created.body.id;
    expect((await prisma.translationJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('ASSIGNED');
    const offer = tg.to(5001).at(-1)!;
    expect(offer.text).toContain('устный перевод');
    expect(offer.text).toContain('русский → суахили');
    expect(offer.reply_markup?.inline_keyboard[0].map((b) => b.callback_data)).toEqual([`job:accept:${jobId}`, `job:decline:${jobId}`]);

    await http().post(`/bot/jobs/${jobId}/action`).send({ telegramId: 5001, action: 'accept' }).expect(401);
    await fromBot(http().post(`/bot/jobs/${jobId}/action`)).send({ telegramId: 9001, action: 'accept' }).expect(403);
    await fromBot(http().post(`/bot/jobs/${jobId}/action`)).send({ telegramId: 5001, action: 'accept' }).expect(200);
    await fromBot(http().post(`/bot/jobs/${jobId}/action`)).send({ telegramId: 5001, action: 'accept' }).expect(409);
    expect(tg.to(9001).at(-1)?.text).toContain('@amina_tz');
    expect(tg.to(5001).at(-1)?.text).toContain('@olga_tourist');

    await fromBot(http().post(`/bot/jobs/${jobId}/action`)).send({ telegramId: 5001, action: 'complete' }).expect(200);
    const ask = tg.to(9001).at(-1)!;
    expect(ask.reply_markup?.inline_keyboard[0].map((b) => b.callback_data)).toEqual([1, 2, 3, 4, 5].map((n) => `job:rate:${jobId}:${n}`));

    await fromBot(http().post(`/bot/jobs/${jobId}/rate`)).send({ telegramId: 5001, rating: 5 }).expect(403);
    await fromBot(http().post(`/bot/jobs/${jobId}/rate`)).send({ telegramId: 9001, rating: 4 }).expect(200);
    await fromBot(http().post(`/bot/jobs/${jobId}/rate`)).send({ telegramId: 9001, rating: 1 }).expect(409);
    const t = await prisma.translator.findUniqueOrThrow({ where: { id: translatorId } });
    expect({ jobsCompleted: t.jobsCompleted, rating: Number(t.rating) }).toEqual({ jobsCompleted: 1, rating: 4 });
    expect((await http().get('/public/translators')).body[0]).toMatchObject({ jobsCompleted: 1, rating: 4 });
  });

  it('a decline goes back to staff, who reassign', async () => {
    const translatorId = await verifiedTranslator(5001);
    const created = await asTelegram(http().post('/public/telegram/translation-jobs'), 9001).send(job(translatorId)).expect(201);
    await fromBot(http().post(`/bot/jobs/${created.body.id}/action`)).send({ telegramId: 5001, action: 'decline' }).expect(200);
    expect(await prisma.translationJob.findUniqueOrThrow({ where: { id: created.body.id } })).toMatchObject({ status: 'REQUESTED', translatorId: null });
    expect(tg.to(9001).at(-1)?.text).toContain('подберём другого');

    const stats = await asMod(http().get('/admin/stats')).expect(200);
    expect(stats.body.translationJobsOpen).toBe(1);
    const assigned = await asMod(http().post(`/admin/translation-jobs/${created.body.id}/assign`)).send({ translatorId }).expect(200);
    expect(assigned.body).toMatchObject({ offerDelivered: true, job: { status: 'ASSIGNED' } });
  });

  it('a translator who cannot be reached leaves the job with staff', async () => {
    const t = await prisma.translator.create({
      data: { name: 'No Telegram', languages: ['ru', 'en'], specialtyCountryCode: 'UG', specialties: ['documents'], verificationStatus: 'VERIFIED' },
    });
    const created = await asTelegram(http().post('/public/telegram/translation-jobs'), 9001).send({ ...job(t.id), type: 'DOCUMENT', targetLanguage: 'en' }).expect(201);
    expect((await prisma.translationJob.findUniqueOrThrow({ where: { id: created.body.id } })).status).toBe('REQUESTED');
  });

  it('refuses unverified translators and identical languages', async () => {
    const res = await asTelegram(http().post('/public/telegram/translator-signup'), 5001).send(signup).expect(201);
    await asTelegram(http().post('/public/telegram/translation-jobs'), 9001).send(job(res.body.id)).expect(404);
    await asTelegram(http().post('/public/telegram/translation-jobs'), 9001).send({ ...job(res.body.id), targetLanguage: 'ru' }).expect(400);
  });
});

describe('insurers', () => {
  const insurer = { name: 'Demo Insurer', countriesCovered: ['UG', 'KE'], claimsContact: '+7 000', repatriationConfirmed: true, coverageRu: 'Медицина', notes: 'internal: called on 3 Oct', published: true };

  it('editors maintain them; the public sees published ones without internal notes', async () => {
    await asMod(http().post('/admin/insurers')).send(insurer).expect(403);
    const created = await asEditor(http().post('/admin/insurers')).send({ ...insurer, factsVerified: true }).expect(201);
    expect(created.body.verifiedAt).toBeTruthy();
    await asEditor(http().post('/admin/insurers')).send({ ...insurer, name: 'Hidden', published: false }).expect(201);
    const pub = await http().get('/public/insurers').expect(200);
    expect(pub.body.map((i: { name: string }) => i.name)).toEqual(['Demo Insurer']);
    expect(JSON.stringify(pub.body)).not.toContain('internal');
  });
});

describe('review invites', () => {
  let op: Operator;
  beforeEach(async () => {
    op = await prisma.operator.create({ data: { ...validOperator, countryCode: 'UG', slug: 'alpha', badgeToken: 'b-alpha', status: 'APPROVED' } });
  });
  const invite = (extra: object = {}) =>
    asMod(http().post('/admin/review-invites')).send({ operatorId: op.id, recipientName: 'Ольга', recipientContact: 'olga@example.com', tripDate: '2026-08-01', ...extra });
  const review = { authorName: 'Ольга', rating: 5, ratingGuide: 5, bodyRu: 'Всё прошло отлично, гид встретил вовремя и всё объяснил.', consent: true };
  const tokenOf = (link: string) => link.split('/').pop()!;

  it('gives a one-time link that creates exactly one pending review', async () => {
    const res = await invite().expect(201);
    expect(res.body.link).toMatch(/^https:\/\/site\.example\/review\/[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(res.body.invite)).not.toContain(tokenOf(res.body.link));
    const t = tokenOf(res.body.link);

    expect((await http().get(`/public/review-invites/${t}`).expect(200)).body).toMatchObject({ state: 'open', operatorName: validOperator.name, recipientName: 'Ольга' });
    await http().post(`/public/review-invites/${t}`).send({ ...review, consent: false }).expect(400);
    const [a, b] = await Promise.all([http().post(`/public/review-invites/${t}`).send(review), http().post(`/public/review-invites/${t}`).send(review)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await prisma.review.count({ where: { operatorId: op.id } })).toBe(1);
    expect((await prisma.review.findFirstOrThrow()).status).toBe('PENDING');
    expect((await http().get(`/public/review-invites/${t}`)).body.state).toBe('used');
  });

  it('revoked and expired links stop working; unknown links are 404', async () => {
    const r1 = await invite().expect(201);
    await asMod(http().post(`/admin/review-invites/${r1.body.invite.id}/revoke`)).expect(200);
    await http().post(`/public/review-invites/${tokenOf(r1.body.link)}`).send(review).expect(409);
    const r2 = await invite().expect(201);
    await prisma.reviewInvite.update({ where: { id: r2.body.invite.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await http().get(`/public/review-invites/${tokenOf(r2.body.link)}`)).body.state).toBe('expired');
    await http().post(`/public/review-invites/${tokenOf(r2.body.link)}`).send(review).expect(409);
    await http().get(`/public/review-invites/${'x'.repeat(43)}`).expect(404);
  });

  it('can invite the traveller from an inquiry, once, and sends the link in Telegram', async () => {
    const user = await prisma.telegramUser.create({ data: { telegramId: BigInt(9001), username: 'olga' } });
    const inquiry = await prisma.inquiry.create({ data: { operatorId: op.id, telegramUserId: user.id, message: 'Есть ли места?' } });
    const res = await invite({ inquiryId: inquiry.id, recipientContact: '@olga' }).expect(201);
    expect(res.body.sentInTelegram).toBe(true);
    expect(tg.to(9001)[0].reply_markup?.inline_keyboard[0][0]).toEqual({ text: 'Оставить отзыв', url: res.body.link });
    await invite({ inquiryId: inquiry.id }).expect(409);
  });

  it('counts invites against reviews per operator', async () => {
    const used = await invite().expect(201);
    await invite().expect(201);
    const revoked = await invite().expect(201);
    await http().post(`/public/review-invites/${tokenOf(used.body.link)}`).send(review).expect(201);
    await asMod(http().post(`/admin/review-invites/${revoked.body.invite.id}/revoke`)).expect(200);
    const stats = await asMod(http().get(`/admin/operators/${op.id}/invite-stats`)).expect(200);
    expect(stats.body).toEqual({ sent: 3, used: 1, open: 1, expired: 0, revoked: 1, published: 0, fromInquiries: 0 });
  });

  it('refuses operators that are not approved', async () => {
    const pending = await prisma.operator.create({ data: { ...validOperator, countryCode: 'UG', slug: 'p', badgeToken: 'b-p' } });
    await asMod(http().post('/admin/review-invites')).send({ operatorId: pending.id, recipientName: 'X', recipientContact: 'x@x.co', tripDate: '2026-08-01' }).expect(409);
  });
});
