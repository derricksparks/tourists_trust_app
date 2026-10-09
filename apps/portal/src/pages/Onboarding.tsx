import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { APPLICATION_REQUIREMENTS, DOCUMENT_MAX_BYTES, DOCUMENT_TYPES, DocumentType, ImportResult, OperatorApplicationInput, OperatorStatus } from '@ttp/shared-types';
import { ChangeEvent, FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api, ApiError, Application } from '../api';
import { useAuth } from '../auth';
import { useCountries } from '../countries';
import { dateEn, PUBLIC_SITE } from '../format';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? (e.fieldErrors[0] ? `${e.fieldErrors[0].path}: ${e.fieldErrors[0].message}` : e.message) : fallback);
const DOC_LABEL: Record<DocumentType, string> = { TOURISM_LICENSE: 'Tourism licence', BUSINESS_REGISTRATION: 'Business registration certificate', OTHER: 'Other document' };
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// ─── Sign-up (/apply) ────────────────────────────────────────────────────────

/** A tour operator in East Africa applies to be listed (Phase 4 self-onboarding). English. */
export function OperatorSignupPage() {
  const { account, accept } = useAuth();
  const navigate = useNavigate();
  const countries = useCountries();
  const [v, setV] = useState({ name: '', countryCode: '', email: '', password: '', phone: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (account) return <Navigate to="/" replace />;
  const country = countries.data?.find((c) => c.code === v.countryCode);
  const set = (k: keyof typeof v) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (v.password.length < 10) return setError('Use a password of at least 10 characters.');
    setBusy(true);
    try {
      accept(await api.operatorSignup({ name: v.name.trim(), countryCode: v.countryCode, email: v.email.trim(), password: v.password, phone: v.phone.trim() || undefined }));
      navigate('/application', { replace: true });
    } catch (err) {
      setError(errorText(err, 'Could not reach the server. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center" lang="en">
      <form className="panel" onSubmit={submit} noValidate style={{ width: 'min(100%, 520px)' }}>
        <div className="stack" style={{ gap: 4 }}>
          <span className="eyebrow">For tour operators</span>
          <h1>Get verified and listed for Russian travellers</h1>
          <p className="muted small">
            Create a login, then fill in your licence details and upload copies. We check them with your licensing authority before your
            listing goes live. It’s free; we don’t take bookings or payments.
          </p>
        </div>
        <div className="field">
          <label htmlFor="name">Company name</label>
          <input id="name" value={v.name} onChange={set('name')} autoComplete="organization" />
        </div>
        <div className="field">
          <label htmlFor="country">Country you operate from</label>
          <select id="country" value={v.countryCode} onChange={set('countryCode')}>
            <option value="">Choose…</option>
            {countries.data?.map((c) => <option key={c.code} value={c.code}>{c.nameEn}</option>)}
          </select>
          {country?.licensingAuthority && <span className="hint">You’ll need your licence from {country.licensingAuthority}.</span>}
        </div>
        <div className="field">
          <label htmlFor="email">Email (your login)</label>
          <input id="email" type="email" value={v.email} onChange={set('email')} autoComplete="username" />
        </div>
        <div className="field">
          <label htmlFor="phone">Phone (optional)</label>
          <input id="phone" type="tel" value={v.phone} onChange={set('phone')} autoComplete="tel" />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" value={v.password} onChange={set('password')} autoComplete="new-password" />
          <span className="hint">At least 10 characters.</span>
        </div>
        {error && <p className="alert err" role="alert">{error}</p>}
        <button className="btn primary" type="submit" disabled={busy || !v.name.trim() || !v.countryCode || !v.email.trim()}>{busy ? '…' : 'Create login and continue'}</button>
        <p className="small">Already applied? <Link to="/login">Sign in</Link></p>
      </form>
    </div>
  );
}

// ─── Application (/application) ──────────────────────────────────────────────

const STATUS_TEXT: Record<OperatorStatus, { kind: string; text: (a: Application) => string }> = {
  DRAFT: { kind: 'info', text: () => 'Fill in your details and upload your licence and registration, then send the application to us.' },
  PENDING: { kind: 'info', text: (a) => `Thank you. Your application is with our team${a.submittedAt ? ` (sent ${dateEn(a.submittedAt)})` : ''}. We check your licence with the authority and may contact your reference; we’ll email you the outcome. Meanwhile you can prepare tours as drafts.` },
  FLAGGED: { kind: 'info', text: (a) => `We need something more before we can approve you: ${a.statusReason ?? 'see our email'}. Update the application below and send it again.` },
  APPROVED: { kind: 'ok', text: (a) => `Verified${a.approvedAt ? ` since ${dateEn(a.approvedAt)}` : ''}. Your listing and badge are live.` },
  REJECTED: { kind: 'err', text: (a) => `We could not approve this application${a.statusReason ? `: ${a.statusReason}` : ''}. Reply to our email if you think this is a mistake.` },
  SUSPENDED: { kind: 'err', text: (a) => `Your listing is suspended${a.statusReason ? `: ${a.statusReason}` : ''}. Contact us to resolve it.` },
};

type FormValues = Record<string, string>;
const TEXT_FIELDS = [
  'name', 'legalName', 'countryCode', 'yearEstablished', 'licensingAuthority', 'tourismBoardLicense', 'businessRegNumber', 'address', 'email', 'phone',
  'telegramUsername', 'websiteUrl', 'referenceContactName', 'referenceContactInfo', 'descriptionEn', 'descriptionRu', 'verificationVideoUrl',
] as const;
const REQUIRED = new Set(['name', 'countryCode', 'licensingAuthority', 'tourismBoardLicense', 'businessRegNumber', 'address']);
/** Everything the application needs before it can be sent (labels without "optional"). */
const NEEDED = new Set([...REQUIRED, ...APPLICATION_REQUIREMENTS.map((r) => r.key)]);

function toValues(a: Application): FormValues {
  return Object.fromEntries(TEXT_FIELDS.map((k) => [k, a[k] == null ? '' : String(a[k])]));
}

/** Only changed fields; required ones are left out while still empty so a draft can be saved half-done. */
export function applicationPatch(values: FormValues, original: FormValues): OperatorApplicationInput {
  const out: Record<string, unknown> = {};
  for (const k of TEXT_FIELDS) {
    const v = values[k].trim();
    if (v === original[k].trim()) continue;
    if (REQUIRED.has(k)) {
      if (v) out[k] = v;
    } else if (k === 'yearEstablished') out[k] = v ? Number(v) : null;
    else out[k] = v || null;
  }
  return out as OperatorApplicationInput;
}

export function ApplicationPage() {
  const queryClient = useQueryClient();
  const { refresh } = useAuth();
  const { data: app, error } = useQuery({ queryKey: ['application'], queryFn: api.application });
  if (error) return <p className="alert err">Couldn’t load your application. Reload the page.</p>;
  if (!app) return <p className="muted">Loading…</p>;
  const reload = async (next?: Application) => {
    if (next) queryClient.setQueryData(['application'], next);
    else await queryClient.invalidateQueries({ queryKey: ['application'] });
    await refresh();
  };
  return <ApplicationView key={`${app.status}-${app.submittedAt}`} app={app} reload={reload} />;
}

function ApplicationView({ app, reload }: { app: Application; reload: (next?: Application) => Promise<void> }) {
  const countries = useCountries();
  const original = toValues(app);
  const [values, setValues] = useState(original);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const status = STATUS_TEXT[app.status];
  const set = (k: string) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setValues((p) => ({ ...p, [k]: e.target.value }));
  const changed = Object.keys(applicationPatch(values, original)).length > 0;

  const save = useMutation({
    mutationFn: () => api.updateApplication(applicationPatch(values, original)),
    onSuccess: async (next) => {
      setMsg({ kind: 'ok', text: 'Saved.' });
      await reload(next);
    },
    onError: (e) => setMsg({ kind: 'err', text: errorText(e, 'Could not save. Try again.') }),
  });
  const submit = useMutation({
    mutationFn: api.submitApplication,
    onSuccess: (next) => reload(next),
    onError: (e) => setMsg({ kind: 'err', text: errorText(e, 'Could not send. Try again.') }),
  });

  const field = (k: (typeof TEXT_FIELDS)[number], label: string, opts: { hint?: string; type?: string; wide?: boolean; area?: boolean; lang?: string } = {}) => (
    <div className={`field${opts.wide ? ' wide' : ''}`}>
      <label htmlFor={k}>{label}{!NEEDED.has(k) && <span className="muted"> (optional)</span>}</label>
      {opts.area ? (
        <textarea id={k} rows={4} value={values[k]} onChange={set(k)} disabled={!app.editable} lang={opts.lang} />
      ) : (
        <input id={k} type={opts.type ?? 'text'} value={values[k]} onChange={set(k)} disabled={!app.editable} lang={opts.lang} />
      )}
      {opts.hint && <span className="hint">{opts.hint}</span>}
    </div>
  );

  return (
    <div className="stack" style={{ gap: 20 }}>
      <header className="stack" style={{ gap: 6 }}>
        <span className="eyebrow">{app.status === 'APPROVED' ? 'Verification' : 'Your application'}</span>
        <h1>{app.name}</h1>
        <p className={`alert ${status.kind}`} role="status">{status.text(app)}</p>
      </header>

      {app.status !== 'APPROVED' && app.status !== 'REJECTED' && (
        <section className="panel" aria-labelledby="todo">
          <h2 id="todo">Before you can send it</h2>
          {app.missing.length === 0 ? (
            <p>Everything we need is here.</p>
          ) : (
            <ul className="todo">
              {app.missing.map((m) => <li key={m.key}>{m.label}</li>)}
            </ul>
          )}
          {app.editable && (
            <div className="row">
              <button className="btn primary" disabled={app.missing.length > 0 || changed || submit.isPending} onClick={() => { setMsg(null); submit.mutate(); }}>
                {app.status === 'FLAGGED' ? 'Send the updated application' : 'Send for review'}
              </button>
              {changed && <span className="small muted">Save your changes first.</span>}
            </div>
          )}
        </section>
      )}

      {app.status === 'APPROVED' && app.badgeToken && <BadgeCode token={app.badgeToken} slug={app.slug} />}

      <form className="panel" onSubmit={(e) => { e.preventDefault(); setMsg(null); save.mutate(); }} noValidate aria-labelledby="details">
        <div className="spread">
          <h2 id="details">Company and licence</h2>
          {!app.editable && <span className="small muted">{app.status === 'APPROVED' ? 'To change these, contact us.' : 'Locked while we review it.'}</span>}
        </div>
        <div className="form-grid">
          {field('name', 'Company name (as travellers know it)')}
          {field('legalName', 'Registered legal name')}
          <div className="field">
            <label htmlFor="countryCode">Country</label>
            <select id="countryCode" value={values.countryCode} onChange={set('countryCode')} disabled={!app.editable}>
              {(countries.data ?? [{ code: app.countryCode, nameEn: app.country.nameEn }]).map((c) => <option key={c.code} value={c.code}>{c.nameEn}</option>)}
            </select>
          </div>
          {field('yearEstablished', 'Year established', { type: 'number' })}
          {field('licensingAuthority', 'Licensing authority')}
          {field('tourismBoardLicense', 'Tourism licence number')}
          {field('businessRegNumber', 'Business registration number')}
          {field('address', 'Physical office address', { wide: true })}
          {field('email', 'Contact email', { type: 'email' })}
          {field('phone', 'Phone', { type: 'tel' })}
          {field('websiteUrl', 'Website', { type: 'url', hint: 'Starting with https://' })}
          {field('telegramUsername', 'Telegram username')}
          {field('referenceContactName', 'Reference: name', { hint: 'A past client or partner we may ask about you' })}
          {field('referenceContactInfo', 'Reference: email or phone')}
          {field('verificationVideoUrl', 'Video of your office and vehicles', { type: 'url', wide: true, hint: 'A YouTube or Telegram link. Travellers trust operators they can see.' })}
          {field('descriptionEn', 'About your company (English)', { area: true, wide: true })}
          {field('descriptionRu', 'About your company (Russian)', { area: true, wide: true, lang: 'ru', hint: 'Shown on your public page. We can help with a translation.' })}
        </div>
        {msg && <p className={`alert ${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'}>{msg.text}</p>}
        {app.editable && <button className="btn primary" type="submit" disabled={!changed || save.isPending} style={{ justifySelf: 'start' }}>Save</button>}
      </form>

      <Documents app={app} reload={reload} />
    </div>
  );
}

function Documents({ app, reload }: { app: Application; reload: () => Promise<void> }) {
  const [type, setType] = useState<DocumentType>(app.documents.some((d) => d.type === 'TOURISM_LICENSE') ? 'BUSINESS_REGISTRATION' : 'TOURISM_LICENSE');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canUpload = app.editable || app.status === 'APPROVED';
  const upload = useMutation({
    mutationFn: () => api.uploadDocument(type, file!),
    onSuccess: async () => {
      setFile(null);
      await reload();
    },
    onError: (e) => setError(errorText(e, 'Upload failed. Try again.')),
  });
  const remove = useMutation({ mutationFn: api.removeDocument, onSuccess: () => reload(), onError: (e) => setError(errorText(e, 'Could not remove it.')) });

  function choose(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setError(f && f.size > DOCUMENT_MAX_BYTES ? 'That file is over 10 MB. Scan at a lower resolution or save as PDF.' : null);
    setFile(f && f.size <= DOCUMENT_MAX_BYTES ? f : null);
  }

  return (
    <section className="panel" aria-labelledby="docs">
      <h2 id="docs">Documents</h2>
      <p className="small muted">PDF, JPEG or PNG, up to 10 MB each. Files are encrypted and only our verification team can open them.</p>
      {app.documents.length > 0 && (
        <ul className="doclist">
          {app.documents.map((d) => (
            <li key={d.id}>
              <span>
                <strong>{DOC_LABEL[d.type]}</strong> <span className="muted small">· {d.originalFilename} · {kb(d.sizeBytes)}</span>
                {d.reviewedAt && <span className="pill ok" style={{ marginLeft: 8 }}>Checked</span>}
              </span>
              <span className="row">
                <button className="btn link" type="button" onClick={() => api.openDocument(d.id).catch(() => setError('Could not open the file.'))}>Open</button>
                {app.editable && !d.reviewedAt && <button className="btn link" type="button" onClick={() => remove.mutate(d.id)} aria-label={`Remove ${d.originalFilename}`}>Remove</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canUpload && (
        <form className="row" onSubmit={(e) => { e.preventDefault(); setError(null); upload.mutate(); }} style={{ alignItems: 'end' }}>
          <div className="field">
            <label htmlFor="doctype">Document</label>
            <select id="doctype" value={type} onChange={(e) => setType(e.target.value as DocumentType)}>
              {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{DOC_LABEL[t]}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="docfile">File</label>
            <input id="docfile" type="file" accept="application/pdf,image/jpeg,image/png" onChange={choose} />
          </div>
          <button className="btn" type="submit" disabled={!file || upload.isPending}>{upload.isPending ? 'Uploading…' : 'Upload'}</button>
        </form>
      )}
      {error && <p className="alert err" role="alert">{error}</p>}
    </section>
  );
}

function BadgeCode({ token, slug }: { token: string; slug: string }) {
  const code = `<script async src="${PUBLIC_SITE}/badge.js" data-ttp-badge="${token}" data-lang="en"></script>`;
  return (
    <section className="panel" aria-labelledby="badge">
      <h2 id="badge">Your verification badge</h2>
      <p className="small muted">
        Paste this into your own website. It links to your <a href={`${PUBLIC_SITE}/operators/${slug}`} target="_blank" rel="noopener noreferrer">verification page</a> and
        updates itself. Remove <span className="mono">data-lang="en"</span> to show it in Russian.
      </p>
      <textarea readOnly rows={3} className="mono" value={code} aria-label="Badge code" onFocus={(e) => e.currentTarget.select()} />
    </section>
  );
}

// ─── Integrations (/integrations): spreadsheet import and feed API keys ──────

const TEMPLATE = [
  'external_ref,title,title_ru,description_ru,description_en,country,duration_days,price,currency,price_basis,capacity,inclusions,exclusions,dates,published',
  'GOR-4D,Gorilla trek 4 days,Трекинг к гориллам 4 дня,"Встреча в Энтеббе, трекинг в Бвинди.",Meet in Entebbe and trek in Bwindi.,UG,4,2450,USD,per_person,6,gorilla permit | transport | lodges,flights | visa,2027-02-10/2027-02-13 | 2027-03-10/2027-03-13,yes',
].join('\r\n');

export function IntegrationsPage() {
  return (
    <div className="stack" style={{ gap: 20 }}>
      <header className="stack" style={{ gap: 6 }}>
        <span className="eyebrow">Integrations</span>
        <h1>Send us your tours in bulk</h1>
        <p className="muted">Upload a spreadsheet, or connect your own booking system to our feed API. Each tour carries your own reference, so sending it again updates it instead of adding a copy.</p>
      </header>
      <CsvImport />
      <ApiKeys />
    </div>
  );
}

function CsvImport() {
  const queryClient = useQueryClient();
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: ({ text, dryRun }: { text: string; dryRun: boolean }) => api.importCsv(text, dryRun),
    onSuccess: (r) => {
      if (r.dryRun) setPreview(r);
      else {
        setDone(r);
        setPreview(null);
        void queryClient.invalidateQueries({ queryKey: ['packages'] });
      }
    },
    onError: (e) => setError(errorText(e, 'Could not read the file.')),
  });

  async function choose(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setError(null);
    setDone(null);
    setPreview(null);
    if (!f) return;
    if (f.size > 1_000_000) return setError('The file is over 1 MB; split it into smaller files.');
    const text = await f.text();
    setCsv(text);
    setFileName(f.name);
    run.mutate({ text, dryRun: true });
  }

  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(`﻿${TEMPLATE}`)}`;
  return (
    <section className="panel" aria-labelledby="csv">
      <h2 id="csv">Spreadsheet import</h2>
      <p className="small">
        Save your sheet as CSV (Excel: File → Save As → CSV UTF-8). One row per tour. Separate several inclusions or date ranges in one cell with
        <span className="mono"> | </span>; write dates as <span className="mono">2027-02-10/2027-02-13</span>. Put <span className="mono">yes</span> in
        “published” to make a tour live (once you’re approved and it has a Russian description).
      </p>
      <div className="row">
        <a className="btn" href={template} download="tours-template.csv">Download the template</a>
        <label className="btn" htmlFor="csvfile">Choose a CSV file</label>
        <input id="csvfile" type="file" accept=".csv,text/csv" onChange={choose} className="sr-only" />
        {fileName && <span className="small muted">{fileName}</span>}
      </div>
      {error && <p className="alert err" role="alert">{error}</p>}
      {preview && (
        <>
          <p role="status">
            Checked {preview.rows.length} rows: {preview.created} new, {preview.updated} updated{preview.failed ? `, ${preview.failed} with errors` : ''}.
          </p>
          <div className="tablewrap">
            <table className="table">
              <thead><tr><th>Row</th><th>Reference</th><th>Result</th><th>Notes</th></tr></thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.row}>
                    <td className="num">{r.row}</td>
                    <td className="mono">{r.externalRef ?? '—'}</td>
                    <td>{r.action === 'error' ? <span className="pill bad">Error</span> : <span className="pill ok">{r.action === 'create' ? 'New' : 'Update'}{r.published ? ' · live' : ' · draft'}</span>}</td>
                    <td className="small">{[...r.errors, ...r.warnings].join('; ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.failed ? (
            <p className="alert info">Fix the rows with errors and choose the file again. Nothing is imported until every row is valid.</p>
          ) : (
            <button className="btn primary" style={{ justifySelf: 'start' }} disabled={run.isPending} onClick={() => run.mutate({ text: csv!, dryRun: false })}>
              Import {preview.rows.length} tours
            </button>
          )}
        </>
      )}
      {done && <p className="alert ok" role="status">Imported: {done.created} new, {done.updated} updated. <Link to="/packages">See your tours</Link></p>}
    </section>
  );
}

function ApiKeys() {
  const queryClient = useQueryClient();
  const keys = useQuery({ queryKey: ['api-keys'], queryFn: api.apiKeys });
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['api-keys'] });
  const create = useMutation({
    mutationFn: () => api.createApiKey(name.trim()),
    onSuccess: (k) => { setFresh(k.key); setName(''); void refresh(); },
    onError: (e) => setError(errorText(e, 'Could not create the key.')),
  });
  const revoke = useMutation({ mutationFn: api.revokeApiKey, onSuccess: () => refresh() });
  const base = `${window.location.origin}/api/feed/v1/packages`;

  return (
    <section className="panel" aria-labelledby="keys">
      <h2 id="keys">Feed API keys</h2>
      <p className="small">
        For your developer: <span className="mono">PUT {base}/&lt;your-ref&gt;</span> with the tour as JSON creates or updates it;{' '}
        <span className="mono">DELETE</span> takes it off sale; <span className="mono">GET {base}</span> lists your tours. Send the key as{' '}
        <span className="mono">Authorization: Bearer &lt;key&gt;</span>. Up to 120 requests a minute.
      </p>
      {fresh && (
        <div className="alert ok stack" role="status" style={{ gap: 8 }}>
          <span>Copy this key now; we don’t store it and can’t show it again.</span>
          <input readOnly className="mono" value={fresh} aria-label="New API key" onFocus={(e) => e.currentTarget.select()} />
          <pre className="copybox mono">{`curl -X PUT ${base}/GOR-4D \\
  -H "Authorization: Bearer ${fresh}" -H "Content-Type: application/json" \\
  -d '{"title":"Gorilla trek 4 days","countryCode":"UG","durationDays":4,"descriptionRu":"…","published":true}'`}</pre>
        </div>
      )}
      {keys.data && keys.data.length > 0 && (
        <ul className="doclist">
          {keys.data.map((k) => (
            <li key={k.id}>
              <span>
                <strong>{k.name}</strong> <span className="mono small muted">{k.prefix}…</span>
                <span className="small muted"> · {k.revokedAt ? `revoked ${dateEn(k.revokedAt)}` : k.lastUsedAt ? `last used ${dateEn(k.lastUsedAt)}` : 'not used yet'}</span>
              </span>
              {!k.revokedAt && <button className="btn link" onClick={() => revoke.mutate(k.id)} aria-label={`Revoke ${k.name}`}>Revoke</button>}
            </li>
          ))}
        </ul>
      )}
      <form className="row" onSubmit={(e) => { e.preventDefault(); setError(null); create.mutate(); }} style={{ alignItems: 'end' }}>
        <div className="field">
          <label htmlFor="keyname">Key name</label>
          <input id="keyname" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Website sync" />
        </div>
        <button className="btn" type="submit" disabled={name.trim().length < 2 || create.isPending}>Create key</button>
      </form>
      {error && <p className="alert err" role="alert">{error}</p>}
    </section>
  );
}
