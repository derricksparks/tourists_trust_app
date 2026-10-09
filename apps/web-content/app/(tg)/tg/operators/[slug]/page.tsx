import { RequestForm } from '@/components/RequestForm';
import { Stars, Tick } from '@/components/Seal';
import { publicApi, SITE_URL } from '@/lib/api';
import { count, countryRu, sinceRu } from '@/lib/format';
import { loadCountries } from '@/lib/countries';

export default async function TelegramOperator({ params }: { params: { slug: string } }) {
  await loadCountries();
  const op = await publicApi.operator(params.slug);
  return (
    <>
      <header className="stack" style={{ gap: 8 }}>
        <span className="verified">
          <Tick /> Проверен{op.verifiedSince ? ` ${sinceRu(op.verifiedSince)}` : ''}
        </span>
        <h1>{op.name}</h1>
        <p className="muted">
          {countryRu(op.countryCode)} · лицензия {op.licensingAuthority}
        </p>
        {op.averageRating !== null && (
          <p>
            <Stars rating={op.averageRating} /> {op.averageRating.toLocaleString('ru-RU')} · {count(op.reviewCount, ['отзыв', 'отзыва', 'отзывов'])}
          </p>
        )}
        {op.descriptionRu && <p>{op.descriptionRu}</p>}
        <a href={`${SITE_URL}/operators/${op.slug}`} target="_blank" rel="noopener">
          Подробнее: проверка, туры и отзывы
        </a>
      </header>
      <section className="panel" aria-labelledby="ask">
        <h2 id="ask">Задать вопрос</h2>
        <RequestForm operatorSlug={op.slug} operatorName={op.name} packages={op.packages.map((p) => ({ slug: p.slug, title: p.titleRu ?? p.title }))} />
      </section>
    </>
  );
}
