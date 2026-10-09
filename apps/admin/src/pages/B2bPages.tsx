import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DMC_STATUSES, DMC_TRANSITIONS, DmcDecision, DmcStatus, FAM_TRIP_STATUSES, FamTripStatus, QUOTE_STATUSES, QuoteStatus, famTripSchema } from '@ttp/shared-types';
import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError, Dmc, FamTripDetail } from '../api';
import { useCanModerate } from '../auth';
import { DecisionOption, DecisionPanel } from '../components/DecisionPanel';
import { StatusPill } from '../components/StatusPill';
import { countryName, formatDate } from '../format';

const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** One-time link shown once, to send to the partner. */
export function OneTimeLink({ link, what }: { link: string; what: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="alert ok stack" style={{ gap: 8 }} role="status">
      <span>{what} Send this link to them; it works once and expires in 7 days.</span>
      <input readOnly value={link} className="mono" aria-label="Set-password link" onFocus={(e) => e.currentTarget.select()} />
      <button type="button" className="btn" style={{ justifySelf: 'start' }} onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true), () => setCopied(false))}>
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  );
}

// ─── DMCs ────────────────────────────────────────────────────────────────────

const DMC_LABEL: Record<DmcStatus, string> = { PENDING: 'To check', APPROVED: 'Approved', REJECTED: 'Rejected', SUSPENDED: 'Suspended' };
const DMC_OPTIONS: Record<DmcDecision, DecisionOption<DmcDecision>> = {
  approve: { value: 'approve', label: 'Approve', needsReason: false, primary: true },
  reject: { value: 'reject', label: 'Reject', needsReason: true, confirm: 'Reject this company? They lose access to the wholesale portal.' },
  suspend: { value: 'suspend', label: 'Suspend', needsReason: true, confirm: 'Suspend this company? Their quotes stay, but they can’t see inventory.' },
};

/** Russian travel companies applying for wholesale access (B2B-2). */
export function DmcsPage() {
  const [params, setParams] = useSearchParams();
  const status = (DMC_STATUSES as readonly string[]).includes(params.get('status') ?? '') ? (params.get('status') as DmcStatus) : 'PENDING';
  const list = useQuery({ queryKey: ['dmcs', status], queryFn: () => api.dmcs(status) });
  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <header className="stack" style={{ gap: 4 }}>
        <span className="eyebrow">Wholesale</span>
        <h1>DMCs</h1>
        <p className="muted" style={{ maxWidth: '70ch' }}>
          Russian travel companies apply in the partner portal. Check the website, legal registration and a contact before approving: approved companies see
          operators’ wholesale inventory and can ask for net prices.
        </p>
      </header>
      <div className="chips" role="group" aria-label="Filter by status">
        {DMC_STATUSES.map((s) => <button key={s} className="chip" aria-pressed={status === s} onClick={() => setParams({ status: s })}>{DMC_LABEL[s]}</button>)}
      </div>
      {list.error && <p className="alert err">Couldn’t load DMCs.</p>}
      {list.data?.length === 0 && <p className="panel empty">Nothing here.</p>}
      {list.data?.map((d) => <DmcCard key={d.id} d={d} />)}
    </div>
  );
}

function DmcCard({ d }: { d: Dmc }) {
  const canModerate = useCanModerate();
  const queryClient = useQueryClient();
  const decide = useMutation({
    mutationFn: ({ decision, reason }: { decision: DmcDecision; reason?: string }) => api.decideDmc(d.id, { decision, reason }),
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: ['dmcs'] }); void queryClient.invalidateQueries({ queryKey: ['stats'] }); },
  });
  const allowed = (Object.keys(DMC_TRANSITIONS) as DmcDecision[]).filter((x) => DMC_TRANSITIONS[x].from.includes(d.status)).map((x) => DMC_OPTIONS[x]);
  return (
    <article className="panel" aria-labelledby={`d-${d.id}`}>
      <div className="spread">
        <div className="stack" style={{ gap: 2 }}>
          <h2 id={`d-${d.id}`} lang="ru">{d.name}</h2>
          <span className="muted" style={{ fontSize: '0.86rem' }}>Applied {formatDate(d.createdAt)} · {d._count.quoteRequests} quote requests · sells {d._count.listings} tours</span>
        </div>
        <StatusPill status={d.status === 'PENDING' ? 'PENDING' : d.status} label={DMC_LABEL[d.status]} />
      </div>
      <dl className="facts">
        {d.legalName && (<><dt>Legal name</dt><dd lang="ru">{d.legalName}</dd></>)}
        <dt>Website</dt><dd>{d.websiteUrl ? <a href={d.websiteUrl} target="_blank" rel="noopener noreferrer">{d.websiteUrl.replace(/^https?:\/\//, '')}</a> : <span className="muted">none</span>}</dd>
        <dt>Contact</dt><dd>{[d.contactName, d.email, d.phone, d.telegramUsername && `@${d.telegramUsername.replace(/^@/, '')}`].filter(Boolean).join(' · ')}</dd>
        <dt>Logins</dt><dd>{d.accounts.map((a) => `${a.email}${a.active ? '' : ' (off)'}`).join(', ') || 'none'}</dd>
      </dl>
      {d.statusReason && <p className="reason"><strong>Reason:</strong> {d.statusReason}</p>}
      {canModerate && allowed.length > 0 && (
        <DecisionPanel key={d.status} id={d.id} options={allowed} reasonPlaceholder="e.g. Website offline and no legal registration found" onDecide={(decision, reason) => decide.mutateAsync({ decision, reason })} />
      )}
    </article>
  );
}

// ─── Operator: portal logins and scores (used on the operator page) ──────────

export function OperatorPortalPanel({ operatorId, approved }: { operatorId: string; approved: boolean }) {
  const canModerate = useCanModerate();
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ['operator-accounts', operatorId], queryFn: () => api.operatorAccounts(operatorId) });
  const scores = useQuery({ queryKey: ['operator-scores', operatorId], queryFn: () => api.operatorScores(operatorId) });
  const [email, setEmail] = useState('');
  const [link, setLink] = useState<{ link: string; what: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['operator-accounts', operatorId] });
  const create = useMutation({
    mutationFn: () => api.createOperatorAccount(operatorId, email.trim()),
    onSuccess: (r) => { setLink({ link: r.link, what: `Login created for ${r.account.email}.` }); setEmail(''); void refresh(); },
    onError: (e) => setError(errText(e, 'Couldn’t create the login.')),
  });
  const reset = useMutation({ mutationFn: (id: string) => api.passwordLink(id), onSuccess: (r) => setLink({ link: r.link, what: 'New password link.' }) });
  const toggle = useMutation({ mutationFn: ({ id, active }: { id: string; active: boolean }) => api.setAccountActive(id, active), onSuccess: () => void refresh() });
  const s = scores.data;

  return (
    <section className="panel" aria-labelledby="portal">
      <h2 id="portal">Partner portal</h2>
      {s && (
        <p style={{ fontSize: '0.92rem' }}>
          Response time <strong>{s.responseTimeScore ?? '—'}</strong>{s.medianResponseHours !== null && <span className="muted"> (median {s.medianResponseHours} h over {s.responsesCounted})</span>} ·
          completeness <strong>{s.completenessScore}</strong>
          {s.missing.length > 0 && <><br /><span className="muted">Missing: {s.missing.map((m) => m.label.toLowerCase()).join(', ')}</span></>}
        </p>
      )}
      {accounts.data?.length ? (
        <ul className="history">
          {accounts.data.map((a) => (
            <li key={a.id}>
              <span>{a.email}{!a.active && <span className="muted"> · switched off</span>}</span>
              <span className="muted">{a.lastLoginAt ? `Last signed in ${formatDate(a.lastLoginAt)}` : 'Never signed in'}</span>
              {canModerate && (
                <span className="row-wrap">
                  {a.active && <button className="btn link" onClick={() => reset.mutate(a.id)}>New password link</button>}
                  <button className="btn link" onClick={() => toggle.mutate({ id: a.id, active: !a.active })}>{a.active ? 'Switch off' : 'Switch on'}</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No portal logins yet.</p>
      )}
      {canModerate && approved && (
        <form className="row-wrap" style={{ alignItems: 'end' }} onSubmit={(e) => { e.preventDefault(); setError(null); create.mutate(); }} noValidate>
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label htmlFor="acc-email">Email for a new login</label>
            <input id="acc-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button className="btn" type="submit" disabled={create.isPending || !email.includes('@')}>Create login</button>
        </form>
      )}
      {error && <p className="alert err" role="alert">{error}</p>}
      {link && <OneTimeLink link={link.link} what={link.what} />}
    </section>
  );
}

// ─── Quotes overview ─────────────────────────────────────────────────────────

const QUOTE_LABEL: Record<QuoteStatus, string> = { OPEN: 'Waiting for operator', QUOTED: 'Quoted', CLOSED: 'Closed' };

export function QuotesPage() {
  const [params, setParams] = useSearchParams();
  const status = (QUOTE_STATUSES as readonly string[]).includes(params.get('status') ?? '') ? (params.get('status') as QuoteStatus) : 'OPEN';
  const list = useQuery({ queryKey: ['quotes', status], queryFn: () => api.quotes(status) });
  const now = Date.now();
  return (
    <div className="page">
      <header className="stack" style={{ gap: 4 }}>
        <span className="eyebrow">Wholesale</span>
        <h1>Quote requests</h1>
        <p className="muted" style={{ maxWidth: '70ch' }}>DMCs ask operators for net prices in the portal. Nudge operators who leave a request for more than two days: it lowers their response score.</p>
      </header>
      <div className="chips" role="group" aria-label="Filter by status">
        {QUOTE_STATUSES.map((s) => <button key={s} className="chip" aria-pressed={status === s} onClick={() => setParams({ status: s })}>{QUOTE_LABEL[s]}</button>)}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Operator</th><th>DMC</th><th>Tour</th><th>Group</th><th>Asked</th></tr></thead>
          <tbody>
            {list.data?.map((q) => {
              const late = q.status === 'OPEN' && now - new Date(q.createdAt).getTime() > 48 * 3600 * 1000;
              return (
                <tr key={q.id}>
                  <td><Link className="title" to={`/operators/${q.package.operator.id}`}>{q.package.operator.name}</Link><div className="muted" style={{ fontSize: '0.82rem' }}>{[q.package.operator.email, q.package.operator.phone].filter(Boolean).join(' · ')}</div></td>
                  <td lang="ru">{q.dmc.name}</td>
                  <td>{q.package.title}</td>
                  <td className="num">{q.pax ?? '—'}{q.travelStartDate && ` · ${formatDate(q.travelStartDate)}`}</td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>{formatDate(q.createdAt)} {late && <StatusPill status="FLAGGED" label="Over 48 h" />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.data?.length === 0 && <p className="empty">Nothing here.</p>}
      </div>
    </div>
  );
}

// ─── Fam trips ───────────────────────────────────────────────────────────────

const TRIP_PILL: Record<FamTripStatus, string> = { PLANNED: 'PENDING', CONFIRMED: 'APPROVED', COMPLETED: 'PUBLISHED', CANCELLED: 'CLOSED' };

export function FamTripsPage() {
  const canModerate = useCanModerate();
  const list = useQuery({ queryKey: ['fam-trips'], queryFn: api.famTrips });
  return (
    <div className="page">
      <header className="spread">
        <div className="stack" style={{ gap: 4 }}>
          <span className="eyebrow">Wholesale</span>
          <h1>Fam trips</h1>
          <p className="muted" style={{ maxWidth: '70ch' }}>Site visits for DMC staff. DMCs ask to join in the portal; you confirm places here. Operators confirm hosting in their portal.</p>
        </div>
        {canModerate && <Link to="/fam-trips/new" className="btn primary">Plan a trip</Link>}
      </header>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Trip</th><th>Dates</th><th>DMCs</th><th>Operators</th><th>Status</th></tr></thead>
          <tbody>
            {list.data?.map((t) => {
              const confirmed = t.dmcs.filter((d) => d.confirmed).length;
              const waiting = t._count.dmcs - confirmed;
              return (
                <tr key={t.id}>
                  <td><Link className="title" to={`/fam-trips/${t.id}`}>{t.title}</Link></td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>{formatDate(t.startDate)} – {formatDate(t.endDate)}</td>
                  <td className="num">{confirmed}{t.capacity ? ` / ${t.capacity}` : ''} confirmed{waiting > 0 && <> · <strong>{waiting} asking</strong></>}</td>
                  <td className="num">{t._count.operators}</td>
                  <td><StatusPill status={TRIP_PILL[t.status]} label={t.status.toLowerCase()} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.data?.length === 0 && <p className="empty">No fam trips yet.</p>}
      </div>
    </div>
  );
}

interface TripForm { title: string; startDate: string; endDate: string; status: FamTripStatus; capacity: string; notes: string; itinerary: { day: string; titleRu: string; operatorId: string }[] }
const emptyTrip: TripForm = { title: '', startDate: '', endDate: '', status: 'PLANNED', capacity: '', notes: '', itinerary: [] };

export function FamTripPage() {
  const { id } = useParams();
  const editing = !!id;
  const canModerate = useCanModerate();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const trip = useQuery({ queryKey: ['fam-trip', id], queryFn: () => api.famTrip(id!), enabled: editing });
  const [f, setF] = useState<TripForm>(emptyTrip);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  useEffect(() => {
    const t = trip.data;
    if (t) setF({ title: t.title, startDate: t.startDate.slice(0, 10), endDate: t.endDate.slice(0, 10), status: t.status, capacity: t.capacity ? String(t.capacity) : '', notes: t.notes ?? '', itinerary: t.itinerary.map((d) => ({ day: String(d.day), titleRu: d.titleRu, operatorId: d.operatorId ?? '' })) });
  }, [trip.data]);

  const save = useMutation({
    mutationFn: () => {
      const body = famTripSchema.parse({
        title: f.title, startDate: f.startDate, endDate: f.endDate, status: f.status, capacity: f.capacity ? Number(f.capacity) : null, notes: f.notes.trim() || null,
        itinerary: f.itinerary.filter((d) => d.titleRu.trim()).map((d) => ({ day: Number(d.day), titleRu: d.titleRu.trim(), ...(d.operatorId && { operatorId: d.operatorId }) })),
      });
      return editing ? api.updateFamTrip(id!, body) : api.createFamTrip(body);
    },
    onSuccess: (t) => { void queryClient.invalidateQueries({ queryKey: ['fam-trips'] }); void queryClient.invalidateQueries({ queryKey: ['fam-trip', t.id] }); setMsg({ kind: 'ok', text: 'Saved.' }); if (!editing) navigate(`/fam-trips/${t.id}`, { replace: true }); },
    onError: (e) => setMsg({ kind: 'err', text: errText(e, 'Couldn’t save.') }),
  });

  if (editing && trip.isLoading) return <p className="muted">Loading…</p>;
  const set = <K extends keyof TripForm>(k: K, v: TripForm[K]) => setF((p) => ({ ...p, [k]: v }));

  function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (f.title.trim().length < 3 || !f.startDate || !f.endDate) return setMsg({ kind: 'err', text: 'Give the trip a title and dates.' });
    if (f.endDate < f.startDate) return setMsg({ kind: 'err', text: 'The end date is before the start date.' });
    save.mutate();
  }

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <header className="stack" style={{ gap: 6 }}>
        <Link to="/fam-trips" className="muted" style={{ fontSize: '0.88rem' }}>← Fam trips</Link>
        <h1>{editing ? f.title || 'Fam trip' : 'Plan a fam trip'}</h1>
      </header>
      <form className="stack" onSubmit={submit} noValidate>
        <section className="panel">
          <div className="form-grid">
            <div className="field wide"><label htmlFor="ft-title">Title</label><input id="ft-title" value={f.title} onChange={(e) => set('title', e.target.value)} /></div>
            <div className="field"><label htmlFor="ft-start">Start</label><input id="ft-start" type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} /></div>
            <div className="field"><label htmlFor="ft-end">End</label><input id="ft-end" type="date" value={f.endDate} onChange={(e) => set('endDate', e.target.value)} /></div>
            <div className="field"><label htmlFor="ft-cap">Places for DMCs</label><input id="ft-cap" type="number" min={1} value={f.capacity} onChange={(e) => set('capacity', e.target.value)} /></div>
            <div className="field"><label htmlFor="ft-status">Status</label>
              <select id="ft-status" value={f.status} onChange={(e) => set('status', e.target.value as FamTripStatus)}>{FAM_TRIP_STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</select>
            </div>
            <div className="field wide"><label htmlFor="ft-notes">Internal notes</label><textarea id="ft-notes" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></div>
          </div>
        </section>
        <section className="panel">
          <h2>Itinerary (Russian, shown to DMCs)</h2>
          {f.itinerary.map((d, i) => (
            <div key={i} className="row-wrap" style={{ alignItems: 'end' }}>
              <div className="field" style={{ width: 80 }}><label htmlFor={`day-${i}`}>Day</label><input id={`day-${i}`} type="number" min={1} value={d.day} onChange={(e) => set('itinerary', f.itinerary.map((x, j) => (j === i ? { ...x, day: e.target.value } : x)))} /></div>
              <div className="field" style={{ flex: 1, minWidth: 220 }}><label htmlFor={`what-${i}`}>What happens</label><input id={`what-${i}`} lang="ru" value={d.titleRu} onChange={(e) => set('itinerary', f.itinerary.map((x, j) => (j === i ? { ...x, titleRu: e.target.value } : x)))} /></div>
              <button type="button" className="btn" onClick={() => set('itinerary', f.itinerary.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn" style={{ justifySelf: 'start' }} onClick={() => set('itinerary', [...f.itinerary, { day: String(f.itinerary.length + 1), titleRu: '', operatorId: '' }])}>Add a day</button>
        </section>
        {msg && <p className={`alert ${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'}>{msg.text}</p>}
        {canModerate && <button className="btn primary" type="submit" disabled={save.isPending} style={{ justifySelf: 'start' }}>{editing ? 'Save changes' : 'Create trip'}</button>}
      </form>
      {trip.data && <Participants trip={trip.data} />}
    </div>
  );
}

function Participants({ trip }: { trip: FamTripDetail }) {
  const canModerate = useCanModerate();
  const queryClient = useQueryClient();
  const dmcs = useQuery({ queryKey: ['dmcs', 'APPROVED'], queryFn: () => api.dmcs('APPROVED') });
  const operators = useQuery({ queryKey: ['operators', { status: 'APPROVED', pageSize: 100 }], queryFn: () => api.operators({ status: 'APPROVED' }) });
  const [addOp, setAddOp] = useState('');
  const [addDmc, setAddDmc] = useState('');
  const [error, setError] = useState<string | null>(null);
  const done = (t: FamTripDetail) => { queryClient.setQueryData(['fam-trip', trip.id], t); void queryClient.invalidateQueries({ queryKey: ['fam-trips'] }); };
  const upsert = useMutation({ mutationFn: (body: Parameters<typeof api.upsertParticipant>[1]) => api.upsertParticipant(trip.id, body), onSuccess: done, onError: (e) => setError(errText(e, 'Couldn’t update.')) });
  const remove = useMutation({ mutationFn: ({ kind, pid }: { kind: 'dmc' | 'operator'; pid: string }) => api.removeParticipant(trip.id, kind, pid), onSuccess: done });
  const confirmed = trip.dmcs.filter((d) => d.confirmed).length;

  return (
    <div className="detail-grid">
      <section className="panel" aria-labelledby="pd">
        <h2 id="pd">DMCs · {confirmed}{trip.capacity ? ` / ${trip.capacity}` : ''} confirmed</h2>
        <ul className="history">
          {trip.dmcs.map((d) => (
            <li key={d.dmcId}>
              <span><strong lang="ru">{d.dmc.name}</strong>{d.representativeName && <span lang="ru"> · {d.representativeName}</span>} · {d.confirmed ? 'confirmed' : <strong>asking to join</strong>}</span>
              <span className="muted">{[d.dmc.contactName, d.dmc.email, d.dmc.phone].filter(Boolean).join(' · ')}</span>
              {canModerate && (
                <span className="row-wrap">
                  <button className="btn link" onClick={() => { setError(null); upsert.mutate({ kind: 'dmc', id: d.dmcId, confirmed: !d.confirmed }); }}>{d.confirmed ? 'Unconfirm' : 'Confirm place'}</button>
                  <button className="btn link" onClick={() => remove.mutate({ kind: 'dmc', pid: d.dmcId })}>Remove</button>
                </span>
              )}
            </li>
          ))}
          {trip.dmcs.length === 0 && <li className="muted">No DMCs yet.</li>}
        </ul>
        {canModerate && (
          <div className="row-wrap" style={{ alignItems: 'end' }}>
            <div className="field" style={{ flex: 1, minWidth: 200 }}><label htmlFor="add-dmc">Invite a DMC</label>
              <select id="add-dmc" value={addDmc} onChange={(e) => setAddDmc(e.target.value)}><option value="">Choose…</option>{dmcs.data?.filter((d) => !trip.dmcs.some((x) => x.dmcId === d.id)).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
            </div>
            <button className="btn" disabled={!addDmc} onClick={() => { upsert.mutate({ kind: 'dmc', id: addDmc, confirmed: true }); setAddDmc(''); }}>Add confirmed</button>
          </div>
        )}
        {error && <p className="alert err" role="alert">{error}</p>}
      </section>
      <section className="panel" aria-labelledby="po">
        <h2 id="po">Host operators</h2>
        <ul className="history">
          {trip.operators.map((o) => (
            <li key={o.operatorId}>
              <span><strong>{o.operator.name}</strong> · {countryName(o.operator.countryCode)}{o.role && ` · ${o.role}`} · {o.confirmed ? 'confirmed' : 'not confirmed yet'}</span>
              <span className="muted">{[o.operator.email, o.operator.phone].filter(Boolean).join(' · ')}</span>
              {canModerate && <button className="btn link" style={{ justifySelf: 'start' }} onClick={() => remove.mutate({ kind: 'operator', pid: o.operatorId })}>Remove</button>}
            </li>
          ))}
          {trip.operators.length === 0 && <li className="muted">No operators yet.</li>}
        </ul>
        {canModerate && (
          <div className="row-wrap" style={{ alignItems: 'end' }}>
            <div className="field" style={{ flex: 1, minWidth: 200 }}><label htmlFor="add-op">Add a host operator</label>
              <select id="add-op" value={addOp} onChange={(e) => setAddOp(e.target.value)}><option value="">Choose…</option>{operators.data?.items.filter((o) => !trip.operators.some((x) => x.operatorId === o.id)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
            </div>
            <button className="btn" disabled={!addOp} onClick={() => { upsert.mutate({ kind: 'operator', id: addOp, role: 'host', confirmed: false }); setAddOp(''); }}>Add</button>
          </div>
        )}
      </section>
    </div>
  );
}
