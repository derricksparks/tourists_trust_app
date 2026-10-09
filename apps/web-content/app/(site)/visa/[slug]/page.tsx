import type { Metadata } from 'next';
import Link from 'next/link';
import { Checklist } from '@/components/Checklist';
import { publicApi } from '@/lib/api';
import { countryRu, countryRuIn, dateRu } from '@/lib/format';
import { renderMarkdown } from '@/lib/markdown';

type Props = { params: { slug: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const g = await publicApi.visaGuide(params.slug);
  return {
    title: `${g.titleRu}: документы и порядок подачи`,
    description: `${g.visaType} ${countryRuIn(g.countryCode)} для граждан России: список документов, порядок подачи, официальный сайт.`,
    alternates: { canonical: `/visa/${g.slug}` },
  };
}

export default async function VisaGuidePage({ params }: Props) {
  const g = await publicApi.visaGuide(params.slug);
  const operatorsLink = `/operators?country=${g.countryCode}`;
  return (
    <article className="page">
      <header className="stack" style={{ gap: 12 }}>
        <Link href="/visa" className="eyebrow" style={{ textDecoration: 'none' }}>
          ← Все визы
        </Link>
        <h1>{g.titleRu}</h1>
        <p className="muted">
          {g.visaType}
          {g.coveredCountries.length > 1 && ` · действует: ${g.coveredCountries.map(countryRu).join(', ')}`} · проверено {dateRu(g.lastUpdated)}
        </p>
      </header>

      <div className="two">
        <section className="panel article" aria-label="Порядок подачи" dangerouslySetInnerHTML={{ __html: renderMarkdown(g.requirementsRu) }} />
        <aside className="stack">
          {g.checklistItems.length > 0 && (
            <section className="panel" aria-labelledby="docs">
              <h2 id="docs">Документы</h2>
              <Checklist guideSlug={g.slug} items={g.checklistItems} />
            </section>
          )}
          <section className="panel" aria-labelledby="facts">
            <h2 id="facts">Коротко</h2>
            <dl className="facts">
              {g.processingTime && (
                <>
                  <dt>Срок</dt>
                  <dd>{g.processingTime}</dd>
                </>
              )}
              {g.feeInfo && (
                <>
                  <dt>Сбор</dt>
                  <dd>{g.feeInfo}</dd>
                </>
              )}
              <dt>Где подать</dt>
              <dd>
                {g.officialUrl ? (
                  <a href={g.officialUrl} rel="noopener noreferrer" target="_blank">
                    {new URL(g.officialUrl).hostname}
                  </a>
                ) : (
                  'на официальном портале страны'
                )}
              </dd>
            </dl>
            <p className="notice">Подавайте только на официальном сайте. Сайты-посредники берут лишние комиссии.</p>
          </section>
          <Link href={operatorsLink} className="btn" style={{ justifySelf: 'start' }}>
            Туроператоры {countryRuIn(g.countryCode)}
          </Link>
        </aside>
      </div>
    </article>
  );
}
