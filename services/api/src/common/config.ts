/** Reads required configuration once at startup so a missing value fails fast. */
export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('JWT_SECRET must be set to at least 16 characters');
  }
  return secret;
}

export const ADMIN_TOKEN_TTL = '8h';
