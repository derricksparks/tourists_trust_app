import { execSync } from 'child_process';

/** Applies all migrations to the test database once before the suite. */
export default function globalSetup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://ttp:ttp@localhost:5432/ttp_test';
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } });
}
