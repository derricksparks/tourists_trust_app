import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Fresh demo data before every run, so the queue always starts in the same state. */
export default function globalSetup() {
  const api = fileURLToPath(new URL('../../../services/api', import.meta.url));
  execSync('npx prisma db seed', { cwd: api, stdio: 'inherit' });
}
