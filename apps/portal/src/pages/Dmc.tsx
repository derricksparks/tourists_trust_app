import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, DmcFamTrip, InventoryItem, Listing } from '../api';
import { useAuth } from '../auth';
import { COUNTRY_RU, dateRu, money, PUBLIC_SITE } from '../format';

const ruMoney = (a: string, c: string) => money(a, c, 'ru-RU');
const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export function DmcPendingPage() {
  const { account, refresh } = useAuth();
  const status = account?.dmc?.status;
  return (
    <section className="panel" style={{ maxWidth: 640 }}>
      <h1>{status === 'PENDING' ? 'Заявка на проверке' : 'Доступ закрыт'}</h1>
      {status === 'PENDING' ? (
        <p>Мы проверяем компанию {account?.dmc?.name}: сайт, регистрацию и контакты. Обычно это занимает один-два рабочих дня. Как только доступ откроется, здесь появится каталог туров.</p>
      ) : (
        <p>Доступ к оптовому каталогу сейчас закрыт. Свяжитесь с менеджером платформы, чтобы узнать подробности.</p>
      )}
      <button className="btn" style={{ justifySelf: 'start' }} onClick={() => void refresh()}>Проверить ещё раз</button>
    </section>
  );
}

// ─── Inventory ───────────────────────────────────────────────────────────────

export function InventoryPage() {
  const [country, setCountry] = useState<string | undefined>();
  const [month, setMonth] = useState('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const { data, error, isLoading } = useQuery({
    queryKey: ['inventory', { country, month, search }],
    queryFn: () => api.inventory({ country, month: month || undefined, q: search || undefined }),
  });

  return (
    <>
      <header className="stack" style={{ gap: 6 }}>
        <span className="eyebrow">Оптовый каталог</span>
        <h1>Проверенные туры Восточной Африки</h1>
        <p className="muted">Все туроператоры прошли проверку лицензии и регистрации. Цены ориентировочные: точные нетто-цены запрашивайте у туроператора. Оплата и договор — напрямую между вами.</p>
      </header>
      <div className="row">
        <div className="chips" role="group" aria-label="Страна">
          <button className="chip" aria-pressed={!country} onClick={() => setCountry(undefined)}>Все страны</button>
          {['UG', 'TZ', 'KE', 'RW'].map((c) => <button key={c} className="chip" aria-pressed={country === c} onClick={() => setCountry(c)}>{COUNTRY_RU[c]}</button>)}
        </div>
        <label className="sr-only" htmlFor="month">Месяц заезда</label>
        <input id="month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 'auto' }} />
        <form className="row" role="search" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }}>
          <label className="sr-only" htmlFor="q">Поиск</label>
          <input id="q" type="search" placeholder="Тур или туроператор" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
          <button className="btn small" type="submit">Найти</button>
        </form>
      </div>
      {error && <p className="alert err">{errorText(error, 'Не удалось загрузить каталог.')}</p>}
      {isLoading && <p className="muted">Загружаем…</p>}
      {data?.length === 0 && <p className="panel muted">По этим фильтрам туров нет.</p>}
      <div className="cards">{data?.map((p) => <InventoryCard key={p.id} p={p} />)}</div>
    </>
  );
}

function InventoryCard({ p }: { p: InventoryItem }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<null | 'quote'>(null);
  const [pax, setPax] = useState('2');
  const [start, setStart] = useState(p.dateRanges[0]?.startDate.slice(0, 10) ?? '');
  const [notes, setNotes] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const quote = useMutation({
    mutationFn: () => api.requestQuote({ packageId: p.id, pax: Number(pax), travelStartDate: start, ...(notes.trim() && { notes: notes.trim() }) }),
    onSuccess: () => { setOpen(null); setMsg({ kind: 'ok', text: 'Запрос отправлен туроператору. Ответ появится в разделе «Запросы цен».' }); void queryClient.invalidateQueries({ queryKey: ['dmc-quotes'] }); },
    onError: (e) => setMsg({ kind: 'err', text: errorText(e, 'Не удалось отправить запрос.') }),
  });
  const list = useMutation({
    mutationFn: () => api.saveListing({ packageId: p.id, active: true }),
    onSuccess: () => { setMsg({ kind: 'ok', text: 'Тур добавлен в «Мои туры»: там готовый текст для вашего сайта.' }); void queryClient.invalidateQueries({ queryKey: ['inventory'] }); void queryClient.invalidateQueries({ queryKey: ['listings'] }); },
    onError: (e) => setMsg({ kind: 'err', text: errorText(e, 'Не удалось добавить тур.') }),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!Number(pax) || Number(pax) < 1) return setMsg({ kind: 'err', text: 'Укажите количество человек.' });
    if (!start) return setMsg({ kind: 'err', text: 'Укажите дату заезда.' });
    quote.mutate();
  }

  const op = p.operator;
  return (
    <article className="panel" aria-labelledby={`p-${p.id}`}>
      <span className="eyebrow">{COUNTRY_RU[p.countryCode]} · {p.durationDays} дн.</span>
      <h2 id={`p-${p.id}`}>{p.titleRu ?? p.title}</h2>
      <p className="small">
        <a href={`${PUBLIC_SITE}/operators/${op.slug}`} target="_blank" rel="noopener noreferrer">{op.name}</a>
        <span className="muted"> · лицензия {op.licensingAuthority}{op.responseTimeScore !== null ? ` · отвечает: ${op.responseTimeScore}/100` : ''}</span>
      </p>
      {p.descriptionRu && <p className="small">{p.descriptionRu}</p>}
      <p className="small">
        {p.price && p.currency ? <strong>от {ruMoney(p.price, p.currency)} {p.priceBasis === 'PER_PERSON' ? 'с человека' : 'за группу'}</strong> : 'Цена по запросу'}
        {p.capacity ? ` · до ${p.capacity} чел.` : ''}
      </p>
      {p.dateRanges.length > 0 && <p className="muted small">Даты: {p.dateRanges.slice(0, 4).map((d) => `${dateRu(d.startDate)}–${dateRu(d.endDate)}`).join('; ')}</p>}
      {msg && <p className={`alert ${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'}>{msg.text}</p>}
      {open === 'quote' ? (
        <form className="stack" style={{ gap: 10 }} onSubmit={submit} noValidate>
          <div className="form-grid">
            <div className="field"><label htmlFor={`pax-${p.id}`}>Человек</label><input id={`pax-${p.id}`} type="number" min={1} value={pax} onChange={(e) => setPax(e.target.value)} /></div>
            <div className="field"><label htmlFor={`start-${p.id}`}>Заезд</label><input id={`start-${p.id}`} type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
            <div className="field wide"><label htmlFor={`notes-${p.id}`}>Комментарий</label><textarea id={`notes-${p.id}`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Размещение, питание, особые пожелания" /></div>
          </div>
          <div className="row">
            <button className="btn primary small" type="submit" disabled={quote.isPending}>Отправить запрос</button>
            <button className="btn small" type="button" onClick={() => setOpen(null)}>Отмена</button>
          </div>
        </form>
      ) : (
        <div className="row">
          <button className="btn primary small" onClick={() => { setMsg(null); setOpen('quote'); }}>Запросить нетто-цену</button>
          {p.listedByMe ? <Link to="/listings" className="small">В моих турах</Link> : <button className="btn small" disabled={list.isPending} onClick={() => list.mutate()}>Продавать под своим брендом</button>}
        </div>
      )}
    </article>
  );
}

// ─── Quotes ──────────────────────────────────────────────────────────────────

const QUOTE_RU = { OPEN: ['wait', 'Ждёт ответа'], QUOTED: ['ok', 'Есть цена'], CLOSED: ['off', 'Закрыт'] } as const;

export function DmcQuotesPage() {
  const queryClient = useQueryClient();
  const { data, error } = useQuery({ queryKey: ['dmc-quotes'], queryFn: api.dmcQuotes });
  const close = useMutation({
    mutationFn: ({ id, outcome }: { id: string; outcome: 'booked' | 'not_booked' }) => api.closeQuote(id, outcome),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dmc-quotes'] }),
  });
  return (
    <>
      <header className="stack" style={{ gap: 6 }}>
        <span className="eyebrow">Запросы цен</span>
        <h1>Ответы туроператоров</h1>
        <p className="muted">Договор и оплата — напрямую с туроператором. Когда вопрос решён, закройте запрос и отметьте, состоялась ли продажа: это помогает нам оценивать туроператоров.</p>
      </header>
      {error && <p className="alert err">{errorText(error, 'Не удалось загрузить запросы.')}</p>}
      {data?.length === 0 && <p className="panel muted">Запросов пока нет. Запросите цену в каталоге.</p>}
      {data?.map((q) => {
        const [kind, label] = QUOTE_RU[q.status];
        return (
          <article key={q.id} className="panel" aria-labelledby={`dq-${q.id}`}>
            <div className="spread">
              <h2 id={`dq-${q.id}`}>{q.package.titleRu ?? q.package.title}</h2>
              <span className={`pill ${kind}`}>{label}</span>
            </div>
            <p className="small muted">
              {q.package.operator?.name} · {q.pax} чел. · заезд {q.travelStartDate ? dateRu(q.travelStartDate) : '—'} · запрос от {dateRu(q.createdAt)}
            </p>
            {q.quotedPrice && q.quotedCurrency && (
              <p>
                <strong>{ruMoney(q.quotedPrice, q.quotedCurrency)}</strong> <span lang="en">— {q.quoteTerms}</span>
              </p>
            )}
            {q.status === 'CLOSED' && !q.quotedPrice && <p className="muted small">Туроператор не смог предложить цену на эти даты.</p>}
            {q.status !== 'CLOSED' && (
              <div className="row">
                {q.status === 'QUOTED' && <button className="btn primary small" disabled={close.isPending} onClick={() => close.mutate({ id: q.id, outcome: 'booked' })}>Закрыть: продали</button>}
                <button className="btn small" disabled={close.isPending} onClick={() => close.mutate({ id: q.id, outcome: 'not_booked' })}>Закрыть: не продали</button>
              </div>
            )}
          </article>
        );
      })}
    </>
  );
}

// ─── Listings / white-label ──────────────────────────────────────────────────

export function DmcListingsPage() {
  const { data, error } = useQuery({ queryKey: ['listings'], queryFn: api.listings });
  return (
    <>
      <header className="stack" style={{ gap: 6 }}>
        <span className="eyebrow">Мои туры</span>
        <h1>Туры, которые вы продаёте</h1>
        <p className="muted">Готовый текст без контактов туроператора — для вашего сайта. Если укажете ссылку на страницу тура у себя, мы покажем вас на нашей странице тура в блоке «Где купить».</p>
      </header>
      {error && <p className="alert err">{errorText(error, 'Не удалось загрузить список.')}</p>}
      {data?.length === 0 && <p className="panel muted">Пока пусто. В каталоге нажмите «Продавать под своим брендом».</p>}
      {data?.map((l) => <ListingCard key={l.id} l={l} />)}
    </>
  );
}

function ListingCard({ l }: { l: Listing }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(l.whiteLabelTitle ?? '');
  const [url, setUrl] = useState(l.dmcPageUrl ?? '');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['listings'] }); void queryClient.invalidateQueries({ queryKey: ['inventory'] }); };
  const save = useMutation({
    mutationFn: (active: boolean) => api.saveListing({ packageId: l.package.id, whiteLabelTitle: title.trim() || null, dmcPageUrl: url.trim() || null, active }),
    onSuccess: () => { setMsg({ kind: 'ok', text: 'Сохранено.' }); refresh(); },
    onError: (e) => setMsg({ kind: 'err', text: e instanceof ApiError && e.fieldErrors[0] ? e.fieldErrors[0].message : errorText(e, 'Не удалось сохранить.') }),
  });
  const remove = useMutation({ mutationFn: () => api.removeListing(l.id), onSuccess: refresh });

  return (
    <article className="panel" aria-labelledby={`l-${l.id}`}>
      <div className="spread">
        <h2 id={`l-${l.id}`}>{l.whiteLabelTitle ?? l.package.titleRu ?? l.package.title}</h2>
        <span className={`pill ${!l.sellable ? 'bad' : l.active ? 'ok' : 'off'}`}>{!l.sellable ? 'Снят с продажи' : l.active ? 'Продаётся' : 'Скрыт'}</span>
      </div>
      <p className="small muted">
        Туроператор: {l.package.operator.name} · <a href={l.mirrorUrl} target="_blank" rel="noopener noreferrer">страница тура на нашем сайте</a>
      </p>
      {!l.sellable && <p className="alert info">Туроператор снял тур с продажи или его проверка приостановлена. Уберите тур со своего сайта.</p>}
      <div className="form-grid">
        <div className="field"><label htmlFor={`t-${l.id}`}>Ваше название (необязательно)</label><input id={`t-${l.id}`} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="field"><label htmlFor={`u-${l.id}`}>Страница тура на вашем сайте</label><input id={`u-${l.id}`} type="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} /></div>
      </div>
      <div className="row">
        <button className="btn primary small" disabled={save.isPending} onClick={() => save.mutate(true)}>Сохранить</button>
        {l.active ? <button className="btn small" disabled={save.isPending} onClick={() => save.mutate(false)}>Скрыть с нашей страницы</button> : <button className="btn small" disabled={save.isPending} onClick={() => save.mutate(true)}>Показывать снова</button>}
        <button className="btn danger small" disabled={remove.isPending} onClick={() => remove.mutate()}>Убрать из моих туров</button>
      </div>
      {msg && <p className={`alert ${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'}>{msg.text}</p>}
      <details>
        <summary className="small" style={{ cursor: 'pointer' }}>Текст для вашего сайта</summary>
        <div className="stack" style={{ gap: 8, marginTop: 8 }}>
          <pre className="copybox" aria-label="Текст тура">{l.whiteLabelText}</pre>
          <button className="btn small" style={{ justifySelf: 'start' }} onClick={() => navigator.clipboard.writeText(l.whiteLabelText).then(() => setCopied(true), () => setCopied(false))}>
            {copied ? 'Скопировано' : 'Скопировать текст'}
          </button>
        </div>
      </details>
    </article>
  );
}

// ─── Fam trips ───────────────────────────────────────────────────────────────

export function DmcFamTripsPage() {
  const { data, error } = useQuery({ queryKey: ['dmc-fam-trips'], queryFn: api.dmcFamTrips });
  return (
    <>
      <header className="stack" style={{ gap: 6 }}>
        <span className="eyebrow">Инфотуры</span>
        <h1>Поездки к туроператорам</h1>
        <p className="muted">Платформа организует ознакомительные поездки: вы своими глазами видите лоджи, машины и гидов. Подайте заявку — мы подтвердим участие.</p>
      </header>
      {error && <p className="alert err">{errorText(error, 'Не удалось загрузить инфотуры.')}</p>}
      {data?.length === 0 && <p className="panel muted">Ближайших инфотуров пока нет.</p>}
      {data?.map((t) => <FamTripCard key={t.id} t={t} />)}
    </>
  );
}

function FamTripCard({ t }: { t: DmcFamTrip }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const join = useMutation({
    mutationFn: () => api.joinFamTrip(t.id, name.trim()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dmc-fam-trips'] }),
    onError: (e) => setError(errorText(e, 'Не удалось отправить заявку.')),
  });
  const full = t.capacity !== null && t.seatsTaken >= t.capacity;
  return (
    <article className="panel" aria-labelledby={`ft-${t.id}`}>
      <div className="spread">
        <h2 id={`ft-${t.id}`}>{t.title}</h2>
        {t.myStatus && <span className={`pill ${t.myStatus === 'confirmed' ? 'ok' : 'wait'}`}>{t.myStatus === 'confirmed' ? 'Участие подтверждено' : 'Заявка подана'}</span>}
      </div>
      <p>{dateRu(t.startDate)} – {dateRu(t.endDate)}{t.capacity ? ` · мест: ${Math.max(0, t.capacity - t.seatsTaken)} из ${t.capacity}` : ''}</p>
      <p className="small muted">Принимают: {t.operators.map((o) => `${o.operator.name} (${COUNTRY_RU[o.operator.countryCode]})`).join(', ')}</p>
      {t.itinerary.length > 0 && <ol className="small" style={{ margin: 0, paddingLeft: '1.2em' }}>{t.itinerary.map((d) => <li key={d.day} value={d.day}>{d.titleRu}</li>)}</ol>}
      {!t.myStatus && (full ? (
        <p className="muted small">Мест нет. Напишите менеджеру, если хотите в лист ожидания.</p>
      ) : (
        <form className="row" style={{ alignItems: 'end' }} onSubmit={(e) => { e.preventDefault(); setError(null); if (name.trim().length < 2) return setError('Укажите, кто поедет.'); join.mutate(); }} noValidate>
          <div className="field"><label htmlFor={`rep-${t.id}`}>Кто поедет от компании</label><input id={`rep-${t.id}`} value={name} onChange={(e) => setName(e.target.value)} /></div>
          <button className="btn primary small" type="submit" disabled={join.isPending}>Подать заявку</button>
        </form>
      ))}
      {t.myRepresentative && <p className="small muted">Участник: {t.myRepresentative}</p>}
      {error && <p className="alert err" role="alert">{error}</p>}
    </article>
  );
}
