import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { ReactNode } from 'react';
import { loadCountries } from '@/lib/countries';
import '../(site)/site.css';
import './tg.css';

export const metadata: Metadata = { title: 'Проверено: Африка', robots: { index: false } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 1 };

/** Telegram Mini App shell. Loads the official WebApp script and follows the user's Telegram theme. */
export default async function TelegramLayout({ children }: { children: ReactNode }) {
  await loadCountries();
  return (
    <html lang="ru">
      <body className="tg">
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        <main className="tg-main">{children}</main>
      </body>
    </html>
  );
}
