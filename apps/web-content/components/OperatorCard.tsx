import type { PublicOperatorSummary } from '@ttp/shared-types';
import Link from 'next/link';
import { count, countryRu, sinceRu } from '@/lib/format';
import { Stars, Tick } from './Seal';

export function OperatorCard({ op }: { op: PublicOperatorSummary }) {
  return (
    <Link href={`/operators/${op.slug}`} className="card">
      <span className="verified">
        <Tick /> Проверен{op.verifiedSince ? ` ${sinceRu(op.verifiedSince)}` : ''}
      </span>
      <h3>{op.name}</h3>
      <p className="meta">
        {countryRu(op.countryCode)} · {op.licensingAuthority}
      </p>
      {op.descriptionRu && <p>{op.descriptionRu}</p>}
      <p className="meta row" style={{ gap: 12 }}>
        {op.averageRating !== null ? (
          <span>
            <Stars rating={op.averageRating} /> {op.averageRating.toLocaleString('ru-RU')} · {count(op.reviewCount, ['отзыв', 'отзыва', 'отзывов'])}
          </span>
        ) : (
          <span>Пока без отзывов</span>
        )}
        <span>{count(op.packageCount, ['тур', 'тура', 'туров'])}</span>
      </p>
    </Link>
  );
}
