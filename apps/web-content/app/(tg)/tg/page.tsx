'use client';

import type { PublicCountry, PublicOperatorSummary } from '@ttp/shared-types';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { OperatorCard } from '@/components/OperatorCard';
import { getWebApp } from '@/lib/telegram';

/** Mini App start screen: verified operators by country. A start_param of op_<slug> jumps to that operator. */
export default function TelegramHome() {
  const router = useRouter();
  const [countries, setCountries] = useState<PublicCountry[]>([]);
  const [country, setCountry] = useState<string | null>(null);
  const [operators, setOperators] = useState<PublicOperatorSummary[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const app = getWebApp();
    app?.ready();
    app?.expand();
    const start = app?.initDataUnsafe.start_param;
    if (start?.startsWith('op_')) router.replace(`/tg/operators/${encodeURIComponent(start.slice(3))}`);
    else if (start?.startsWith('tr_')) router.replace(`/tg/translators/${encodeURIComponent(start.slice(3))}`);
    else if (start === 'translators') router.replace('/tg/translators');
    else if (start === 'translator') router.replace('/tg/translator-signup');
    fetch('/backend/public/countries')
      .then((r) => r.json())
      .then(setCountries)
      .catch(() => setError(true));
  }, [router]);

  useEffect(() => {
    setOperators(null);
    fetch(`/backend/public/operators${country ? `?country=${country}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setOperators)
      .catch(() => setError(true));
  }, [country]);

  return (
    <>
      <header className="stack" style={{ gap: 6 }}>
        <h1>Проверенные туроператоры</h1>
        <p className="muted">Лицензия, регистрация и видео проверены. Выберите компанию, чтобы задать вопрос.</p>
        <button className="btn" style={{ justifySelf: 'start' }} onClick={() => router.push('/tg/translators')}>
          Нужен переводчик или гид
        </button>
      </header>
      <div className="chips" role="group" aria-label="Страна">
        <button className="chip" aria-current={country === null} onClick={() => setCountry(null)}>
          Все
        </button>
        {countries
          .filter((c) => c.operatorCount > 0)
          .map((c) => (
            <button key={c.code} className="chip" aria-current={country === c.code} onClick={() => setCountry(c.code)}>
              {c.nameRu} <small>{c.operatorCount}</small>
            </button>
          ))}
      </div>
      {error && <p className="notice">Не удалось загрузить список. Закройте и откройте приложение ещё раз.</p>}
      {!operators && !error && <p className="muted">Загружаем…</p>}
      <div className="cards">
        {operators?.map((op) => (
          <div key={op.slug} onClickCapture={(e) => { e.preventDefault(); router.push(`/tg/operators/${op.slug}`); }}>
            <OperatorCard op={op} />
          </div>
        ))}
      </div>
    </>
  );
}
