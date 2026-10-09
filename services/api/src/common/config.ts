/** Reads required configuration once at startup so a missing value fails fast. */
export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('JWT_SECRET must be set to at least 16 characters');
  }
  return secret;
}

export const ADMIN_TOKEN_TTL = '8h';

/**
 * In production, refuse to start with settings that would quietly break the pilot (demo secrets,
 * links pointing at localhost) and warn about optional services that are switched off.
 */
export function checkProductionConfig(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const errors: string[] = [];
  if ((env.JWT_SECRET ?? '').length < 32) errors.push('JWT_SECRET must be at least 32 random characters');
  for (const name of ['SITE_URL', 'PORTAL_URL', 'ADMIN_URL']) {
    if (!env[name]?.startsWith('https://')) errors.push(`${name} must be the public https:// address`);
  }
  if (!env.REVALIDATE_SECRET || env.REVALIDATE_SECRET.startsWith('change-me')) errors.push('REVALIDATE_SECRET must be set to a random value');
  // Operators' licence files are encrypted with it; losing it makes them unreadable.
  if (!env.DOCUMENT_ENCRYPTION_KEY) errors.push('DOCUMENT_ENCRYPTION_KEY must be set (openssl rand -base64 32) and kept safe');
  if (errors.length) throw new Error(`Production settings are not ready:\n- ${errors.join('\n- ')}`);
  const warnings: string[] = [];
  if (!env.TELEGRAM_BOT_TOKEN) warnings.push('TELEGRAM_BOT_TOKEN is not set: Mini App sign-in and staff replies are off');
  if (!env.SMTP_URL) warnings.push('SMTP_URL is not set: emails are only logged, not sent');
  if (!env.STAFF_EMAILS) warnings.push('STAFF_EMAILS is not set: nobody is emailed about new DMC applications');
  return warnings;
}
