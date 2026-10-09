import type { Metadata } from 'next';
import Link from 'next/link';
import { publicApi } from '@/lib/api';
import { countryRuIn, dateRu } from '@/lib/format';
import { renderMarkdown } from '@/lib/markdown';
import { loadCountries } from '@/lib/countries';

type Props = { params: { slug: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await loadCountries();
  const g = await publicApi.guide(params.slug);
  return { title: g.titleRu, description: g.summaryRu ?? undefined, alternates: { canonical: `/guides/${g.slug}` } };
}

export default async function GuidePage({ params }: Props) {
  await loadCountries();
  const g = await publicApi.guide(params.slug);
  return (
    <article className="page">
      <header className="stack" style={{ gap: 12 }}>
        <Link href="/guides" className="eyebrow" style={{ textDecoration: 'none' }}>
          ← Все статьи
        </Link>
        <h1>{g.titleRu}</h1>
        <p className="muted">Проверено {dateRu(g.lastUpdated)}</p>
      </header>
      <div className="two">
        <div className="article prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(g.bodyRu) }} />
        <aside className="stack">
          <Link href={`/operators?country=${g.countryCode}`} className="btn primary" style={{ justifySelf: 'start' }}>
            Туроператоры {countryRuIn(g.countryCode)}
          </Link>
          <Link href="/visa" className="btn" style={{ justifySelf: 'start' }}>
            Визы
          </Link>
        </aside>
      </div>
    </article>
  );
}
