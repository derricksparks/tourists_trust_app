import type { Metadata } from 'next';
import Link from 'next/link';
import { publicApi } from '@/lib/api';
import { countryRuIn, dateRu } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Визы в Уганду, Танзанию и Кению для россиян',
  description: 'Пошаговые инструкции по электронным визам и eTA, список документов и ссылки на официальные сайты.',
  alternates: { canonical: '/visa' },
};

export default async function VisaListPage() {
  const guides = await publicApi.visaGuides();
  return (
    <div className="page">
      <header className="stack" style={{ gap: 10 }}>
        <h1>Визы для поездки в Восточную Африку</h1>
        <p className="muted prose">
          Инструкции на русском и список документов. Подаёте вы сами на официальном сайте — мы не оформляем визы и не берём за это деньги.
        </p>
      </header>
      <div className="cards">
        {guides.map((g) => (
          <Link key={g.slug} href={`/visa/${g.slug}`} className="card">
            <span className="eyebrow">{g.visaType}</span>
            <h3>{g.titleRu}</h3>
            <p className="meta">
              {g.coveredCountries.length > 1 ? `Действует ${g.coveredCountries.map(countryRuIn).join(', ')}` : `Для поездки ${countryRuIn(g.countryCode)}`}
            </p>
            <p className="meta">Проверено {dateRu(g.lastUpdated)}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
