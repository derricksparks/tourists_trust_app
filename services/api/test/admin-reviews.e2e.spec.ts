import { INestApplication } from '@nestjs/common';
import { AdminUser } from '@prisma/client';
import { createHash } from 'crypto';
import request from 'supertest';
import { PrismaService } from '../src/common/prisma.service';
import { createAdmin, createApp, resetDb, tokenFor, validOperator } from './helpers';

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
const auth = (r: request.Test, token = modToken) => r.set('Authorization', `Bearer ${token}`);

async function createReview(n = 1, status: 'PENDING' | 'PUBLISHED' = 'PENDING') {
  const operator = await prisma.operator.create({
    data: { ...validOperator, countryCode: 'UG', slug: `op-${n}-${Math.random()}`, badgeToken: `tok-${n}-${Math.random()}`, status: 'APPROVED' },
  });
  const invite = await prisma.reviewInvite.create({
    data: {
      tokenHash: createHash('sha256').update(`t${n}${Math.random()}`).digest('hex'), operatorId: operator.id,
      recipientName: 'Traveller', recipientContact: 't@example.com', tripDate: new Date('2026-08-01'),
      issuedById: moderator.id, expiresAt: new Date('2027-01-01'), usedAt: new Date(),
    },
  });
  return prisma.review.create({
    data: { operatorId: operator.id, inviteId: invite.id, authorName: `Author ${n}`, rating: 4, bodyRu: 'Хорошо', tripDate: new Date('2026-08-01'), status },
  });
}

const decide = (id: string, body: object, token = modToken) => auth(http().post(`/admin/reviews/${id}/decision`).send(body), token);

describe('review moderation', () => {
  it('lists pending reviews with operator and invite details', async () => {
    await createReview(1);
    await createReview(2, 'PUBLISHED');
    const res = await auth(http().get('/admin/reviews?status=PENDING')).expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({ authorName: 'Author 1', operator: { name: validOperator.name }, invite: { recipientName: 'Traveller' } });
  });

  it('publishes a pending review and records the moderator', async () => {
    const review = await createReview();
    const res = await decide(review.id, { decision: 'publish' }).expect(200);
    expect(res.body).toMatchObject({ status: 'PUBLISHED', moderatedBy: { id: moderator.id } });
    expect(await prisma.auditLog.count({ where: { entityId: review.id, action: 'review.publish' } })).toBe(1);
  });

  it('requires a reason to reject, and can take down a published review', async () => {
    const review = await createReview(1, 'PUBLISHED');
    await decide(review.id, { decision: 'reject' }).expect(400);
    const res = await decide(review.id, { decision: 'reject', reason: 'Mentions a guide by full name' }).expect(200);
    expect(res.body).toMatchObject({ status: 'REJECTED', rejectionReason: 'Mentions a guide by full name' });
    await decide(review.id, { decision: 'publish' }).expect(409);
  });

  it('forbids content editors from moderating', async () => {
    const review = await createReview();
    const editor = await createAdmin(prisma, 'CONTENT_EDITOR');
    await decide(review.id, { decision: 'publish' }, await tokenFor(app, editor.email)).expect(403);
  });
});

describe('dashboard', () => {
  it('returns stats and countries', async () => {
    await createReview();
    await prisma.operator.create({ data: { ...validOperator, countryCode: 'KE', slug: 'p', badgeToken: 'p' } });
    const stats = await auth(http().get('/admin/stats')).expect(200);
    expect(stats.body).toEqual({
      operatorsByStatus: { PENDING: 1, APPROVED: 1, REJECTED: 0, FLAGGED: 0, SUSPENDED: 0 },
      reviewsPending: 1, listingsLive: 0, dmcsOnboarded: 0, quoteRequests: 0, translatorJobsCompleted: 0,
    });
    const countries = await auth(http().get('/admin/countries')).expect(200);
    expect(countries.body.map((c: { code: string }) => c.code)).toEqual(['KE', 'TZ', 'UG']);
  });
});
