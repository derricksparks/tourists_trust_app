import { INestApplication } from '@nestjs/common';
import { Operator } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/common/prisma.service';
import { whiteLabelText } from '../src/portal/dmc-portal.module';
import { median, responseScore } from '../src/scoring/scoring.service';
import { createAdmin, createApp, resetDb, tokenFor, validOperator } from './helpers';

let app: INestApplication;
let prisma: PrismaService;
let modToken: string;

beforeAll(async () => {
  process.env.PORTAL_URL = 'https://portal.example';
  process.env.SITE_URL = 'https://site.example';
  delete process.env.WEB_REVALIDATE_URL;
  ({ app, prisma } = await createApp());
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetDb(prisma);
  modToken = await tokenFor(app, (await createAdmin(prisma, 'MODERATOR')).email);
});

const http = () => request(app.getHttpServer());
const asMod = (r: request.Test) => r.set('Authorization', `Bearer ${modToken}`);
const bearer = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`);

async function approvedOperator(name = 'Alpha Safaris'): Promise<Operator> {
  const slug = name.toLowerCase().replace(/\W+/g, '-');
  return prisma.operator.create({ data: { ...validOperator, name, slug, countryCode: 'UG', badgeToken: `b-${slug}`, status: 'APPROVED', approvedAt: new Date() } });
}

/** Admin creates the login, the operator opens the link and sets a password. */
async function operatorLogin(op: Operator, email = `staff@${op.slug}.example`) {
  const created = await asMod(http().post(`/admin/operators/${op.id}/accounts`)).send({ email }).expect(201);
  const token = new URL(created.body.link).searchParams.get('token')!;
  const res = await http().post('/portal/auth/set-password').send({ token, password: 'a-long-password-1' }).expect(200);
  return { token: res.body.accessToken as string, link: token };
}

async function approvedDmc(email = 'b2b@dmc.example') {
  const res = await http()
    .post('/portal/dmc-signup')
    .send({ name: 'Северный Ветер', contactName: 'Анна', email, password: 'another-long-pass', websiteUrl: 'https://dmc.example' })
    .expect(201);
  const dmcId = res.body.account.dmc.id;
  await asMod(http().post(`/admin/dmcs/${dmcId}/decision`)).send({ decision: 'approve' }).expect(200);
  return { token: res.body.accessToken as string, dmcId };
}

const tour = {
  title: 'Bwindi Gorilla Trek',
  titleRu: 'Гориллы Бвинди',
  descriptionRu: 'Трекинг к гориллам с рейнджерами.',
  countryCode: 'UG',
  durationDays: 4,
  price: 2450,
  currency: 'USD',
  capacity: 6,
  inclusions: ['gorilla permit', 'transport'],
  dates: [{ startDate: '2027-02-10', endDate: '2027-02-13' }],
};

async function publishedTour(opToken: string) {
  const p = await bearer(http().post('/portal/operator/packages'), opToken).send(tour).expect(201);
  await bearer(http().post(`/portal/operator/packages/${p.body.id}/status`), opToken).send({ status: 'PUBLISHED' }).expect(200);
  return p.body as { id: string; slug: string };
}

describe('scoring maths', () => {
  it('takes the median and maps 2h → 100, 72h → 0', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
    expect([responseScore(1), responseScore(2), responseScore(37), responseScore(72), responseScore(100), responseScore(null)]).toEqual([100, 100, 50, 0, 0, null]);
  });
});

describe('partner logins', () => {
  it('an admin creates an operator login; the link sets a password once', async () => {
    const op = await approvedOperator();
    const { token, link } = await operatorLogin(op);
    const me = await bearer(http().get('/portal/auth/me'), token).expect(200);
    expect(me.body).toMatchObject({ role: 'OPERATOR', operator: { id: op.id, status: 'APPROVED' } });
    await http().post('/portal/auth/set-password').send({ token: link, password: 'yet-another-pass' }).expect(400);
    await http().post('/portal/auth/login').send({ email: `staff@${op.slug}.example`, password: 'a-long-password-1' }).expect(200);
  });

  it('only approved operators get logins, one per email', async () => {
    const pending = await prisma.operator.create({ data: { ...validOperator, countryCode: 'UG', slug: 'p', badgeToken: 'b-p' } });
    await asMod(http().post(`/admin/operators/${pending.id}/accounts`)).send({ email: 'x@p.example' }).expect(409);
    const op = await approvedOperator();
    await operatorLogin(op, 'same@example.com');
    await asMod(http().post(`/admin/operators/${op.id}/accounts`)).send({ email: 'same@example.com' }).expect(409);
  });

  it('a deactivated login stops working at once; admin tokens are not portal tokens', async () => {
    const op = await approvedOperator();
    const { token } = await operatorLogin(op);
    const [acc] = (await asMod(http().get(`/admin/operators/${op.id}/accounts`)).expect(200)).body;
    await asMod(http().post(`/admin/accounts/${acc.id}/active`)).send({ active: false }).expect(200);
    await bearer(http().get('/portal/operator/overview'), token).expect(401);
    await bearer(http().get('/portal/operator/overview'), modToken).expect(401);
  });
});

describe('DMCs', () => {
  it('sign up as pending and see no inventory until approved', async () => {
    const res = await http().post('/portal/dmc-signup').send({ name: 'Байкал Тур', contactName: 'Иван', email: 'ivan@baikal.example', password: 'long-password-x' }).expect(201);
    expect(res.body.account).toMatchObject({ role: 'DMC', dmc: { status: 'PENDING' } });
    const forbidden = await bearer(http().get('/portal/dmc/inventory'), res.body.accessToken).expect(403);
    expect(forbidden.body.message).toContain('на проверке');
    await http().post('/portal/dmc-signup').send({ name: 'Dup', contactName: 'Пётр', email: 'ivan@baikal.example', password: 'long-password-x' }).expect(409);
    await asMod(http().post(`/admin/dmcs/${res.body.account.dmc.id}/decision`)).send({ decision: 'reject' }).expect(400);
    await asMod(http().post(`/admin/dmcs/${res.body.account.dmc.id}/decision`)).send({ decision: 'approve' }).expect(200);
    await bearer(http().get('/portal/dmc/inventory'), res.body.accessToken).expect(200);
  });

  it('a DMC cannot use operator endpoints, and vice versa', async () => {
    const { token: dmcToken } = await approvedDmc();
    const { token: opToken } = await operatorLogin(await approvedOperator());
    await bearer(http().get('/portal/operator/packages'), dmcToken).expect(403);
    await bearer(http().get('/portal/dmc/inventory'), opToken).expect(403);
  });
});

describe('package feed → wholesale inventory → quotes', () => {
  it('drafts stay private; publishing needs a Russian description; DMCs see only sellable tours', async () => {
    const op = await approvedOperator();
    const { token: opToken } = await operatorLogin(op);
    const { token: dmcToken } = await approvedDmc();
    const draft = await bearer(http().post('/portal/operator/packages'), opToken).send({ ...tour, descriptionRu: null }).expect(201);
    expect(draft.body).toMatchObject({ status: 'DRAFT', slug: 'bwindi-gorilla-trek-alpha-safaris', price: '2450' });
    expect((await bearer(http().get('/portal/dmc/inventory'), dmcToken)).body).toEqual([]);
    const refused = await bearer(http().post(`/portal/operator/packages/${draft.body.id}/status`), opToken).send({ status: 'PUBLISHED' }).expect(409);
    expect(refused.body.message).toContain('Russian description');

    await bearer(http().patch(`/portal/operator/packages/${draft.body.id}`), opToken).send(tour).expect(200);
    await bearer(http().post(`/portal/operator/packages/${draft.body.id}/status`), opToken).send({ status: 'PUBLISHED' }).expect(200);
    const inv = await bearer(http().get('/portal/dmc/inventory?country=UG&month=2027-02'), dmcToken).expect(200);
    expect(inv.body).toHaveLength(1);
    expect(inv.body[0]).toMatchObject({ title: tour.title, operator: { name: 'Alpha Safaris' }, listedByMe: false });
    expect(JSON.stringify(inv.body)).not.toMatch(/badgeToken|referenceContact|statusReason/);
    expect((await bearer(http().get('/portal/dmc/inventory?month=2027-05'), dmcToken)).body).toEqual([]);

    await prisma.operator.update({ where: { id: op.id }, data: { status: 'SUSPENDED' } });
    expect((await bearer(http().get('/portal/dmc/inventory'), dmcToken)).body).toEqual([]);
    await bearer(http().post('/portal/operator/packages'), opToken).send(tour).expect(403);
  });

  it("an operator can't touch another operator's tours", async () => {
    const { token: a } = await operatorLogin(await approvedOperator('Alpha'));
    const { token: b } = await operatorLogin(await approvedOperator('Beta'));
    const p = await bearer(http().post('/portal/operator/packages'), a).send(tour).expect(201);
    await bearer(http().patch(`/portal/operator/packages/${p.body.id}`), b).send(tour).expect(404);
    await bearer(http().post(`/portal/operator/packages/${p.body.id}/status`), b).send({ status: 'ARCHIVED' }).expect(404);
  });

  it('runs request → quote → close, one open request per tour, and scores the response', async () => {
    const op = await approvedOperator();
    const { token: opToken } = await operatorLogin(op);
    const { token: dmcToken } = await approvedDmc();
    const pkg = await publishedTour(opToken);

    const q = await bearer(http().post('/portal/dmc/quotes'), dmcToken).send({ packageId: pkg.id, pax: 6, travelStartDate: '2027-02-10', notes: 'Нужна net-цена' }).expect(201);
    await bearer(http().post('/portal/dmc/quotes'), dmcToken).send({ packageId: pkg.id, pax: 2, travelStartDate: '2027-03-01' }).expect(409);
    const inbox = await bearer(http().get('/portal/operator/quotes'), opToken).expect(200);
    expect(inbox.body[0]).toMatchObject({ pax: 6, notes: 'Нужна net-цена', dmc: { name: 'Северный Ветер', email: 'b2b@dmc.example' } });
    expect((await bearer(http().get('/portal/operator/overview'), opToken)).body.openQuotes).toBe(1);

    await bearer(http().post(`/portal/operator/quotes/${q.body.id}/respond`), opToken).send({ action: 'quote', quotedPrice: 2100, quotedCurrency: 'USD', quoteTerms: 'Net per person, valid 30 days' }).expect(200);
    await bearer(http().post(`/portal/operator/quotes/${q.body.id}/respond`), opToken).send({ action: 'decline', reason: 'Changed my mind' }).expect(409);
    const mine = await bearer(http().get('/portal/dmc/quotes'), dmcToken).expect(200);
    expect(mine.body[0]).toMatchObject({ status: 'QUOTED', quotedPrice: '2100', quotedCurrency: 'USD' });
    await bearer(http().post(`/portal/dmc/quotes/${q.body.id}/close`), dmcToken).send({ outcome: 'booked' }).expect(200);

    const scored = await prisma.operator.findUniqueOrThrow({ where: { id: op.id } });
    expect(scored.responseTimeScore).toBe(100);
    const breakdown = await asMod(http().get(`/admin/operators/${op.id}/scores`)).expect(200);
    expect(breakdown.body).toMatchObject({ responsesCounted: 1, responseTimeScore: 100 });
    expect(breakdown.body.missing.map((m: { key: string }) => m.key)).toEqual(expect.arrayContaining(['video', 'descriptionEn']));
  });

  it('counts a request unanswered for 72h+ as slow', async () => {
    const op = await approvedOperator();
    const { token: opToken } = await operatorLogin(op);
    const { token: dmcToken } = await approvedDmc();
    const pkg = await publishedTour(opToken);
    const q = await bearer(http().post('/portal/dmc/quotes'), dmcToken).send({ packageId: pkg.id, pax: 2, travelStartDate: '2027-02-10' }).expect(201);
    await prisma.quoteRequest.update({ where: { id: q.body.id }, data: { createdAt: new Date(Date.now() - 80 * 3600 * 1000) } });
    const b = await asMod(http().get(`/admin/operators/${op.id}/scores`)).expect(200);
    expect(b.body).toMatchObject({ responseTimeScore: 0, medianResponseHours: 72 });
    expect((await asMod(http().get('/admin/stats'))).body.quotesUnanswered48h).toBe(1);
  });
});

describe('listings and the public tour page', () => {
  it('a DMC lists a tour under its brand; the public page links back to operator and seller', async () => {
    const op = await approvedOperator();
    const { token: opToken } = await operatorLogin(op);
    const { token: dmcToken } = await approvedDmc();
    const pkg = await publishedTour(opToken);

    await bearer(http().post('/portal/dmc/listings'), dmcToken).send({ packageId: pkg.id, whiteLabelTitle: 'Гориллы Уганды — эксклюзив', dmcPageUrl: 'https://dmc.example/uganda' }).expect(201);
    const listings = await bearer(http().get('/portal/dmc/listings'), dmcToken).expect(200);
    expect(listings.body[0]).toMatchObject({ sellable: true, mirrorUrl: `https://site.example/tours/${pkg.slug}` });
    expect(listings.body[0].whiteLabelText).toContain('Гориллы Уганды — эксклюзив');
    expect(listings.body[0].whiteLabelText).not.toContain(validOperator.name);

    const pub = await http().get(`/public/packages/${pkg.slug}`).expect(200);
    expect(pub.body).toMatchObject({ titleRu: 'Гориллы Бвинди', operator: { name: 'Alpha Safaris', slug: op.slug }, sellers: [{ dmcName: 'Северный Ветер', url: 'https://dmc.example/uganda' }] });
    expect(JSON.stringify(pub.body)).not.toMatch(/badgeToken|businessRegNumber.*REG|email/);

    await bearer(http().post('/portal/dmc/listings'), dmcToken).send({ packageId: pkg.id, active: false }).expect(201);
    expect((await http().get(`/public/packages/${pkg.slug}`)).body.sellers).toEqual([]);
    await bearer(http().post(`/portal/operator/packages/${pkg.id}/status`), opToken).send({ status: 'ARCHIVED' }).expect(200);
    await http().get(`/public/packages/${pkg.slug}`).expect(404);
  });

  it('builds white-label text without the operator', () => {
    const text = whiteLabelText({
      title: 'Trek', titleRu: 'Трек', descriptionRu: 'Описание', durationDays: 3, inclusions: ['guide'], exclusions: [],
      dateRanges: [{ startDate: new Date('2027-02-10'), endDate: new Date('2027-02-12') }],
    });
    expect(text).toBe('Трек\n3 дн.\n\nОписание\n\nВключено: guide\nДаты: 10.02.2027–12.02.2027\n\nПринимающая сторона проверена платформой «Проверено: Африка».');
  });
});

describe('fam trips', () => {
  it('admin plans, a DMC asks to join, admin confirms within capacity, operator confirms', async () => {
    const op = await approvedOperator();
    const { token: opToken } = await operatorLogin(op);
    const { token: dmcToken, dmcId } = await approvedDmc();
    const { dmcId: otherDmc } = await approvedDmc('other@dmc.example');

    const trip = await asMod(http().post('/admin/fam-trips'))
      .send({ title: 'Uganda fam trip', startDate: '2027-03-02', endDate: '2027-03-08', capacity: 1, itinerary: [{ day: 1, titleRu: 'Прилёт в Энтеббе' }] })
      .expect(201);
    await asMod(http().post('/admin/fam-trips')).send({ title: 'Bad', startDate: '2027-03-08', endDate: '2027-03-02' }).expect(400);
    await asMod(http().post(`/admin/fam-trips/${trip.body.id}/participants`)).send({ kind: 'operator', id: op.id, role: 'host' }).expect(200);

    const list = await bearer(http().get('/portal/dmc/fam-trips'), dmcToken).expect(200);
    expect(list.body[0]).toMatchObject({ title: 'Uganda fam trip', myStatus: null, operators: [{ operator: { name: 'Alpha Safaris' } }] });
    await bearer(http().post(`/portal/dmc/fam-trips/${trip.body.id}/join`), dmcToken).send({ representativeName: 'Анна' }).expect(200);
    await bearer(http().post(`/portal/dmc/fam-trips/${trip.body.id}/join`), dmcToken).send({ representativeName: 'Анна' }).expect(409);
    expect((await bearer(http().get('/portal/dmc/fam-trips'), dmcToken)).body[0].myStatus).toBe('requested');

    await asMod(http().post(`/admin/fam-trips/${trip.body.id}/participants`)).send({ kind: 'dmc', id: dmcId, confirmed: true }).expect(200);
    const full = await asMod(http().post(`/admin/fam-trips/${trip.body.id}/participants`)).send({ kind: 'dmc', id: otherDmc, confirmed: true }).expect(409);
    expect(full.body.message).toContain('full');

    await bearer(http().post(`/portal/operator/fam-trips/${trip.body.id}/confirm`), opToken).expect(200);
    const detail = await asMod(http().get(`/admin/fam-trips/${trip.body.id}`)).expect(200);
    expect(detail.body.operators[0]).toMatchObject({ confirmed: true, role: 'host' });
    expect(detail.body.dmcs[0]).toMatchObject({ confirmed: true, representativeName: 'Анна' });
  });
});
