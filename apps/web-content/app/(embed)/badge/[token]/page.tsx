import type { BadgeStatus } from '@ttp/shared-types';
import type { Metadata } from 'next';
import { SITE_URL } from '@/lib/api';

export const metadata: Metadata = { robots: { index: false } };

const API_URL = process.env.API_URL ?? 'http://localhost:3000';
const COLORS = { verified: '#0d7a4e', revoked: '#b3261e', not_verified: '#5d6b63' } as const;
const TEXT = {
  ru: { verified: 'Проверенный туроператор', revoked: 'Проверка отозвана', not_verified: 'Не подтверждён', since: 'с', brand: 'Проверено: Африка' },
  en: { verified: 'Verified tour operator', revoked: 'Verification revoked', not_verified: 'Not verified', since: 'since', brand: 'Verified: Africa' },
};

/**
 * Iframe badge for sites that can't run scripts:
 *   <iframe src="https://SITE/badge/TOKEN" width="320" height="64" style="border:0" title="Verification"></iframe>
 */
export default async function BadgeFrame({ params, searchParams }: { params: { token: string }; searchParams: { lang?: string } }) {
  const res = await fetch(`${API_URL}/public/badge/${encodeURIComponent(params.token)}`, { next: { revalidate: 300, tags: ['operators'] } });
  const data: BadgeStatus = res.ok ? await res.json() : { state: 'not_verified' };
  const t = TEXT[searchParams.lang === 'en' ? 'en' : 'ru'];
  const color = COLORS[data.state];
  const op = data.operator;
  const since = op?.verifiedSince ? ` · ${t.since} ${new Date(op.verifiedSince).getUTCFullYear()}` : '';
  return (
    <a
      href={op ? `${SITE_URL}/operators/${op.slug}` : `${SITE_URL}/operators`}
      target="_blank"
      rel="noopener"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 10, padding: '8px 14px 8px 10px', border: `1.5px solid ${color}`,
        borderRadius: 12, background: '#fff', color: '#12201a', textDecoration: 'none',
      }}
    >
      <svg viewBox="0 0 40 40" width="36" height="36" aria-hidden="true" style={{ color }}>
        <circle cx="20" cy="20" r="18" fill="none" stroke="currentColor" strokeWidth="3" />
        <path
          d={data.state === 'verified' ? 'M12 20.5 L18 26.5 L28.5 14.5' : data.state === 'revoked' ? 'M14 14 L26 26 M26 14 L14 26' : 'M20 12 V22 M20 27.5 V28'}
          fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"
        />
      </svg>
      <span style={{ display: 'grid', gap: 2 }}>
        <b style={{ color }}>{t[data.state]}</b>
        <span style={{ fontSize: 12, color: '#55625b' }}>
          {op ? `${op.name} · ` : ''}
          {t.brand}
          {since}
        </span>
      </span>
    </a>
  );
}
