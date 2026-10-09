import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LANGUAGES,
  SPECIALTIES,
  TRANSLATION_JOB_STATUSES,
  TRANSLATOR_STATUSES,
  TRANSLATOR_TRANSITIONS,
  TranslationJobStatus,
  TranslatorDecision,
  TranslatorStatus,
} from '@ttp/shared-types';
import { FormEvent, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError, TranslationJob, Translator } from '../api';
import { useCanModerate } from '../auth';
import { DecisionOption, DecisionPanel } from '../components/DecisionPanel';
import { Pager } from '../components/Pager';
import { StatusPill } from '../components/StatusPill';
import { countryName, formatDate, formatDateTime } from '../format';

const lang = (code: string) => LANGUAGES[code] ?? code;
const STATUS_LABEL: Record<TranslatorStatus, string> = { PENDING: 'To check', VERIFIED: 'Verified', REJECTED: 'Rejected', SUSPENDED: 'Suspended' };
const PILL: Record<TranslatorStatus, string> = { PENDING: 'PENDING', VERIFIED: 'APPROVED', REJECTED: 'REJECTED', SUSPENDED: 'SUSPENDED' };

const OPTIONS: Record<TranslatorDecision, DecisionOption<TranslatorDecision>> = {
  verify: { value: 'verify', label: 'Verify', needsReason: true, primary: true },
  reject: { value: 'reject', label: 'Reject', needsReason: true, confirm: 'Reject this application? They are told in Telegram; your notes stay internal.' },
  suspend: { value: 'suspend', label: 'Suspend', needsReason: true, confirm: 'Hide this translator from the directory? Open offers stay with them.' },
};

/** Translator applications from the bot (TR-1): spot-check language, then verify or reject. */
export function TranslatorsPage() {
  const [params, setParams] = useSearchParams();
  const status = (TRANSLATOR_STATUSES as readonly string[]).includes(params.get('status') ?? '') ? (params.get('status') as TranslatorStatus) : 'PENDING';
  const list = useQuery({ queryKey: ['translators', status], queryFn: () => api.translators(status) });

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <header className="stack" style={{ gap: 4 }}>
        <span className="eyebrow">Concierge</span>
        <h1>Translators &amp; guides</h1>
        <p className="muted" style={{ maxWidth: '70ch' }}>
          People apply in the Telegram bot and rate their own languages. Before verifying, check their Russian yourself (a short call or a
          sample translation) and write down what you checked. Verified people appear in the public directory without contact details.
        </p>
      </header>
      <div className="chips" role="group" aria-label="Filter by status">
        {TRANSLATOR_STATUSES.map((s) => (
          <button key={s} className="chip" aria-pressed={status === s} onClick={() => setParams({ status: s })}>{STATUS_LABEL[s]}</button>
        ))}
      </div>
      {list.error && <p className="alert err">Couldn’t load translators. Reload the page to try again.</p>}
      {list.data?.length === 0 && <p className="panel empty">{status === 'PENDING' ? 'No applications waiting.' : `No ${STATUS_LABEL[status].toLowerCase()} translators.`}</p>}
      {list.data?.map((t) => <TranslatorCard key={t.id} t={t} />)}
    </div>
  );
}

function TranslatorCard({ t }: { t: Translator }) {
  const canModerate = useCanModerate();
  const queryClient = useQueryClient();
  const decide = useMutation({
    mutationFn: ({ decision, notes }: { decision: TranslatorDecision; notes: string }) => api.decideTranslator(t.id, { decision, notes }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['translators'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
  const allowed = (Object.keys(TRANSLATOR_TRANSITIONS) as TranslatorDecision[])
    .filter((d) => TRANSLATOR_TRANSITIONS[d].from.includes(t.verificationStatus))
    .map((d) => OPTIONS[d]);
  const username = t.telegramUser?.username ?? t.telegramUsername;

  return (
    <article className="panel" aria-labelledby={`t-${t.id}`}>
      <div className="spread">
        <div className="stack" style={{ gap: 2 }}>
          <h2 id={`t-${t.id}`}>{t.name}</h2>
          <span className="muted" style={{ fontSize: '0.86rem' }}>
            {countryName(t.specialtyCountryCode)} · applied {formatDate(t.createdAt)}
            {username && ` · @${username}`}
            {t.phone && ` · ${t.phone}`}
          </span>
        </div>
        <StatusPill status={PILL[t.verificationStatus]} label={STATUS_LABEL[t.verificationStatus]} />
      </div>
      <dl className="facts">
        <dt>Languages</dt>
        <dd>{t.languages.map((l) => `${lang(l)} (${t.proficiency[l] ?? '?'})`).join(', ')}</dd>
        <dt>Work</dt>
        <dd>{t.specialties.map((s) => SPECIALTIES[s] ?? s).join(', ')}</dd>
        {t.bioRu && (
          <>
            <dt>About</dt>
            <dd lang="ru">{t.bioRu}</dd>
          </>
        )}
        <dt>Jobs</dt>
        <dd>
          {t.jobsCompleted} completed{t.rating ? ` · rated ${Number(t.rating).toFixed(1)} / 5` : ''}
        </dd>
      </dl>
      {t.spotCheckNotes && (
        <p className="reason">
          <strong>Check:</strong> {t.spotCheckNotes}
          {t.spotCheckedBy && t.spotCheckedAt && <span className="muted"> — {t.spotCheckedBy.name}, {formatDate(t.spotCheckedAt)}</span>}
        </p>
      )}
      {!t.telegramUser && <p className="alert info">Not linked to Telegram: job offers can’t reach them in the bot.</p>}
      {canModerate && allowed.length > 0 && (
        <DecisionPanel
          key={t.verificationStatus}
          id={t.id}
          options={allowed}
          reasonPlaceholder="What you checked, e.g. 20-minute call in Russian, fluent; translated a sample menu"
          onDecide={(decision, notes) => decide.mutateAsync({ decision, notes: notes! })}
        />
      )}
    </article>
  );
}

// ─── Translation jobs ────────────────────────────────────────────────────────

const JOB_LABEL: Record<TranslationJobStatus, string> = {
  REQUESTED: 'Needs a translator',
  ASSIGNED: 'Waiting for reply',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};
const JOB_PILL: Record<TranslationJobStatus, string> = { REQUESTED: 'PENDING', ASSIGNED: 'FLAGGED', IN_PROGRESS: 'APPROVED', COMPLETED: 'PUBLISHED', CANCELLED: 'CLOSED' };

/** Translation and interpretation requests (TR-3): staff step in when no translator has taken one. */
export function TranslationJobsPage() {
  const [params, setParams] = useSearchParams();
  const status = (TRANSLATION_JOB_STATUSES as readonly string[]).includes(params.get('status') ?? '') ? (params.get('status') as TranslationJobStatus) : 'REQUESTED';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const list = useQuery({ queryKey: ['translation-jobs', { status, page }], queryFn: () => api.translationJobs({ status, page }), placeholderData: keepPreviousData });
  const verified = useQuery({ queryKey: ['translators', 'VERIFIED'], queryFn: () => api.translators('VERIFIED') });

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <header className="stack" style={{ gap: 4 }}>
        <span className="eyebrow">Concierge</span>
        <h1>Translation requests</h1>
        <p className="muted" style={{ maxWidth: '70ch' }}>
          Requests go straight to the chosen translator in Telegram. They land here when the translator declines or can’t be reached: pick
          someone else and the offer is sent to them.
        </p>
      </header>
      <div className="chips" role="group" aria-label="Filter by status">
        {TRANSLATION_JOB_STATUSES.map((s) => (
          <button key={s} className="chip" aria-pressed={status === s} onClick={() => setParams({ status: s })}>{JOB_LABEL[s]}</button>
        ))}
      </div>
      {list.error && <p className="alert err">Couldn’t load requests. Reload the page to try again.</p>}
      {list.data?.items.length === 0 && <p className="panel empty">Nothing here.</p>}
      {list.data?.items.map((j) => <JobCard key={j.id} job={j} translators={verified.data ?? []} />)}
      {list.data && <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => setParams({ status, page: String(p) })} />}
    </div>
  );
}

function JobCard({ job: j, translators }: { job: TranslationJob; translators: Translator[] }) {
  const canModerate = useCanModerate();
  const queryClient = useQueryClient();
  const [translatorId, setTranslatorId] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['translation-jobs'] });
    void queryClient.invalidateQueries({ queryKey: ['stats'] });
  };
  const assign = useMutation({
    mutationFn: () => api.assignJob(j.id, translatorId),
    onSuccess: (r) => {
      setMessage(r.offerDelivered ? { kind: 'ok', text: `Offer sent to ${r.job.translator?.name} in Telegram.` } : { kind: 'info', text: `Assigned, but the offer couldn’t be delivered in Telegram. Contact ${r.job.translator?.name} directly.` });
      refresh();
    },
    onError: (e) => setMessage({ kind: 'err', text: e instanceof ApiError ? e.message : 'Couldn’t assign. Try again.' }),
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelJob(j.id, reason.trim()),
    onSuccess: refresh,
    onError: (e) => setMessage({ kind: 'err', text: e instanceof ApiError ? e.message : 'Couldn’t cancel. Try again.' }),
  });

  const requester =
    j.requesterTelegramUser
      ? `${[j.requesterTelegramUser.firstName, j.requesterTelegramUser.lastName].filter(Boolean).join(' ') || 'Traveller'}${j.requesterTelegramUser.username ? ` (@${j.requesterTelegramUser.username})` : ''}`
      : j.requesterOperator?.name ?? j.requesterDmc?.name ?? 'Unknown';
  const open = j.status === 'REQUESTED' || j.status === 'ASSIGNED';
  const candidates = translators.filter((t) => t.languages.includes(j.sourceLanguage) && t.languages.includes(j.targetLanguage));

  function submitAssign(e: FormEvent) {
    e.preventDefault();
    if (!translatorId) return setMessage({ kind: 'err', text: 'Choose a translator first.' });
    assign.mutate();
  }

  return (
    <article className="panel" aria-labelledby={`j-${j.id}`}>
      <div className="spread">
        <div className="stack" style={{ gap: 2 }}>
          <h2 id={`j-${j.id}`}>
            {j.type === 'LIVE' ? 'Interpreting' : 'Document'}: {lang(j.sourceLanguage)} → {lang(j.targetLanguage)}
          </h2>
          <span className="muted" style={{ fontSize: '0.86rem' }}>
            From {requester} · {formatDateTime(j.createdAt)}
            {j.scheduledAt && ` · for ${formatDateTime(j.scheduledAt)}`}
            {j.deadline && ` · due ${formatDate(j.deadline)}`}
          </span>
        </div>
        <StatusPill status={JOB_PILL[j.status]} label={JOB_LABEL[j.status]} />
      </div>
      {j.description && <blockquote lang="ru" style={{ margin: 0, padding: '10px 12px', background: 'var(--sunken)', borderRadius: 6, whiteSpace: 'pre-wrap' }}>{j.description}</blockquote>}
      <p className="muted" style={{ fontSize: '0.88rem' }}>
        Translator: {j.translator ? `${j.translator.name}${j.translator.telegramUser?.username ? ` (@${j.translator.telegramUser.username})` : ''}` : 'none yet'}
        {j.rating && ` · rated ${j.rating} / 5`}
      </p>
      {canModerate && open && (
        <div className="stack" style={{ gap: 10 }}>
          <form className="row-wrap" onSubmit={submitAssign} style={{ alignItems: 'end' }}>
            <div className="field" style={{ minWidth: 240 }}>
              <label htmlFor={`assign-${j.id}`}>{j.translator ? 'Reassign to' : 'Assign to'}</label>
              <select id={`assign-${j.id}`} value={translatorId} onChange={(e) => setTranslatorId(e.target.value)}>
                <option value="">Choose a verified translator…</option>
                {candidates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} — {countryName(t.specialtyCountryCode)}{t.telegramUser ? '' : ' (no Telegram)'}</option>
                ))}
              </select>
            </div>
            <button className="btn primary" type="submit" disabled={assign.isPending}>Send offer</button>
          </form>
          {candidates.length === 0 && <p className="muted" style={{ fontSize: '0.86rem' }}>No verified translator covers both languages.</p>}
          <div className="row-wrap" style={{ alignItems: 'end' }}>
            <div className="field" style={{ flex: 1, minWidth: 220 }}>
              <label htmlFor={`cancel-${j.id}`}>Cancel with reason</label>
              <input id={`cancel-${j.id}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Traveller no longer needs it" />
            </div>
            <button className="btn danger" type="button" disabled={cancel.isPending || reason.trim().length < 3} onClick={() => cancel.mutate()}>Cancel request</button>
          </div>
        </div>
      )}
      {message && <p className={`alert ${message.kind}`} role={message.kind === 'err' ? 'alert' : 'status'}>{message.text}</p>}
    </article>
  );
}
