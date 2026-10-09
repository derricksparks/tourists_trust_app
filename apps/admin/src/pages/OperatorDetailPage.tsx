import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OPERATOR_TRANSITIONS, OperatorDecision } from '@ttp/shared-types';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, OperatorDocument } from '../api';
import { useCanModerate } from '../auth';
import { DecisionOption, DecisionPanel } from '../components/DecisionPanel';
import { ReviewInvitesPanel } from '../components/ReviewInvites';
import { OperatorPortalPanel } from './B2bPages';
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
  DRAFT: 'Signed up on the portal but hasn’t sent the application yet. Nothing to decide until they do.',
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
        {op.submittedAt && op.status === 'PENDING' && <p className="muted">Waiting since {formatDateTime(op.submittedAt)}</p>}
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

          <DocumentsPanel operatorId={op.id} documents={op.documents} registerUrl={op.country.licenceRegisterUrl} canModerate={canModerate} />
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
            {op.approvedAt && <p className="muted">Last approved {formatDate(op.approvedAt)}.</p>}
          </section>

          <BadgeCode token={op.badgeToken} status={op.status} />

          <ReviewInvitesPanel operatorId={op.id} approved={op.status === 'APPROVED'} />

          <OperatorPortalPanel operatorId={op.id} approved={op.status === 'APPROVED'} />

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

const PUBLIC_SITE = (import.meta.env.VITE_PUBLIC_SITE_URL ?? 'http://localhost:3001').replace(/\/$/, '');

/** Embed code to send the operator for their own website. */
function BadgeCode({ token, status }: { token: string; status: string }) {
  const [copied, setCopied] = useState(false);
  const code = `<script async src="${PUBLIC_SITE}/badge.js" data-ttp-badge="${token}"></script>`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section className="panel" aria-labelledby="badge">
      <h2 id="badge">Badge for their website</h2>
      <p className="muted" style={{ fontSize: '0.88rem' }}>
        Send this to the operator to paste into their site. It shows “Verified” only while they are approved, and “Verification revoked” if
        suspended. Add <span className="mono">data-lang="en"</span> for English.
      </p>
      <textarea readOnly value={code} rows={3} className="mono" aria-label="Badge embed code" onFocus={(e) => e.currentTarget.select()} />
      <div className="row-wrap">
        <button className="btn" type="button" onClick={copy}>{copied ? 'Copied' : 'Copy code'}</button>
        <span className="muted" style={{ fontSize: '0.84rem' }}>Currently shows: {status === 'APPROVED' ? 'Verified' : status === 'SUSPENDED' ? 'Verification revoked' : 'Not verified'}</span>
      </div>
    </section>
  );
}

const DOC_TYPE: Record<string, string> = { TOURISM_LICENSE: 'Tourism licence', BUSINESS_REGISTRATION: 'Business registration', OTHER: 'Other' };

/** Uploaded licence and registration (encrypted at rest; opening one is recorded in the history). */
function DocumentsPanel({ operatorId, documents, registerUrl, canModerate }: { operatorId: string; documents: OperatorDocument[]; registerUrl: string | null; canModerate: boolean }) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const review = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => api.reviewDocument(operatorId, id, text),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['operator', operatorId] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save the note.'),
  });
  const open = (id: string) => {
    setError(null);
    api.openDocument(operatorId, id).then(() => queryClient.invalidateQueries({ queryKey: ['operator', operatorId] })).catch((e: Error) => setError(e.message));
  };
  return (
    <section className="panel" aria-labelledby="docs">
      <div className="spread">
        <h2 id="docs">Documents</h2>
        {registerUrl && <a href={registerUrl} target="_blank" rel="noopener noreferrer">Check the licence register</a>}
      </div>
      {documents.length === 0 && <p className="muted">No documents uploaded. Operators upload them from the partner portal; for operators you entered yourself, record what you checked in the decision reason.</p>}
      <ul className="doclist">
        {documents.map((d) => (
          <li key={d.id}>
            <span>
              <strong>{DOC_TYPE[d.type] ?? d.type}</strong> <span className="muted">· {d.originalFilename} · {formatDate(d.createdAt)}</span>
            </span>
            {canModerate && <button className="btn link" style={{ justifySelf: 'start' }} onClick={() => open(d.id)} aria-label={`Open ${d.originalFilename}`}>Open</button>}
            {d.reviewedAt ? (
              <span className="muted">Checked {formatDate(d.reviewedAt)}{d.reviewNotes ? `: ${d.reviewNotes}` : ''}</span>
            ) : (
              canModerate && (
                <form className="row-wrap" onSubmit={(e) => { e.preventDefault(); review.mutate({ id: d.id, text: notes[d.id] ?? '' }); }}>
                  <input aria-label={`What you found in ${d.originalFilename}`} placeholder="e.g. Matches the register" value={notes[d.id] ?? ''} onChange={(e) => setNotes((p) => ({ ...p, [d.id]: e.target.value }))} style={{ flex: 1, minWidth: 180 }} />
                  <button className="btn" type="submit" disabled={(notes[d.id] ?? '').trim().length < 2}>Mark checked</button>
                </form>
              )
            )}
          </li>
        ))}
      </ul>
      {error && <p className="alert err" role="alert">{error}</p>}
    </section>
  );
}
