import type { Metadata } from 'next';
import Link from 'next/link';
import { ReactNode } from 'react';
import { SITE_URL, telegramLink } from '@/lib/api';
import './site.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'Проверенные туроператоры Восточной Африки', template: '%s — Проверено: Африка' },
  description:
    'Туроператоры Уганды, Танзании и Кении с проверенной лицензией, видео и отзывами путешественников. Визы, страховка и как добраться — на русском.',
  openGraph: { locale: 'ru_RU', type: 'website', siteName: 'Проверено: Африка' },
  alternates: { canonical: '/' },
};

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600&family=JetBrains+Mono:wght@400&family=Unbounded:wght@600;700&display=swap"
        />
      </head>
      <body>
        <header className="top">
          <div className="wrap">
            <Link href="/" className="brand">
              <svg width="34" height="34" viewBox="0 0 200 200" aria-hidden="true" style={{ color: 'var(--seal)' }}>
                <circle cx="100" cy="100" r="92" fill="none" stroke="currentColor" strokeWidth="14" />
                <path d="M62 104 L90 132 L140 74" fill="none" stroke="currentColor" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>
                <strong>Проверено: Африка</strong>
                <span>Уганда · Танзания · Кения</span>
              </span>
            </Link>
            <nav className="nav" aria-label="Разделы">
              <Link href="/operators">Туроператоры</Link>
              <Link href="/visa">Визы</Link>
              <Link href="/guides">Как добраться</Link>
              <Link href="/translators">Переводчики</Link>
              <Link href="/insurance">Страховка</Link>
              <a href={telegramLink()}>Telegram</a>
            </nav>
          </div>
        </header>
        <main>
          <div className="wrap">{children}</div>
        </main>
        <footer className="foot">
          <div className="wrap">
            <p>
              Мы проверяем лицензию, регистрацию и видео каждого туроператора перед публикацией. Платежи через сайт не принимаются — вы
              договариваетесь и платите напрямую туроператору или своему турагентству.
            </p>
            <p>Демонстрационная версия: все компании и отзывы вымышлены.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
