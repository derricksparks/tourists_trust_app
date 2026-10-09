import { INestApplication } from '@nestjs/common';
import { AdminUser } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/common/prisma.service';
import { PASSWORD, createAdmin, createApp, resetDb, tokenFor, validOperator } from './helpers';

let app: INestApplication;
let prisma: PrismaService;
let moderator: AdminUser;
let modToken: string;

beforeAll(async () => {
  ({ app, prisma } = await createApp());
});
afterAll(() => app.close());

beforeEach(async () => {
  await resetDb(prisma);
  moderator = await createAdmin(prisma, 'MODERATOR');
  modToken = await tokenFor(app, moderator.email);
});

const http = () => request(app.getHttpServer());
const createOperator = (body: object = validOperator) =>
  http().post('/admin/operators').set('Authorization', `Bearer ${modToken}`).send(body);
const decide = (id: string, body: object) =>
  http().post(`/admin/operators/${id}/decision`).set('Authorization', `Bearer ${modToken}`).send(body);

describe('admin auth', () => {
  it('logs in and returns the admin', async () => {
    const res = await http().post('/admin/auth/login').send({ email: moderator.email.toUpperCase(), password: PASSWORD }).expect(200);
    expect(res.body.admin).toMatchObject({ id: moderator.id, role: 'MODERATOR' });
    await http().get('/admin/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
  });

  it('rejects a wrong password and an unknown email the same way', async () => {
    const a = await http().post('/admin/auth/login').send({ email: moderator.email, password: 'nope' }).expect(401);
    const b = await http().post('/admin/auth/login').send({ email: 'nobody@test.local', password: 'nope' }).expect(401);
    expect(a.body.message).toBe(b.body.message);
  });

  it('rejects a deactivated admin, including one holding a valid token', async () => {
    await prisma.adminUser.update({ where: { id: moderator.id }, data: { active: false } });
    await http().post('/admin/auth/login').send({ email: moderator.email, password: PASSWORD }).expect(401);
    await http().get('/admin/operators').set('Authorization', `Bearer ${modToken}`).expect(401);
  });

  it('requires a token on admin routes', async () => {
    await http().get('/admin/operators').expect(401);
    await http().get('/admin/operators').set('Authorization', 'Bearer garbage').expect(401);
  });
});

describe('operator approval queue', () => {
  it('creates an operator as PENDING with a slug and badge token, and audits it', async () => {
    const res = await createOperator().expect(201);
    expect(res.body).toMatchObject({ status: 'PENDING', countryCode: 'UG', slug: 'test-safari-co-ug' });
    expect(res.body.badgeToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const second = await createOperator().expect(201);
    expect(second.body.slug).toBe('test-safari-co-ug-2');
    expect(await prisma.auditLog.count({ where: { entityId: res.body.id, action: 'operator.create' } })).toBe(1);
  });

  it('validates input and unknown countries', async () => {
    const bad = await createOperator({ ...validOperator, businessRegNumber: '' }).expect(400);
    expect(bad.body.errors[0].path).toBe('businessRegNumber');
    await createOperator({ ...validOperator, countryCode: 'ZZ' }).expect(400);
  });

  it('forbids content editors from creating or deciding', async () => {
    const editor = await createAdmin(prisma, 'CONTENT_EDITOR');
    const token = await tokenFor(app, editor.email);
    await http().post('/admin/operators').set('Authorization', `Bearer ${token}`).send(validOperator).expect(403);
    await http().get('/admin/operators').set('Authorization', `Bearer ${token}`).expect(200);
  });

  it('lists the pending queue oldest first, filtered by status', async () => {
    const first = (await createOperator({ ...validOperator, name: 'First' })).body;
    const second = (await createOperator({ ...validOperator, name: 'Second' })).body;
    await decide(second.id, { decision: 'approve' }).expect(200);
    await createOperator({ ...validOperator, name: 'Third' });

    const res = await http().get('/admin/operators?status=PENDING').set('Authorization', `Bearer ${modToken}`).expect(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((o: { name: string }) => o.name)).toEqual(['First', 'Third']);
    expect(res.body.items[0].id).toBe(first.id);
  });

  it('approves, records who approved, and keeps the history', async () => {
    const { id } = (await createOperator()).body;
    const res = await decide(id, { decision: 'approve' }).expect(200);
    expect(res.body).toMatchObject({ status: 'APPROVED', approvedById: moderator.id, statusReason: null });

    const detail = await http().get(`/admin/operators/${id}`).set('Authorization', `Bearer ${modToken}`).expect(200);
    expect(detail.body.history.map((h: { action: string }) => h.action)).toEqual(['operator.approve', 'operator.create']);
  });

  it('requires a reason to reject, flag or suspend', async () => {
    const { id } = (await createOperator()).body;
    await decide(id, { decision: 'reject' }).expect(400);
    const res = await decide(id, { decision: 'flag', reason: 'Licence number unclear' }).expect(200);
    expect(res.body).toMatchObject({ status: 'FLAGGED', statusReason: 'Licence number unclear' });
  });

  it('refuses transitions the workflow does not allow', async () => {
    const { id } = (await createOperator()).body;
    await decide(id, { decision: 'suspend', reason: 'x' }).expect(409);
    await decide(id, { decision: 'reject', reason: 'No licence' }).expect(200);
    const res = await decide(id, { decision: 'approve' }).expect(409);
    expect(res.body.message).toContain('REJECTED');
  });

  it('lets only one of two simultaneous decisions win', async () => {
    const { id } = (await createOperator()).body;
    const results = await Promise.all([
      decide(id, { decision: 'approve' }),
      decide(id, { decision: 'reject', reason: 'Fake documents' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.auditLog.count({ where: { entityId: id, action: { not: 'operator.create' } } })).toBe(1);
  });

  it('returns 404 for an unknown operator', async () => {
    await decide('00000000-0000-0000-0000-000000000000', { decision: 'approve' }).expect(404);
    await http().get('/admin/operators/00000000-0000-0000-0000-000000000000').set('Authorization', `Bearer ${modToken}`).expect(404);
  });
});
