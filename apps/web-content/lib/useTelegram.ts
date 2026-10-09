'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getWebApp, TelegramWebApp } from './telegram';

/** The WebApp when running inside Telegram, with the back button wired to `backTo`. */
export function useTelegram(backTo?: string) {
  const router = useRouter();
  const [app, setApp] = useState<TelegramWebApp | null>(null);
  useEffect(() => {
    const webApp = getWebApp();
    setApp(webApp);
    if (!webApp) return;
    webApp.ready();
    if (!backTo) return;
    const back = () => router.push(backTo);
    webApp.BackButton.show();
    webApp.BackButton.onClick(back);
    return () => {
      webApp.BackButton.offClick(back);
      webApp.BackButton.hide();
    };
  }, [router, backTo]);
  return app;
}

/** POSTs to the API as the Telegram user; throws a readable Russian message on failure. */
export async function postAsTelegramUser<T>(app: TelegramWebApp, path: string, body: unknown): Promise<T> {
  const res = await fetch(`/backend/public/telegram/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `tma ${app.initData}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data as T;
  if (res.status === 401) throw new Error('Telegram не подтвердил вход. Закройте и откройте приложение ещё раз.');
  if (res.status === 429 || res.status === 409) throw new Error(String(data.message ?? 'Не получилось.'));
  if (res.status === 400) throw new Error(String(data.errors?.[0]?.message ?? 'Проверьте поля формы.'));
  throw new Error('Не получилось отправить. Попробуйте ещё раз.');
}
