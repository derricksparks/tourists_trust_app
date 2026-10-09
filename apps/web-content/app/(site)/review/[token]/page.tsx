import type { PublicReviewInvite } from '@ttp/shared-types';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ReviewForm } from '@/components/ReviewForm';
import { dateRu } from '@/lib/format';

export const metadata: Metadata = { title: 'Отзыв о поездке', robots: { index: false, follow: false } };

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

/** One-time review link sent after a trip. Personal, so never cached. */
export default async function ReviewPage({ params }: { params: { token: string } }) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(params.token)) notFound();
  const res = await fetch(`${API_URL}/public/review-invites/${params.token}`, { cache: 'no-store' });
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`Invite lookup failed: ${res.status}`);
  const invite = (await res.json()) as PublicReviewInvite;

  if (invite.state !== 'open') {
    const why = {
      used: 'По этой ссылке отзыв уже оставлен. Спасибо!',
      expired: 'Срок действия ссылки истёк.',
      revoked: 'Эта ссылка больше не действует.',
    }[invite.state];
    return (
      <div className="stack prose">
        <h1>Отзыв о поездке</h1>
        <p>{why}</p>
        <Link href={`/operators/${invite.operatorSlug}`}>Страница {invite.operatorName}</Link>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="stack prose" style={{ gap: 10 }}>
        <span className="eyebrow">Отзыв по приглашению</span>
        <h1>Как прошла поездка с {invite.operatorName}?</h1>
        <p className="muted">
          {invite.packageTitle ? `${invite.packageTitle} · ` : ''}поездка {dateRu(invite.tripDate)}. Ссылка личная и работает один раз. Перед
          публикацией отзыв прочитает модератор; мы не исправляем оценки.
        </p>
      </header>
      <ReviewForm token={params.token} defaultName={invite.recipientName.split(' ')[0]} operatorName={invite.operatorName} operatorSlug={invite.operatorSlug} />
    </div>
  );
}
