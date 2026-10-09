import Link from 'next/link';
import { OperatorCard } from '@/components/OperatorCard';
import { Seal } from '@/components/Seal';
import { publicApi, telegramLink } from '@/lib/api';
import { count, countryRuIn } from '@/lib/format';

export default async function HomePage() {
  const [countries, operators, visas] = await Promise.all([publicApi.countries(), publicApi.operators(), publicApi.visaGuides()]);
  const total = countries.reduce((a, c) => a + c.operatorCount, 0);
  const featured = [...operators].sort((a, b) => b.reviewCount - a.reviewCount).slice(0, 6);

  return (
    <div className="page">
      <section className="hero">
        <div className="stack" style={{ gap: 20 }}>
          <span className="eyebrow">Уганда · Танзания · Кения</span>
          <h1>Туроператоры Восточной Африки, которых мы проверили сами</h1>
          <p className="lead">
            Лицензия, регистрация компании, видео офиса и машин, отзывы только от тех, кто реально съездил. Всё на русском — и без
            предоплаты через посредников.
          </p>
          <div className="row">
            <Link href="/operators" className="btn primary">
              {count(total, ['проверенный туроператор', 'проверенных туроператора', 'проверенных туроператоров'])}
            </Link>
            <a href={telegramLink()} className="btn">
              Открыть в Telegram
            </a>
          </div>
        </div>
        <div className="seal-wrap">
          <Seal />
        </div>
      </section>

      <section className="stack" aria-labelledby="how">
        <h2 id="how">Что значит «проверен»</h2>
        <ol className="steps">
          <li>
            <h3>Лицензия</h3>
            <p className="muted">Сверяем номер лицензии с реестром: Uganda Tourism Board, TALA в Танзании, TRA в Кении.</p>
          </li>
          <li>
            <h3>Компания</h3>
            <p className="muted">Проверяем регистрацию, адрес и контакт рекомендателя, который работал с оператором.</p>
          </li>
          <li>
            <h3>Видео</h3>
            <p className="muted">Оператор показывает офис, лагерь и машины на видео — без стоковых фото.</p>
          </li>
          <li>
            <h3>Отзывы по приглашению</h3>
            <p className="muted">Отзыв можно оставить только по личной ссылке после поездки. Каждый читает модератор.</p>
          </li>
        </ol>
      </section>

      <section className="stack" aria-labelledby="where">
        <h2 id="where">Куда поехать</h2>
        <div className="chips">
          {countries
            .filter((c) => c.operatorCount > 0)
            .map((c) => (
              <Link key={c.code} href={`/operators?country=${c.code}`} className="chip">
                {c.nameRu} <small>{c.operatorCount}</small>
              </Link>
            ))}
        </div>
        <div className="cards">
          {featured.map((op) => (
            <OperatorCard key={op.slug} op={op} />
          ))}
        </div>
      </section>

      {visas.length > 0 && (
        <section className="stack" aria-labelledby="visas">
          <h2 id="visas">Визы</h2>
          <div className="cards">
            {visas.map((v) => (
              <Link key={v.slug} href={`/visa/${v.slug}`} className="card">
                <span className="eyebrow">{v.visaType}</span>
                <h3>{v.titleRu}</h3>
                <p className="meta">
                  {v.coveredCountries.length > 1 ? `Действует ${v.coveredCountries.map(countryRuIn).join(', ')}` : `Для поездки ${countryRuIn(v.countryCode)}`}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
