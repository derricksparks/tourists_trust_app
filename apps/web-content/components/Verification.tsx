import { dateRu } from '@/lib/format';

/**
 * Content safety (pilot round): a visa guide or insurer shows when and where its facts were
 * checked, or a clear notice that nobody has checked them yet.
 */
export function Verification({ verifiedOn, sourceUrl, compact }: { verifiedOn: string | null; sourceUrl: string | null; compact?: boolean }) {
  if (!verifiedOn || !sourceUrl) {
    return (
      <span className="unverified" role="note">
        Ещё не проверено{compact ? '' : ': сверьте сведения с официальным источником, прежде чем на них полагаться'}
      </span>
    );
  }
  return (
    <span className="checked">
      Проверено {dateRu(verifiedOn)} ·{' '}
      <a href={sourceUrl} rel="noopener noreferrer" target="_blank">
        источник{compact ? '' : `: ${new URL(sourceUrl).hostname}`}
      </a>
    </span>
  );
}
