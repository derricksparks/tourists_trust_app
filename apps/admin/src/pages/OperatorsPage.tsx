import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { OPERATOR_STATUSES, OperatorStatus } from '@ttp/shared-types';
import { FormEvent, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useCanModerate } from '../auth';
import { Pager } from '../components/Pager';
import { StatusPill } from '../components/StatusPill';
import { countryName, formatDate, titleCase } from '../format';

/** The operator approval queue: filter by status/country, search, oldest first. */
export function OperatorsPage() {
  const canModerate = useCanModerate();
  const [params, setParams] = useSearchParams();
  const status = (OPERATOR_STATUSES as readonly string[]).includes(params.get('status') ?? '')
    ? (params.get('status') as OperatorStatus)
    : undefined;
  const countryCode = params.get('country') ?? undefined;
  const q = params.get('q') ?? undefined;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [search, setSearch] = useState(q ?? '');
  useEffect(() => setSearch(q ?? ''), [q]);

  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats });
  const countries = useQuery({ queryKey: ['countries'], queryFn: api.countries, staleTime: Infinity });
  const list = useQuery({
    queryKey: ['operators', { status, countryCode, q, page }],
    queryFn: () => api.operators({ status, countryCode, q, page }),
    placeholderData: keepPreviousData,
  });

  const update = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  };
  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    update({ q: search.trim() || undefined });
  };

  const counts = stats.data?.operatorsByStatus;
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : undefined;

  return (
    <div className="page">
      <header className="spread">
        <div className="stack" style={{ gap: 4 }}>
          <span className="eyebrow">Trust &amp; verification</span>
          <h1>Operators</h1>
        </div>
        {canModerate && (
          <Link to="/operators/new" className="btn primary">
            Add operator
          </Link>
        )}
      </header>

      <div className="chips" role="group" aria-label="Filter by status">
        <button className="chip" aria-pressed={!status} onClick={() => update({ status: undefined })}>
          All {total !== undefined && <span className="n">{total}</span>}
        </button>
        {OPERATOR_STATUSES.map((s) => (
          <button key={s} className="chip" aria-pressed={status === s} onClick={() => update({ status: s })}>
            {titleCase(s)} {counts && <span className="n">{counts[s]}</span>}
          </button>
        ))}
      </div>

      <div className="row-wrap">
        <form onSubmit={submitSearch} className="row-wrap" role="search" style={{ flex: '1 1 320px' }}>
          <label htmlFor="op-search" className="sr-only">
            Search operators
          </label>
          <input
            id="op-search"
            type="search"
            placeholder="Name, registration or licence number"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 0 }}
          />
          <button className="btn" type="submit">
            Search
          </button>
        </form>
        <label htmlFor="op-country" className="sr-only">
          Country
        </label>
        <select id="op-country" value={countryCode ?? ''} onChange={(e) => update({ country: e.target.value || undefined })} style={{ width: 'auto' }}>
          <option value="">All countries</option>
          {countries.data?.map((c) => (
            <option key={c.code} value={c.code}>
              {c.nameEn}
            </option>
          ))}
        </select>
      </div>

      {list.error && <p className="alert err">Couldn’t load operators. Reload the page to try again.</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Operator</th>
              <th>Country</th>
              <th className="hide-narrow">Licensed by</th>
              <th>Status</th>
              <th>Added</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.items.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link className="title" to={`/operators/${o.id}`}>
                    {o.name}
                  </Link>
                  {o.statusReason && (
                    <div className="muted" style={{ fontSize: '0.84rem' }}>
                      {o.statusReason}
                    </div>
                  )}
                </td>
                <td>{countryName(o.countryCode)}</td>
                <td className="hide-narrow">{o.licensingAuthority}</td>
                <td>
                  <StatusPill status={o.status} />
                </td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  {formatDate(o.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data && list.data.items.length === 0 && (
          <p className="empty">{q || countryCode || status ? 'No operators match these filters.' : 'No operators yet.'}</p>
        )}
        {list.isLoading && <p className="empty">Loading…</p>}
      </div>
      {list.data && (
        <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => update({ page: String(p) })} />
      )}
    </div>
  );
}
