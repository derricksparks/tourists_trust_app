import { INestApplication } from '@nestjs/common';
import { mkdtempSync, readdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { PrismaService } from '../src/common/prisma.service';
import { Mail, MailService } from '../src/mail/mail.service';
import { parseCsv } from '../src/feed/csv';
import { sniffDocumentType } from '../src/portal/onboarding.module';
import { createAdmin, createApp, resetDb, tokenFor } from './helpers';

let app: INestApplication;
let prisma: PrismaService;
let mail: MailService;
let modToken: string;
let editorToken: string;
const uploadDir = mkdtempSync(join(tmpdir(), 'ttp-uploads-'));

beforeAll(async () => {
  process.env.UPLOAD_DIR = uploadDir;
  process.env.PORTAL_URL = 'https://portal.example';
  process.env.STAFF_EMAILS = 'ops@platform.example';
  delete process.env.SMTP_URL;
  delete process.env.WEB_REVALIDATE_URL;
  ({ app, prisma } = await createApp());
  mail = app.get(MailService);
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetDb(prisma);
  mail.sent.length = 0;
  modToken = await tokenFor(app, (await createAdmin(prisma, 'MODERATOR')).email);
  editorToken = await tokenFor(app, (await createAdmin(prisma, 'CONTENT_EDITOR')).email);
});

const http = () => request(app.getHttpServer());
const bearer = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`);
const asMod = (r: request.Test) => bearer(r, modToken);

const PDF = Buffer.from('%PDF-1.4\n% fictional licence for tests: UTB-LIC-2026-0042\n%%EOF\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

async function waitFor(match: (m: Mail) => boolean): Promise<Mail> {
  for (let i = 0; i < 50; i++) {
    const found = mail.sent.find(match);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`No such email. Sent: ${mail.sent.map((m) => `${m.to.join(',')}: ${m.subject}`).join(' | ')}`);
}

/** Each test signs up from its own address, so the per-address limit doesn't carry over. */
let ip = 0;
beforeEach(() => void ip++);
const signupReq = () => http().post('/portal/operator-signup').set('X-Forwarded-For', `198.51.100.${ip}`);

async function signup(email = 'owner@forest.example', countryCode = 'UG') {
  const res = await signupReq().send({ name: 'Forest Walkers', countryCode, email, password: 'a-long-password-1' }).expect(201);
  return res.body.accessToken as string;
}

const intake = {
  legalName: 'Forest Walkers Ltd',
  businessRegNumber: 'URSB-80020001',
  tourismBoardLicense: 'UTB-LIC-2026-0042',
  address: 'Plot 4, Kisoro Road, Kabale',
  yearEstablished: 2015,
  referenceContactName: 'Jane Client',
  referenceContactInfo: 'jane@client.example',
  websiteUrl: 'https://forest.example',
};

const upload = (token: string, type: string, data: Buffer, name: string) =>
  bearer(http().post('/portal/operator/documents'), token).field('type', type).attach('file', data, name);

describe('operator self-onboarding', () => {
  it('signs up as a draft that is invisible to the public and outside the review queue', async () => {
    const token = await signup();
    const me = await bearer(http().get('/portal/auth/me'), token).expect(200);
    expect(me.body).toMatchObject({ role: 'OPERATOR', operator: { status: 'DRAFT' } });

    const app1 = await bearer(http().get('/portal/operator/application'), token).expect(200);
    expect(app1.body).toMatchObject({ status: 'DRAFT', editable: true, licensingAuthority: 'Uganda Tourism Board', badgeToken: null, submittedAt: null });
    expect(app1.body.missing.map((m: { key: string }) => m.key)).toContain('doc:TOURISM_LICENSE');

    await http().get(`/public/operators/${app1.body.slug}`).expect(404);
    const queue = await asMod(http().get('/admin/operators?status=PENDING')).expect(200);
    expect(queue.body.total).toBe(0);
  });

  it('only accepts active countries, one login per email, and limits sign-ups per address', async () => {
    await prisma.country.create({ data: { code: 'ZM', nameEn: 'Zambia', nameRu: 'Замбия', active: false } });
    await signupReq().send({ name: 'Zed Safaris', countryCode: 'ZM', email: 'z@z.example', password: 'a-long-password-1' }).expect(400);
    await signup('dup@x.example');
    await signupReq().send({ name: 'Again', countryCode: 'UG', email: 'dup@x.example', password: 'a-long-password-1' }).expect(409);
    // Five attempts per hour per address, refused ones included: three above, two more, then no.
    await signup('n1@x.example');
    await signup('n2@x.example');
    await signupReq().send({ name: 'Six', countryCode: 'UG', email: 'six@x.example', password: 'a-long-password-1' }).expect(429);
  });

  it('fills in, uploads encrypted documents, submits; staff read the files; approval goes live', async () => {
    const token = await signup();
    await bearer(http().post('/portal/operator/application/submit'), token).expect(400);
    await bearer(http().patch('/portal/operator/application'), token).send(intake).expect(200);

    // Only real PDF / JPEG / PNG files, whatever the name says.
    await upload(token, 'TOURISM_LICENSE', Buffer.from('MZ fake executable'), 'licence.pdf').expect(400);
    const lic = await upload(token, 'TOURISM_LICENSE', PDF, 'licence.pdf').expect(201);
    expect(lic.body).toMatchObject({ type: 'TOURISM_LICENSE', contentType: 'application/pdf', sizeBytes: PDF.length });
    await upload(token, 'BUSINESS_REGISTRATION', PNG, 'certificate.png').expect(201);

    // On disk the file is encrypted: the licence number in it can't be read.
    const opId = (await bearer(http().get('/portal/operator/application'), token)).body.id;
    const files = readdirSync(join(uploadDir, 'documents', opId));
    expect(files).toHaveLength(2);
    for (const f of files) expect(readFileSync(join(uploadDir, 'documents', opId, f)).includes('UTB-LIC-2026-0042')).toBe(false);

    const own = await bearer(http().get(`/portal/operator/documents/${lic.body.id}/file`), token).expect(200);
    expect(Buffer.from(own.body).equals(PDF)).toBe(true);

    const sent = await bearer(http().post('/portal/operator/application/submit'), token).expect(200);
    expect(sent.body).toMatchObject({ status: 'PENDING', editable: false, missing: [] });
    await waitFor((m) => m.to.includes('ops@platform.example') && m.subject === 'New operator application: Forest Walkers (Uganda)');
    await waitFor((m) => m.to.includes('owner@forest.example') && m.subject === 'We received your application');

    // Locked while staff review it.
    await bearer(http().patch('/portal/operator/application'), token).send({ address: 'Elsewhere' }).expect(409);
    await upload(token, 'OTHER', PDF, 'more.pdf').expect(409);

    const queue = await asMod(http().get('/admin/operators?status=PENDING')).expect(200);
    expect(queue.body.items.map((o: { id: string }) => o.id)).toEqual([opId]);
    const file = await asMod(http().get(`/admin/operators/${opId}/documents/${lic.body.id}/file`)).expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['cache-control']).toBe('private, no-store');
    await bearer(http().get(`/admin/operators/${opId}/documents/${lic.body.id}/file`), editorToken).expect(403);
    await asMod(http().post(`/admin/operators/${opId}/documents/${lic.body.id}/review`)).send({ notes: 'Matches the UTB register' }).expect(200);
    expect(await prisma.auditLog.count({ where: { action: 'operator.document_view', entityId: opId } })).toBe(1);

    await asMod(http().post(`/admin/operators/${opId}/decision`)).send({ decision: 'approve' }).expect(200);
    await waitFor((m) => m.to.includes('owner@forest.example') && m.subject === 'Forest Walkers is now verified and listed');
    await http().get(`/public/operators/${sent.body.slug}`).expect(200);
    const after = await bearer(http().get('/portal/operator/application'), token).expect(200);
    expect(after.body.badgeToken).toEqual(expect.any(String));
  });

  it('a flagged application shows the reason, can be fixed and resubmitted', async () => {
    const token = await signup();
    await bearer(http().patch('/portal/operator/application'), token).send(intake).expect(200);
    await upload(token, 'TOURISM_LICENSE', PDF, 'licence.pdf').expect(201);
    const reg = await upload(token, 'BUSINESS_REGISTRATION', PDF, 'reg.pdf').expect(201);
    const { body } = await bearer(http().post('/portal/operator/application/submit'), token).expect(200);
    await bearer(http().post('/portal/operator/application/submit'), token).expect(409);

    await asMod(http().post(`/admin/operators/${body.id}/decision`)).send({ decision: 'flag', reason: 'The registration copy is unreadable' }).expect(200);
    const flagged = await bearer(http().get('/portal/operator/application'), token).expect(200);
    expect(flagged.body).toMatchObject({ status: 'FLAGGED', statusReason: 'The registration copy is unreadable', editable: true });
    await waitFor((m) => m.subject === 'We need more information for your application' && m.text.includes('unreadable'));

    await bearer(http().delete(`/portal/operator/documents/${reg.body.id}`), token).expect(200);
    await bearer(http().post('/portal/operator/application/submit'), token).expect(400);
    await upload(token, 'BUSINESS_REGISTRATION', PNG, 'reg.png').expect(201);
    await bearer(http().post('/portal/operator/application/submit'), token).expect(200);
    await waitFor((m) => m.subject.startsWith('Operator answered your follow-up'));
  });

  it('tours can be drafted before approval but only go live after it', async () => {
    const token = await signup();
    const tour = { title: 'Bwindi Forest Walk', descriptionRu: 'Прогулка по лесу.', countryCode: 'UG', durationDays: 2 };
    const p = await bearer(http().post('/portal/operator/packages'), token).send(tour).expect(201);
    const res = await bearer(http().post(`/portal/operator/packages/${p.body.id}/status`), token).send({ status: 'PUBLISHED' }).expect(409);
    expect(res.body.message).toContain('once your application is approved');
    await bearer(http().post('/portal/operator/packages'), token).send({ ...tour, countryCode: 'ZZ' }).expect(400);
  });

  it('recognises file types by content', () => {
    expect(sniffDocumentType(PDF)).toBe('application/pdf');
    expect(sniffDocumentType(PNG)).toBe('image/png');
    expect(sniffDocumentType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffDocumentType(Buffer.from('<html>'))).toBeNull();
  });
});

describe('package feed', () => {
  async function approvedOperatorToken(email = 'feed@op.example') {
    const token = await signup(email);
    const { body } = await bearer(http().get('/portal/operator/application'), token);
    await prisma.operator.update({ where: { id: body.id }, data: { status: 'APPROVED', approvedAt: new Date() } });
    return { token, operatorId: body.id as string };
  }
  const tour = (over: Record<string, unknown> = {}) => ({
    title: 'Murchison Falls Safari',
    titleRu: 'Сафари в Мерчисон-Фолс',
    descriptionRu: 'Водопад и сафари на катере.',
    countryCode: 'UG',
    durationDays: 3,
    price: 950,
    currency: 'USD',
    dates: [{ startDate: '2027-03-01', endDate: '2027-03-03' }],
    published: true,
    ...over,
  });

  it('keys: shown once, stored hashed, revocable', async () => {
    const { token } = await approvedOperatorToken();
    const created = await bearer(http().post('/portal/operator/api-keys'), token).send({ name: 'Website sync' }).expect(201);
    expect(created.body.key).toMatch(/^ttp_live_[\w-]{43}$/);
    const stored = await prisma.apiKey.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(JSON.stringify(stored)).not.toContain(created.body.key);
    const list = await bearer(http().get('/portal/operator/api-keys'), token).expect(200);
    expect(list.body[0]).not.toHaveProperty('key');
    expect(list.body[0].prefix).toBe(created.body.key.slice(0, 13));

    await http().get('/feed/v1/packages').set('Authorization', `Bearer ${created.body.key}`).expect(200);
    await bearer(http().delete(`/portal/operator/api-keys/${created.body.id}`), token).expect(200);
    await http().get('/feed/v1/packages').set('Authorization', `Bearer ${created.body.key}`).expect(401);
    await http().get('/feed/v1/packages').expect(401);
  });

  it('PUT creates then updates by external_ref, publishes, and is idempotent; DELETE archives', async () => {
    const { token } = await approvedOperatorToken();
    const key = (await bearer(http().post('/portal/operator/api-keys'), token).send({ name: 'Sync' })).body.key;
    const feed = (r: request.Test) => r.set('Authorization', `Bearer ${key}`);

    const first = await feed(http().put('/feed/v1/packages/MF-3D')).send(tour()).expect(200);
    expect(first.body).toMatchObject({ action: 'create', warnings: [], package: { externalRef: 'MF-3D', status: 'PUBLISHED', price: 950 } });
    expect(first.body.package.publicUrl).toMatch(/\/tours\/murchison-falls-safari/);
    const again = await feed(http().put('/feed/v1/packages/MF-3D')).send(tour({ price: 990, dates: [] })).expect(200);
    expect(again.body).toMatchObject({ action: 'update', package: { price: 990, dates: [] } });
    expect(await prisma.package.count()).toBe(1);

    const noRu = await feed(http().put('/feed/v1/packages/MF-3D')).send(tour({ descriptionRu: null })).expect(200);
    expect(noRu.body.package.status).toBe('DRAFT');
    expect(noRu.body.warnings[0]).toContain('Russian description');

    await feed(http().put('/feed/v1/packages/bad ref!')).send(tour()).expect(400);
    await feed(http().put('/feed/v1/packages/X1')).send(tour({ durationDays: 0 })).expect(400);
    await feed(http().get('/feed/v1/packages/NOPE')).expect(404);
    const archived = await feed(http().delete('/feed/v1/packages/MF-3D')).expect(200);
    expect(archived.body.status).toBe('ARCHIVED');
    expect((await feed(http().get('/feed/v1/packages')).expect(200)).body.items).toHaveLength(1);
  });

  it('before approval the feed works but everything stays a draft; operators only see their own tours', async () => {
    const token = await signup('early@op.example');
    const key = (await bearer(http().post('/portal/operator/api-keys'), token).send({ name: 'Sync' }).expect(201)).body.key;
    const res = await http().put('/feed/v1/packages/T1').set('Authorization', `Bearer ${key}`).send(tour()).expect(200);
    expect(res.body.package.status).toBe('DRAFT');
    expect(res.body.warnings[0]).toContain('once your application is approved');

    const other = await approvedOperatorToken('other@op.example');
    const otherKey = (await bearer(http().post('/portal/operator/api-keys'), other.token).send({ name: 'Sync' })).body.key;
    await http().get('/feed/v1/packages/T1').set('Authorization', `Bearer ${otherKey}`).expect(404);
    // The same external_ref is independent per operator.
    await http().put('/feed/v1/packages/T1').set('Authorization', `Bearer ${otherKey}`).send(tour()).expect(200);
    expect(await prisma.package.count()).toBe(2);
  });

  it('a suspended operator’s keys stop working', async () => {
    const { token, operatorId } = await approvedOperatorToken();
    const key = (await bearer(http().post('/portal/operator/api-keys'), token).send({ name: 'Sync' })).body.key;
    await prisma.operator.update({ where: { id: operatorId }, data: { status: 'SUSPENDED' } });
    await http().get('/feed/v1/packages').set('Authorization', `Bearer ${key}`).expect(403);
  });

  it('spreadsheet import: dry run reports per row, a file with errors imports nothing, a clean file imports all', async () => {
    const { token } = await approvedOperatorToken();
    const header = 'external_ref;title;title_ru;description_ru;country;duration_days;price;currency;inclusions;dates;published';
    const good = [
      'Q-1;Queen Elizabeth Safari;Сафари в Королеве Елизавете;"Катер по каналу; львы на деревьях.";UG;3;890;USD;guide | transport;2027-04-02/2027-04-04 | 2027-05-01/2027-05-03;yes',
      'Q-2;Kibale Chimps;;;UG;2;450,50;USD;;;no',
    ];
    const bad = 'Q-3;Zed Trip;;;ZM;0;;;;2027-13-01/2027-13-02;yes';

    const dry = await bearer(http().post('/portal/operator/import'), token).send({ csv: [header, ...good, bad].join('\r\n'), dryRun: true }).expect(200);
    expect(dry.body).toMatchObject({ dryRun: true, created: 2, updated: 0, failed: 1 });
    expect(dry.body.rows[0]).toMatchObject({ row: 2, externalRef: 'Q-1', action: 'create', published: true, errors: [] });
    expect(dry.body.rows[1]).toMatchObject({ row: 3, action: 'create', published: false });
    expect(dry.body.rows[2].errors.join(' ')).toMatch(/duration_days/);
    expect(await prisma.package.count()).toBe(0);

    await bearer(http().post('/portal/operator/import'), token).send({ csv: [header, ...good, bad].join('\n'), dryRun: false }).expect(400);
    expect(await prisma.package.count()).toBe(0);

    const done = await bearer(http().post('/portal/operator/import'), token).send({ csv: [header, ...good].join('\n'), dryRun: false }).expect(200);
    expect(done.body).toMatchObject({ dryRun: false, created: 2, failed: 0 });
    const q1 = await prisma.package.findFirstOrThrow({ where: { externalRef: 'Q-1' }, include: { dateRanges: true } });
    expect(q1).toMatchObject({ status: 'PUBLISHED', descriptionRu: 'Катер по каналу; львы на деревьях.', inclusions: ['guide', 'transport'] });
    expect(q1.dateRanges).toHaveLength(2);
    expect(Number((await prisma.package.findFirstOrThrow({ where: { externalRef: 'Q-2' } })).price)).toBe(450.5);

    // Importing the same file again updates rather than duplicates.
    const re = await bearer(http().post('/portal/operator/import'), token).send({ csv: [header, ...good].join('\n'), dryRun: true }).expect(200);
    expect(re.body).toMatchObject({ created: 0, updated: 2 });
    await bearer(http().post('/portal/operator/import'), token).send({ csv: 'name,price\nX,1', dryRun: true }).expect(400);
  });
});

describe('more countries', () => {
  it('a super admin adds a country; it opens for sign-ups and appears publicly only once switched on', async () => {
    const superToken = await tokenFor(app, (await createAdmin(prisma, 'SUPER_ADMIN')).email);
    const zm = { code: 'zm', nameEn: 'Zambia', nameRu: 'Замбия', nameRuIn: 'в Замбии', licensingAuthority: 'Zambia Tourism Agency (demo)' };
    await asMod(http().post('/admin/countries')).send(zm).expect(403);
    await bearer(http().post('/admin/countries'), superToken).send({ ...zm, nameRuIn: 'Замбии' }).expect(400);
    const created = await bearer(http().post('/admin/countries'), superToken).send(zm).expect(201);
    expect(created.body).toMatchObject({ code: 'ZM', active: false, operatorCount: 0 });
    await bearer(http().post('/admin/countries'), superToken).send(zm).expect(409);

    const codes = async () => (await http().get('/public/countries').expect(200)).body.map((c: { code: string }) => c.code);
    expect(await codes()).not.toContain('ZM');
    await signupReq().send({ name: 'Lower Zambezi Co', countryCode: 'ZM', email: 'z@z.example', password: 'a-long-password-1' }).expect(400);

    await bearer(http().patch('/admin/countries/zm'), superToken).send({ active: true, licenceRegisterUrl: 'https://register.example/zm' }).expect(200);
    expect(await codes()).toContain('ZM');
    const pub = (await http().get('/public/countries')).body.find((c: { code: string }) => c.code === 'ZM');
    expect(Object.keys(pub).sort()).toEqual(['code', 'nameEn', 'nameRu', 'nameRuIn', 'operatorCount']);
    const signupList = await http().get('/portal/countries').expect(200);
    expect(signupList.body).toContainEqual({ code: 'ZM', nameEn: 'Zambia', nameRu: 'Замбия', licensingAuthority: 'Zambia Tourism Agency (demo)' });
    const token = await signup('z@z.example', 'ZM');
    const app2 = await bearer(http().get('/portal/operator/application'), token).expect(200);
    expect(app2.body.licensingAuthority).toBe('Zambia Tourism Agency (demo)');
    expect(app2.body.country.licenceRegisterUrl).toBe('https://register.example/zm');
  });
});

describe('CSV parsing', () => {
  it('handles quotes, line breaks in cells, semicolon files and the Excel byte-order mark', () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']]);
    expect(parseCsv('﻿a;b\r\n1;"two\nlines"\r\n\r\n')).toEqual([['a', 'b'], ['1', 'two\nlines']]);
  });
});
