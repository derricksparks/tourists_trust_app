import type { Metadata } from 'next';
import Link from 'next/link';
import { Stars, Tick } from '@/components/Seal';
import { publicApi, SITE_URL, telegramLink } from '@/lib/api';
import { count, countryRuIn, dateRangeRu, priceRu, sinceRu } from '@/lib/format';

type Props = { params: { slug: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await publicApi.package(params.slug);
  const title = `${p.titleRu ?? p.title}: ${count(p.durationDays, ['день', 'дня', 'дней'])} ${countryRuIn(p.operator.countryCode)}`;
  return { title, description: p.descriptionRu ?? undefined, alternates: { canonical: `/tours/${p.slug}` } };
}

const INCLUSIONS: Record<string, string> = {
  transport: 'транспорт', accommodation: 'проживание', meals: 'питание', guide: 'гид', 'park fees': 'сборы парков',
  'gorilla permit': 'пермит на горилл', '4x4 vehicle': 'джип 4×4', lodges: 'лоджи', 'airport transfer': 'трансфер из аэропорта', flights: 'перелёты',
};

/**
 * Russian "mirror" page of a tour (spec B2B-4): the operator's offer with its verification, linking back
 * to the operator's own site and to the Russian travel companies that sell it.
 */
export default async function TourPage({ params }: Props) {
  const p = await publicApi.package(params.slug);
  const op = p.operator;
  const price = priceRu(p.price, p.currency, p.priceBasis);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'TouristTrip',
    name: p.titleRu ?? p.title,
    description: p.descriptionRu ?? undefined,
    url: `${SITE_URL}/tours/${p.slug}`,
    provider: { '@type': 'TravelAgency', name: op.name, url: op.websiteUrl ?? `${SITE_URL}/operators/${op.slug}` },
  };

  return (
    <article className="page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <header className="stack" style={{ gap: 12 }}>
        <Link href={`/operators/${op.slug}`} className="eyebrow" style={{ textDecoration: 'none' }}>← {op.name}</Link>
        <h1>{p.titleRu ?? p.title}</h1>
        <p className="row muted" style={{ gap: 14 }}>
          <span>{count(p.durationDays, ['день', 'дня', 'дней'])}</span>
          {p.capacity && <span>до {count(p.capacity, ['человека', 'человек', 'человек'])} в группе</span>}
          {price && <span className="price">{price}</span>}
        </p>
      </header>

      <div className="two">
        <div className="stack">
          {p.descriptionRu && <p className="prose" style={{ fontSize: '1.08rem' }}>{p.descriptionRu}</p>}
          {p.dates.length > 0 && (
            <section className="panel" aria-labelledby="dates">
              <h2 id="dates">Даты</h2>
              <ul className="checks">{p.dates.map((d) => <li key={d.startDate}>{dateRangeRu(d.startDate, d.endDate)}{d.capacity ? ` · мест: ${d.capacity}` : ''}</li>)}</ul>
            </section>
          )}
          {(p.inclusions.length > 0 || p.exclusions.length > 0) && (
            <section className="panel" aria-labelledby="incl">
              <h2 id="incl">Что входит</h2>
              <div className="tags">{p.inclusions.map((i) => <span key={i} className="tag">✓ {INCLUSIONS[i] ?? i}</span>)}</div>
              {p.exclusions.length > 0 && <p className="muted">Не входит: {p.exclusions.join(', ')}</p>}
            </section>
          )}
          <p className="muted" style={{ fontSize: '0.9rem' }}>Цена ориентировочная, её указывает туроператор. Платежи через наш сайт не принимаются.</p>
        </div>

        <aside className="stack">
          <section className="panel" aria-labelledby="who">
            <h2 id="who">Кто проводит тур</h2>
            <span className="verified"><Tick /> Проверен{op.verifiedSince ? ` ${sinceRu(op.verifiedSince)}` : ''}</span>
            <p><Link href={`/operators/${op.slug}`}><strong>{op.name}</strong></Link></p>
            <p className="muted">Лицензия: {op.licensingAuthority}</p>
            {op.averageRating !== null && (
              <p><Stars rating={op.averageRating} /> {op.averageRating.toLocaleString('ru-RU')} · {count(op.reviewCount, ['отзыв', 'отзыва', 'отзывов'])}</p>
            )}
            {op.websiteUrl && <a href={op.websiteUrl} rel="noopener" target="_blank">Сайт туроператора</a>}
          </section>

          <section className="panel" aria-labelledby="buy">
            <h2 id="buy">Где купить</h2>
            {p.sellers.length > 0 ? (
              <>
                <p className="muted">Российские турфирмы, которые продают этот тур:</p>
                <ul className="checks">
                  {p.sellers.map((s) => (
                    <li key={s.url}><span><a href={s.url} rel="noopener" target="_blank">{s.dmcName}</a>{s.title !== (p.titleRu ?? p.title) && <span className="muted"> — «{s.title}»</span>}</span></li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="muted">Пока этот тур можно заказать напрямую у туроператора.</p>
            )}
            <a href={telegramLink(op.slug)} className="btn primary" style={{ justifySelf: 'start' }}>Задать вопрос в Telegram</a>
          </section>
        </aside>
      </div>
    </article>
  );
}
