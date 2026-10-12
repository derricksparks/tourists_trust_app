import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, BookingRow, BookingTotal } from '../api';
import { StatusPill } from '../components/StatusPill';
import { formatDate } from '../format';
import { BOOKING_LABEL, BOOKING_PILL } from './B2bPages';

const thisMonth = () => new Date().toISOString().slice(0, 7);
const monthsAgo = (n: number) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 7);
};

/**
 * Confirmed bookings per operator and per DMC by month, from both sides' reports on quotes.
 * For invoicing introduction fees by hand: the platform itself takes and records no payments.
 */
export function BookingsPage() {
  const [from, setFrom] = useState(monthsAgo(2));
  const [to, setTo] = useState(thisMonth());
  const [error, setError] = useState<string | null>(null);
  const report = useQuery({ queryKey: ['bookings', from, to], queryFn: () => api.bookings(from, to), enabled: from <= to });
  const download = (view: 'bookings' | 'operators' | 'dmcs') => {
    setError(null);
    api.downloadBookingsCsv(from, to, view).catch((e) => setError(e instanceof ApiError ? e.message : 'Could not export'));
  };
  const r = report.data;
  return (
    <div className="page">
      <header className="stack" style={{ gap: 4 }}>
        <span className="eyebrow">Wholesale</span>
        <h1>Bookings</h1>
        <p className="muted" style={{ maxWidth: '72ch' }}>
          Quotes that became bookings, as the DMC and the operator report them in the portal. A booking counts as confirmed when both sides
          say so and their numbers match; the month is the booking date. Use the exports to invoice introduction fees outside the platform.
        </p>
      </header>
      <div className="row-wrap" style={{ alignItems: 'end' }}>
        <div className="field"><label htmlFor="from">From month</label><input id="from" type="month" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="field"><label htmlFor="to">To month</label><input id="to" type="month" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <button className="btn" onClick={() => download('bookings')}>Export bookings (CSV)</button>
        <button className="btn" onClick={() => download('operators')}>Export per operator</button>
        <button className="btn" onClick={() => download('dmcs')}>Export per DMC</button>
      </div>
      {from > to && <p className="alert err">The start month is after the end month.</p>}
      {(error || report.error) && <p className="alert err" role="alert">{error ?? 'Could not load the report.'}</p>}
      {r && (
        <>
          <section className="stack" aria-labelledby="totals">
            <h2 id="totals">Confirmed bookings by month</h2>
            <div className="detail-grid">
              <Totals title="Per operator" rows={r.byOperator} link={(id) => `/operators/${id}`} />
              <Totals title="Per DMC" rows={r.byDmc} />
            </div>
          </section>
          <Rows title="Confirmed bookings" rows={r.confirmed} empty="No confirmed bookings in these months." />
          <Rows title="Needs follow-up" hint="One side hasn't reported yet, or the two reports disagree. These are not in the totals." rows={r.needsAttention} empty="Nothing to follow up." />
        </>
      )}
    </div>
  );
}

function Totals({ title, rows, link }: { title: string; rows: BookingTotal[]; link?: (id: string) => string }) {
  return (
    <div className="table-wrap">
      <table aria-label={title}>
        <thead><tr><th>Month</th><th>{title.replace('Per ', '')}</th><th>Bookings</th><th>Travellers</th></tr></thead>
        <tbody>
          {rows.map((g) => (
            <tr key={`${g.month}-${g.id}`}>
              <td className="num">{g.month}</td>
              <td>{link ? <Link to={link(g.id)}>{g.name}</Link> : g.name}</td>
              <td className="num">{g.bookings}</td>
              <td className="num">{g.pax}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="empty">None.</p>}
    </div>
  );
}

function Rows({ title, hint, rows, empty }: { title: string; hint?: string; rows: BookingRow[]; empty: string }) {
  return (
    <section className="stack" aria-label={title}>
      <h2>{title}</h2>
      {hint && <p className="muted">{hint}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Booked</th><th>Operator</th><th>DMC</th><th>Tour</th><th>Travellers</th><th>Agreed net</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.quoteId}>
                <td className="num">{b.bookedOn ? formatDate(b.bookedOn) : '—'}</td>
                <td>{b.operator.name}</td>
                <td lang="ru">{b.dmc.name}</td>
                <td>{b.tour}</td>
                <td className="num">{b.pax ?? '—'}</td>
                <td className="num">{b.netPrice && b.currency ? `${b.netPrice} ${b.currency}` : '—'}</td>
                <td>
                  <StatusPill status={BOOKING_PILL[b.state]} label={BOOKING_LABEL[b.state]} />
                  {b.differences.length > 0 && <div className="muted" style={{ fontSize: '0.82rem' }}>Differ on: {b.differences.join(', ')}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="empty">{empty}</p>}
      </div>
    </section>
  );
}
