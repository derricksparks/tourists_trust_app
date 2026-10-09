import { INestApplication } from '@nestjs/common';
import { Operator } from '@prisma/client';
import { createServer, Server } from 'net';
import request from 'supertest';
import { PrismaService } from '../src/common/prisma.service';
import { checkProductionConfig } from '../src/common/config';
import { Mail, MailService } from '../src/mail/mail.service';
import { createAdmin, createApp, resetDb, tokenFor, validOperator } from './helpers';

let app: INestApplication;
let prisma: PrismaService;
let mail: MailService;
let modToken: string;

beforeAll(async () => {
  process.env.PORTAL_URL = 'https://portal.example';
  process.env.ADMIN_URL = 'https://admin.example';
  process.env.STAFF_EMAILS = 'ops@platform.example, second@platform.example';
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
});

const http = () => request(app.getHttpServer());
const asMod = (r: request.Test) => r.set('Authorization', `Bearer ${modToken}`);
const bearer = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`);

/** Notifications go out after the response, so wait for the one we expect. */
async function waitFor(match: (m: Mail) => boolean): Promise<Mail> {
  for (let i = 0; i < 50; i++) {
    const found = mail.sent.find(match);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`No such email. Sent: ${mail.sent.map((m) => `${m.to.join(',')}: ${m.subject}`).join(' | ')}`);
}
const linkIn = (text: string) => text.match(/https:\/\/portal\.example\/set-password\?token=\S+/)![0];

async function approvedOperator(): Promise<Operator> {
  return prisma.operator.create({ data: { ...validOperator, name: 'Alpha Safaris', slug: 'alpha', countryCode: 'UG', badgeToken: 'b-alpha', status: 'APPROVED', approvedAt: new Date() } });
}

describe('partner emails', () => {
  it('a new operator login is emailed its set-password link, which works', async () => {
    const op = await approvedOperator();
    const res = await asMod(http().post(`/admin/operators/${op.id}/accounts`)).send({ email: 'staff@alpha.example' }).expect(201);
    // No SMTP server in tests, so the API says it did not email and staff copy the link instead.
    expect(res.body.emailed).toBe(false);
    const sent = await waitFor((m) => m.to.includes('staff@alpha.example'));
    expect(sent.subject).toBe('Your partner portal login');
    expect(linkIn(sent.text)).toBe(res.body.link);
  });

  it('DMC journey: application → staff and applicant told, approval, quote both ways', async () => {
    const op = await approvedOperator();
    const opLink = (await asMod(http().post(`/admin/operators/${op.id}/accounts`)).send({ email: 'staff@alpha.example' }).expect(201)).body.link;
    const opToken = (await http().post('/portal/auth/set-password').send({ token: new URL(opLink).searchParams.get('token'), password: 'a-long-password-1' }).expect(200)).body.accessToken;

    const signup = await http()
      .post('/portal/dmc-signup')
      .send({ name: 'Северный Ветер', contactName: 'Анна', email: 'b2b@dmc.example', password: 'another-long-pass' })
      .expect(201);
    const staff = await waitFor((m) => m.subject === 'New DMC application: Северный Ветер');
    expect(staff.to).toEqual(['ops@platform.example', 'second@platform.example']);
    expect(staff.text).toContain('https://admin.example/dmcs');
    expect((await waitFor((m) => m.to.includes('b2b@dmc.example'))).subject).toBe('Заявка получена');

    await asMod(http().post(`/admin/dmcs/${signup.body.account.dmc.id}/decision`)).send({ decision: 'approve' }).expect(200);
    await waitFor((m) => m.subject === 'Доступ открыт' && m.to.includes('b2b@dmc.example'));

    const pkg = await bearer(http().post('/portal/operator/packages'), opToken)
      .send({ title: 'Bwindi Trek', descriptionRu: 'Гориллы.', countryCode: 'UG', durationDays: 4, inclusions: [], dates: [] })
      .expect(201);
    await bearer(http().post(`/portal/operator/packages/${pkg.body.id}/status`), opToken).send({ status: 'PUBLISHED' }).expect(200);
    const dmcToken = signup.body.accessToken;
    const quote = await bearer(http().post('/portal/dmc/quotes'), dmcToken).send({ packageId: pkg.body.id, pax: 4, travelStartDate: '2027-02-10' }).expect(201);

    const toOperator = await waitFor((m) => m.to.includes('staff@alpha.example') && m.subject.startsWith('Quote request'));
    expect(toOperator.subject).toBe('Quote request: Bwindi Trek (4 pax)');
    expect(toOperator.text).toContain('Северный Ветер');
    expect(toOperator.text).toContain('https://portal.example/quotes');

    await bearer(http().post(`/portal/operator/quotes/${quote.body.id}/respond`), opToken)
      .send({ action: 'quote', quotedPrice: 1800, quotedCurrency: 'USD', quoteTerms: '30% deposit' })
      .expect(200);
    const answered = await waitFor((m) => m.to.includes('b2b@dmc.example') && m.subject.startsWith('Цена'));
    expect(answered.text).toContain('1800 USD');
    expect(answered.text).toContain('30% deposit');
  });

  it('a quote for an operator without a login goes to staff instead', async () => {
    const op = await approvedOperator();
    const pkg = await prisma.package.create({ data: { operatorId: op.id, title: 'Lake Tour', slug: 'lake', countryCode: 'UG', durationDays: 2, status: 'PUBLISHED', descriptionRu: 'Озеро.' } });
    const signup = await http().post('/portal/dmc-signup').send({ name: 'Байкал', contactName: 'Иван', email: 'ivan@b.example', password: 'another-long-pass' }).expect(201);
    await asMod(http().post(`/admin/dmcs/${signup.body.account.dmc.id}/decision`)).send({ decision: 'approve' }).expect(200);
    await bearer(http().post('/portal/dmc/quotes'), signup.body.accessToken).send({ packageId: pkg.id, pax: 2, travelStartDate: '2027-03-01' }).expect(201);
    const sent = await waitFor((m) => m.subject === 'Quote request for Alpha Safaris, who has no portal login');
    expect(sent.to).toContain('ops@platform.example');
  });
});

describe('fam trip emails', () => {
  it('operator invited, DMC request reaches staff, confirmation reaches the DMC once', async () => {
    const op = await approvedOperator();
    await asMod(http().post(`/admin/operators/${op.id}/accounts`)).send({ email: 'staff@alpha.example' }).expect(201);
    const trip = await asMod(http().post('/admin/fam-trips')).send({ title: 'Uganda for agents', startDate: '2027-05-01', endDate: '2027-05-07', capacity: 4 }).expect(201);
    await asMod(http().post(`/admin/fam-trips/${trip.body.id}/participants`)).send({ kind: 'operator', id: op.id }).expect(200);
    expect((await waitFor((m) => m.to.includes('staff@alpha.example') && m.subject.includes('fam trip'))).subject).toBe("You're invited to host a fam trip: Uganda for agents");

    const signup = await http().post('/portal/dmc-signup').send({ name: 'Байкал', contactName: 'Иван', email: 'ivan@b.example', password: 'another-long-pass' }).expect(201);
    const dmcId = signup.body.account.dmc.id;
    await asMod(http().post(`/admin/dmcs/${dmcId}/decision`)).send({ decision: 'approve' }).expect(200);
    await bearer(http().post(`/portal/dmc/fam-trips/${trip.body.id}/join`), signup.body.accessToken).send({ representativeName: 'Иван Петров' }).expect(200);
    expect((await waitFor((m) => m.subject.startsWith('Fam trip request'))).text).toContain('Иван Петров');

    await asMod(http().post(`/admin/fam-trips/${trip.body.id}/participants`)).send({ kind: 'dmc', id: dmcId, confirmed: true }).expect(200);
    await waitFor((m) => m.subject === 'Место в поездке подтверждено: Uganda for agents');
    await asMod(http().post(`/admin/fam-trips/${trip.body.id}/participants`)).send({ kind: 'dmc', id: dmcId, confirmed: true, representativeName: 'Анна' }).expect(200);
    await new Promise((r) => setTimeout(r, 100));
    expect(mail.sent.filter((m) => m.subject.startsWith('Место в поездке'))).toHaveLength(1);
  });
});

describe('forgot password', () => {
  it('emails a working link to a real login, says the same for unknown addresses, and throttles', async () => {
    const op = await approvedOperator();
    await asMod(http().post(`/admin/operators/${op.id}/accounts`)).send({ email: 'staff@alpha.example' }).expect(201);
    mail.sent.length = 0;

    await http().post('/portal/auth/forgot-password').send({ email: 'nobody@nowhere.example' }).expect(200, { ok: true });
    await http().post('/portal/auth/forgot-password').send({ email: 'Staff@Alpha.example' }).expect(200, { ok: true });
    const sent = await waitFor((m) => m.to.includes('staff@alpha.example'));
    expect(sent.subject).toBe('Reset your partner portal password');
    const token = new URL(linkIn(sent.text)).searchParams.get('token');
    await http().post('/portal/auth/set-password').send({ token, password: 'brand-new-password' }).expect(200);

    // A second request within five minutes sends nothing more.
    await http().post('/portal/auth/forgot-password').send({ email: 'staff@alpha.example' }).expect(200);
    await new Promise((r) => setTimeout(r, 100));
    expect(mail.sent.filter((m) => m.to.includes('staff@alpha.example'))).toHaveLength(1);
    expect(mail.sent.some((m) => m.to.includes('nobody@nowhere.example'))).toBe(false);
  });

  it('a DMC gets its reset email in Russian', async () => {
    await http().post('/portal/dmc-signup').send({ name: 'Байкал', contactName: 'Иван', email: 'ivan@b.example', password: 'another-long-pass' }).expect(201);
    await http().post('/portal/auth/forgot-password').send({ email: 'ivan@b.example' }).expect(200);
    expect((await waitFor((m) => m.subject === 'Новый пароль для кабинета партнёра')).to).toEqual(['ivan@b.example']);
  });
});

describe('SMTP delivery', () => {
  let server: Server;
  const received: string[] = [];

  /** The smallest SMTP server that accepts a message, so the real transport is exercised. */
  beforeAll(async () => {
    server = createServer((socket) => {
      let data = false;
      let body = '';
      socket.write('220 test ESMTP\r\n');
      socket.on('data', (chunk) => {
        for (const line of chunk.toString().split('\r\n').filter((l, i, a) => l || i < a.length - 1)) {
          if (data) {
            if (line === '.') {
              data = false;
              received.push(body);
              body = '';
              socket.write('250 queued\r\n');
            } else body += `${line}\n`;
          } else if (/^EHLO|^HELO/i.test(line)) socket.write('250 test\r\n');
          else if (/^DATA/i.test(line)) {
            data = true;
            socket.write('354 go\r\n');
          } else if (/^QUIT/i.test(line)) socket.end('221 bye\r\n');
          else socket.write('250 ok\r\n');
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  });
  afterAll(() => new Promise((r) => server.close(r)));

  it('sends through the server in SMTP_URL, one message per recipient, from MAIL_FROM_NAME <MAIL_FROM>', async () => {
    const port = (server.address() as { port: number }).port;
    Object.assign(process.env, { SMTP_URL: `smtp://127.0.0.1:${port}?ignoreTLS=true`, MAIL_FROM: 'no-reply@platform.example', MAIL_FROM_NAME: 'Проверено: Африка', MAIL_REPLY_TO: 'help@platform.example' });
    try {
      const smtp = new MailService();
      smtp.onModuleInit();
      expect(smtp.configured).toBe(true);
      await smtp.send({ to: ['a@x.example', 'b@x.example'], subject: 'Привет', text: 'Тест' });
      expect(received).toHaveLength(2);
      // The Russian name is encoded (and may be folded over lines); mailboxes decode it.
      expect(received[0]).toMatch(/^From: =\?UTF-8\?B\?/m);
      expect(received[0]).toContain('<no-reply@platform.example>');
      expect(received[0]).toContain('Reply-To: help@platform.example');
      expect(received[0]).toMatch(/^To: a@x\.example$/m);
      expect(received[0]).not.toContain('b@x.example');
      expect(smtp.sent).toHaveLength(0);
    } finally {
      delete process.env.SMTP_URL;
      delete process.env.MAIL_FROM;
      delete process.env.MAIL_FROM_NAME;
      delete process.env.MAIL_REPLY_TO;
    }
  });

  it('refuses to start with SMTP_URL but no sender address', () => {
    process.env.SMTP_URL = 'smtp://127.0.0.1:1';
    try {
      expect(() => new MailService().onModuleInit()).toThrow('MAIL_FROM');
    } finally {
      delete process.env.SMTP_URL;
    }
  });
});

describe('production settings', () => {
  const good = {
    NODE_ENV: 'production',
    JWT_SECRET: 'x'.repeat(40),
    SITE_URL: 'https://site.example',
    PORTAL_URL: 'https://partners.site.example',
    ADMIN_URL: 'https://admin.site.example',
    REVALIDATE_SECRET: 'r'.repeat(40),
    DOCUMENT_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  };
  it('refuses demo secrets and localhost links, warns about switched-off services', () => {
    expect(checkProductionConfig({ ...good, NODE_ENV: 'development', JWT_SECRET: 'short' })).toEqual([]);
    expect(() => checkProductionConfig({ ...good, JWT_SECRET: 'too-short', SITE_URL: 'http://localhost:3001' })).toThrow(/JWT_SECRET[\s\S]*SITE_URL/);
    expect(() => checkProductionConfig({ ...good, REVALIDATE_SECRET: 'change-me-revalidate' })).toThrow('REVALIDATE_SECRET');
    expect(checkProductionConfig(good)).toHaveLength(3);
    expect(checkProductionConfig({ ...good, TELEGRAM_BOT_TOKEN: 't', SMTP_URL: 'smtp://x', STAFF_EMAILS: 'a@b.c' })).toEqual([]);
  });
});
