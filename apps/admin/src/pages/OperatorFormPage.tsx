import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { operatorCreateSchema, operatorUpdateSchema } from '@ttp/shared-types';
import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, Operator } from '../api';
import { useCanModerate } from '../auth';
import { useCountries } from '../countries';


const FIELDS = [
  'name', 'legalName', 'countryCode', 'licensingAuthority', 'tourismBoardLicense', 'businessRegNumber', 'address',
  'yearEstablished', 'referenceContactName', 'referenceContactInfo', 'websiteUrl', 'email', 'phone', 'telegramUsername',
  'verificationVideoUrl', 'descriptionRu', 'descriptionEn',
] as const;
type Field = (typeof FIELDS)[number];
type Values = Record<Field, string>;
const REQUIRED: Field[] = ['name', 'countryCode', 'licensingAuthority', 'tourismBoardLicense', 'businessRegNumber', 'address'];

const emptyValues = () => Object.fromEntries(FIELDS.map((f) => [f, ''])) as Values;
const fromOperator = (o: Operator) =>
  Object.fromEntries(FIELDS.map((f) => [f, o[f] == null ? '' : String(o[f])])) as Values;

/**
 * Turns the form strings into an API payload. On create, blank optional fields are left out;
 * on edit only changed fields are sent, and a cleared optional field is sent as null.
 */
export function toPayload(values: Values, original?: Values) {
  const out: Record<string, unknown> = {};
  for (const f of FIELDS) {
    const v = values[f].trim();
    if (original && v === original[f].trim()) continue;
    if (v === '') {
      if (original) out[f] = REQUIRED.includes(f) ? '' : null;
      continue;
    }
    out[f] = f === 'yearEstablished' ? Number(v) : v;
  }
  return out;
}

export function OperatorFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const canModerate = useCanModerate();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const countries = useCountries();
  const existing = useQuery({ queryKey: ['operator', id], queryFn: () => api.operator(id!), enabled: editing });

  const [values, setValues] = useState<Values>(emptyValues);
  // Each country's licensing authority (set on the Countries page), offered as suggestions; any value is allowed.
  const authorities = [...new Set((countries.data ?? []).filter((c) => c.licensingAuthority && (!values.countryCode || c.code === values.countryCode)).map((c) => c.licensingAuthority!))];
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  useEffect(() => {
    if (existing.data) setValues(fromOperator(existing.data));
  }, [existing.data]);

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing ? api.updateOperator(id!, payload) : api.createOperator(payload as never),
    onSuccess: (op) => {
      void queryClient.invalidateQueries({ queryKey: ['operators'] });
      void queryClient.invalidateQueries({ queryKey: ['operator', op.id] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      navigate(`/operators/${op.id}`);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors.length) {
        setErrors(Object.fromEntries(e.fieldErrors.map((fe) => [fe.path, fe.message])));
        setFormError('Some fields need fixing.');
      } else setFormError(e instanceof ApiError ? e.message : 'Couldn’t save. Try again.');
    },
  });

  if (!canModerate) return <Navigate to="/operators" replace />;
  if (editing && existing.isLoading) return <p className="muted">Loading…</p>;
  if (editing && !existing.data) return <p className="alert err">Couldn’t load this operator.</p>;

  const original = existing.data ? fromOperator(existing.data) : undefined;
  const set = (f: Field) => (e: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [f]: e.target.value }));
    setErrors((er) => ({ ...er, [f]: undefined }));
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const payload = toPayload(values, original);
    if (editing && Object.keys(payload).length === 0) {
      navigate(`/operators/${id}`);
      return;
    }
    const parsed = (editing ? operatorUpdateSchema : operatorCreateSchema).safeParse(payload);
    if (!parsed.success) {
      const fieldErrors: Partial<Record<Field, string>> = {};
      for (const issue of parsed.error.issues) fieldErrors[issue.path[0] as Field] ??= friendly(issue.path[0] as Field, issue.message);
      setErrors(fieldErrors);
      setFormError('Some fields need fixing.');
      return;
    }
    save.mutate(parsed.data);
  }

  const input = (f: Field, label: string, props: { hint?: string; type?: string; wide?: boolean; list?: string; lang?: string; children?: ReactNode } = {}) => (
    <div className={`field ${props.wide ? 'wide' : ''}`}>
      <label htmlFor={f}>
        {label}
        {REQUIRED.includes(f) ? '' : <span className="muted"> (optional)</span>}
      </label>
      {props.children ?? (
        <input
          id={f}
          type={props.type ?? 'text'}
          value={values[f]}
          onChange={set(f)}
          list={props.list}
          lang={props.lang}
          aria-invalid={!!errors[f]}
          aria-describedby={errors[f] ? `${f}-error` : props.hint ? `${f}-hint` : undefined}
        />
      )}
      {props.hint && !errors[f] && (
        <span id={`${f}-hint`} className="hint">
          {props.hint}
        </span>
      )}
      {errors[f] && (
        <span id={`${f}-error`} className="error">
          {errors[f]}
        </span>
      )}
    </div>
  );

  const textarea = (f: Field, label: string, lang: string) =>
    input(f, label, {
      wide: true,
      children: <textarea id={f} lang={lang} value={values[f]} onChange={set(f)} aria-invalid={!!errors[f]} rows={3} />,
    });

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <header className="stack" style={{ gap: 6 }}>
        <Link to={editing ? `/operators/${id}` : '/operators'} className="muted" style={{ fontSize: '0.88rem' }}>
          ← {editing ? existing.data!.name : 'Operators'}
        </Link>
        <h1>{editing ? 'Edit operator' : 'Add operator'}</h1>
        {!editing && <p className="muted">New operators start as pending and appear in the approval queue.</p>}
      </header>

      <form className="stack" onSubmit={submit} noValidate>
        <section className="panel">
          <fieldset>
            <legend>Licence &amp; registration</legend>
            <div className="form-grid">
              {input('name', 'Trading name', { wide: true })}
              {input('countryCode', 'Country', {
                children: (
                  <select id="countryCode" value={values.countryCode} onChange={set('countryCode')} aria-invalid={!!errors.countryCode}>
                    <option value="">Choose a country</option>
                    {countries.data
                      ?.filter((c) => c.active || c.code === values.countryCode)
                      .map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.nameEn}
                        </option>
                      ))}
                  </select>
                ),
              })}
              {input('licensingAuthority', 'Licensing authority', { list: 'authorities' })}
              <datalist id="authorities">
                {authorities.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
              {input('tourismBoardLicense', 'Tourism licence number')}
              {input('businessRegNumber', 'Business registration number')}
              {input('legalName', 'Registered legal name')}
              {input('yearEstablished', 'Year established', { type: 'number' })}
              {input('address', 'Physical address', { wide: true })}
              {input('referenceContactName', 'Reference contact name')}
              {input('referenceContactInfo', 'Reference contact email or phone')}
            </div>
          </fieldset>
        </section>

        <section className="panel">
          <fieldset>
            <legend>Contact &amp; listing</legend>
            <div className="form-grid">
              {input('websiteUrl', 'Website', { type: 'url', hint: 'Their own site. The badge and Russian page link back here.' })}
              {input('email', 'Email', { type: 'email' })}
              {input('phone', 'Phone', { type: 'tel' })}
              {input('telegramUsername', 'Telegram username')}
              {input('verificationVideoUrl', 'Verification video link', { type: 'url', wide: true, hint: 'YouTube or Telegram video of their office, camp or vehicles.' })}
              {textarea('descriptionRu', 'Description in Russian', 'ru')}
              {textarea('descriptionEn', 'Description in English', 'en')}
            </div>
          </fieldset>
        </section>

        {formError && (
          <p className="alert err" role="alert">
            {formError}
          </p>
        )}
        <div className="row-wrap">
          <button className="btn primary" type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Add operator'}
          </button>
          <Link className="btn" to={editing ? `/operators/${id}` : '/operators'}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

/** Rewrites schema messages into plain instructions for the form. */
function friendly(field: Field, message: string) {
  if (field === 'countryCode') return 'Choose a country.';
  if (field === 'yearEstablished') return `Enter a year between 1900 and ${new Date().getFullYear()}.`;
  if (/required|at least|received null/i.test(message)) return 'Fill this in.';
  if (/url/i.test(message)) return 'Enter a full web address starting with https://';
  if (/email/i.test(message)) return 'Enter a valid email address.';
  return message;
}
