'use client';

/** The parts of the official Telegram WebApp object (telegram.org/js/telegram-web-app.js) we use. */
export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { start_param?: string; user?: { first_name?: string } };
  colorScheme: 'light' | 'dark';
  ready(): void;
  expand(): void;
  close(): void;
  HapticFeedback?: { notificationOccurred(type: 'success' | 'error' | 'warning'): void };
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

/** The WebApp object when the page is open inside Telegram with signed launch data, else null. */
export function getWebApp(): TelegramWebApp | null {
  const app = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
  return app && app.initData ? app : null;
}
