import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

/** Fresh demo data before every run. */
export default function globalSetup() {
  execSync('npx prisma db seed', { cwd: resolve(__dirname, '../../../services/api'), stdio: 'inherit' });
}
