import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AdminRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma.service';

export const PASSWORD = 'correct-horse-battery';

export async function createApp(): Promise<{ app: INestApplication; prisma: PrismaService }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

export async function resetDb(prisma: PrismaService) {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
  await prisma.country.createMany({
    data: [
      { code: 'UG', nameEn: 'Uganda', nameRu: 'Уганда', nameRuIn: 'в Уганде', active: true, licensingAuthority: 'Uganda Tourism Board' },
      { code: 'TZ', nameEn: 'Tanzania', nameRu: 'Танзания', nameRuIn: 'в Танзании', active: true },
      { code: 'KE', nameEn: 'Kenya', nameRu: 'Кения', nameRuIn: 'в Кении', active: true },
      { code: 'RU', nameEn: 'Russia', nameRu: 'Россия', nameRuIn: 'в России', active: false },
    ],
  });
}

const hash = bcrypt.hashSync(PASSWORD, 4);

export async function createAdmin(prisma: PrismaService, role: AdminRole, overrides: { active?: boolean } = {}) {
  return prisma.adminUser.create({
    data: { name: `Test ${role}`, email: `${role.toLowerCase()}-${Math.random().toString(36).slice(2)}@test.local`, passwordHash: hash, role, ...overrides },
  });
}

export async function tokenFor(app: INestApplication, email: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/admin/auth/login').send({ email, password: PASSWORD }).expect(200);
  return res.body.accessToken;
}

export const validOperator = {
  name: 'Test Safari Co',
  countryCode: 'ug',
  businessRegNumber: 'REG-1',
  tourismBoardLicense: 'LIC-1',
  licensingAuthority: 'Uganda Tourism Board',
  address: 'Kampala',
};
