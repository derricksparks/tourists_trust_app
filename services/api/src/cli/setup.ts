/**
 * Prepares a fresh production database, where the demo seed must never run:
 *   node dist/cli/setup.js <email> "<name>" [SUPER_ADMIN|MODERATOR|CONTENT_EDITOR]
 * Adds the reference countries and creates a staff login (super admin by default) with a random
 * password, printed once. Run it again with the same email to reset that person's password.
 */
import { AdminRole, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

export const COUNTRIES = [
  { code: 'UG', nameEn: 'Uganda', nameRu: 'Уганда' },
  { code: 'TZ', nameEn: 'Tanzania', nameRu: 'Танзания' },
  { code: 'KE', nameEn: 'Kenya', nameRu: 'Кения' },
  { code: 'RW', nameEn: 'Rwanda', nameRu: 'Руанда' },
  { code: 'RU', nameEn: 'Russia', nameRu: 'Россия' },
];

async function main() {
  const [email, name, role = 'SUPER_ADMIN'] = process.argv.slice(2);
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !(role in AdminRole)) {
    console.error('Usage: node dist/cli/setup.js <email> "<name>" [SUPER_ADMIN|MODERATOR|CONTENT_EDITOR]');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    for (const c of COUNTRIES) await prisma.country.upsert({ where: { code: c.code }, create: c, update: {} });

    const password = randomBytes(12).toString('base64url');
    const passwordHash = await bcrypt.hash(password, 12);
    const existing = await prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) {
      await prisma.adminUser.update({ where: { id: existing.id }, data: { passwordHash, active: true } });
      console.log(`Password reset for ${existing.email} (${existing.role}).`);
    } else {
      await prisma.adminUser.create({ data: { email: email.toLowerCase(), name: name || email, passwordHash, role: role as AdminRole } });
      console.log(`${role} ${email.toLowerCase()} created.`);
    }
    console.log(`Password: ${password}\nIt is shown only this once. Sign in to the admin dashboard with it.`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
