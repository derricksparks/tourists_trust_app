'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getWebApp, TelegramWebApp } from '@/lib/telegram';

interface Props {
  operatorSlug: string;
  operatorName: string;
  packages: { slug: string; title: string }[];
}

/** "Request info" form in the Mini App. The sender is identified by Telegram's signed initData. */
export function RequestForm({ operatorSlug, operatorName, packages }: Props) {
  const router = useRouter();
  const [app, setApp] = useState<TelegramWebApp | null>(null);
  const [message, setMessage] = useState('');
  const [packageSlug, setPackageSlug] = useState('');
  const [travelMonth, setTravelMonth] = useState('');
  const [groupSize, setGroupSize] = useState('2');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const webApp = getWebApp();
    setApp(webApp);
    if (!webApp) return;
    webApp.ready();
    const back = () => router.push('/tg');
    webApp.BackButton.show();
    webApp.BackButton.onClick(back);
    return () => {
      webApp.BackButton.offClick(back);
      webApp.BackButton.hide();
    };
  }, [router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!app) return;
    if (message.trim().length < 10) return setError('Напишите хотя бы пару предложений: даты, сколько вас, что хотите увидеть.');
    if (!consent) return setError('Отметьте согласие, чтобы мы могли передать вопрос туроператору.');
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/backend/public/telegram/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `tma ${app.initData}` },
        body: JSON.stringify({
          operatorSlug,
          message: message.trim(),
          consent: true,
          ...(packageSlug && { packageSlug }),
          ...(travelMonth && { travelMonth }),
          ...(groupSize && { groupSize: Number(groupSize) }),
        }),
      });
      if (res.status === 429) throw new Error('Слишком много вопросов за час. Попробуйте позже.');
      if (res.status === 401) throw new Error('Telegram не подтвердил вход. Закройте и откройте приложение ещё раз.');
      if (!res.ok) throw new Error('Не получилось отправить. Попробуйте ещё раз.');
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
        <strong>Вопрос отправлен</strong>
        <p className="muted">Мы передадим его в {operatorName}. Ответ пришлём в чат с ботом.</p>
        <button className="btn" onClick={() => router.push('/tg')}>
          К списку туроператоров
        </button>
      </div>
    );

  if (!app)
    return (
      <p className="notice">
        Эта форма работает внутри Telegram. Откройте нашего бота и выберите компанию — так туроператор сможет ответить вам в Telegram.
      </p>
    );

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="message">Ваш вопрос</label>
        <textarea
          id="message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Например: хотим на 5 дней в феврале, двое взрослых. Сколько стоит и что входит?"
          maxLength={2000}
        />
      </div>
      {packages.length > 0 && (
        <div className="field">
          <label htmlFor="package">Тур</label>
          <select id="package" value={packageSlug} onChange={(e) => setPackageSlug(e.target.value)}>
            <option value="">Пока не выбрали</option>
            {packages.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.title}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="row" style={{ gap: 12, alignItems: 'start' }}>
        <div className="field" style={{ flex: '1 1 160px' }}>
          <label htmlFor="month">Когда</label>
          <input id="month" type="month" value={travelMonth} onChange={(e) => setTravelMonth(e.target.value)} />
        </div>
        <div className="field" style={{ flex: '1 1 100px' }}>
          <label htmlFor="size">Сколько человек</label>
          <input id="size" type="number" min={1} max={100} value={groupSize} onChange={(e) => setGroupSize(e.target.value)} />
        </div>
      </div>
      <label className="consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>Согласен, чтобы моё имя в Telegram и вопрос передали туроператору {operatorName} для ответа.</span>
      </label>
      {error && (
        <p className="field error" role="alert">
          {error}
        </p>
      )}
      <button className="btn primary" type="submit" disabled={busy} style={{ justifyContent: 'center' }}>
        {busy ? 'Отправляем…' : 'Отправить вопрос'}
      </button>
    </form>
  );
}
