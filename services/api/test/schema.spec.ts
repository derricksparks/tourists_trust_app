import { $Enums, PrismaClient } from '@prisma/client';
import { ADMIN_ROLES, OPERATOR_STATUSES, REVIEW_STATUSES } from '@ttp/shared-types';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

afterAll(() => prisma.$disconnect());

describe('schema', () => {
  it('shared-types enums match the Prisma enums', () => {
    expect([...OPERATOR_STATUSES].sort()).toEqual(Object.values($Enums.OperatorStatus).sort());
    expect([...ADMIN_ROLES].sort()).toEqual(Object.values($Enums.AdminRole).sort());
    expect([...REVIEW_STATUSES].sort()).toEqual(Object.values($Enums.ReviewStatus).sort());
  });

  // Hard rule: no payment processing and no payment fields in v1.
  it('has no payment-related tables or columns', async () => {
    const hits = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (table_name  ~* '(payment|transaction|payout|wallet|settlement|invoice|card|charge|refund)'
          OR column_name ~* '(payment|transaction|payout|wallet|settlement|invoice|card|charge|refund|iban|swift)')`;
    expect(hits).toEqual([]);
  });

  describe('CHECK constraints', () => {
    const insertReview = (rating: number) =>
      prisma.$executeRawUnsafe(
        `INSERT INTO reviews (id, operator_id, invite_id, author_name, rating, body_ru, trip_date, updated_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'x', $4, 'x', now(), now())`,
        randomUUID(), randomUUID(), randomUUID(), rating,
      );

    it('rejects a rating outside 1–5', async () => {
      await expect(insertReview(6)).rejects.toThrow(/reviews_ratings_range/);
    });

    it('rejects a portal account whose role does not match its owner', async () => {
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO accounts (id, email, password_hash, role, dmc_id, updated_at)
           VALUES ($1::uuid, 'a@b.c', 'x', 'OPERATOR', $2::uuid, now())`,
          randomUUID(), randomUUID(),
        ),
      ).rejects.toThrow(/accounts_role_owner/);
    });

    it('rejects a display price without a currency', async () => {
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO packages (id, operator_id, slug, title, country_code, duration_days, price, updated_at)
           VALUES ($1::uuid, $2::uuid, 's', 't', 'UG', 3, 100, now())`,
          randomUUID(), randomUUID(),
        ),
      ).rejects.toThrow(/packages_price_currency/);
    });
  });
});
