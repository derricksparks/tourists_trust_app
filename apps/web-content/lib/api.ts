import type {
  PublicCountry,
  PublicDestinationGuide,
  PublicInsurer,
  PublicOperatorDetail,
  PublicOperatorSummary,
  PublicTranslator,
  PublicVisaGuide,
} from '@ttp/shared-types';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

/**
 * Server-side reads from the core API. Pages are cached and refreshed every five minutes, or
 * immediately when the API calls /api/revalidate with the matching tag after a change.
 */
async function get<T>(path: string, tag: 'operators' | 'guides' | 'translators'): Promise<T> {
  // Render at request time rather than at build time, so building the site never needs the API.
  // The fetch below is still cached (and refreshed by tag), so the API isn't hit on every visit.
  headers();
  const res = await fetch(`${API_URL}/public${path}`, { next: { revalidate: 300, tags: [tag] } });
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`API ${path} returned ${res.status}`);
  return res.json() as Promise<T>;
}

const qs = (p: Record<string, string | undefined>) => {
  const e = Object.entries(p).filter((x): x is [string, string] => !!x[1]);
  return e.length ? `?${new URLSearchParams(e)}` : '';
};

export const publicApi = {
  countries: () => get<PublicCountry[]>('/countries', 'operators'),
  operators: (country?: string) => get<PublicOperatorSummary[]>(`/operators${qs({ country })}`, 'operators'),
  operator: (slug: string) => get<PublicOperatorDetail>(`/operators/${encodeURIComponent(slug)}`, 'operators'),
  visaGuides: (country?: string) => get<PublicVisaGuide[]>(`/visa-guides${qs({ country })}`, 'guides'),
  visaGuide: (slug: string) => get<PublicVisaGuide>(`/visa-guides/${encodeURIComponent(slug)}`, 'guides'),
  guides: (p: { country?: string; kind?: string } = {}) => get<PublicDestinationGuide[]>(`/guides${qs(p)}`, 'guides'),
  guide: (slug: string) => get<PublicDestinationGuide>(`/guides/${encodeURIComponent(slug)}`, 'guides'),
  translators: (p: { country?: string; specialty?: string } = {}) => get<PublicTranslator[]>(`/translators${qs(p)}`, 'translators'),
  translator: (id: string) => get<PublicTranslator>(`/translators/${encodeURIComponent(id)}`, 'translators'),
  insurers: () => get<PublicInsurer[]>('/insurers', 'guides'),
};

export const SITE_URL = (process.env.SITE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
export const TELEGRAM_BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT ?? 'TrustAfricaDemoBot';

/** Deep link that opens the bot's Mini App straight on an operator (start_param = op_<slug>). */
export const telegramLink = (slug?: string) =>
  `https://t.me/${TELEGRAM_BOT}${slug ? `?startapp=${encodeURIComponent(`op_${slug}`)}` : ''}`;

/** Opens the Mini App on a screen: tr_<id> for a translator, translator for the sign-up form. */
export const telegramAppLink = (startParam: string) => `https://t.me/${TELEGRAM_BOT}?startapp=${encodeURIComponent(startParam)}`;
