import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BookingReportInput, BookingState, CURRENCIES } from '@ttp/shared-types';
import { FormEvent, useState } from 'react';
import { api, ApiError, Quote } from '../api';
import { dateEn, dateRu } from '../format';

type Lang = 'ru' | 'en';
const T = {
  ru: {
    title: 'Состоялось ли бронирование?', booked: 'Забронировали', notBooked: 'Не забронировали', date: 'Дата бронирования', pax: 'Туристов',
    price: 'Согласованная цена нетто (необязательно)', currency: 'Валюта', save: 'Сохранить', change: 'Изменить',
    you: 'Вы', other: 'Туроператор', none: 'Пока не отмечено', saved: 'Сохранено.',
    note: 'Только для учёта: платформа не принимает и не проводит оплату.',
    state: { none: '', awaiting_other_side: 'Ждём подтверждения второй стороны', confirmed: 'Подтверждено обеими сторонами', not_booked: 'Обе стороны: не забронировали', disputed: 'Данные сторон расходятся — мы свяжемся с вами' } as Record<BookingState, string>,
    fmt: dateRu,
  },
  en: {
    title: 'Did this become a booking?', booked: 'Booked', notBooked: 'Not booked', date: 'Booking date', pax: 'Travellers',
    price: 'Agreed net price (optional)', currency: 'Currency', save: 'Save', change: 'Change',
    you: 'You', other: 'The DMC', none: 'Not reported yet', saved: 'Saved.',
    note: 'For our records only: the platform takes no payments.',
    state: { none: '', awaiting_other_side: 'Waiting for the other side to confirm', confirmed: 'Confirmed by both sides', not_booked: 'Both sides: not booked', disputed: 'The two reports differ; we will contact you' } as Record<BookingState, string>,
    fmt: dateEn,
  },
};
const PILL: Record<BookingState, string> = { none: 'off', awaiting_other_side: 'wait', confirmed: 'ok', not_booked: 'off', disputed: 'bad' };

/** One side's booking report on a quote, and what the other side said (pilot round). */
export function BookingPanel({ q, side, lang, queryKey }: { q: Quote; side: 'DMC' | 'OPERATOR'; lang: Lang; queryKey: string }) {
  const t = T[lang];
  const queryClient = useQueryClient();
  const mine = q.bookingReports.find((r) => r.side === side);
  const theirs = q.bookingReports.find((r) => r.side !== side);
  const [editing, setEditing] = useState(!mine);
  const [outcome, setOutcome] = useState<'BOOKED' | 'NOT_BOOKED'>(mine?.outcome ?? 'BOOKED');
  const [bookedOn, setBookedOn] = useState(mine?.bookedOn?.slice(0, 10) ?? new Date().toISOString().slice(0, 10));
  const [pax, setPax] = useState(String(mine?.pax ?? q.pax ?? ''));
  const [price, setPrice] = useState(mine?.netPrice ? String(Number(mine.netPrice)) : '');
  const [currency, setCurrency] = useState(mine?.currency ?? q.quotedCurrency ?? 'USD');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body: BookingReportInput =
        outcome === 'BOOKED'
          ? { outcome, bookedOn, ...(pax && { pax: Number(pax) }), ...(price && { netPrice: Number(price), currency: currency as BookingReportInput['currency'] }) }
          : { outcome };
      return side === 'DMC' ? api.dmcBooking(q.id, body) : api.operatorBooking(q.id, body);
    },
    onSuccess: () => {
      setEditing(false);
      setMsg({ kind: 'ok', text: t.saved });
      void queryClient.invalidateQueries({ queryKey: [queryKey] });
    },
    onError: (e) => setMsg({ kind: 'err', text: e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.message) : 'Error' }),
  });
  const describe = (r: Quote['bookingReports'][number]) =>
    r.outcome === 'BOOKED'
      ? `${t.booked}${r.bookedOn ? ` · ${t.fmt(r.bookedOn)}` : ''}${r.pax ? ` · ${r.pax} ${lang === 'ru' ? 'чел.' : 'travellers'}` : ''}${r.netPrice && r.currency ? ` · ${Number(r.netPrice).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB')} ${r.currency}` : ''}`
      : t.notBooked;
  function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    save.mutate();
  }

  return (
    <section className="stack" style={{ gap: 8, borderTop: '1px solid var(--line)', paddingTop: 12 }} aria-label={t.title}>
      <div className="spread">
        <strong>{t.title}</strong>
        {q.booking.state !== 'none' && <span className={`pill ${PILL[q.booking.state]}`}>{t.state[q.booking.state]}</span>}
      </div>
      <dl className="facts">
        <dt>{t.you}</dt><dd>{mine ? describe(mine) : t.none}{mine && !editing && <> · <button className="btn link" onClick={() => setEditing(true)}>{t.change}</button></>}</dd>
        <dt>{t.other}</dt><dd>{theirs ? describe(theirs) : t.none}</dd>
      </dl>
      {editing && (
        <form className="stack" style={{ gap: 10 }} onSubmit={submit} noValidate>
          <div className="chips" role="radiogroup" aria-label={t.title}>
            <button type="button" className="chip" role="radio" aria-checked={outcome === 'BOOKED'} aria-pressed={outcome === 'BOOKED'} onClick={() => setOutcome('BOOKED')}>{t.booked}</button>
            <button type="button" className="chip" role="radio" aria-checked={outcome === 'NOT_BOOKED'} aria-pressed={outcome === 'NOT_BOOKED'} onClick={() => setOutcome('NOT_BOOKED')}>{t.notBooked}</button>
          </div>
          {outcome === 'BOOKED' && (
            <div className="form-grid">
              <div className="field"><label htmlFor={`bd-${q.id}`}>{t.date}</label><input id={`bd-${q.id}`} type="date" value={bookedOn} onChange={(e) => setBookedOn(e.target.value)} /></div>
              <div className="field"><label htmlFor={`bp-${q.id}`}>{t.pax}</label><input id={`bp-${q.id}`} type="number" min={1} value={pax} onChange={(e) => setPax(e.target.value)} /></div>
              <div className="field"><label htmlFor={`bn-${q.id}`}>{t.price}</label><input id={`bn-${q.id}`} type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} /></div>
              <div className="field"><label htmlFor={`bc-${q.id}`}>{t.currency}</label><select id={`bc-${q.id}`} value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div>
            </div>
          )}
          <span className="small muted">{t.note}</span>
          <button className="btn primary small" type="submit" disabled={save.isPending} style={{ justifySelf: 'start' }}>{t.save}</button>
        </form>
      )}
      {msg && <p className={`alert ${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'}>{msg.text}</p>}
    </section>
  );
}
