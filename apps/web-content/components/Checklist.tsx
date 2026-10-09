'use client';

import type { ChecklistItem } from '@ttp/shared-types';
import { useEffect, useState } from 'react';

/**
 * Document checklist for one visa (spec VI-2). Ticks are kept in this browser only, so a
 * traveller can come back to it; nothing is sent to us.
 */
export function Checklist({ guideSlug, items }: { guideSlug: string; items: ChecklistItem[] }) {
  const storageKey = `visa-checklist:${guideSlug}`;
  const [checked, setChecked] = useState<string[]>([]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
      if (Array.isArray(saved)) setChecked(saved.filter((k) => typeof k === 'string'));
    } catch {
      /* storage unavailable: start empty */
    }
  }, [storageKey]);

  const toggle = (key: string) => {
    setChecked((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* not saved; still works for this visit */
      }
      return next;
    });
  };

  const required = items.filter((i) => i.required);
  const doneRequired = required.filter((i) => checked.includes(i.key)).length;
  const pct = required.length ? Math.round((doneRequired / required.length) * 100) : 0;

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="stack" style={{ gap: 6 }}>
        <p aria-live="polite">
          Готово {doneRequired} из {required.length} обязательных
        </p>
        <div className="progress" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
      <ul className="checklist">
        {items.map((item) => (
          <li key={item.key}>
            <label>
              <input type="checkbox" checked={checked.includes(item.key)} onChange={() => toggle(item.key)} />
              <span>
                {item.labelRu}
                {!item.required && <span className="opt"> — если требуется</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <p className="muted" style={{ fontSize: '0.88rem' }}>
        Отметки сохраняются только в этом браузере.
      </p>
    </div>
  );
}
