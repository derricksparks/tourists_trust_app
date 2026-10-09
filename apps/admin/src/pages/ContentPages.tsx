import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChecklistItem,
  CONTENT_STATUSES,
  ContentStatus,
  destinationGuideCreateSchema,
  destinationGuideUpdateSchema,
  GUIDE_KINDS,
  GuideKind,
  visaGuideCreateSchema,
  visaGuideUpdateSchema,
} from '@ttp/shared-types';
import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { api, ApiError, DestinationGuide, VisaGuide } from '../api';
import { useCanEditContent } from '../auth';
import { StatusPill } from '../components/StatusPill';
import { countryName, formatDate } from '../format';

const PUBLIC_SITE = (import.meta.env.VITE_PUBLIC_SITE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const KIND_LABEL: Record<GuideKind, string> = { DESTINATION: 'What to see', LOGISTICS: 'How to get there' };
const OPERATOR_COUNTRIES = ['UG', 'TZ', 'KE', 'RW'];

// ─── Lists ───────────────────────────────────────────────────────────────────

export function VisaGuidesPage() {
  const list = useQuery({ queryKey: ['visa-guides'], queryFn: api.visaGuides });
  return (
    <ContentList
      eyebrow="Concierge"
      title="Visa guides"
      intro="Step-by-step visa instructions and document checklists on the public site. Re-check the facts against the official site regularly; readers see the date you last did."
      newHref="/visa-guides/new"
      loading={list.isLoading}
      error={!!list.error}
      rows={list.data?.map((g) => ({
        id: g.id,
        href: `/visa-guides/${g.id}`,
        title: g.titleRu,
        detail: `${g.visaType} · ${g.coveredCountries.map(countryName).join(', ')}`,
        status: g.status,
        checked: g.lastUpdated,
        publicHref: `${PUBLIC_SITE}/visa/${g.slug}`,
      }))}
    />
  );
}

export function GuidesPage() {
  const list = useQuery({ queryKey: ['guides'], queryFn: api.guides });
  return (
    <ContentList
      eyebrow="Concierge"
      title="Travel guides"
      intro="Destination overviews and “how to get there” articles: routings, layover visas, seasons. Kept by hand; readers see the date you last checked them."
      newHref="/guides/new"
      loading={list.isLoading}
      error={!!list.error}
      rows={list.data?.map((g) => ({
        id: g.id,
        href: `/guides/${g.id}`,
        title: g.titleRu,
        detail: `${KIND_LABEL[g.kind]} · ${countryName(g.countryCode)}`,
        status: g.status,
        checked: g.lastUpdated,
        publicHref: `${PUBLIC_SITE}/guides/${g.slug}`,
      }))}
    />
  );
}

interface Row {
  id: string;
  href: string;
  title: string;
  detail: string;
  status: ContentStatus;
  checked: string;
  publicHref: string;
}

function ContentList(props: { eyebrow: string; title: string; intro: string; newHref: string; loading: boolean; error: boolean; rows?: Row[] }) {
  const canEdit = useCanEditContent();
  return (
    <div className="page">
      <header className="spread">
        <div className="stack" style={{ gap: 4 }}>
          <span className="eyebrow">{props.eyebrow}</span>
          <h1>{props.title}</h1>
          <p className="muted" style={{ maxWidth: '70ch' }}>{props.intro}</p>
        </div>
        {canEdit && <Link to={props.newHref} className="btn primary">New</Link>}
      </header>
      {props.error && <p className="alert err">Couldn’t load. Reload the page to try again.</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Status</th>
              <th>Facts checked</th>
              <th className="hide-narrow">On the site</th>
            </tr>
          </thead>
          <tbody>
            {props.rows?.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link className="title" to={r.href} lang="ru">{r.title}</Link>
                  <div className="muted" style={{ fontSize: '0.84rem' }}>{r.detail}</div>
                </td>
                <td><StatusPill status={r.status} /></td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>{formatDate(r.checked)}</td>
                <td className="hide-narrow">
                  {r.status === 'PUBLISHED' ? <a href={r.publicHref} target="_blank" rel="noopener noreferrer">Open</a> : <span className="muted">Not public</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {props.rows?.length === 0 && <p className="empty">Nothing yet. Use “New” to write the first one.</p>}
        {props.loading && <p className="empty">Loading…</p>}
      </div>
    </div>
  );
}

// ─── Shared form pieces ──────────────────────────────────────────────────────

type Errors = Record<string, string | undefined>;

function Field({ id, label, hint, error, wide, children }: { id: string; label: string; hint?: string; error?: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`field ${wide ? 'wide' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="error" id={`${id}-error`}>{error}</span>}
    </div>
  );
}

function issuesToErrors(issues: z.ZodIssue[]): Errors {
  const out: Errors = {};
  for (const i of issues) {
    const key = i.path.join('.');
    out[key] ??= /required|at least 1|received undefined/i.test(i.message) ? 'Fill this in.' : /url/i.test(i.message) ? 'Enter a full web address starting with https://' : i.message;
  }
  return out;
}

function useSave<T>(save: () => Promise<T>, onDone: (t: T) => void) {
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: save,
    onSuccess: onDone,
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors.length) {
        setErrors(Object.fromEntries(e.fieldErrors.map((f) => [f.path, f.message])));
        setFormError('Some fields need fixing.');
      } else setFormError(e instanceof ApiError ? e.message : 'Couldn’t save. Try again.');
    },
  });
  return { errors, setErrors, formError, setFormError, m };
}

function PublishControls(props: { id: string; status: ContentStatus; onStatus: (s: ContentStatus) => void; verified: boolean; onVerified: (v: boolean) => void; lastChecked?: string }) {
  return (
    <section className="panel">
      <fieldset>
        <legend>Publishing</legend>
        <div className="form-grid">
          <Field id={`${props.id}-status`} label="Status" hint="Only published pages appear on the site.">
            <select id={`${props.id}-status`} value={props.status} onChange={(e) => props.onStatus(e.target.value as ContentStatus)}>
              {CONTENT_STATUSES.map((s) => <option key={s} value={s}>{s === 'DRAFT' ? 'Draft' : 'Published'}</option>)}
            </select>
          </Field>
          <div className="field" style={{ alignContent: 'end' }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 500 }}>
              <input type="checkbox" checked={props.verified} onChange={(e) => props.onVerified(e.target.checked)} style={{ width: 'auto' }} />
              I checked these facts against the official source today
            </label>
            <span className="hint">{props.lastChecked ? `Readers currently see “checked ${formatDate(props.lastChecked)}”.` : 'Publishing also sets today’s date.'}</span>
          </div>
        </div>
      </fieldset>
    </section>
  );
}

function FormShell({ back, backLabel, title, children, onSubmit, saving, formError, editing }: { back: string; backLabel: string; title: string; children: ReactNode; onSubmit: (e: FormEvent) => void; saving: boolean; formError: string | null; editing: boolean }) {
  const canEdit = useCanEditContent();
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <header className="stack" style={{ gap: 6 }}>
        <Link to={back} className="muted" style={{ fontSize: '0.88rem' }}>← {backLabel}</Link>
        <h1 lang="ru">{title}</h1>
      </header>
      <form className="stack" onSubmit={onSubmit} noValidate>
        {children}
        {formError && <p className="alert err" role="alert">{formError}</p>}
        {!canEdit && <p className="alert info">Only content editors can change guides.</p>}
        <div className="row-wrap">
          <button className="btn primary" type="submit" disabled={saving || !canEdit}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create'}</button>
          <Link className="btn" to={back}>Cancel</Link>
        </div>
      </form>
    </div>
  );
}

const slugHint = 'The web address: lowercase latin letters, digits and hyphens, e.g. uganda-evisa. Changing it breaks existing links.';

// ─── Visa guide form ─────────────────────────────────────────────────────────

const emptyVisa = { slug: '', countryCode: 'UG', coveredCountries: ['UG'], visaType: '', titleRu: '', requirementsRu: '', checklistItems: [] as ChecklistItem[], officialUrl: '', feeInfo: '', processingTime: '', status: 'DRAFT' as ContentStatus };

export function VisaGuideFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const existing = useQuery({ queryKey: ['visa-guide', id], queryFn: () => api.visaGuide(id!), enabled: editing });
  const [v, setV] = useState(emptyVisa);
  const [verified, setVerified] = useState(false);
  useEffect(() => {
    const g = existing.data;
    if (g) setV({ ...g, officialUrl: g.officialUrl ?? '', feeInfo: g.feeInfo ?? '', processingTime: g.processingTime ?? '' });
  }, [existing.data]);

  const payload = () => ({
    ...v,
    officialUrl: v.officialUrl.trim() || null,
    feeInfo: v.feeInfo.trim() || null,
    processingTime: v.processingTime.trim() || null,
    ...(verified && { factsVerified: true }),
  });
  const { errors, setErrors, formError, setFormError, m } = useSave(
    () => (editing ? api.updateVisaGuide(id!, visaGuideUpdateSchema.parse(payload())) : api.createVisaGuide(visaGuideCreateSchema.parse(payload()))),
    (g: VisaGuide) => {
      void queryClient.invalidateQueries({ queryKey: ['visa-guides'] });
      queryClient.setQueryData(['visa-guide', g.id], g);
      navigate('/visa-guides');
    },
  );

  if (editing && existing.isLoading) return <p className="muted">Loading…</p>;
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => {
    setV((p) => ({ ...p, [k]: val }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = visaGuideCreateSchema.safeParse(payload());
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      setFormError('Some fields need fixing.');
      return;
    }
    m.mutate();
  }

  const items = v.checklistItems;
  const setItem = (i: number, patch: Partial<ChecklistItem>) => set('checklistItems', items.map((it, j) => (j === i ? { ...it, ...patch } : it)));

  return (
    <FormShell back="/visa-guides" backLabel="Visa guides" title={editing ? v.titleRu || 'Visa guide' : 'New visa guide'} onSubmit={submit} saving={m.isPending} formError={formError} editing={editing}>
      <section className="panel">
        <fieldset>
          <legend>The visa</legend>
          <div className="form-grid">
            <Field id="titleRu" label="Title (Russian)" error={errors.titleRu} wide>
              <input id="titleRu" lang="ru" value={v.titleRu} onChange={(e) => set('titleRu', e.target.value)} aria-invalid={!!errors.titleRu} />
            </Field>
            <Field id="visaType" label="Visa type" hint="e.g. eVisa, eTA, East African Tourist Visa" error={errors.visaType}>
              <input id="visaType" value={v.visaType} onChange={(e) => set('visaType', e.target.value)} aria-invalid={!!errors.visaType} />
            </Field>
            <Field id="slug" label="Web address" hint={slugHint} error={errors.slug}>
              <input id="slug" value={v.slug} onChange={(e) => set('slug', e.target.value)} aria-invalid={!!errors.slug} />
            </Field>
            <Field id="countryCode" label="Listed under" hint="The country page this guide appears on.">
              <select id="countryCode" value={v.countryCode} onChange={(e) => set('countryCode', e.target.value)}>
                {OPERATOR_COUNTRIES.map((c) => <option key={c} value={c}>{countryName(c)}</option>)}
              </select>
            </Field>
            <div className="field">
              <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Valid for</span>
              <div className="row-wrap" role="group" aria-label="Valid for">
                {OPERATOR_COUNTRIES.map((c) => (
                  <label key={c} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input type="checkbox" style={{ width: 'auto' }} checked={v.coveredCountries.includes(c)}
                      onChange={(e) => set('coveredCountries', e.target.checked ? [...v.coveredCountries, c] : v.coveredCountries.filter((x) => x !== c))} />
                    {countryName(c)}
                  </label>
                ))}
              </div>
              {errors.coveredCountries && <span className="error">Tick at least one country.</span>}
            </div>
            <Field id="officialUrl" label="Official application site" error={errors.officialUrl}>
              <input id="officialUrl" type="url" value={v.officialUrl} onChange={(e) => set('officialUrl', e.target.value)} aria-invalid={!!errors.officialUrl} />
            </Field>
            <Field id="processingTime" label="Processing time (Russian)">
              <input id="processingTime" lang="ru" value={v.processingTime} onChange={(e) => set('processingTime', e.target.value)} />
            </Field>
            <Field id="feeInfo" label="Fee, as shown to readers" hint="Display only, e.g. “USD 50”. We never take payment.">
              <input id="feeInfo" value={v.feeInfo} onChange={(e) => set('feeInfo', e.target.value)} />
            </Field>
            <Field id="requirementsRu" label="Instructions (Russian)" hint="Formatting: ## heading, - list, 1. numbered list, **bold**, [link](https://…)" error={errors.requirementsRu} wide>
              <textarea id="requirementsRu" lang="ru" rows={12} value={v.requirementsRu} onChange={(e) => set('requirementsRu', e.target.value)} aria-invalid={!!errors.requirementsRu} />
            </Field>
          </div>
        </fieldset>
      </section>

      <section className="panel">
        <fieldset>
          <legend>Document checklist</legend>
          <p className="muted" style={{ fontSize: '0.88rem' }}>Readers tick these off on the guide page. Optional items are labelled “if required”.</p>
          {items.map((it, i) => (
            <div key={i} className="row-wrap" style={{ alignItems: 'end' }}>
              <Field id={`item-${i}-label`} label={`Item ${i + 1} (Russian)`} error={errors[`checklistItems.${i}.labelRu`]}>
                <input id={`item-${i}-label`} lang="ru" value={it.labelRu} onChange={(e) => setItem(i, { labelRu: e.target.value })} style={{ minWidth: 260 }} />
              </Field>
              <Field id={`item-${i}-key`} label="Key" error={errors[`checklistItems.${i}.key`]}>
                <input id={`item-${i}-key`} value={it.key} onChange={(e) => setItem(i, { key: e.target.value })} style={{ width: 150 }} />
              </Field>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', paddingBottom: 10 }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={it.required} onChange={(e) => setItem(i, { required: e.target.checked })} /> Required
              </label>
              <button type="button" className="btn" onClick={() => set('checklistItems', items.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn" style={{ justifySelf: 'start' }} onClick={() => set('checklistItems', [...items, { key: `item_${items.length + 1}`, labelRu: '', required: true }])}>
            Add item
          </button>
        </fieldset>
      </section>

      <PublishControls id="visa" status={v.status} onStatus={(s) => set('status', s)} verified={verified} onVerified={setVerified} lastChecked={existing.data?.lastUpdated} />
    </FormShell>
  );
}

// ─── Destination / logistics guide form ──────────────────────────────────────

const emptyGuide = { slug: '', countryCode: 'UG', kind: 'LOGISTICS' as GuideKind, titleRu: '', summaryRu: '', bodyRu: '', status: 'DRAFT' as ContentStatus };

export function GuideFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const existing = useQuery({ queryKey: ['guide', id], queryFn: () => api.guide(id!), enabled: editing });
  const [g, setG] = useState(emptyGuide);
  const [verified, setVerified] = useState(false);
  useEffect(() => {
    const d = existing.data;
    if (d) setG({ slug: d.slug, countryCode: d.countryCode, kind: d.kind, titleRu: d.titleRu, summaryRu: d.summaryRu ?? '', bodyRu: d.bodyRu, status: d.status });
  }, [existing.data]);

  const payload = () => ({ ...g, summaryRu: g.summaryRu.trim() || null, ...(verified && { factsVerified: true }) });
  const { errors, setErrors, formError, setFormError, m } = useSave(
    () => (editing ? api.updateGuide(id!, destinationGuideUpdateSchema.parse(payload())) : api.createGuide(destinationGuideCreateSchema.parse(payload()))),
    (d: DestinationGuide) => {
      void queryClient.invalidateQueries({ queryKey: ['guides'] });
      queryClient.setQueryData(['guide', d.id], d);
      navigate('/guides');
    },
  );

  if (editing && existing.isLoading) return <p className="muted">Loading…</p>;
  const set = <K extends keyof typeof g>(k: K, val: (typeof g)[K]) => {
    setG((p) => ({ ...p, [k]: val }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = destinationGuideCreateSchema.safeParse(payload());
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      setFormError('Some fields need fixing.');
      return;
    }
    m.mutate();
  }

  return (
    <FormShell back="/guides" backLabel="Travel guides" title={editing ? g.titleRu || 'Guide' : 'New travel guide'} onSubmit={submit} saving={m.isPending} formError={formError} editing={editing}>
      <section className="panel">
        <fieldset>
          <legend>Article</legend>
          <div className="form-grid">
            <Field id="titleRu" label="Title (Russian)" error={errors.titleRu} wide>
              <input id="titleRu" lang="ru" value={g.titleRu} onChange={(e) => set('titleRu', e.target.value)} aria-invalid={!!errors.titleRu} />
            </Field>
            <Field id="kind" label="Type">
              <select id="kind" value={g.kind} onChange={(e) => set('kind', e.target.value as GuideKind)}>
                {GUIDE_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
            </Field>
            <Field id="countryCode" label="Country">
              <select id="countryCode" value={g.countryCode} onChange={(e) => set('countryCode', e.target.value)}>
                {OPERATOR_COUNTRIES.map((c) => <option key={c} value={c}>{countryName(c)}</option>)}
              </select>
            </Field>
            <Field id="slug" label="Web address" hint={slugHint} error={errors.slug} wide>
              <input id="slug" value={g.slug} onChange={(e) => set('slug', e.target.value)} aria-invalid={!!errors.slug} />
            </Field>
            <Field id="summaryRu" label="One-line summary (Russian)" hint="Shown on the list of guides." wide>
              <input id="summaryRu" lang="ru" value={g.summaryRu} onChange={(e) => set('summaryRu', e.target.value)} />
            </Field>
            <Field id="bodyRu" label="Text (Russian)" hint="Formatting: ## heading, - list, 1. numbered list, **bold**, [link](https://…)" error={errors.bodyRu} wide>
              <textarea id="bodyRu" lang="ru" rows={16} value={g.bodyRu} onChange={(e) => set('bodyRu', e.target.value)} aria-invalid={!!errors.bodyRu} />
            </Field>
          </div>
        </fieldset>
      </section>
      <PublishControls id="guide" status={g.status} onStatus={(s) => set('status', s)} verified={verified} onVerified={setVerified} lastChecked={existing.data?.lastUpdated} />
    </FormShell>
  );
}
