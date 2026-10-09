import { INestApplication } from '@nestjs/common';
import { OperatorStatus } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { PrismaService } from '../src/common/prisma.service';
import { signInitData, validateInitData } from '../src/telegram/init-data';
import { createAdmin, createApp, resetDb, tokenFor, validOperator } from './helpers';

const BOT_TOKEN = '123456:TEST-bot-token';
let app: INestApplication;
let prisma: PrismaService;
let revalidations: string[][] = [];
let sentMessages: { chat_id: string; text: string }[] = [];
let hookServer: Server;
let telegramServer: Server;

beforeAll(async () => {
  // Stand-in for the public site's revalidation endpoint.
  hookServer = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.headers.authorization === 'Bearer hook-secret') revalidations.push(JSON.parse(body).tags);
      res.end('{}');
    });
  });
  await new Promise<void>((r) => hookServer.listen(0, r));
  process.env.WEB_REVALIDATE_URL = `http://127.0.0.1:${(hookServer.address() as AddressInfo).port}/api/revalidate`;
  process.env.REVALIDATE_SECRET = 'hook-secret';
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  // Stand-in for api.telegram.org: chat 666 has blocked the bot.
  telegramServer = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const msg = JSON.parse(body);
      if (req.url !== `/bot${BOT_TOKEN}/sendMessage`) return res.end(JSON.stringify({ ok: false, error_code: 404, description: 'Not Found' }));
      if (msg.chat_id === '666') return res.end(JSON.stringify({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }));
      sentMessages.push(msg);
      res.end(JSON.stringify({ ok: true, result: {} }));
    });
  });
  await new Promise<void>((r) => telegramServer.listen(0, r));
  process.env.TELEGRAM_API_BASE = `http://127.0.0.1:${(telegramServer.address() as AddressInfo).port}`;
  ({ app, prisma } = await createApp());
});
afterAll(async () => {
  await app.close();
  hookServer.close();
  telegramServer.close();
});
beforeEach(async () => {
  await resetDb(prisma);
  revalidations = [];
  sentMessages = [];
});

const http = () => request(app.getHttpServer());

async function operator(name: string, status: OperatorStatus, countryCode = 'UG') {
  const slug = name.toLowerCase().replace(/\W+/g, '-');
  return prisma.operator.create({
    data: {
      ...validOperator, name, slug, countryCode, status, badgeToken: `badge-${slug}`, statusReason: 'internal note',
      referenceContactInfo: 'secret-reference@example.com', approvedAt: status === 'APPROVED' ? new Date('2026-09-01') : null,
    },
  });
}

async function publishedReview(operatorId: string, rating: number, status: 'PUBLISHED' | 'PENDING' = 'PUBLISHED') {
  const admin = (await prisma.adminUser.findFirst()) ?? (await createAdmin(prisma, 'SUPER_ADMIN'));
  const invite = await prisma.reviewInvite.create({
    data: {
      tokenHash: createHash('sha256').update(randomUUID()).digest('hex'), operatorId, recipientName: 'T', recipientContact: 't@x.co',
      tripDate: new Date('2026-08-01'), issuedById: admin.id, expiresAt: new Date('2027-01-01'), usedAt: new Date(),
    },
  });
  return prisma.review.create({ data: { operatorId, inviteId: invite.id, authorName: 'A', rating, bodyRu: 'Текст', tripDate: new Date('2026-08-01'), status } });
}

describe('public operators', () => {
  it('lists only approved operators, with ratings from published reviews only', async () => {
    const a = await operator('Alpha Safaris', 'APPROVED');
    await operator('Beta Pending', 'PENDING');
    await operator('Gamma Suspended', 'SUSPENDED');
    await publishedReview(a.id, 5);
    await publishedReview(a.id, 4);
    await publishedReview(a.id, 1, 'PENDING');

    const res = await http().get('/public/operators').expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ name: 'Alpha Safaris', reviewCount: 2, averageRating: 4.5, verifiedSince: '2026-09-01T00:00:00.000Z' });
  });

  it('never exposes internal fields', async () => {
    await operator('Alpha Safaris', 'APPROVED');
    const res = await http().get('/public/operators/alpha-safaris').expect(200);
    const text = JSON.stringify(res.body);
    for (const leak of ['statusReason', 'internal note', 'secret-reference', 'badgeToken', 'badge-alpha', 'referenceContact']) {
      expect(text).not.toContain(leak);
    }
  });

  it('returns 404 for an operator that is not approved', async () => {
    await operator('Beta Pending', 'PENDING');
    await http().get('/public/operators/beta-pending').expect(404);
  });

  it('counts approved operators per country', async () => {
    await operator('Alpha', 'APPROVED', 'UG');
    await operator('Beta', 'APPROVED', 'KE');
    await operator('Gamma', 'PENDING', 'KE');
    const res = await http().get('/public/countries').expect(200);
    expect(Object.fromEntries(res.body.map((c: { code: string; operatorCount: number }) => [c.code, c.operatorCount]))).toEqual({ UG: 1, KE: 1, TZ: 0 }); // Russia is the demand side and is not listed
  });
});

describe('badge', () => {
  it('shows verified, revoked or not verified, and is readable from any website', async () => {
    await operator('Alpha', 'APPROVED');
    await operator('Gamma', 'SUSPENDED');
    await operator('Beta', 'PENDING');

    const ok = await http().get('/public/badge/badge-alpha').expect(200);
    expect(ok.headers['access-control-allow-origin']).toBe('*');
    expect(ok.body).toMatchObject({ state: 'verified', operator: { name: 'Alpha', slug: 'alpha' } });
    expect((await http().get('/public/badge/badge-gamma')).body).toMatchObject({ state: 'revoked', operator: { verifiedSince: null } });
    expect((await http().get('/public/badge/badge-beta')).body).toEqual({ state: 'not_verified' });
    expect((await http().get('/public/badge/nope')).body).toEqual({ state: 'not_verified' });
  });

  it('tells the public site to refresh when an operator is suspended', async () => {
    const op = await operator('Alpha', 'APPROVED');
    const mod = await createAdmin(prisma, 'MODERATOR');
    await http()
      .post(`/admin/operators/${op.id}/decision`)
      .set('Authorization', `Bearer ${await tokenFor(app, mod.email)}`)
      .send({ decision: 'suspend', reason: 'Licence expired' })
      .expect(200);
    await new Promise((r) => setTimeout(r, 200));
    expect(revalidations).toEqual([['operators']]);
  });
});

describe('Telegram Mini App', () => {
  const now = () => String(Math.floor(Date.now() / 1000));
  const initData = (id = 4242, authDate = now()) =>
    signInitData({ auth_date: authDate, query_id: 'AAA', user: JSON.stringify({ id, first_name: 'Ольга', username: 'olga_demo', language_code: 'ru' }) }, BOT_TOKEN);
  const send = (data: string, body: object) => http().post('/public/telegram/inquiries').set('Authorization', `tma ${data}`).send(body);
  const body = { operatorSlug: 'alpha', message: 'Есть ли места на февраль для двоих?', travelMonth: '2027-02', groupSize: 2, consent: true };

  it('validates initData signatures and age', () => {
    const good = initData();
    expect(validateInitData(good, BOT_TOKEN)?.id).toBe(4242);
    expect(validateInitData(good, 'other:token')).toBeNull();
    expect(validateInitData(good.replace('4242', '4243'), BOT_TOKEN)).toBeNull();
    expect(validateInitData(initData(1, String(Math.floor(Date.now() / 1000) - 2 * 86400)), BOT_TOKEN)).toBeNull();
  });

  it('creates an inquiry and the Telegram user, recording consent', async () => {
    const op = await operator('Alpha', 'APPROVED');
    const res = await send(initData(), body).expect(201);
    expect(res.body).toMatchObject({ operatorName: 'Alpha' });
    const inquiry = await prisma.inquiry.findUniqueOrThrow({ where: { id: res.body.id }, include: { telegramUser: true } });
    expect(inquiry).toMatchObject({ operatorId: op.id, status: 'NEW', contactInfo: '@olga_demo', groupSize: 2 });
    expect(inquiry.telegramUser?.telegramId).toBe(BigInt(4242));
    expect(inquiry.telegramUser?.consentAt).toBeInstanceOf(Date);
  });

  it('rejects forged data, missing consent and unapproved operators', async () => {
    await operator('Alpha', 'APPROVED');
    await operator('Beta', 'PENDING');
    await send(initData().replace(/hash=[0-9a-f]+/, `hash=${'0'.repeat(64)}`), body).expect(401);
    await http().post('/public/telegram/inquiries').send(body).expect(401);
    await send(initData(), { ...body, consent: false }).expect(400);
    await send(initData(), { ...body, operatorSlug: 'beta' }).expect(404);
  });

  it('limits a user to five inquiries an hour', async () => {
    await operator('Alpha', 'APPROVED');
    for (let i = 0; i < 5; i++) await send(initData(), body).expect(201);
    await send(initData(), body).expect(429);
    await send(initData(777), body).expect(201);
  });
});

describe('admin inquiries', () => {
  it('marks an inquiry responded once, then closed', async () => {
    const op = await operator('Alpha', 'APPROVED');
    const inquiry = await prisma.inquiry.create({ data: { operatorId: op.id, message: 'Hello there, any space?' } });
    const token = await tokenFor(app, (await createAdmin(prisma, 'MODERATOR')).email);
    const set = (status: string) => http().post(`/admin/inquiries/${inquiry.id}/status`).set('Authorization', `Bearer ${token}`).send({ status });

    const list = await http().get('/admin/inquiries?status=NEW').set('Authorization', `Bearer ${token}`).expect(200);
    expect(list.body.items[0].operator).toMatchObject({ name: 'Alpha', slug: 'alpha' });
    const res = await set('RESPONDED').expect(200);
    expect(res.body.firstResponseAt).toBeTruthy();
    await set('RESPONDED').expect(409);
    await set('CLOSED').expect(200);
  });
});

describe('replying to a traveller through the bot', () => {
  it('sends the reply to the Telegram chat and marks the inquiry responded', async () => {
    const op = await operator('Alpha', 'APPROVED');
    const user = await prisma.telegramUser.create({ data: { telegramId: BigInt(4242), firstName: 'Ольга' } });
    const blocked = await prisma.telegramUser.create({ data: { telegramId: BigInt(666) } });
    const inquiry = await prisma.inquiry.create({ data: { operatorId: op.id, telegramUserId: user.id, message: 'Есть ли места в феврале?' } });
    const blockedInquiry = await prisma.inquiry.create({ data: { operatorId: op.id, telegramUserId: blocked.id, message: 'Есть ли места в марте?' } });
    const webInquiry = await prisma.inquiry.create({ data: { operatorId: op.id, channel: 'WEB', message: 'Hello, any space?' } });
    const token = await tokenFor(app, (await createAdmin(prisma, 'MODERATOR')).email);
    const reply = (id: string) => http().post(`/admin/inquiries/${id}/reply`).set('Authorization', `Bearer ${token}`).send({ text: 'Да, есть 4 места.' });

    const res = await reply(inquiry.id).expect(200);
    expect(res.body).toMatchObject({ status: 'RESPONDED' });
    expect(sentMessages).toEqual([{ chat_id: '4242', text: 'Ответ на ваш вопрос к Alpha:\n\nДа, есть 4 места.', link_preview_options: { is_disabled: true } }]);
    expect(await prisma.auditLog.count({ where: { entityId: inquiry.id, action: 'inquiry.reply' } })).toBe(1);

    const refused = await reply(blockedInquiry.id).expect(409);
    expect(refused.body.message).toContain('blocked the bot');
    expect((await prisma.inquiry.findUniqueOrThrow({ where: { id: blockedInquiry.id } })).status).toBe('NEW');
    await reply(webInquiry.id).expect(409);
  });
});

describe('content editing', () => {
  const guide = {
    slug: 'uganda-evisa', countryCode: 'UG', coveredCountries: ['UG'], visaType: 'eVisa', titleRu: 'Виза в Уганду',
    requirementsRu: 'Текст', checklistItems: [{ key: 'passport', labelRu: 'Паспорт', required: true }],
  };

  it('lets content editors create and publish visa guides, and only them', async () => {
    const editor = await tokenFor(app, (await createAdmin(prisma, 'CONTENT_EDITOR')).email);
    const moderator = await tokenFor(app, (await createAdmin(prisma, 'MODERATOR')).email);
    await http().post('/admin/visa-guides').set('Authorization', `Bearer ${moderator}`).send(guide).expect(403);

    const created = await http().post('/admin/visa-guides').set('Authorization', `Bearer ${editor}`).send(guide).expect(201);
    expect(created.body.status).toBe('DRAFT');
    await http().get('/public/visa-guides/uganda-evisa').expect(404);
    await http().post('/admin/visa-guides').set('Authorization', `Bearer ${editor}`).send(guide).expect(409);

    const before = new Date(created.body.lastUpdated).getTime();
    await new Promise((r) => setTimeout(r, 20));
    const published = await http().patch(`/admin/visa-guides/${created.body.id}`).set('Authorization', `Bearer ${editor}`).send({ status: 'PUBLISHED' }).expect(200);
    expect(new Date(published.body.lastUpdated).getTime()).toBeGreaterThan(before);
    const pub = await http().get('/public/visa-guides/uganda-evisa').expect(200);
    expect(pub.body.checklistItems).toEqual(guide.checklistItems);
    expect((await http().get('/public/visa-guides?country=UG')).body).toHaveLength(1);
  });

  it('finds a multi-country visa from any country it covers', async () => {
    await prisma.visaGuide.create({
      data: { ...guide, slug: 'eatv', countryCode: 'KE', coveredCountries: ['KE', 'UG', 'RW'], status: 'PUBLISHED', checklistItems: [] },
    });
    expect((await http().get('/public/visa-guides?country=UG')).body.map((g: { slug: string }) => g.slug)).toEqual(['eatv']);
    expect((await http().get('/public/visa-guides?country=TZ')).body).toEqual([]);
  });

  it('sets published_at the first time a destination guide is published', async () => {
    const editor = await tokenFor(app, (await createAdmin(prisma, 'CONTENT_EDITOR')).email);
    const g = await http().post('/admin/guides').set('Authorization', `Bearer ${editor}`)
      .send({ slug: 'ug-how', countryCode: 'UG', kind: 'LOGISTICS', titleRu: 'Как добраться', bodyRu: 'Текст' }).expect(201);
    expect(g.body.publishedAt).toBeNull();
    const p = await http().patch(`/admin/guides/${g.body.id}`).set('Authorization', `Bearer ${editor}`).send({ status: 'PUBLISHED' }).expect(200);
    expect(p.body.publishedAt).toBeTruthy();
    expect((await http().get('/public/guides?country=UG&kind=LOGISTICS')).body).toHaveLength(1);
  });
});
