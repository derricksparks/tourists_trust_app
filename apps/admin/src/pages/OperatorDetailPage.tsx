import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OPERATOR_TRANSITIONS, OperatorDecision } from '@ttp/shared-types';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useCanModerate } from '../auth';
import { DecisionOption, DecisionPanel } from '../components/DecisionPanel';
import { StatusPill } from '../components/StatusPill';
import { ACTION_LABELS, formatDate, formatDateTime } from '../format';

const OPTIONS: Record<OperatorDecision, DecisionOption<OperatorDecision>> = {
  approve: { value: 'approve', label: 'Approve', needsReason: false, primary: true },
  flag: { value: 'flag', label: 'Flag', needsReason: true },
  reject: {
    value: 'reject',
    label: 'Reject',
    needsReason: true,
    confirm: 'Rejecting is final. The operator would have to apply again as a new record. Reject this operator?',
  },
  suspend: {
    value: 'suspend',
    label: 'Suspend',
    needsReason: true,
    confirm: 'Suspending takes the operator’s listing down and their badge shows “revoked” until you approve them again. Suspend?',
  },
};

const NEXT_STEP: Record<string, string> = {
  PENDING: 'Check the licence and registration with the licensing authority, then decide.',
  FLAGGED: 'Waiting on a follow-up. Approve or reject once it is resolved.',
  APPROVED: 'Live. Suspend if the licence lapses or a serious complaint is confirmed.',
  SUSPENDED: 'Not live. Approve again once the problem is fixed.',
  REJECTED: 'Rejected is final. The operator has to apply again as a new record.',
};

export function OperatorDetailPage() {
  const { id = '' } = useParams();
  const canModerate = useCanModerate();
  const queryClient = useQueryClient();
  const { data: op, error, isLoading } = useQuery({ queryKey: ['operator', id], queryFn: () => api.operator(id) });

  const decide = useMutation({
    mutationFn: ({ decision, reason }: { decision: OperatorDecision; reason?: string }) => api.decideOperator(id, { decision, reason }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['operator', id] });
      void queryClient.invalidateQueries({ queryKey: ['operators'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  if (isLoading) return <p className="muted">Loading…</p>;
  if (error || !op)
    return (
      <div className="page">
        <p className="alert err">{error instanceof ApiError && error.status === 404 ? 'This operator doesn’t exist.' : 'Couldn’t load this operator.'}</p>
        <Link to="/operators">Back to operators</Link>
      </div>
    );

  const allowed = (Object.keys(OPERATOR_TRANSITIONS) as OperatorDecision[])
    .filter((d) => OPERATOR_TRANSITIONS[d].from.includes(op.status))
    .map((d) => OPTIONS[d]);
  const missing = [
    !op.verificationVideoUrl && 'verification video',
    !op.websiteUrl && 'website',
    !op.descriptionRu && 'Russian description',
    !op.referenceContactInfo && 'reference contact',
  ].filter(Boolean) as string[];

  return (
    <div className="page">
      <header className="stack" style={{ gap: 6 }}>
        <Link to="/operators" className="muted" style={{ fontSize: '0.88rem' }}>
          ← Operators
        </Link>
        <div className="spread">
          <div className="row-wrap" style={{ gap: 12 }}>
            <h1>{op.name}</h1>
            <StatusPill status={op.status} />
          </div>
          {canModerate && (
            <Link to={`/operators/${op.id}/edit`} className="btn">
              Edit details
            </Link>
          )}
        </div>
        <p className="muted mono">/operators/{op.slug}</p>
      </header>

      <div className="detail-grid">
        <div className="stack">
          <section className="panel" aria-labelledby="licence">
            <h2 id="licence">Licence &amp; registration</h2>
            <dl className="facts">
              <dt>Country</dt>
              <dd>{op.country.nameEn}</dd>
              <dt>Licensed by</dt>
              <dd>{op.licensingAuthority}</dd>
              <dt>Licence no.</dt>
              <dd className="mono">{op.tourismBoardLicense}</dd>
              <dt>Registration no.</dt>
              <dd className="mono">{op.businessRegNumber}</dd>
              {op.legalName && (
                <>
                  <dt>Legal name</dt>
                  <dd>{op.legalName}</dd>
                </>
              )}
              <dt>Address</dt>
              <dd>{op.address}</dd>
              <dt>Established</dt>
              <dd>{op.yearEstablished ? `${op.yearEstablished} (${new Date().getFullYear() - op.yearEstablished} years)` : <Missing />}</dd>
              <dt>Reference</dt>
              <dd>{op.referenceContactName || op.referenceContactInfo ? [op.referenceContactName, op.referenceContactInfo].filter(Boolean).join(' · ') : <Missing />}</dd>
            </dl>
          </section>

          <section className="panel" aria-labelledby="contact">
            <h2 id="contact">Contact &amp; listing</h2>
            <dl className="facts">
              <dt>Website</dt>
              <dd>{op.websiteUrl ? <ExternalLink href={op.websiteUrl} /> : <Missing />}</dd>
              <dt>Email</dt>
              <dd>{op.email ?? <Missing />}</dd>
              <dt>Phone</dt>
              <dd>{op.phone ?? <Missing />}</dd>
              <dt>Telegram</dt>
              <dd>{op.telegramUsername ? `@${op.telegramUsername.replace(/^@/, '')}` : <Missing />}</dd>
              <dt>Video</dt>
              <dd>{op.verificationVideoUrl ? <ExternalLink href={op.verificationVideoUrl} /> : <Missing />}</dd>
              <dt>About (RU)</dt>
              <dd lang="ru">{op.descriptionRu ?? <Missing />}</dd>
              <dt>About (EN)</dt>
              <dd>{op.descriptionEn ?? <Missing />}</dd>
              <dt>Badge token</dt>
              <dd className="mono">{op.badgeToken}</dd>
            </dl>
          </section>

          <section className="panel" aria-labelledby="docs">
            <h2 id="docs">Documents</h2>
            {op.documents.length ? (
              <ul className="history">
                {op.documents.map((d) => (
                  <li key={d.id}>
                    <span>
                      {d.originalFilename} <span className="muted">· {d.type.replace('_', ' ').toLowerCase()}</span>
                    </span>
                    {d.reviewNotes && <span className="muted">{d.reviewNotes}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No documents uploaded. Uploads arrive with the operator portal; until then, record what you checked in the decision reason.</p>
            )}
          </section>
        </div>

        <div className="stack">
          <section className="panel" aria-labelledby="decision">
            <h2 id="decision">Decision</h2>
            {op.statusReason && (
              <p className="reason">
                <strong>Reason:</strong> {op.statusReason}
              </p>
            )}
            <p className="muted">{NEXT_STEP[op.status]}</p>
            {missing.length > 0 && op.status !== 'REJECTED' && <p className="alert info">Still missing: {missing.join(', ')}.</p>}
            {canModerate && allowed.length > 0 && (
              <DecisionPanel
                key={op.status}
                id={op.id}
                options={allowed}
                reasonPlaceholder="e.g. Licence number checked against the UTB register on 9 Oct"
                onDecide={(decision, reason) => decide.mutateAsync({ decision, reason })}
              />
            )}
            {!canModerate && <p className="muted">Only moderators can approve or reject operators.</p>}
            {decide.data && decide.data.id === op.id && (
              <p className="alert ok" role="status">
                Saved. {op.name} is now {decide.data.status.toLowerCase()}.
              </p>
            )}
            {op.approvedAt && <p className="muted">First approved {formatDate(op.approvedAt)}.</p>}
          </section>

          <section className="panel" aria-labelledby="history">
            <h2 id="history">History</h2>
            <ol className="history">
              {op.history.map((h) => (
                <li key={h.id}>
                  <time dateTime={h.createdAt}>{formatDateTime(h.createdAt)}</time>
                  <span>
                    <strong>{ACTION_LABELS[h.action] ?? h.action}</strong> by {h.actorAdmin?.name ?? 'system'}
                  </span>
                  {h.reason && <span className="muted">{h.reason}</span>}
                </li>
              ))}
              {op.history.length === 0 && <li className="muted">No recorded changes.</li>}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}

const Missing = () => <span className="muted">Not given</span>;
const ExternalLink = ({ href }: { href: string }) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {href.replace(/^https?:\/\//, '')}
  </a>
);
