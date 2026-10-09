import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CURRENCIES, INCLUSION_OPTIONS, PackageInput, PackageStatus, packageCreateSchema } from '@ttp/shared-types';
import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, OperatorPackage, Quote } from '../api';
import { COUNTRY_EN, dateEn, money, PUBLIC_SITE } from '../format';

const STATUS_PILL: Record<PackageStatus, [string, string]> = { DRAFT: ['wait', 'Draft'], PUBLISHED: ['ok', 'Published'], ARCHIVED: ['off', 'Archived'] };

function Pill({ kind, children }: { kind: string; children: React.ReactNode }) {
  return <span className={`pill ${kind}`}>{children}</span>;
}

// ─── Overview ────────────────────────────────────────────────────────────────

export function OperatorOverviewPage() {
  const { data, error } = useQuery({ queryKey: ['overview'], queryFn: api.overview });
  if (error) return <p className="alert err">Couldn’t load your overview. Reload the page.</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const { operator: op, scores: s } = data;
  return (
    <>
      <header className="stack" style={{ gap: 6 }}>
        <span className="eyebrow">Overview</span>
        <h1>{op.name}</h1>
        {op.status === 'APPROVED' ? (
          <p className="muted">
            Verified and listed. <a href={`${PUBLIC_SITE}/operators/${op.slug}`} target="_blank" rel="noopener noreferrer">See your public page</a>
          </p>
        ) : (
          <p className="alert info">Your listing is not active ({op.status.toLowerCase()}){op.statusReason ? `: ${op.statusReason}` : ''}. You can look around, but changes are paused.</p>
        )}
      </header>
      <section className="tiles" aria-label="To do">
        <Link to="/quotes" className={`tile ${data.openQuotes ? 'attention' : ''}`}>
          <span className="value">{data.openQuotes}</span>
          <span>Quote requests waiting for your price</span>
        </Link>
        <Link to="/packages" className="tile">
          <span className="value">{data.packagesByStatus.PUBLISHED ?? 0}</span>
          <span>Published tours{data.packagesByStatus.DRAFT ? ` · ${data.packagesByStatus.DRAFT} draft` : ''}</span>
        </Link>
        <Link to="/fam-trips" className="tile">
          <span className="value">{data.upcomingFamTrips}</span>
          <span>Upcoming fam trips</span>
        </Link>
      </section>
      <div className="cards">
        <section className="panel" aria-labelledby="resp">
          <h2 id="resp">Response time</h2>
          {s.responseTimeScore === null ? (
            <p className="muted">No requests in the last 90 days yet.</p>
          ) : (
            <>
              <Meter value={s.responseTimeScore} label="Response time score" />
              <p>
                You answer in about <strong>{s.medianResponseHours} hours</strong> (median of {s.responsesCounted} requests, last 90 days).
              </p>
            </>
          )}
          <p className="muted small">Answering travellers and DMCs within a few hours raises this score. Requests left more than 72 hours count as missed.</p>
        </section>
        <section className="panel" aria-labelledby="comp">
          <h2 id="comp">Listing completeness</h2>
          <Meter value={s.completenessScore} label="Completeness score" />
          {s.missing.length ? (
            <ul className="small" style={{ margin: 0, paddingLeft: '1.2em' }}>
              {s.missing.map((m) => <li key={m.key}>{m.label} <span className="muted">(+{m.points})</span></li>)}
            </ul>
          ) : (
            <p>Your listing has everything travellers look for.</p>
          )}
          <p className="muted small">To change your company details or video, send them to your platform contact.</p>
        </section>
      </div>
    </>
  );
}

function Meter({ value, label }: { value: number; label: string }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 700 }}>{value}<span className="muted small"> / 100</span></span>
      <div className="meter" role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${value}%` }} /></div>
    </div>
  );
}

// ─── Tours ───────────────────────────────────────────────────────────────────

export function PackagesPage() {
  const { data, error } = useQuery({ queryKey: ['packages'], queryFn: api.packages });
  return (
    <>
      <header className="spread">
        <div className="stack" style={{ gap: 6 }}>
          <span className="eyebrow">Package feed</span>
          <h1>Your tours</h1>
          <p className="muted">Published tours appear on the Russian site and in the wholesale catalogue for Russian travel companies. Prices are indicative; DMCs ask you for exact terms.</p>
        </div>
        <Link to="/packages/new" className="btn primary">Add a tour</Link>
      </header>
      {error && <p className="alert err">Couldn’t load your tours.</p>}
      {data?.length === 0 && <p className="panel muted">No tours yet. Add your first one: it starts as a draft.</p>}
      <div className="cards">
        {data?.map((p) => (
          <Link key={p.id} to={`/packages/${p.id}`} className="panel" style={{ color: 'var(--ink)', textDecoration: 'none' }}>
            <div className="spread"><Pill kind={STATUS_PILL[p.status][0]}>{STATUS_PILL[p.status][1]}</Pill><span className="muted small">{COUNTRY_EN[p.countryCode]}</span></div>
            <h2>{p.title}</h2>
            {p.titleRu && <p className="muted small" lang="ru">{p.titleRu}</p>}
            <p className="small">
              {p.durationDays} days{p.price && p.currency ? ` · from ${money(p.price, p.currency)}` : ''} · {p.dateRanges.length} date{p.dateRanges.length === 1 ? '' : 's'}
            </p>
            <p className="muted small">{p._count.quoteRequests} quote requests · sold by {p._count.listings} DMC{p._count.listings === 1 ? '' : 's'}</p>
          </Link>
        ))}
      </div>
    </>
  );
}

interface FormState {
  title: string; titleRu: string; descriptionEn: string; descriptionRu: string; countryCode: string; durationDays: string;
  price: string; currency: string; priceBasis: 'PER_PERSON' | 'PER_GROUP'; capacity: string; inclusions: string[]; exclusions: string;
  dates: { startDate: string; endDate: string; capacity: string }[];
}
const empty: FormState = { title: '', titleRu: '', descriptionEn: '', descriptionRu: '', countryCode: 'UG', durationDays: '', price: '', currency: 'USD', priceBasis: 'PER_PERSON', capacity: '', inclusions: [], exclusions: '', dates: [] };
const fromPackage = (p: OperatorPackage): FormState => ({
  title: p.title, titleRu: p.titleRu ?? '', descriptionEn: p.descriptionEn ?? '', descriptionRu: p.descriptionRu ?? '', countryCode: p.countryCode,
  durationDays: String(p.durationDays), price: p.price ?? '', currency: p.currency ?? 'USD', priceBasis: p.priceBasis, capacity: p.capacity ? String(p.capacity) : '',
  inclusions: p.inclusions, exclusions: p.exclusions.join(', '),
  dates: p.dateRanges.map((d) => ({ startDate: d.startDate.slice(0, 10), endDate: d.endDate.slice(0, 10), capacity: d.capacity ? String(d.capacity) : '' })),
});

export function toPackageInput(f: FormState): unknown {
  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  const text = (s: string) => s.trim() || null;
  return {
    title: f.title.trim(), titleRu: text(f.titleRu), descriptionEn: text(f.descriptionEn), descriptionRu: text(f.descriptionRu),
    countryCode: f.countryCode, durationDays: Number(f.durationDays), price: num(f.price), currency: num(f.price) === null ? null : f.currency,
    priceBasis: f.priceBasis, capacity: num(f.capacity), inclusions: f.inclusions,
    exclusions: f.exclusions.split(',').map((x) => x.trim()).filter(Boolean),
    dates: f.dates.filter((d) => d.startDate || d.endDate).map((d) => ({ startDate: d.startDate, endDate: d.endDate || d.startDate, capacity: num(d.capacity) })),
  };
}

const MESSAGES: Record<string, string> = {
  title: 'Give the tour a name (at least 3 characters).',
  durationDays: 'Enter the number of days.',
  currency: 'Choose a currency for the price.',
};

export function PackageFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const existing = useQuery({ queryKey: ['package', id], queryFn: () => api.package(id!), enabled: editing });
  const [f, setF] = useState<FormState>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ kind: 'err' | 'ok'; text: string } | null>(null);
  useEffect(() => { if (existing.data) setF(fromPackage(existing.data)); }, [existing.data]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['packages'] });
    void queryClient.invalidateQueries({ queryKey: ['overview'] });
  };
  const save = useMutation({
    mutationFn: (input: PackageInput) => (editing ? api.updatePackage(id!, input) : api.createPackage(input)),
    onSuccess: (p) => {
      refresh();
      queryClient.setQueryData(['package', p.id], p);
      setMessage({ kind: 'ok', text: 'Saved.' });
      if (!editing) navigate(`/packages/${p.id}`, { replace: true });
    },
    onError: (e) => setMessage({ kind: 'err', text: e instanceof ApiError ? e.message : 'Couldn’t save. Try again.' }),
  });
  const status = useMutation({
    mutationFn: (s: PackageStatus) => api.setPackageStatus(id!, s),
    onSuccess: (p) => { refresh(); queryClient.setQueryData(['package', p.id], p); setMessage({ kind: 'ok', text: `Tour is now ${p.status.toLowerCase()}.` }); },
    onError: (e) => setMessage({ kind: 'err', text: e instanceof ApiError ? e.message : 'Couldn’t change the status.' }),
  });

  if (editing && existing.isLoading) return <p className="muted">Loading…</p>;
  if (editing && existing.error) return <p className="alert err">Tour not found. <Link to="/packages">Back to tours</Link></p>;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => { setF((p) => ({ ...p, [k]: v })); setErrors((e) => ({ ...e, [k]: '' })); };
  const current = existing.data?.status;

  function submit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    const parsed = packageCreateSchema.safeParse(toPackageInput(f));
    if (!parsed.success) {
      const out: Record<string, string> = {};
      for (const i of parsed.error.issues) {
        const key = String(i.path[0]);
        out[key] ??= MESSAGES[key] ?? (key === 'dates' ? 'Check the dates: each needs a start, and the end can’t be before it.' : i.message);
      }
      setErrors(out);
      return setMessage({ kind: 'err', text: 'Some fields need fixing.' });
    }
    save.mutate(parsed.data);
  }

  const err = (k: string) => errors[k] && <span className="error">{errors[k]}</span>;

  return (
    <>
      <header className="stack" style={{ gap: 6 }}>
        <Link to="/packages" className="small">← Your tours</Link>
        <div className="row">
          <h1>{editing ? f.title || 'Tour' : 'Add a tour'}</h1>
          {current && <Pill kind={STATUS_PILL[current][0]}>{STATUS_PILL[current][1]}</Pill>}
        </div>
      </header>
      <form className="stack" onSubmit={submit} noValidate>
        <section className="panel">
          <h2>The tour</h2>
          <div className="form-grid">
            <div className="field wide"><label htmlFor="title">Name (English)</label><input id="title" value={f.title} onChange={(e) => set('title', e.target.value)} aria-invalid={!!errors.title} />{err('title')}</div>
            <div className="field wide"><label htmlFor="titleRu">Name in Russian</label><input id="titleRu" lang="ru" value={f.titleRu} onChange={(e) => set('titleRu', e.target.value)} /><span className="hint">Shown on the Russian site. Ask your platform contact if you need help translating.</span></div>
            <div className="field"><label htmlFor="country">Country</label>
              <select id="country" value={f.countryCode} onChange={(e) => set('countryCode', e.target.value)}>{['UG', 'TZ', 'KE', 'RW'].map((c) => <option key={c} value={c}>{COUNTRY_EN[c]}</option>)}</select>
            </div>
            <div className="field"><label htmlFor="days">Days</label><input id="days" type="number" min={1} max={60} value={f.durationDays} onChange={(e) => set('durationDays', e.target.value)} aria-invalid={!!errors.durationDays} />{err('durationDays')}</div>
            <div className="field wide"><label htmlFor="descRu">Description in Russian</label><textarea id="descRu" lang="ru" rows={5} value={f.descriptionRu} onChange={(e) => set('descriptionRu', e.target.value)} /><span className="hint">Required before publishing.</span></div>
            <div className="field wide"><label htmlFor="descEn">Description in English</label><textarea id="descEn" rows={4} value={f.descriptionEn} onChange={(e) => set('descriptionEn', e.target.value)} /></div>
          </div>
        </section>

        <section className="panel">
          <h2>Price and group</h2>
          <p className="muted small">An indicative public price. Nobody pays through the platform; DMCs request exact terms from you.</p>
          <div className="form-grid">
            <div className="field"><label htmlFor="price">From price (optional)</label><input id="price" type="number" min={0} value={f.price} onChange={(e) => set('price', e.target.value)} /></div>
            <div className="field"><label htmlFor="currency">Currency</label>
              <select id="currency" value={f.currency} onChange={(e) => set('currency', e.target.value)} aria-invalid={!!errors.currency}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>{err('currency')}
            </div>
            <div className="field"><label htmlFor="basis">Price is</label>
              <select id="basis" value={f.priceBasis} onChange={(e) => set('priceBasis', e.target.value as FormState['priceBasis'])}><option value="PER_PERSON">per person</option><option value="PER_GROUP">per group</option></select>
            </div>
            <div className="field"><label htmlFor="cap">Max group size (optional)</label><input id="cap" type="number" min={1} value={f.capacity} onChange={(e) => set('capacity', e.target.value)} /></div>
          </div>
        </section>

        <section className="panel">
          <h2>What’s included</h2>
          <div className="checks" role="group" aria-label="Included">
            {INCLUSION_OPTIONS.map((o) => (
              <label key={o}><input type="checkbox" checked={f.inclusions.includes(o)} onChange={(e) => set('inclusions', e.target.checked ? [...f.inclusions, o] : f.inclusions.filter((x) => x !== o))} />{o}</label>
            ))}
          </div>
          <div className="field"><label htmlFor="excl">Not included</label><input id="excl" value={f.exclusions} onChange={(e) => set('exclusions', e.target.value)} /><span className="hint">Separate with commas, e.g. international flights, visa, tips</span></div>
        </section>

        <section className="panel">
          <h2>Departure dates</h2>
          <div className="dates">
            {f.dates.map((d, i) => (
              <div key={i} className="row">
                <div className="field"><label htmlFor={`start-${i}`}>Start</label><input id={`start-${i}`} type="date" value={d.startDate} onChange={(e) => set('dates', f.dates.map((x, j) => (j === i ? { ...x, startDate: e.target.value } : x)))} /></div>
                <div className="field"><label htmlFor={`end-${i}`}>End</label><input id={`end-${i}`} type="date" value={d.endDate} onChange={(e) => set('dates', f.dates.map((x, j) => (j === i ? { ...x, endDate: e.target.value } : x)))} /></div>
                <div className="field" style={{ maxWidth: 140 }}><label htmlFor={`cap-${i}`}>Places</label><input id={`cap-${i}`} type="number" min={1} value={d.capacity} onChange={(e) => set('dates', f.dates.map((x, j) => (j === i ? { ...x, capacity: e.target.value } : x)))} /></div>
                <button type="button" className="btn small" onClick={() => set('dates', f.dates.filter((_, j) => j !== i))}>Remove</button>
              </div>
            ))}
          </div>
          {err('dates')}
          <button type="button" className="btn small" style={{ justifySelf: 'start' }} onClick={() => set('dates', [...f.dates, { startDate: '', endDate: '', capacity: '' }])}>Add dates</button>
        </section>

        {message && <p className={`alert ${message.kind}`} role={message.kind === 'err' ? 'alert' : 'status'}>{message.text}</p>}
        <div className="row">
          <button className="btn primary" type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Save as draft'}</button>
          {editing && current !== 'PUBLISHED' && <button type="button" className="btn" disabled={status.isPending} onClick={() => status.mutate('PUBLISHED')}>Publish</button>}
          {editing && current === 'PUBLISHED' && <button type="button" className="btn" disabled={status.isPending} onClick={() => status.mutate('DRAFT')}>Unpublish</button>}
          {editing && current !== 'ARCHIVED' && <button type="button" className="btn danger" disabled={status.isPending} onClick={() => status.mutate('ARCHIVED')}>Archive</button>}
          {current === 'PUBLISHED' && existing.data && <a href={`${PUBLIC_SITE}/tours/${existing.data.slug}`} target="_blank" rel="noopener noreferrer" className="small">View on the site</a>}
        </div>
        {editing && <p className="muted small">Publishing saved changes only: save first if you edited anything.</p>}
      </form>
    </>
  );
}

// ─── Quote requests ──────────────────────────────────────────────────────────

const QUOTE_PILL = { OPEN: ['wait', 'Waiting for you'], QUOTED: ['ok', 'Quoted'], CLOSED: ['off', 'Closed'] } as const;

export function OperatorQuotesPage() {
  const { data, error } = useQuery({ queryKey: ['operator-quotes'], queryFn: api.operatorQuotes });
  return (
    <>
      <header className="stack" style={{ gap: 6 }}>
        <span className="eyebrow">Wholesale</span>
        <h1>Quote requests</h1>
        <p className="muted">Russian travel companies ask for your net price for a group. Answer with a price and terms, or say you can’t. Payment and contracts are between you and the DMC.</p>
      </header>
      {error && <p className="alert err">Couldn’t load requests.</p>}
      {data?.length === 0 && <p className="panel muted">No requests yet.</p>}
      {data?.map((q) => <QuoteCard key={q.id} q={q} />)}
    </>
  );
}

function QuoteCard({ q }: { q: Quote }) {
  const queryClient = useQueryClient();
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [terms, setTerms] = useState('');
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'quote' | 'decline'>('quote');
  const [error, setError] = useState<string | null>(null);
  const respond = useMutation({
    mutationFn: () =>
      api.respondQuote(q.id, mode === 'quote'
        ? { action: 'quote', quotedPrice: Number(price), quotedCurrency: currency as 'USD', quoteTerms: terms.trim() }
        : { action: 'decline', reason: reason.trim() }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['operator-quotes'] });
      void queryClient.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Couldn’t send. Try again.'),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === 'quote' && (!price || Number(price) < 0)) return setError('Enter your price.');
    if (mode === 'quote' && terms.trim().length < 5) return setError('Add the terms: what the price covers, per person or group, how long it’s valid.');
    if (mode === 'decline' && reason.trim().length < 5) return setError('Tell the DMC why, in a few words.');
    respond.mutate();
  }

  const [kind, label] = QUOTE_PILL[q.status];
  return (
    <article className="panel" aria-labelledby={`q-${q.id}`}>
      <div className="spread">
        <h2 id={`q-${q.id}`}>{q.dmc?.name} · {q.package.title}</h2>
        <Pill kind={kind}>{label}</Pill>
      </div>
      <dl className="facts">
        <dt>Group</dt><dd>{q.pax} people</dd>
        <dt>Dates</dt><dd>{q.travelStartDate ? dateEn(q.travelStartDate) : '—'}{q.travelEndDate ? ` – ${dateEn(q.travelEndDate)}` : ''}</dd>
        {q.notes && (<><dt>Notes</dt><dd lang="ru">{q.notes}</dd></>)}
        <dt>Contact</dt><dd>{[q.dmc?.contactName, q.dmc?.email, q.dmc?.phone].filter(Boolean).join(' · ')}</dd>
        <dt>Asked</dt><dd>{dateEn(q.createdAt)}</dd>
        {q.quotedPrice && q.quotedCurrency && (<><dt>Your quote</dt><dd><strong>{money(q.quotedPrice, q.quotedCurrency)}</strong> · {q.quoteTerms}</dd></>)}
      </dl>
      {q.status === 'OPEN' && (
        <form className="stack" style={{ gap: 10 }} onSubmit={submit} noValidate>
          <div className="chips" role="radiogroup" aria-label="Answer">
            <button type="button" className="chip" role="radio" aria-checked={mode === 'quote'} aria-pressed={mode === 'quote'} onClick={() => setMode('quote')}>Send a price</button>
            <button type="button" className="chip" role="radio" aria-checked={mode === 'decline'} aria-pressed={mode === 'decline'} onClick={() => setMode('decline')}>Can’t quote</button>
          </div>
          {mode === 'quote' ? (
            <div className="form-grid">
              <div className="field"><label htmlFor={`p-${q.id}`}>Net price</label><input id={`p-${q.id}`} type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} /></div>
              <div className="field"><label htmlFor={`c-${q.id}`}>Currency</label><select id={`c-${q.id}`} value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div>
              <div className="field wide"><label htmlFor={`t-${q.id}`}>Terms</label><textarea id={`t-${q.id}`} rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="e.g. Per person in double rooms, includes permits and transport, valid 30 days" /></div>
            </div>
          ) : (
            <div className="field"><label htmlFor={`r-${q.id}`}>Why not</label><input id={`r-${q.id}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Fully booked on these dates" /></div>
          )}
          {error && <p className="alert err" role="alert">{error}</p>}
          <button className="btn primary" type="submit" disabled={respond.isPending} style={{ justifySelf: 'start' }}>{mode === 'quote' ? 'Send quote' : 'Send answer'}</button>
        </form>
      )}
    </article>
  );
}

// ─── Fam trips ───────────────────────────────────────────────────────────────

export function OperatorFamTripsPage() {
  const queryClient = useQueryClient();
  const { data, error } = useQuery({ queryKey: ['operator-fam-trips'], queryFn: api.operatorFamTrips });
  const confirm = useMutation({ mutationFn: api.confirmFamTrip, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['operator-fam-trips'] }) });
  return (
    <>
      <header className="stack" style={{ gap: 6 }}>
        <span className="eyebrow">Fam trips</span>
        <h1>Site visits by Russian travel companies</h1>
        <p className="muted">Trips the platform organises so DMC staff can see your tours in person. Confirm that you’ll host.</p>
      </header>
      {error && <p className="alert err">Couldn’t load fam trips.</p>}
      {data?.length === 0 && <p className="panel muted">You’re not part of a fam trip yet.</p>}
      {data?.map(({ famTrip: t, confirmed, role }) => (
        <article key={t.id} className="panel" aria-labelledby={`f-${t.id}`}>
          <div className="spread">
            <h2 id={`f-${t.id}`}>{t.title}</h2>
            <Pill kind={confirmed ? 'ok' : 'wait'}>{confirmed ? 'You confirmed' : 'Please confirm'}</Pill>
          </div>
          <p>{dateEn(t.startDate)} – {dateEn(t.endDate)}{role ? ` · your role: ${role}` : ''} · {t.status.toLowerCase()}</p>
          <p className="muted small">Confirmed DMCs: {t.dmcs.map((d) => d.dmc.name).join(', ') || 'none yet'}</p>
          {t.itinerary.length > 0 && (
            <ol className="small" style={{ margin: 0, paddingLeft: '1.2em' }} lang="ru">
              {t.itinerary.map((d) => <li key={d.day} value={d.day}>{d.titleRu}</li>)}
            </ol>
          )}
          {!confirmed && t.status !== 'CANCELLED' && (
            <button className="btn primary" style={{ justifySelf: 'start' }} disabled={confirm.isPending} onClick={() => confirm.mutate(t.id)}>Confirm we’ll host</button>
          )}
        </article>
      ))}
    </>
  );
}
