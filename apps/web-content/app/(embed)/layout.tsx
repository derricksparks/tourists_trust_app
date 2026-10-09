import { ReactNode } from 'react';

/** Bare document for the iframe badge: no site chrome, transparent background. */
export default function EmbedLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body style={{ margin: 0, background: 'transparent', font: '500 14px/1.25 system-ui, -apple-system, "Segoe UI", sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
