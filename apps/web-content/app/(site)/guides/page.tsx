import type { Metadata } from 'next';
import Link from 'next/link';
import { publicApi } from '@/lib/api';
import { countryRu } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Как добраться и что посмотреть',
  description: 'Перелёты, пересадки, сезоны и главные места Уганды, Танзании и Кении — на русском.',
  alternates: { canonical: '/guides' },
};

export default async function GuidesPage() {
  const guides = await publicApi.guides();
  const byCountry = new Map<string, typeof guides>();
  for (const g of guides) byCountry.set(g.countryCode, [...(byCountry.get(g.countryCode) ?? []), g]);

  return (
    <div className="page">
      <header className="stack" style={{ gap: 10 }}>
        <h1>Как добраться и что посмотреть</h1>
        <p className="muted prose">Маршруты перелёта, транзитные визы и лучшие сезоны. Мы обновляем статьи вручную и пишем дату проверки.</p>
      </header>
      {[...byCountry.entries()].map(([code, list]) => (
        <section key={code} className="stack" aria-labelledby={`c-${code}`}>
          <h2 id={`c-${code}`}>{countryRu(code)}</h2>
          <div className="cards">
            {list.map((g) => (
              <Link key={g.slug} href={`/guides/${g.slug}`} className="card">
                <span className="eyebrow">{g.kind === 'LOGISTICS' ? 'Как добраться' : 'Что посмотреть'}</span>
                <h3>{g.titleRu}</h3>
                {g.summaryRu && <p className="meta">{g.summaryRu}</p>}
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
