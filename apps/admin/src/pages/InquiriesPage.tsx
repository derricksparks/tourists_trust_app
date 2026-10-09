import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { INQUIRY_STATUSES, InquiryStatus } from '@ttp/shared-types';
import { FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError, Inquiry } from '../api';
import { useCanModerate } from '../auth';
import { Pager } from '../components/Pager';
import { InviteLink } from '../components/ReviewInvites';
import { StatusPill } from '../components/StatusPill';
import { formatDateTime, titleCase } from '../format';

const LABEL: Record<InquiryStatus, string> = { NEW: 'New', RESPONDED: 'Answered', CLOSED: 'Closed' };

/**
 * Questions travellers sent from the Telegram Mini App. Until operators have their own portal,
 * staff pass each one to the operator and send the answer back through the bot.
 */
export function InquiriesPage() {
  const [params, setParams] = useSearchParams();
  const status = (INQUIRY_STATUSES as readonly string[]).includes(params.get('status') ?? '') ? (params.get('status') as InquiryStatus) : 'NEW';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const list = useQuery({ queryKey: ['inquiries', { status, page }], queryFn: () => api.inquiries({ status, page }), placeholderData: keepPreviousData });

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <header className="stack" style={{ gap: 4 }}>
        <span className="eyebrow">Telegram</span>
        <h1>Inquiries</h1>
        <p className="muted" style={{ maxWidth: '70ch' }}>
          Forward each question to the operator. When they answer, paste the answer here and send it: the traveller gets it in the bot chat,
          and the operator's response time is recorded.
        </p>
      </header>
      <div className="chips" role="group" aria-label="Filter by status">
        {INQUIRY_STATUSES.map((s) => (
          <button key={s} className="chip" aria-pressed={status === s} onClick={() => setParams({ status: s })}>
            {LABEL[s]}
          </button>
        ))}
      </div>
      {list.error && <p className="alert err">Couldn’t load inquiries. Reload the page to try again.</p>}
      {list.isLoading && <p className="muted">Loading…</p>}
      {list.data?.items.length === 0 && (
        <p className="panel empty">{status === 'NEW' ? 'No new questions. They appear here as soon as a traveller sends one.' : `No ${LABEL[status].toLowerCase()} inquiries.`}</p>
      )}
      {list.data?.items.map((i) => <InquiryCard key={i.id} inquiry={i} />)}
      {list.data && <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => setParams({ status, page: String(p) })} />}
    </div>
  );
}

function InquiryCard({ inquiry: i }: { inquiry: Inquiry }) {
  const canModerate = useCanModerate();
  const queryClient = useQueryClient();
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['inquiries'] });
    void queryClient.invalidateQueries({ queryKey: ['stats'] });
  };
  const send = useMutation({ mutationFn: (text: string) => api.replyToInquiry(i.id, text), onSuccess: () => { setReply(''); refresh(); } });
  const setStatus = useMutation({ mutationFn: (s: 'RESPONDED' | 'CLOSED') => api.setInquiryStatus(i.id, s), onSettled: refresh });

  const who = [i.telegramUser?.firstName, i.telegramUser?.lastName].filter(Boolean).join(' ') || i.contactName || 'Traveller';
  const op = i.operator;

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (reply.trim().length < 2) return setError('Write the answer before sending.');
    send.mutate(reply.trim(), { onError: (err) => setError(err instanceof ApiError ? err.message : 'Couldn’t send. Try again.') });
  }

  return (
    <article className="panel" aria-labelledby={`inq-${i.id}`}>
      <div className="spread">
        <div className="stack" style={{ gap: 2 }}>
          <h2 id={`inq-${i.id}`}>
            {who} → <Link to={`/operators/${op.id}`} style={{ color: 'var(--fg)' }}>{op.name}</Link>
          </h2>
          <span className="muted" style={{ fontSize: '0.86rem' }}>
            {formatDateTime(i.createdAt)} · {i.contactInfo ?? 'no contact'}
            {i.travelMonth && ` · travelling ${i.travelMonth}`}
            {i.groupSize && ` · ${i.groupSize} ${i.groupSize === 1 ? 'person' : 'people'}`}
            {i.package && ` · ${i.package.titleRu ?? i.package.title}`}
          </span>
        </div>
        <StatusPill status={i.status} label={LABEL[i.status]} />
      </div>
      <blockquote lang="ru" style={{ margin: 0, padding: '10px 12px', background: 'var(--sunken)', borderRadius: 6, whiteSpace: 'pre-wrap' }}>
        {i.message}
      </blockquote>
      <p className="muted" style={{ fontSize: '0.86rem' }}>
        Forward to the operator:{' '}
        {[op.email, op.phone, op.telegramUsername && `@${op.telegramUsername.replace(/^@/, '')}`].filter(Boolean).join(' · ') || 'no contact details on file'}
      </p>
      {i.firstResponseAt && <p className="muted" style={{ fontSize: '0.86rem' }}>Answered {formatDateTime(i.firstResponseAt)}</p>}
      {canModerate && i.status !== 'CLOSED' && (
        <div className="stack" style={{ gap: 10 }}>
          {i.telegramUser ? (
            <form className="stack" style={{ gap: 8 }} onSubmit={submit}>
              <div className="field">
                <label htmlFor={`reply-${i.id}`}>Answer to send in Telegram</label>
                <textarea id={`reply-${i.id}`} lang="ru" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Paste or translate the operator's answer, in Russian" />
              </div>
              <div className="row-wrap">
                <button className="btn primary" type="submit" disabled={send.isPending}>
                  {send.isPending ? 'Sending…' : 'Send to traveller'}
                </button>
                {i.status === 'NEW' && (
                  <button className="btn" type="button" disabled={setStatus.isPending} onClick={() => setStatus.mutate('RESPONDED')}>
                    Mark answered without sending
                  </button>
                )}
                <button className="btn" type="button" disabled={setStatus.isPending} onClick={() => setStatus.mutate('CLOSED')}>
                  Close
                </button>
              </div>
            </form>
          ) : (
            <div className="row-wrap">
              <button className="btn" onClick={() => setStatus.mutate('RESPONDED')} disabled={i.status !== 'NEW'}>
                Mark answered
              </button>
              <button className="btn" onClick={() => setStatus.mutate('CLOSED')}>
                Close
              </button>
            </div>
          )}
          {error && <p className="alert err" role="alert">{error}</p>}
          {send.isSuccess && <p className="alert ok" role="status">Sent. {who} has the answer in Telegram.</p>}
        </div>
      )}
      {i.status === 'CLOSED' && <p className="muted">{titleCase(i.status)}.</p>}
      {canModerate && i.status !== 'NEW' && i.telegramUser && <InviteFromInquiry inquiry={i} who={who} />}
    </article>
  );
}

/**
 * After the trip, invite the traveller who asked through the bot to review the operator.
 * These invites don't depend on the operator's own list, which keeps reviews honest.
 */
function InviteFromInquiry({ inquiry: i, who }: { inquiry: Inquiry; who: string }) {
  const [open, setOpen] = useState(false);
  const [tripDate, setTripDate] = useState(i.travelMonth ? `${i.travelMonth}-01` : new Date().toISOString().slice(0, 10));
  const create = useMutation({
    mutationFn: () =>
      api.createInvite({ operatorId: i.operator.id, inquiryId: i.id, recipientName: who, recipientContact: i.contactInfo ?? 'Telegram', tripDate, sendTelegram: true }),
  });
  if (create.data) return <InviteLink link={create.data.link} sentInTelegram={create.data.sentInTelegram} />;
  if (!open)
    return (
      <button className="btn" style={{ justifySelf: 'start' }} onClick={() => setOpen(true)}>
        Invite to review after the trip
      </button>
    );
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row-wrap" style={{ alignItems: 'end' }}>
        <div className="field">
          <label htmlFor={`trip-${i.id}`}>Trip date</label>
          <input id={`trip-${i.id}`} type="date" value={tripDate} onChange={(e) => setTripDate(e.target.value)} />
        </div>
        <button className="btn primary" disabled={create.isPending || !tripDate} onClick={() => create.mutate()}>
          Send invite in Telegram
        </button>
        <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {create.error && (
        <p className="alert err" role="alert">
          {create.error instanceof ApiError ? create.error.message : 'Couldn’t create the invite.'}
        </p>
      )}
    </div>
  );
}
