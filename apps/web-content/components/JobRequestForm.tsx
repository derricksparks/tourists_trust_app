'use client';

import { LANGUAGES } from '@ttp/shared-types';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { postAsTelegramUser, useTelegram } from '@/lib/useTelegram';

/** Translation / interpretation request (TR-3), sent to the chosen translator in the bot. */
export function JobRequestForm({ translatorId, translatorName, languages }: { translatorId: string; translatorName: string; languages: string[] }) {
  const app = useTelegram('/tg/translators');
  const router = useRouter();
  const other = languages.filter((l) => l !== 'ru');
  const [type, setType] = useState<'LIVE' | 'DOCUMENT'>('LIVE');
  const [source, setSource] = useState('ru');
  const [target, setTarget] = useState(other[0] ?? 'en');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!app) return;
    setError(null);
    if (description.trim().length < 10) return setError('Опишите задачу в двух-трёх предложениях.');
    if (source === target) return setError('Языки должны различаться.');
    if (!consent) return setError('Отметьте согласие, чтобы переводчик получил ваш контакт.');
    setBusy(true);
    try {
      await postAsTelegramUser(app, 'translation-jobs', {
        translatorId, type, sourceLanguage: source, targetLanguage: target, description: description.trim(), consent: true,
        ...(date && type === 'DOCUMENT' && { deadline: date }),
        ...(date && type === 'LIVE' && { scheduledAt: new Date(date).toISOString() }),
      });
      app.HapticFeedback?.notificationOccurred('success');
      setSent(true);
    } catch (err) {
      app.HapticFeedback?.notificationOccurred('error');
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (sent)
    return (
      <div className="done" role="status">
        <strong>Заявка отправлена</strong>
        <p className="muted">{translatorName} получит её в Telegram. Когда переводчик согласится, бот пришлёт вам его контакт.</p>
        <button className="btn" onClick={() => router.push('/tg/translators')}>К списку</button>
      </div>
    );
  if (!app) return <p className="notice">Заявку можно отправить только из Telegram: откройте нашего бота и выберите переводчика.</p>;

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div className="chips" role="radiogroup" aria-label="Что нужно">
        <button type="button" role="radio" className="chip" aria-checked={type === 'LIVE'} aria-current={type === 'LIVE'} onClick={() => setType('LIVE')}>Устный перевод / гид</button>
        <button type="button" role="radio" className="chip" aria-checked={type === 'DOCUMENT'} aria-current={type === 'DOCUMENT'} onClick={() => setType('DOCUMENT')}>Перевод документа</button>
      </div>
      <div className="row" style={{ gap: 12, alignItems: 'start' }}>
        <div className="field" style={{ flex: '1 1 140px' }}>
          <label htmlFor="src">С языка</label>
          <select id="src" value={source} onChange={(e) => setSource(e.target.value)}>
            {languages.map((l) => <option key={l} value={l}>{LANGUAGES[l] ?? l}</option>)}
          </select>
        </div>
        <div className="field" style={{ flex: '1 1 140px' }}>
          <label htmlFor="dst">На язык</label>
          <select id="dst" value={target} onChange={(e) => setTarget(e.target.value)}>
            {languages.map((l) => <option key={l} value={l}>{LANGUAGES[l] ?? l}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="desc">Что нужно сделать</label>
        <textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000}
          placeholder={type === 'LIVE' ? 'Например: встреча с поставщиком в Кампале, 3 часа, 12 февраля утром.' : 'Например: справка о прививках, 1 страница, нужно до 20 января.'} />
      </div>
      <div className="field">
        <label htmlFor="when">{type === 'LIVE' ? 'Когда' : 'Нужно к'}</label>
        <input id="when" type={type === 'LIVE' ? 'datetime-local' : 'date'} value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      {type === 'DOCUMENT' && <p className="muted" style={{ fontSize: '0.88rem' }}>Сам документ вы отправите переводчику в Telegram после того, как он примет заявку.</p>}
      <label className="consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>Согласен, чтобы переводчик получил мой контакт в Telegram после принятия заявки.</span>
      </label>
      {error && <p className="field error" role="alert">{error}</p>}
      <button className="btn primary" type="submit" disabled={busy} style={{ justifyContent: 'center' }}>{busy ? 'Отправляем…' : 'Отправить заявку'}</button>
    </form>
  );
}
