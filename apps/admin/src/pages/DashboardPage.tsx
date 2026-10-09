import { useQuery } from '@tanstack/react-query';
import { OperatorStatus } from '@ttp/shared-types';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { titleCase } from '../format';

const STATUS_ORDER: { status: OperatorStatus; color: string }[] = [
  { status: 'APPROVED', color: 'var(--ok)' },
  { status: 'PENDING', color: 'var(--idle)' },
  { status: 'FLAGGED', color: 'var(--warn)' },
  { status: 'SUSPENDED', color: 'var(--off)' },
  { status: 'REJECTED', color: 'var(--bad)' },
];

export function DashboardPage() {
  const { admin } = useAuth();
  const { data, error, isLoading } = useQuery({ queryKey: ['stats'], queryFn: api.stats });

  return (
    <div className="page">
      <header className="stack" style={{ gap: 4 }}>
        <span className="eyebrow">Dashboard</span>
        <h1>Hello, {admin!.name.split(' ')[0]}</h1>
      </header>

      {isLoading && <p className="muted">Loading…</p>}
      {error && <p className="alert err">Couldn’t load the numbers. Reload the page to try again.</p>}
      {data && (
        <>
          <section className="stack" aria-labelledby="todo">
            <h2 id="todo">Waiting for a decision</h2>
            <div className="tiles">
              <Link to="/operators?status=PENDING" className={`tile ${data.operatorsByStatus.PENDING ? 'attention' : ''}`}>
                <span className="value">{data.operatorsByStatus.PENDING}</span>
                <span>Operators to review</span>
              </Link>
              <Link to="/operators?status=FLAGGED" className="tile">
                <span className="value">{data.operatorsByStatus.FLAGGED}</span>
                <span>Flagged operators</span>
              </Link>
              <Link to="/reviews?status=PENDING" className={`tile ${data.reviewsPending ? 'attention' : ''}`}>
                <span className="value">{data.reviewsPending}</span>
                <span>Reviews to moderate</span>
              </Link>
              <Link to="/inquiries" className={`tile ${data.inquiriesNew ? 'attention' : ''}`}>
                <span className="value">{data.inquiriesNew}</span>
                <span>Traveller questions to answer</span>
              </Link>
              <Link to="/translators" className={`tile ${data.translatorsPending ? 'attention' : ''}`}>
                <span className="value">{data.translatorsPending}</span>
                <span>Translators to check</span>
              </Link>
              <Link to="/translation-jobs" className={`tile ${data.translationJobsOpen ? 'attention' : ''}`}>
                <span className="value">{data.translationJobsOpen}</span>
                <span>Translation requests without a translator</span>
              </Link>
            </div>
          </section>

          <section className="panel" aria-labelledby="ops">
            <div className="spread">
              <h2 id="ops">Operators by status</h2>
              <Link to="/operators">See all</Link>
            </div>
            <OperatorBar counts={data.operatorsByStatus} />
          </section>

          <section className="stack" aria-labelledby="activity">
            <h2 id="activity">Platform activity</h2>
            <div className="tiles">
              <Tile value={data.listingsLive} label="Listings live" hint="Published packages from approved operators" />
              <Tile value={data.dmcsOnboarded} label="DMCs onboarded" hint="Approved Russian partners" />
              <Tile value={data.quoteRequests} label="Quote requests" hint="All time" />
              <Tile value={data.translatorJobsCompleted} label="Translator jobs completed" hint="All time" />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Tile({ value, label, hint }: { value: number; label: string; hint: string }) {
  return (
    <div className="tile">
      <span className="value">{value}</span>
      <span>{label}</span>
      <span className="muted" style={{ fontSize: '0.8rem' }}>
        {hint}
      </span>
    </div>
  );
}

function OperatorBar({ counts }: { counts: Record<OperatorStatus, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total) return <p className="muted">No operators yet. Add the first one from the Operators page.</p>;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="statusbar" role="img" aria-label={STATUS_ORDER.map((s) => `${counts[s.status]} ${s.status.toLowerCase()}`).join(', ')}>
        {STATUS_ORDER.filter((s) => counts[s.status]).map((s) => (
          <span key={s.status} style={{ width: `${(counts[s.status] / total) * 100}%`, background: s.color }} />
        ))}
      </div>
      <div className="legend">
        {STATUS_ORDER.map((s) => (
          <Link key={s.status} to={`/operators?status=${s.status}`} style={{ color: 'var(--fg)', textDecoration: 'none' }}>
            <i style={{ background: s.color }} />
            {titleCase(s.status)} <strong className="num">{counts[s.status]}</strong>
          </Link>
        ))}
      </div>
    </div>
  );
}
