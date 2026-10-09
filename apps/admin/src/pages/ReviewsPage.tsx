import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { REVIEW_STATUSES, REVIEW_TRANSITIONS, ReviewDecision, ReviewStatus } from '@ttp/shared-types';
import { Link, useSearchParams } from 'react-router-dom';
import { api, Review } from '../api';
import { useCanModerate } from '../auth';
import { DecisionOption, DecisionPanel } from '../components/DecisionPanel';
import { Pager } from '../components/Pager';
import { StatusPill } from '../components/StatusPill';
import { countryName, formatDate, titleCase } from '../format';

/** Review moderation queue (spec TV-5). Every review came through a one-time invite link. */
export function ReviewsPage() {
  const [params, setParams] = useSearchParams();
  const status = (REVIEW_STATUSES as readonly string[]).includes(params.get('status') ?? '')
    ? (params.get('status') as ReviewStatus)
    : 'PENDING';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const list = useQuery({
    queryKey: ['reviews', { status, page }],
    queryFn: () => api.reviews({ status, page }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <header className="stack" style={{ gap: 4 }}>
        <span className="eyebrow">Trust &amp; verification</span>
        <h1>Reviews</h1>
        <p className="muted" style={{ maxWidth: '70ch' }}>
          Travellers can only write a review through a one-time link sent after their trip, so each one is tied to a real booking. Check it for
          personal details, abuse and anything unrelated to the trip before publishing.
        </p>
      </header>

      <div className="chips" role="group" aria-label="Filter by status">
        {REVIEW_STATUSES.map((s) => (
          <button key={s} className="chip" aria-pressed={status === s} onClick={() => setParams({ status: s })}>
            {titleCase(s)}
          </button>
        ))}
      </div>

      {list.error && <p className="alert err">Couldn’t load reviews. Reload the page to try again.</p>}
      {list.isLoading && <p className="muted">Loading…</p>}
      {list.data?.items.length === 0 && (
        <p className="panel empty">{status === 'PENDING' ? 'Nothing to moderate. New reviews will appear here.' : `No ${status.toLowerCase()} reviews.`}</p>
      )}
      {list.data?.items.map((r) => <ReviewCard key={r.id} review={r} />)}
      {list.data && (
        <Pager
          page={list.data.page}
          pageSize={list.data.pageSize}
          total={list.data.total}
          onPage={(p) => setParams({ status, page: String(p) })}
        />
      )}
    </div>
  );
}

const OPTIONS = (status: ReviewStatus): Record<ReviewDecision, DecisionOption<ReviewDecision>> => ({
  publish: { value: 'publish', label: 'Publish', needsReason: false, primary: true },
  reject:
    status === 'PUBLISHED'
      ? { value: 'reject', label: 'Take down', needsReason: true, confirm: 'Take this review off the public site?' }
      : { value: 'reject', label: 'Reject', needsReason: true },
});

function ReviewCard({ review: r }: { review: Review }) {
  const canModerate = useCanModerate();
  const queryClient = useQueryClient();
  const decide = useMutation({
    mutationFn: ({ decision, reason }: { decision: ReviewDecision; reason?: string }) => api.decideReview(r.id, { decision, reason }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['reviews'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
  const options = OPTIONS(r.status);
  const allowed = (Object.keys(REVIEW_TRANSITIONS) as ReviewDecision[])
    .filter((d) => REVIEW_TRANSITIONS[d].from.includes(r.status))
    .map((d) => options[d]);
  const subRatings = [
    ['Guide', r.ratingGuide],
    ['Vehicle', r.ratingVehicle],
    ['Accommodation', r.ratingAccommodation],
    ['Value', r.ratingValue],
  ].filter(([, v]) => v != null) as [string, number][];

  return (
    <article className="panel review" aria-labelledby={`rv-${r.id}`}>
      <div className="spread">
        <div className="stack" style={{ gap: 2 }}>
          <h2 id={`rv-${r.id}`}>
            <Link to={`/operators/${r.operator.id}`} style={{ color: 'var(--fg)' }}>
              {r.operator.name}
            </Link>
          </h2>
          <span className="muted" style={{ fontSize: '0.88rem' }}>
            {countryName(r.operator.countryCode)}
            {r.package && ` · ${r.package.title}`}
          </span>
        </div>
        <StatusPill status={r.status} />
      </div>

      <div className="row-wrap" style={{ gap: 14 }}>
        <span className="stars" aria-label={`${r.rating} out of 5`}>
          {'★'.repeat(r.rating)}
          <span style={{ color: 'var(--line)' }}>{'★'.repeat(5 - r.rating)}</span>
        </span>
        <span>
          <strong>{r.authorName}</strong> <span className="muted">· trip {formatDate(r.tripDate)}</span>
        </span>
      </div>
      {subRatings.length > 0 && (
        <div className="ratings">
          {subRatings.map(([label, v]) => (
            <span key={label}>
              {label} <strong className="num">{v}/5</strong>
            </span>
          ))}
        </div>
      )}
      {r.bodyRu && <blockquote lang="ru">{r.bodyRu}</blockquote>}
      {r.bodyEn && <blockquote lang="en">{r.bodyEn}</blockquote>}
      <p className="muted" style={{ fontSize: '0.84rem' }}>
        Invite sent to {r.invite.recipientName} ({r.invite.recipientContact}) on {formatDate(r.invite.createdAt)} · written {formatDate(r.createdAt)}
      </p>
      {r.rejectionReason && (
        <p className="reason">
          <strong>Reason:</strong> {r.rejectionReason}
        </p>
      )}
      {r.moderatedBy && r.moderatedAt && (
        <p className="muted" style={{ fontSize: '0.84rem' }}>
          {titleCase(r.status)} by {r.moderatedBy.name} on {formatDate(r.moderatedAt)}
        </p>
      )}
      {canModerate && allowed.length > 0 && (
        <DecisionPanel
          key={r.status}
          id={r.id}
          options={allowed}
          reasonPlaceholder="e.g. Names the guide’s phone number; asked the traveller to resubmit"
          onDecide={(decision, reason) => decide.mutateAsync({ decision, reason })}
        />
      )}
    </article>
  );
}
