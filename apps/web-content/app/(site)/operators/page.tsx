import type { Metadata } from 'next';
import Link from 'next/link';
import { OperatorCard } from '@/components/OperatorCard';
import { publicApi } from '@/lib/api';
import { countryRuIn } from '@/lib/format';
import { loadCountries } from '@/lib/countries';

type Props = { searchParams: { country?: string } };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  await loadCountries();
  const c = searchParams.country?.toUpperCase();
  return {
    title: c ? `Проверенные туроператоры ${countryRuIn(c)}` : 'Проверенные туроператоры',
    alternates: { canonical: c ? `/operators?country=${c}` : '/operators' },
  };
}

export default async function OperatorsPage({ searchParams }: Props) {
  await loadCountries();
  const country = /^[A-Za-z]{2}$/.test(searchParams.country ?? '') ? searchParams.country!.toUpperCase() : undefined;
  const [countries, operators] = await Promise.all([publicApi.countries(), publicApi.operators(country)]);

  return (
    <div className="page">
      <header className="stack" style={{ gap: 10 }}>
        <h1>{country ? `Туроператоры ${countryRuIn(country)}` : 'Проверенные туроператоры'}</h1>
        <p className="muted prose">
          В списке только компании, которые прошли проверку лицензии, регистрации и видео. Если проверку отзывают, компания исчезает
          отсюда, а её значок на сайте показывает «проверка отозвана».
        </p>
      </header>
      <nav className="chips" aria-label="Страна">
        <Link href="/operators" className="chip" aria-current={!country}>
          Все <small>{countries.reduce((a, c) => a + c.operatorCount, 0)}</small>
        </Link>
        {countries
          .filter((c) => c.operatorCount > 0)
          .map((c) => (
            <Link key={c.code} href={`/operators?country=${c.code}`} className="chip" aria-current={country === c.code}>
              {c.nameRu} <small>{c.operatorCount}</small>
            </Link>
          ))}
      </nav>
      {operators.length ? (
        <div className="cards">
          {operators.map((op) => (
            <OperatorCard key={op.slug} op={op} />
          ))}
        </div>
      ) : (
        <p className="muted">В этой стране пока нет проверенных туроператоров.</p>
      )}
    </div>
  );
}
