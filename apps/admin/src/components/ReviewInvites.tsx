import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { api, ApiError } from '../api';
import { useCanModerate } from '../auth';
import { formatDate } from '../format';
import { StatusPill } from './StatusPill';

const STATE_PILL = { open: 'PENDING', used: 'APPROVED', expired: 'CLOSED', revoked: 'REJECTED' } as const;
const today = () => new Date().toISOString().slice(0, 10);

/** Copyable link, shown once: only its hash is stored. */
export function InviteLink({ link, sentInTelegram }: { link: string; sentInTelegram: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="alert ok stack" style={{ gap: 8 }} role="status">
      <span>
        {sentInTelegram ? 'Invite sent to the traveller in Telegram. ' : 'Invite created. '}
        Copy the link now: it can’t be shown again.
      </span>
      <input readOnly value={link} className="mono" aria-label="Review link" onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className="btn"
        style={{ justifySelf: 'start' }}
        onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true), () => setCopied(false))}
      >
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  );
}

/**
 * Review invites for one operator (decision B5.6), with the numbers moderators use to spot an
 * operator who only passes on happy travellers: how many invites went out and how many became reviews.
 */
export function ReviewInvitesPanel({ operatorId, approved }: { operatorId: string; approved: boolean }) {
  const canModerate = useCanModerate();
  const queryClient = useQueryClient();
  const stats = useQuery({ queryKey: ['invite-stats', operatorId], queryFn: () => api.inviteStats(operatorId) });
  const invites = useQuery({ queryKey: ['invites', operatorId], queryFn: () => api.reviewInvites(operatorId) });
  const [form, setForm] = useState({ recipientName: '', recipientContact: '', tripDate: today() });
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['invite-stats', operatorId] });
    void queryClient.invalidateQueries({ queryKey: ['invites', operatorId] });
  };
  const create = useMutation({
    mutationFn: () => api.createInvite({ operatorId, ...form, recipientName: form.recipientName.trim(), recipientContact: form.recipientContact.trim() }),
    onSuccess: () => {
      setForm({ recipientName: '', recipientContact: '', tripDate: today() });
      refresh();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Couldn’t create the invite.'),
  });
  const revoke = useMutation({ mutationFn: api.revokeInvite, onSettled: refresh });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.recipientName.trim() || form.recipientContact.trim().length < 3) return setError('Enter the traveller’s name and email or Telegram.');
    create.mutate();
  }

  const s = stats.data;
  const rate = s && s.sent ? Math.round((s.used / s.sent) * 100) : null;

  return (
    <section className="panel" aria-labelledby="invites">
      <h2 id="invites">Review invites</h2>
      {s && (
        <p style={{ fontSize: '0.92rem' }}>
          <strong className="num">{s.sent}</strong> sent · <strong className="num">{s.used}</strong> became reviews{rate !== null && ` (${rate}%)`} ·{' '}
          <strong className="num">{s.published}</strong> published · {s.open} open · {s.expired} expired
          <br />
          <span className="muted">{s.fromInquiries} sent to travellers who asked through our bot (not chosen by the operator).</span>
        </p>
      )}
      {s && s.sent >= 5 && s.fromInquiries === 0 && (
        <p className="alert info">Every invite so far came from the operator’s own list. Invite a few travellers from the inquiry inbox too.</p>
      )}
      {canModerate && approved && (
        <form className="stack" style={{ gap: 8 }} onSubmit={submit} noValidate>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="inv-name">Traveller’s name</label>
              <input id="inv-name" value={form.recipientName} onChange={(e) => setForm({ ...form, recipientName: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="inv-contact">Email or Telegram</label>
              <input id="inv-contact" value={form.recipientContact} onChange={(e) => setForm({ ...form, recipientContact: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="inv-date">Trip date</label>
              <input id="inv-date" type="date" value={form.tripDate} max={today()} onChange={(e) => setForm({ ...form, tripDate: e.target.value })} />
            </div>
          </div>
          <button className="btn" type="submit" disabled={create.isPending} style={{ justifySelf: 'start' }}>Create invite link</button>
          {error && <p className="alert err" role="alert">{error}</p>}
          {create.data && <InviteLink link={create.data.link} sentInTelegram={create.data.sentInTelegram} />}
        </form>
      )}
      {!approved && <p className="muted">Only approved operators can collect reviews.</p>}
      {!!invites.data?.length && (
        <ul className="history">
          {invites.data.slice(0, 10).map((i) => (
            <li key={i.id}>
              <span className="row-wrap" style={{ gap: 8 }}>
                <StatusPill status={STATE_PILL[i.state]} label={i.state} />
                {i.recipientName} · {i.recipientContact} · trip {formatDate(i.tripDate)}
                {i.review && ` · review ${i.review.rating}★ ${i.review.status.toLowerCase()}`}
                {i.inquiryId && ' · from inquiry'}
              </span>
              {canModerate && i.state === 'open' && (
                <button className="btn link" type="button" style={{ justifySelf: 'start' }} disabled={revoke.isPending} onClick={() => revoke.mutate(i.id)}>
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
