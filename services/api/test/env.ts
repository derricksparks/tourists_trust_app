// Tests use their own database, never the dev one (it is wiped between tests).
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://ttp:ttp@localhost:5432/ttp_test';
process.env.JWT_SECRET = 'test-secret-at-least-16-chars';
