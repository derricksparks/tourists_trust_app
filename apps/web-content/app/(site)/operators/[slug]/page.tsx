import type { Metadata } from 'next';
import Link from 'next/link';
import { Seal, Stars } from '@/components/Seal';
import { publicApi, SITE_URL, telegramLink } from '@/lib/api';
import { count, countryRuIn, dateRangeRu, dateRu, monthYearRu, priceRu, yearsRu } from '@/lib/format';

type Props = { params: { slug: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const op = await publicApi.operator(params.slug);
  const title = `${op.name}: проверенный туроператор ${countryRuIn(op.countryCode)}`;
  const description =
    op.descriptionRu ?? `Лицензия ${op.licensingAuthority}, проверка видео и отзывы путешественников. ${op.name}, ${op.country.nameRu}.`;
  return { title, description, alternates: { canonical: `/operators/${op.slug}` }, openGraph: { title, description } };
}

export default async function OperatorPage({ params }: Props) {
  const op = await publicApi.operator(params.slug);
  const since = op.verifiedSince ? new Date(op.verifiedSince).getUTCFullYear() : null;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'TravelAgency',
    name: op.name,
    url: op.websiteUrl ?? `${SITE_URL}/operators/${op.slug}`,
    address: { '@type': 'PostalAddress', addressCountry: op.countryCode },
    ...(op.yearEstablished && { foundingDate: String(op.yearEstablished) }),
    ...(op.websiteUrl && { sameAs: [op.websiteUrl] }),
  };

  return (
    <article className="page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />

      <header className="op-head">
        <div className="stack" style={{ gap: 14 }}>
          <Link href={`/operators?country=${op.countryCode}`} className="eyebrow" style={{ textDecoration: 'none' }}>
            ← Туроператоры {countryRuIn(op.countryCode)}
          </Link>
          <h1>{op.name}</h1>
          {op.descriptionRu && <p className="prose" style={{ fontSize: '1.1rem' }}>{op.descriptionRu}</p>}
          <p className="row muted" style={{ gap: 14 }}>
            {op.averageRating !== null && (
              <span>
                <Stars rating={op.averageRating} /> {op.averageRating.toLocaleString('ru-RU')} · {count(op.reviewCount, ['отзыв', 'отзыва', 'отзывов'])}
              </span>
            )}
            {op.yearEstablished && <span>Работает {yearsRu(op.yearEstablished)}</span>}
          </p>
          <div className="row">
            <a href={telegramLink(op.slug)} className="btn primary">
              Задать вопрос в Telegram
            </a>
            {op.websiteUrl && (
              <a href={op.websiteUrl} className="btn" rel="noopener" target="_blank">
                Сайт компании
              </a>
            )}
          </div>
        </div>
        <div className="seal-wrap">
          <Seal year={since} label={`Проверенный туроператор${op.verifiedSince ? ` с ${dateRu(op.verifiedSince)}` : ''}`} />
        </div>
      </header>

      <div className="two">
        <section className="panel" aria-labelledby="check">
          <h2 id="check">Что мы проверили</h2>
          <dl className="facts">
            <dt>Лицензия</dt>
            <dd>
              <span className="mono">{op.tourismBoardLicense}</span>
              <br />
              <span className="muted">{op.licensingAuthority}</span>
            </dd>
            <dt>Регистрация</dt>
            <dd className="mono">{op.businessRegNumber}</dd>
            <dt>Страна</dt>
            <dd>{op.country.nameRu}</dd>
            {op.yearEstablished && (
              <>
                <dt>Основана</dt>
                <dd>{op.yearEstablished}</dd>
              </>
            )}
            {op.verifiedSince && (
              <>
                <dt>Проверен</dt>
                <dd>{dateRu(op.verifiedSince)}</dd>
              </>
            )}
          </dl>
          <ul className="checks">
            <li>Номер лицензии сверен с реестром {op.licensingAuthority}</li>
            <li>Регистрация компании и адрес подтверждены</li>
            {op.verificationVideoUrl && (
              <li>
                <span>
                  Видео офиса и машин:{' '}
                  <a href={op.verificationVideoUrl} rel="noopener noreferrer" target="_blank">
                    смотреть
                  </a>
                </span>
              </li>
            )}
            <li>Отзывы — только по личным приглашениям после поездки</li>
          </ul>
          <p className="notice">
            Мы не принимаем платежи. Условия и оплату вы согласуете напрямую с туроператором или своим турагентством в России.
          </p>
        </section>

        <section className="panel" aria-labelledby="ask">
          <h2 id="ask">Как связаться</h2>
          <p>
            Напишите в нашем Telegram-боте: мы передадим вопрос туроператору и проследим, чтобы вам ответили. Если нужен переводчик — бот
            тоже поможет.
          </p>
          <a href={telegramLink(op.slug)} className="btn primary" style={{ justifySelf: 'start' }}>
            Открыть бота
          </a>
          {op.telegramUsername && <p className="muted">Telegram компании: @{op.telegramUsername.replace(/^@/, '')}</p>}
        </section>
      </div>

      {op.packages.length > 0 && (
        <section className="panel" aria-labelledby="tours">
          <h2 id="tours">Туры</h2>
          {op.packages.map((p) => (
            <div key={p.slug} className="package" id={p.slug}>
              <h3>
                <Link href={`/tours/${p.slug}`}>{p.titleRu ?? p.title}</Link>
              </h3>
              <p className="row muted" style={{ gap: 14 }}>
                <span>{count(p.durationDays, ['день', 'дня', 'дней'])}</span>
                {p.capacity && <span>до {count(p.capacity, ['человека', 'человек', 'человек'])} в группе</span>}
                {priceRu(p.price, p.currency, p.priceBasis) && <span className="price">{priceRu(p.price, p.currency, p.priceBasis)}</span>}
              </p>
              {p.descriptionRu && <p className="prose">{p.descriptionRu}</p>}
              {p.dates.length > 0 && (
                <p>
                  <span className="muted">Даты: </span>
                  {p.dates.map((d) => dateRangeRu(d.startDate, d.endDate)).join(' · ')}
                </p>
              )}
              {p.inclusions.length > 0 && (
                <div className="tags" aria-label="Включено">
                  {p.inclusions.map((i) => (
                    <span key={i} className="tag">
                      ✓ {INCLUSIONS[i] ?? i}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
          <p className="muted" style={{ fontSize: '0.9rem' }}>
            Цены ориентировочные, их указывает туроператор. Точную стоимость уточняйте при запросе.
          </p>
        </section>
      )}

      <section className="panel" aria-labelledby="reviews">
        <h2 id="reviews">Отзывы путешественников</h2>
        {op.reviews.length === 0 && <p className="muted">Отзывов пока нет. Они появятся после первых поездок.</p>}
        {op.reviews.map((r) => (
          <div key={r.id} className="review">
            <p className="row" style={{ gap: 10 }}>
              <Stars rating={r.rating} /> <strong>{r.authorName}</strong>
              <span className="muted">
                {monthYearRu(r.tripDate)}
                {r.packageTitle ? ` · ${r.packageTitle}` : ''}
              </span>
            </p>
            {r.bodyRu && <p className="prose">{r.bodyRu}</p>}
            {!r.bodyRu && r.bodyEn && <p className="prose" lang="en">{r.bodyEn}</p>}
            {r.operatorReply && (
              <p className="prose muted">
                <strong>Ответ туроператора:</strong> {r.operatorReply}
              </p>
            )}
          </div>
        ))}
      </section>
    </article>
  );
}

const INCLUSIONS: Record<string, string> = {
  transport: 'транспорт',
  accommodation: 'проживание',
  meals: 'питание',
  guide: 'гид',
  'park fees': 'сборы парков',
  'gorilla permit': 'пермит на горилл',
  '4x4 vehicle': 'джип 4×4',
  lodges: 'лоджи',
};
