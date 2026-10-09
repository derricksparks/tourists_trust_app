import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AdminCountry, countryCreateSchema } from '@ttp/shared-types';
import { FormEvent, useState } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { useCountries } from '../countries';

const errText = (e: unknown) => (e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.message) : 'Could not save. Try again.');

/**
 * Destinations (Phase 4, "more countries"). Add a country, fill in who licenses tour operators
 * there and where to check a licence, then switch it on: operators can then sign up from it and
 * it appears on the public site. Only super admins change this.
 */
export function CountriesPage() {
  const { admin } = useAuth();
  const canEdit = admin?.role === 'SUPER_ADMIN';
  const countries = useCountries();
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="page">
      <header className="stack" style={{ gap: 4 }}>
        <span className="eyebrow">Settings</span>
        <h1>Countries</h1>
        <p className="muted" style={{ maxWidth: '70ch' }}>
          Switched-on countries take operator sign-ups and appear on the public site. Before switching one on, add the licensing authority and
          the register where reviewers check licence numbers, and a visa guide for Russian travellers.
        </p>
      </header>
      {countries.error && <p className="alert err">Couldn’t load countries.</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Country</th><th>Russian</th><th>Licensing authority</th><th>Operators</th><th>Status</th>{canEdit && <th />}</tr>
          </thead>
          <tbody>
            {countries.data?.map((c) =>
              editing === c.code ? (
                <tr key={c.code}><td colSpan={6}><CountryForm country={c} onDone={() => setEditing(null)} /></td></tr>
              ) : (
                <tr key={c.code}>
                  <td><strong>{c.nameEn}</strong> <span className="muted mono">{c.code}</span></td>
                  <td lang="ru">{c.nameRu}{c.nameRuIn && <span className="muted"> · {c.nameRuIn}</span>}</td>
                  <td>
                    {c.licensingAuthority ?? <span className="muted">Not set</span>}
                    {c.licenceRegisterUrl && <div><a href={c.licenceRegisterUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.84rem' }}>Licence register</a></div>}
                  </td>
                  <td className="num">{c.operatorCount}</td>
                  <td><span className={`pill s-${c.active ? 'APPROVED' : 'DRAFT'}`}>{c.active ? 'On' : 'Off'}</span></td>
                  {canEdit && <td><button className="btn link" onClick={() => setEditing(c.code)} aria-label={`Edit ${c.nameEn}`}>Edit</button></td>}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      {canEdit && <section className="panel" aria-labelledby="add"><h2 id="add">Add a country</h2><CountryForm onDone={() => undefined} /></section>}
      {!canEdit && <p className="muted">Only super admins can add or change countries.</p>}
    </div>
  );
}

function CountryForm({ country, onDone }: { country?: AdminCountry; onDone: () => void }) {
  const queryClient = useQueryClient();
  const blank = { code: '', nameEn: '', nameRu: '', nameRuIn: '', licensingAuthority: '', licenceRegisterUrl: '', active: false };
  const [v, setV] = useState(country ? { ...blank, ...Object.fromEntries(Object.entries(country).map(([k, x]) => [k, x ?? ''])), active: country.active } : blank);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement>) => setV((p) => ({ ...p, [k]: k === 'active' ? e.target.checked : e.target.value }));
  const body = () => {
    const parsed = countryCreateSchema.safeParse({
      code: v.code, nameEn: v.nameEn, nameRu: v.nameRu, nameRuIn: v.nameRuIn, active: v.active,
      licensingAuthority: String(v.licensingAuthority).trim() || null, licenceRegisterUrl: String(v.licenceRegisterUrl).trim() || null,
    });
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);
    return parsed.data;
  };
  const save = useMutation({
    mutationFn: async () => {
      const { code, ...rest } = body();
      return country ? api.updateCountry(country.code, rest) : api.createCountry({ code, ...rest });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['countries'] });
      if (!country) setV(blank);
      onDone();
    },
    onError: (e) => setError(errText(e)),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setError(null); save.mutate(); };
  const id = (k: string) => `${country?.code ?? 'new'}-${k}`;
  return (
    <form onSubmit={submit} className="stack" style={{ gap: 12 }} aria-label={country ? `Edit ${country.nameEn}` : 'New country'}>
      <div className="form-grid">
        {!country && <div className="field"><label htmlFor={id('code')}>ISO code</label><input id={id('code')} value={v.code} onChange={set('code')} maxLength={2} placeholder="ZM" /></div>}
        <div className="field"><label htmlFor={id('nameEn')}>Name (English)</label><input id={id('nameEn')} value={v.nameEn} onChange={set('nameEn')} /></div>
        <div className="field"><label htmlFor={id('nameRu')}>Name (Russian)</label><input id={id('nameRu')} lang="ru" value={v.nameRu} onChange={set('nameRu')} placeholder="Замбия" /></div>
        <div className="field"><label htmlFor={id('nameRuIn')}>Russian “in …”</label><input id={id('nameRuIn')} lang="ru" value={v.nameRuIn} onChange={set('nameRuIn')} placeholder="в Замбии" /><span className="hint">Used in page titles: “Туроператоры в Замбии”.</span></div>
        <div className="field"><label htmlFor={id('auth')}>Licensing authority</label><input id={id('auth')} value={String(v.licensingAuthority)} onChange={set('licensingAuthority')} /></div>
        <div className="field"><label htmlFor={id('reg')}>Licence register (link)</label><input id={id('reg')} type="url" value={String(v.licenceRegisterUrl)} onChange={set('licenceRegisterUrl')} placeholder="https://" /></div>
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={v.active} onChange={set('active')} /> Switched on (takes sign-ups, shown on the site)
      </label>
      {error && <p className="alert err" role="alert">{error}</p>}
      <div className="row-wrap">
        <button className="btn primary" type="submit" disabled={save.isPending}>{country ? 'Save' : 'Add country'}</button>
        {country && <button className="btn" type="button" onClick={onDone}>Cancel</button>}
      </div>
    </form>
  );
}
