import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Fresh demo data before every run. Re-seeding gives every row a new id, so the site's cached API
 * responses must go too: drop the on-disk fetch cache and, if a site is already running, ask it to
 * refresh every tag.
 */
export default async function globalSetup() {
  execSync('npx prisma db seed', { cwd: resolve(__dirname, '../../../services/api'), stdio: 'inherit' });
  rmSync(resolve(__dirname, '../.next/cache/fetch-cache'), { recursive: true, force: true });
  const secret = process.env.REVALIDATE_SECRET ?? 'change-me-revalidate';
  await fetch('http://localhost:3001/api/revalidate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ tags: ['operators', 'guides', 'translators'] }),
  }).catch(() => undefined);
}
