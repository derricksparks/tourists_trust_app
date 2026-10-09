import { LANGUAGES, PublicTranslator, SPECIALTIES } from '@ttp/shared-types';
import { count, countryRuIn } from '@/lib/format';
import { Stars } from './Seal';

const LEVEL: Record<string, string> = { native: 'родной', C2: 'C2', C1: 'C1', B2: 'B2', B1: 'B1', A2: 'A2' };

export function TranslatorCard({ t, action }: { t: PublicTranslator; action?: React.ReactNode }) {
  return (
    <div className="card">
      <span className="eyebrow">{countryRuIn(t.specialtyCountryCode)}</span>
      <h3>{t.name}</h3>
      <p className="meta">
        {t.languages.map((l) => `${LANGUAGES[l] ?? l}${t.proficiency[l] ? ` (${LEVEL[t.proficiency[l]] ?? t.proficiency[l]})` : ''}`).join(' · ')}
      </p>
      <div className="tags">
        {t.specialties.map((s) => (
          <span key={s} className="tag">{SPECIALTIES[s] ?? s}</span>
        ))}
      </div>
      {t.bioRu && <p>{t.bioRu}</p>}
      <p className="meta">
        {t.rating !== null ? (
          <>
            <Stars rating={t.rating} /> {t.rating.toLocaleString('ru-RU')} ·{' '}
          </>
        ) : null}
        {t.jobsCompleted ? `${count(t.jobsCompleted, ['заказ выполнен', 'заказа выполнено', 'заказов выполнено'])}` : 'Пока без заказов'}
      </p>
      {action}
    </div>
  );
}
