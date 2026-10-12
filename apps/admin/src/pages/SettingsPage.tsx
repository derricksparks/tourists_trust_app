import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminSiteSettings, DEFAULT_DISCLAIMERS, SiteSettingsUpdateInput } from '@ttp/shared-types';
import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth, useCanModerate } from '../auth';
import { formatDate } from '../format';

const PUBLIC_SITE = (import.meta.env.VITE_PUBLIC_SITE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const errText = (e: unknown) => (e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.message) : 'Could not save. Try again.');

/**
 * Pilot round: wording and limits a super admin changes without a code change. The disclaimers
 * appear on the public visa and insurance pages (so a lawyer's text can be pasted in); the
 * retention period decides which operators' licence copies are due for deletion.
 */
export function SettingsPage() {
  const { admin } = useAuth();
  const canEdit = admin?.role === 'SUPER_ADMIN';
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <header className="stack" style={{ gap: 4 }}>
        <span className="eyebrow">Platform</span>
        <h1>Settings</h1>
        <p className="muted" style={{ maxWidth: '70ch' }}>
          Disclaimer wording on the public site and how long operators’ licence copies are kept. {canEdit ? 'Changes are recorded with your name.' : 'Only super admins can change these.'}
        </p>
      </header>
      {settings.error && <p className="alert err">Couldn’t load settings.</p>}
      {settings.data && (
        <>
          <DisclaimersForm data={settings.data} canEdit={canEdit} />
          <RetentionPanel data={settings.data} canEdit={canEdit} />
        </>
      )}
    </div>
  );
}

function DisclaimersForm({ data, canEdit }: { data: AdminSiteSettings; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [visa, setVisa] = useState(data.disclaimerVisa);
  const [insurance, setInsurance] = useState(data.disclaimerInsurance);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    setVisa(data.disclaimerVisa);
    setInsurance(data.disclaimerInsurance);
  }, [data.disclaimerVisa, data.disclaimerInsurance]);
  const save = useMutation({
    mutationFn: (body: SiteSettingsUpdateInput) => api.updateSettings(body),
    onSuccess: (s) => {
      queryClient.setQueryData(['settings'], s);
      setMsg({ ok: true, text: 'Saved. The public pages update within a minute.' });
    },
    onError: (e) => setMsg({ ok: false, text: errText(e) }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    save.mutate({ disclaimerVisa: visa, disclaimerInsurance: insurance });
  };
  const updated = (key: string) => data.updated.find((u) => u.key === key);
  const box = (id: string, label: string, value: string, set: (v: string) => void, isDefault: boolean, key: string, kind: keyof typeof DEFAULT_DISCLAIMERS, page: string) => {
    const u = updated(key);
    return (
      <div className="field wide">
        <label htmlFor={id}>{label}</label>
        <textarea id={id} lang="ru" rows={5} value={value} readOnly={!canEdit} onChange={(e) => set(e.target.value)} />
        <span className="hint">
          {isDefault ? 'Standard wording, not reviewed by a lawyer.' : u ? `Changed ${formatDate(u.at)}${u.by ? ` by ${u.by}` : ''}.` : ''} Shown on{' '}
          <a href={`${PUBLIC_SITE}${page}`} target="_blank" rel="noopener noreferrer">{page}</a>. A blank line starts a new paragraph.{' '}
          {canEdit && value !== DEFAULT_DISCLAIMERS[kind] && <button type="button" className="btn link" onClick={() => set(DEFAULT_DISCLAIMERS[kind])}>Use the standard wording</button>}
        </span>
      </div>
    );
  };
  return (
    <form className="panel" onSubmit={submit} aria-labelledby="disc">
      <h2 id="disc">Disclaimers</h2>
      <div className="form-grid">
        {box('disclaimerVisa', 'Visa pages (Russian)', visa, setVisa, data.disclaimerVisaIsDefault, 'disclaimer.visa', 'visa', '/visa')}
        {box('disclaimerInsurance', 'Insurance page (Russian)', insurance, setInsurance, data.disclaimerInsuranceIsDefault, 'disclaimer.insurance', 'insurance', '/insurance')}
      </div>
      {msg && <p className={`alert ${msg.ok ? 'ok' : 'err'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
      {canEdit && (
        <div className="row-wrap">
          <button className="btn primary" type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save disclaimers'}</button>
        </div>
      )}
    </form>
  );
}

function RetentionPanel({ data, canEdit }: { data: AdminSiteSettings; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const canModerate = useCanModerate();
  const [days, setDays] = useState(data.documentRetentionDays?.toString() ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const due = useQuery({ queryKey: ['retention-due'], queryFn: api.retentionDue, enabled: canModerate });
  const save = useMutation({
    mutationFn: () => api.updateSettings({ documentRetentionDays: days.trim() ? Number(days) : null }),
    onSuccess: (s) => {
      queryClient.setQueryData(['settings'], s);
      void queryClient.invalidateQueries({ queryKey: ['retention-due'] });
      setMsg({ ok: true, text: 'Saved.' });
    },
    onError: (e) => setMsg({ ok: false, text: errText(e) }),
  });
  const purge = useMutation({
    mutationFn: api.purgeRetention,
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['retention-due'] });
      setMsg({ ok: true, text: `Deleted ${r.deleted} file${r.deleted === 1 ? '' : 's'}. Each is recorded in the operator’s history.` });
    },
    onError: (e) => setMsg({ ok: false, text: errText(e) }),
  });
  const list = due.data?.documents ?? [];
  return (
    <section className="panel" aria-labelledby="ret">
      <h2 id="ret">Licence copies</h2>
      <p className="muted" style={{ fontSize: '0.9rem', maxWidth: '75ch' }}>
        Operators’ licence and registration files are kept encrypted. Set how many days after upload a file may be kept; files older than that are listed here
        for deletion. Nothing is deleted automatically. Deleting erases the file but keeps a note that it existed, whether it was checked, and who deleted it.
        You can also delete a single file from the operator’s page.
      </p>
      <form className="row-wrap" onSubmit={(e) => { e.preventDefault(); setMsg(null); save.mutate(); }}>
        <label htmlFor="retention" style={{ fontWeight: 600, fontSize: '0.9rem' }}>Keep for</label>
        <input id="retention" type="number" min={30} max={3650} inputMode="numeric" placeholder="no limit" value={days} readOnly={!canEdit} onChange={(e) => setDays(e.target.value)} style={{ width: 120 }} />
        <span>days after upload</span>
        {canEdit && <button className="btn" type="submit" disabled={save.isPending}>Save</button>}
      </form>
      <span className="hint muted" style={{ fontSize: '0.8rem' }}>Between 30 and 3650 days. Leave empty to keep files until someone deletes them. Ask your lawyer what period to use.</span>
      {canModerate && data.documentRetentionDays && (
        <>
          <h3>Past the retention period ({list.length})</h3>
          {list.length === 0 ? (
            <p className="muted">None.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Operator</th><th>File</th><th>Uploaded</th><th>Checked</th></tr></thead>
                <tbody>
                  {list.map((d) => (
                    <tr key={d.id}>
                      <td><Link className="title" to={`/operators/${d.operator.id}`}>{d.operator.name}</Link></td>
                      <td>{d.originalFilename}</td>
                      <td className="num">{formatDate(d.createdAt)}</td>
                      <td className="num">{d.reviewedAt ? formatDate(d.reviewedAt) : <span className="muted">Not checked</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {canEdit && list.length > 0 && (
            <button className="btn danger" style={{ justifySelf: 'start' }} disabled={purge.isPending} onClick={() => { if (window.confirm(`Delete ${list.length} file(s)? This cannot be undone.`)) purge.mutate(); }}>
              Delete these {list.length} files
            </button>
          )}
        </>
      )}
      {msg && <p className={`alert ${msg.ok ? 'ok' : 'err'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
    </section>
  );
}
