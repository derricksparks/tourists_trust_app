'use client';

import type { PublicTranslator } from '@ttp/shared-types';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { TranslatorCard } from '@/components/TranslatorCard';
import { useTelegram } from '@/lib/useTelegram';

const COUNTRIES: [string, string][] = [['UG', 'Уганда'], ['TZ', 'Танзания'], ['KE', 'Кения'], ['RW', 'Руанда']];

export default function TelegramTranslators() {
  useTelegram('/tg');
  const router = useRouter();
  const [country, setCountry] = useState<string | null>(null);
  const [list, setList] = useState<PublicTranslator[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setList(null);
    fetch(`/backend/public/translators${country ? `?country=${country}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setList)
      .catch(() => setError(true));
  }, [country]);

  return (
    <>
      <header className="stack" style={{ gap: 6 }}>
        <h1>Гиды и переводчики</h1>
        <p className="muted">Все говорят по-русски и прошли нашу проверку. Выберите человека и опишите задачу.</p>
      </header>
      <div className="chips" role="group" aria-label="Страна">
        <button className="chip" aria-current={country === null} onClick={() => setCountry(null)}>Все</button>
        {COUNTRIES.map(([c, n]) => (
          <button key={c} className="chip" aria-current={country === c} onClick={() => setCountry(c)}>{n}</button>
        ))}
      </div>
      {error && <p className="notice">Не удалось загрузить список. Попробуйте позже.</p>}
      {!list && !error && <p className="muted">Загружаем…</p>}
      {list?.length === 0 && <p className="muted">Здесь пока никого нет.</p>}
      <div className="cards">
        {list?.map((t) => (
          <TranslatorCard key={t.id} t={t} action={<button className="btn primary" onClick={() => router.push(`/tg/translators/${t.id}`)}>Выбрать</button>} />
        ))}
      </div>
      <button className="btn" style={{ justifySelf: 'start' }} onClick={() => router.push('/tg/translator-signup')}>Я переводчик — хочу в каталог</button>
    </>
  );
}
