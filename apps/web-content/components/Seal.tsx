/** The verification seal: a stamp with "ПРОВЕРЕНО" around the edge. Decorative; meaning is in the text beside it. */
export function Seal({ year, revoked = false, label }: { year?: number | null; revoked?: boolean; label?: string }) {
  const ring = revoked ? 'ПРОВЕРКА ОТОЗВАНА · ПРОВЕРКА ОТОЗВАНА · ' : 'ПРОВЕРЕНО · ЛИЦЕНЗИЯ · ВИДЕО · ОТЗЫВЫ · ';
  return (
    <svg className={`seal ${revoked ? 'revoked' : ''}`} viewBox="0 0 200 200" role="img" aria-label={label ?? (revoked ? 'Проверка отозвана' : 'Проверенный туроператор')}>
      <defs>
        <path id="seal-ring" d="M100,100 m-74,0 a74,74 0 1,1 148,0 a74,74 0 1,1 -148,0" />
      </defs>
      <circle cx="100" cy="100" r="96" fill="none" stroke="currentColor" strokeWidth="3" />
      <circle cx="100" cy="100" r="58" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <text fontSize="13.5" letterSpacing="2.4">
        <textPath href="#seal-ring">{ring}</textPath>
      </text>
      {revoked ? (
        <path d="M78 78 L122 122 M122 78 L78 122" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
      ) : (
        <path d="M74 102 L93 121 L128 82" fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {year ? (
        <text x="100" y="147" fontSize="12" textAnchor="middle" letterSpacing="1">
          С {year}
        </text>
      ) : null}
    </svg>
  );
}

/** Small tick used on cards. */
export function Tick() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="8" fill="currentColor" />
      <path d="M4.5 8.2 L7 10.6 L11.5 5.6" fill="none" stroke="var(--on-seal)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Stars({ rating }: { rating: number }) {
  const full = Math.round(rating);
  return (
    <span className="stars" aria-label={`Оценка ${rating} из 5`}>
      {'★'.repeat(full)}
      <span className="off">{'★'.repeat(5 - full)}</span>
    </span>
  );
}
