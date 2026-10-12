import { publicApi } from '@/lib/api';

/** Standing disclaimer; the wording is set by a super admin in the dashboard (Settings). */
export async function Disclaimer({ kind }: { kind: 'visa' | 'insurance' }) {
  const text = (await publicApi.disclaimers())[kind];
  return (
    <aside className="disclaimer" aria-label="Важно">
      <strong>Важно.</strong>{' '}
      {text.split(/\n{2,}/).map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </aside>
  );
}
