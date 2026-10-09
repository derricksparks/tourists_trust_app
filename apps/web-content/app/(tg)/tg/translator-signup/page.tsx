'use client';

import { LANGUAGES, PROFICIENCY_LEVELS, SPECIALTIES } from '@ttp/shared-types';
import type { PublicCountry } from '@ttp/shared-types';
import { FormEvent, useEffect, useState } from 'react';
import { postAsTelegramUser, useTelegram } from '@/lib/useTelegram';

const LEVEL_LABEL: Record<string, string> = { native: 'родной' };

/** Translator / guide sign-up (TR-1). Self-reported levels; staff spot-check before the profile is listed. */
export default function TranslatorSignup() {
  const app = useTelegram('/tg/translators');
  const [name, setName] = useState('');
  const [levels, setLevels] = useState<Record<string, string>>({ ru: '' });
  const [country, setCountry] = useState('UG');
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [bioRu, setBioRu] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [countries, setCountries] = useState<PublicCountry[]>([]);

  // Destinations staff have switched on (Phase 4).
  useEffect(() => {
    fetch('/backend/public/countries')
      .then((r) => (r.ok ? r.json() : []))
      .then(setCountries)
      .catch(() => undefined);
  }, []);

  const languages = Object.keys(levels);
  const toggleLang = (l: string) =>
    setLevels((p) => {
      const next = { ...p };
      if (l in next) delete next[l];
      else next[l] = '';
      return next;
    });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!app) return;
    setError(null);
    if (name.trim().length < 2) return setError('Укажите имя.');
    if (languages.length < 2) return setError('Отметьте русский и хотя бы ещё один язык.');
    if (languages.some((l) => !levels[l])) return setError('Укажите уровень для каждого языка.');
    if (!specialties.length) return setError('Выберите хотя бы одно направление.');
    if (!consent) return setError('Отметьте согласие на публикацию профиля.');
    setBusy(true);
    try {
      await postAsTelegramUser(app, 'translator-signup', {
        name: name.trim(), languages, proficiency: levels, specialtyCountryCode: country, specialties, consent: true,
        ...(bioRu.trim() && { bioRu: bioRu.trim() }),
        ...(phone.trim() && { phone: phone.trim() }),
      });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (sent)
    return (
      <div className="done" role="status">
        <strong>Заявка принята</strong>
        <p className="muted">Мы напишем вам здесь, в Telegram, чтобы договориться о коротком созвоне на русском. После проверки профиль появится в каталоге.</p>
      </div>
    );

  return (
    <>
      <header className="stack" style={{ gap: 6 }}>
        <h1>Стать переводчиком или гидом</h1>
        <p className="muted">Для тех, кто говорит по-русски и работает в Восточной Африке. Контакты в каталоге не показываются: заявки приходят через бота.</p>
      </header>
      {!app && <p className="notice">Анкету можно отправить только из Telegram.</p>}
      <form className="stack" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="name">Имя, как показывать в каталоге</label>
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </div>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600, fontSize: '0.92rem' }}>Языки и уровень</legend>
          {Object.entries(LANGUAGES).map(([code, label]) => (
            <div key={code} className="row" style={{ gap: 10 }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 150, fontWeight: 400 }}>
                <input type="checkbox" checked={code in levels} disabled={code === 'ru'} onChange={() => toggleLang(code)} style={{ width: 18, height: 18 }} />
                {label}
              </label>
              {code in levels && (
                <select aria-label={`Уровень: ${label}`} value={levels[code]} onChange={(e) => setLevels((p) => ({ ...p, [code]: e.target.value }))} style={{ width: 'auto' }}>
                  <option value="">уровень…</option>
                  {PROFICIENCY_LEVELS.map((lv) => <option key={lv} value={lv}>{LEVEL_LABEL[lv] ?? lv}</option>)}
                </select>
              )}
            </div>
          ))}
        </fieldset>
        <div className="field">
          <label htmlFor="country">Где работаете</label>
          <select id="country" value={country} onChange={(e) => setCountry(e.target.value)}>
            {(countries.length ? countries : [{ code: 'UG', nameRu: 'Уганда' }]).map((c) => <option key={c.code} value={c.code}>{c.nameRu}</option>)}
          </select>
        </div>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600, fontSize: '0.92rem' }}>Направления</legend>
          <div className="chips">
            {Object.entries(SPECIALTIES).map(([k, v]) => (
              <label key={k} className="chip" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={specialties.includes(k)} onChange={(e) => setSpecialties((p) => (e.target.checked ? [...p, k] : p.filter((x) => x !== k)))} />
                {v}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor="bio">О себе (покажем в каталоге)</label>
          <textarea id="bio" value={bioRu} onChange={(e) => setBioRu(e.target.value)} maxLength={1000} placeholder="Где учили русский, с какими задачами работаете." />
        </div>
        <div className="field">
          <label htmlFor="phone">Телефон для связи с нами (не публикуется)</label>
          <input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} />
        </div>
        <label className="consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>Согласен на публикацию имени, языков, направлений и рассказа о себе в каталоге.</span>
        </label>
        {error && <p className="field error" role="alert">{error}</p>}
        <button className="btn primary" type="submit" disabled={busy || !app} style={{ justifyContent: 'center' }}>{busy ? 'Отправляем…' : 'Отправить анкету'}</button>
      </form>
    </>
  );
}
