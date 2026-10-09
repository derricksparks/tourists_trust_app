import { DmcSignupInput, dmcSignupSchema } from '@ttp/shared-types';
import { FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';

export function LoginPage() {
  const { account, login, notice } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (account) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401
        ? 'Email or password is wrong. / Неверный email или пароль.'
        : 'Could not reach the server. / Сервер недоступен.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <form className="panel" onSubmit={submit} noValidate>
        <div className="stack" style={{ gap: 4 }}>
          <span className="eyebrow">Проверено: Африка</span>
          <h1>Partner portal · Кабинет партнёра</h1>
          <p className="muted small">For tour operators in East Africa and travel companies in Russia. / Для туроператоров Восточной Африки и турфирм из России.</p>
        </div>
        {notice && <p className="alert info">{notice}</p>}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Password / Пароль</label>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p className="alert err" role="alert">{error}</p>}
        <button className="btn primary" type="submit" disabled={busy || !email || !password}>{busy ? '…' : 'Sign in / Войти'}</button>
        <p className="small muted">
          Forgot your password? Ask your contact at the platform for a new link. / Забыли пароль? Попросите новую ссылку у менеджера платформы.
        </p>
        <p className="small" lang="ru">Турфирма из России? <Link to="/signup">Подать заявку на доступ</Link></p>
      </form>
    </div>
  );
}

export function SetPasswordPage() {
  const [params] = useSearchParams();
  const { accept } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const token = params.get('token') ?? '';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 10) return setError('Use at least 10 characters. / Не короче 10 символов.');
    if (password !== repeat) return setError('The passwords do not match. / Пароли не совпадают.');
    try {
      accept(await api.setPassword(token, password));
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. / Ошибка.');
    }
  }

  return (
    <div className="center">
      <form className="panel" onSubmit={submit} noValidate>
        <h1>Set your password · Задайте пароль</h1>
        <p className="muted small">This link works once. / Ссылка одноразовая.</p>
        <div className="field">
          <label htmlFor="pw">New password / Новый пароль</label>
          <input id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <span className="hint">At least 10 characters. / Не короче 10 символов.</span>
        </div>
        <div className="field">
          <label htmlFor="pw2">Repeat / Ещё раз</label>
          <input id="pw2" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        </div>
        {error && <p className="alert err" role="alert">{error}</p>}
        <button className="btn primary" type="submit" disabled={!token}>Save and sign in / Сохранить и войти</button>
      </form>
    </div>
  );
}

const FIELDS: { key: keyof DmcSignupInput; label: string; type?: string; hint?: string; optional?: boolean }[] = [
  { key: 'name', label: 'Название компании' },
  { key: 'legalName', label: 'Юридическое название', optional: true },
  { key: 'websiteUrl', label: 'Сайт', type: 'url', optional: true, hint: 'Начиная с https://' },
  { key: 'contactName', label: 'Контактное лицо' },
  { key: 'email', label: 'Email (это ваш логин)', type: 'email' },
  { key: 'phone', label: 'Телефон', type: 'tel', optional: true },
  { key: 'telegramUsername', label: 'Telegram', optional: true },
  { key: 'password', label: 'Пароль', type: 'password', hint: 'Не короче 10 символов' },
];

/** Russian DMC applies for wholesale access. */
export function SignupPage() {
  const { accept, account } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (account) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const payload = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v !== ''));
    const parsed = dmcSignupSchema.safeParse(payload);
    if (!parsed.success) {
      const out: Record<string, string> = {};
      for (const i of parsed.error.issues) out[String(i.path[0])] ??= /Required|received undefined/.test(i.message) ? 'Заполните поле' : i.message;
      setErrors(out);
      return setFormError('Проверьте отмеченные поля.');
    }
    setBusy(true);
    try {
      accept(await api.dmcSignup(parsed.data));
      navigate('/', { replace: true });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Не удалось отправить заявку.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center" lang="ru">
      <form className="panel" onSubmit={submit} noValidate style={{ width: 'min(100%, 620px)' }}>
        <div className="stack" style={{ gap: 4 }}>
          <span className="eyebrow">Для турфирм из России</span>
          <h1>Доступ к проверенным турам Восточной Африки</h1>
          <p className="muted small">Оптовые запросы цен у туроператоров Уганды, Танзании и Кении, готовые описания туров для вашего сайта, инфотуры. Мы проверим компанию и откроем доступ, обычно за один-два рабочих дня.</p>
        </div>
        <div className="form-grid">
          {FIELDS.map((f) => (
            <div key={f.key} className={`field ${f.key === 'name' ? 'wide' : ''}`}>
              <label htmlFor={f.key}>{f.label}{f.optional && <span className="muted"> (необязательно)</span>}</label>
              <input id={f.key} type={f.type ?? 'text'} value={values[f.key] ?? ''} aria-invalid={!!errors[f.key]}
                autoComplete={f.key === 'password' ? 'new-password' : f.key === 'email' ? 'username' : undefined}
                onChange={(e) => { setValues({ ...values, [f.key]: e.target.value }); setErrors({ ...errors, [f.key]: '' }); }} />
              {errors[f.key] ? <span className="error">{errors[f.key]}</span> : f.hint && <span className="hint">{f.hint}</span>}
            </div>
          ))}
        </div>
        {formError && <p className="alert err" role="alert">{formError}</p>}
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Отправляем…' : 'Подать заявку'}</button>
        <p className="small"><Link to="/login">Уже есть доступ? Войти</Link></p>
      </form>
    </div>
  );
}
