import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { insurerCreateSchema, insurerUpdateSchema } from '@ttp/shared-types';
import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, Insurer } from '../api';
import { useCanEditContent } from '../auth';
import { StatusPill } from '../components/StatusPill';
import { countryName, formatDate } from '../format';
import { useActiveCountryCodes } from '../countries';

const PUBLIC_SITE = (import.meta.env.VITE_PUBLIC_SITE_URL ?? 'http://localhost:3001').replace(/\/$/, '');

/** Insurer comparison data (IN-1, IN-2), kept by content editors after calling each insurer. */
export function InsurersPage() {
  const canEdit = useCanEditContent();
  const list = useQuery({ queryKey: ['insurers'], queryFn: api.insurers });
  return (
    <div className="page">
      <header className="spread">
        <div className="stack" style={{ gap: 4 }}>
          <span className="eyebrow">Concierge</span>
          <h1>Insurers</h1>
          <p className="muted" style={{ maxWidth: '70ch' }}>
            The comparison table on the <a href={`${PUBLIC_SITE}/insurance`} target="_blank" rel="noopener noreferrer">insurance page</a>. Call each
            insurer to confirm they really pay claims and repatriate from these countries, then tick “verified”. We never sell policies.
          </p>
        </div>
        {canEdit && <Link to="/insurers/new" className="btn primary">New</Link>}
      </header>
      {list.error && <p className="alert err">Couldn’t load insurers.</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Insurer</th>
              <th>Countries</th>
              <th>Repatriation</th>
              <th>Last verified</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.map((i) => (
              <tr key={i.id}>
                <td><Link className="title" to={`/insurers/${i.id}`}>{i.name}</Link>{i.nameRu && <div className="muted" style={{ fontSize: '0.84rem' }} lang="ru">{i.nameRu}</div>}</td>
                <td>{i.countriesCovered.join(', ')}</td>
                <td>{i.repatriationConfirmed ? 'Confirmed' : <span className="muted">Not confirmed</span>}</td>
                <td className="num">{i.verifiedAt ? formatDate(i.verifiedAt) : <span className="muted">Never</span>}</td>
                <td><StatusPill status={i.published ? 'PUBLISHED' : 'DRAFT'} label={i.published ? 'Published' : 'Hidden'} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data?.length === 0 && <p className="empty">No insurers yet.</p>}
      </div>
    </div>
  );
}

const empty = { name: '', nameRu: '', websiteUrl: '', countriesCovered: ['UG', 'TZ', 'KE'], claimsContact: '', repatriationConfirmed: false, coverageRu: '', exclusionsRu: '', medicalLimitInfo: '', notes: '', published: false };

export function InsurerFormPage() {
  const COUNTRIES = useActiveCountryCodes();
  const { id } = useParams();
  const editing = !!id;
  const canEdit = useCanEditContent();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const existing = useQuery({ queryKey: ['insurer', id], queryFn: () => api.insurer(id!), enabled: editing });
  const [v, setV] = useState(empty);
  const [verified, setVerified] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [formError, setFormError] = useState<string | null>(null);
  useEffect(() => {
    const i = existing.data;
    if (i) setV({ ...empty, ...Object.fromEntries(Object.entries(i).map(([k, val]) => [k, val ?? ''])), countriesCovered: i.countriesCovered, repatriationConfirmed: i.repatriationConfirmed, published: i.published } as typeof empty);
  }, [existing.data]);

  const payload = () => {
    const blankToNull = (s: string) => s.trim() || null;
    return {
      name: v.name, claimsContact: v.claimsContact, countriesCovered: v.countriesCovered, repatriationConfirmed: v.repatriationConfirmed, published: v.published,
      nameRu: blankToNull(v.nameRu), websiteUrl: blankToNull(v.websiteUrl), coverageRu: blankToNull(v.coverageRu), exclusionsRu: blankToNull(v.exclusionsRu),
      medicalLimitInfo: blankToNull(v.medicalLimitInfo), notes: blankToNull(v.notes), ...(verified && { factsVerified: true }),
    };
  };
  const save = useMutation({
    mutationFn: () => (editing ? api.updateInsurer(id!, insurerUpdateSchema.parse(payload())) : api.createInsurer(insurerCreateSchema.parse(payload()))),
    onSuccess: (i: Insurer) => {
      void queryClient.invalidateQueries({ queryKey: ['insurers'] });
      queryClient.setQueryData(['insurer', i.id], i);
      navigate('/insurers');
    },
    onError: (e) => setFormError(e instanceof ApiError ? e.message : 'Couldn’t save. Try again.'),
  });

  if (editing && existing.isLoading) return <p className="muted">Loading…</p>;
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => {
    setV((p) => ({ ...p, [k]: val }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };
  function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = insurerCreateSchema.safeParse(payload());
    if (!parsed.success) {
      const out: Record<string, string> = {};
      for (const i of parsed.error.issues) out[String(i.path[0])] ??= /url/i.test(i.message) ? 'Enter a full web address starting with https://' : i.path[0] === 'countriesCovered' ? 'Tick at least one country.' : 'Fill this in.';
      setErrors(out);
      return setFormError('Some fields need fixing.');
    }
    save.mutate();
  }
  const text = (k: 'name' | 'nameRu' | 'websiteUrl' | 'claimsContact' | 'medicalLimitInfo', label: string, hint?: string, lang?: string) => (
    <div className="field">
      <label htmlFor={k}>{label}</label>
      <input id={k} lang={lang} value={v[k]} onChange={(e) => set(k, e.target.value)} aria-invalid={!!errors[k]} />
      {hint && !errors[k] && <span className="hint">{hint}</span>}
      {errors[k] && <span className="error">{errors[k]}</span>}
    </div>
  );
  const area = (k: 'coverageRu' | 'exclusionsRu' | 'notes', label: string, hint: string, lang?: string) => (
    <div className="field wide">
      <label htmlFor={k}>{label}</label>
      <textarea id={k} lang={lang} rows={3} value={v[k]} onChange={(e) => set(k, e.target.value)} />
      <span className="hint">{hint}</span>
    </div>
  );

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <header className="stack" style={{ gap: 6 }}>
        <Link to="/insurers" className="muted" style={{ fontSize: '0.88rem' }}>← Insurers</Link>
        <h1>{editing ? v.name || 'Insurer' : 'New insurer'}</h1>
      </header>
      <form className="stack" onSubmit={submit} noValidate>
        <section className="panel">
          <fieldset>
            <legend>Insurer</legend>
            <div className="form-grid">
              {text('name', 'Name')}
              {text('nameRu', 'Name in Russian', undefined, 'ru')}
              {text('websiteUrl', 'Website')}
              {text('claimsContact', 'Claims contact', 'Phone or email a traveller should use when something happens.')}
              {text('medicalLimitInfo', 'Medical limit (shown as written)', 'e.g. до 50 000 €', 'ru')}
              <div className="field">
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Pays claims in</span>
                <div className="row-wrap" role="group" aria-label="Pays claims in">
                  {COUNTRIES.map((c) => (
                    <label key={c} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input type="checkbox" style={{ width: 'auto' }} checked={v.countriesCovered.includes(c)} onChange={(e) => set('countriesCovered', e.target.checked ? [...v.countriesCovered, c] : v.countriesCovered.filter((x) => x !== c))} />
                      {countryName(c)}
                    </label>
                  ))}
                </div>
                {errors.countriesCovered && <span className="error">{errors.countriesCovered}</span>}
              </div>
              <label className="field" style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 500 }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={v.repatriationConfirmed} onChange={(e) => set('repatriationConfirmed', e.target.checked)} />
                Repatriation confirmed by the insurer
              </label>
              {area('coverageRu', 'What it covers (Russian)', 'Comparison column.', 'ru')}
              {area('exclusionsRu', 'Exclusions (Russian)', 'Comparison column: what travellers often assume is covered but isn’t.', 'ru')}
              {area('notes', 'Internal notes', 'Never shown publicly: who you spoke to and when.')}
            </div>
          </fieldset>
        </section>
        <section className="panel">
          <fieldset>
            <legend>Publishing</legend>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={v.published} onChange={(e) => set('published', e.target.checked)} /> Show on the insurance page
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={verified} onChange={(e) => setVerified(e.target.checked)} /> I confirmed claims and repatriation with the insurer today
            </label>
            {existing.data?.verifiedAt && <span className="hint">Last verified {formatDate(existing.data.verifiedAt)}{existing.data.verifiedBy ? ` by ${existing.data.verifiedBy.name}` : ''}.</span>}
          </fieldset>
        </section>
        {formError && <p className="alert err" role="alert">{formError}</p>}
        {!canEdit && <p className="alert info">Only content editors can change insurers.</p>}
        <div className="row-wrap">
          <button className="btn primary" type="submit" disabled={save.isPending || !canEdit}>{save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create'}</button>
          <Link className="btn" to="/insurers">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
