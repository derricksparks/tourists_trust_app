'use client';

import type { PublicCountry, PublicTranslator } from '@ttp/shared-types';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { TranslatorCard } from '@/components/TranslatorCard';
import { registerCountries } from '@/lib/format';
import { useTelegram } from '@/lib/useTelegram';


export default function TelegramTranslators() {
  useTelegram('/tg');
  const router = useRouter();
  const [country, setCountry] = useState<string | null>(null);
  const [list, setList] = useState<PublicTranslator[] | null>(null);
  const [error, setError] = useState(false);
  const [countries, setCountries] = useState<PublicCountry[]>([]);

  // Destinations come from the API (staff add countries); also teaches the cards their Russian names.
  useEffect(() => {
    fetch('/backend/public/countries')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: PublicCountry[]) => {
        registerCountries(list);
        setCountries(list);
      })
      .catch(() => undefined);
  }, []);

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
        {countries.map((c) => (
          <button key={c.code} className="chip" aria-current={country === c.code} onClick={() => setCountry(c.code)}>{c.nameRu}</button>
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
