'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';

type Key = 'rating' | 'ratingGuide' | 'ratingVehicle' | 'ratingAccommodation' | 'ratingValue';
const PARTS: { key: Key; label: string }[] = [
  { key: 'ratingGuide', label: 'Гид' },
  { key: 'ratingVehicle', label: 'Транспорт' },
  { key: 'ratingAccommodation', label: 'Жильё' },
  { key: 'ratingValue', label: 'Цена и качество' },
];

function Stars({ id, label, value, onChange }: { id: string; label: string; value?: number; onChange: (n: number) => void }) {
  return (
    <div className="rating" role="radiogroup" aria-labelledby={id}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={!!value && n <= value} aria-label={`${label}: ${n} из 5`} onClick={() => onChange(n)}>
          ★
        </button>
      ))}
    </div>
  );
}

export function ReviewForm({ token, defaultName, operatorName, operatorSlug }: { token: string; defaultName: string; operatorName: string; operatorSlug: string }) {
  const [ratings, setRatings] = useState<Partial<Record<Key, number>>>({});
  const [authorName, setAuthorName] = useState(defaultName);
  const [bodyRu, setBodyRu] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!ratings.rating) return setError('Поставьте общую оценку.');
    if (bodyRu.trim().length < 30) return setError('Напишите хотя бы пару предложений о поездке.');
    if (!consent) return setError('Отметьте согласие на публикацию.');
    setBusy(true);
    try {
      const res = await fetch(`/backend/public/review-invites/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...ratings, authorName: authorName.trim(), bodyRu: bodyRu.trim(), consent: true }),
      });
      if (res.status === 409) throw new Error('По этой ссылке отзыв уже оставлен или она больше не действует.');
      if (!res.ok) throw new Error('Не получилось отправить. Попробуйте ещё раз.');
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <div className="panel prose" role="status">
        <h2>Спасибо!</h2>
        <p>Отзыв появится на странице {operatorName} после проверки модератором, обычно в течение двух дней.</p>
        <Link href={`/operators/${operatorSlug}`}>Перейти на страницу компании</Link>
      </div>
    );

  return (
    <form className="form panel" onSubmit={submit} noValidate>
      <fieldset>
        <legend id="overall">Общая оценка</legend>
        <Stars id="overall" label="Общая оценка" value={ratings.rating} onChange={(n) => setRatings((r) => ({ ...r, rating: n }))} />
      </fieldset>
      <fieldset>
        <legend>По отдельности (необязательно)</legend>
        {PARTS.map((p) => (
          <div key={p.key} className="rating-row">
            <span className="label" id={`l-${p.key}`}>{p.label}</span>
            <Stars id={`l-${p.key}`} label={p.label} value={ratings[p.key]} onChange={(n) => setRatings((r) => ({ ...r, [p.key]: n }))} />
          </div>
        ))}
      </fieldset>
      <div className="field">
        <label htmlFor="body">Расскажите о поездке</label>
        <textarea id="body" value={bodyRu} onChange={(e) => setBodyRu(e.target.value)} maxLength={4000} placeholder="Что понравилось, что нет, совпало ли с обещанным, как работал гид." />
      </div>
      <div className="field">
        <label htmlFor="name">Подпись под отзывом</label>
        <input id="name" type="text" value={authorName} onChange={(e) => setAuthorName(e.target.value)} maxLength={60} />
      </div>
      <label className="consent" style={{ display: 'grid', gridTemplateColumns: '22px 1fr', gap: 10 }}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ width: 18, height: 18, marginTop: 3 }} />
        <span>Согласен на публикацию отзыва с этой подписью.</span>
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn primary" type="submit" disabled={busy} style={{ justifySelf: 'start' }}>
        {busy ? 'Отправляем…' : 'Отправить отзыв'}
      </button>
    </form>
  );
}
