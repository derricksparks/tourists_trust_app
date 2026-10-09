import type { Metadata } from 'next';
import { publicApi } from '@/lib/api';
import { countryRu, dateRu } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Страховка для поездки в Уганду, Танзанию и Кению: сравнение',
  description: 'Российские страховщики, которые реально урегулируют случаи в Восточной Африке: покрытие, исключения, репатриация, контакты.',
  alternates: { canonical: '/insurance' },
};

export default async function InsurancePage() {
  const insurers = await publicApi.insurers();
  return (
    <div className="page">
      <header className="stack" style={{ gap: 10 }}>
        <h1>Страховка для Восточной Африки</h1>
        <p className="muted prose">
          Мы сами звоним страховщикам и проверяем, могут ли они оплатить лечение и эвакуацию в Уганде, Танзании и Кении. Полисы мы не
          продаём и комиссий не получаем — покупайте на сайте страховщика.
        </p>
      </header>
      {insurers.length === 0 ? (
        <p className="muted">Сравнение готовится.</p>
      ) : (
        <div className="table-scroll" role="region" aria-label="Сравнение страховщиков" tabIndex={0}>
          <table className="compare">
            <thead>
              <tr>
                <th scope="col">Страховщик</th>
                <th scope="col">Страны</th>
                <th scope="col">Репатриация</th>
                <th scope="col">Что покрывает</th>
                <th scope="col">Исключения</th>
                <th scope="col">Лимит</th>
                <th scope="col">Куда звонить при страховом случае</th>
              </tr>
            </thead>
            <tbody>
              {insurers.map((i) => (
                <tr key={i.id}>
                  <th scope="row">
                    {i.websiteUrl ? <a href={i.websiteUrl} rel="noopener noreferrer" target="_blank">{i.nameRu ?? i.name}</a> : (i.nameRu ?? i.name)}
                    {i.verifiedAt && <div className="muted small">проверено {dateRu(i.verifiedAt)}</div>}
                  </th>
                  <td>{i.countriesCovered.map(countryRu).join(', ')}</td>
                  <td>{i.repatriationConfirmed ? <span className="yes">✓ подтверждена</span> : <span className="muted">не подтверждена</span>}</td>
                  <td>{i.coverageRu ?? '—'}</td>
                  <td>{i.exclusionsRu ?? '—'}</td>
                  <td>{i.medicalLimitInfo ?? '—'}</td>
                  <td className="mono">{i.claimsContact}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="notice prose">
        Перед покупкой проверьте, что в полис включены нужные страны, сафари и активности (например, восхождение на Килиманджаро). Условия
        меняются — сверяйтесь с договором.
      </p>
    </div>
  );
}
