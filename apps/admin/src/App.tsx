import { useQuery } from '@tanstack/react-query';
import { NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api';
import { useAuth } from './auth';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { OperatorDetailPage } from './pages/OperatorDetailPage';
import { OperatorFormPage } from './pages/OperatorFormPage';
import { OperatorsPage } from './pages/OperatorsPage';
import { ReviewsPage } from './pages/ReviewsPage';
import { titleCase } from './format';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Shell />}>
          <Route index element={<DashboardPage />} />
          <Route path="operators" element={<OperatorsPage />} />
          <Route path="operators/new" element={<OperatorFormPage />} />
          <Route path="operators/:id" element={<OperatorDetailPage />} />
          <Route path="operators/:id/edit" element={<OperatorFormPage />} />
          <Route path="reviews" element={<ReviewsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}

function RequireAuth() {
  const { admin, checking } = useAuth();
  const location = useLocation();
  if (checking) return <p className="empty">Checking your session…</p>;
  if (!admin) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

function Shell() {
  const { admin, logout } = useAuth();
  // Shared with the dashboard query, so the counts in the menu stay current.
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats });
  const pendingOperators = stats.data?.operatorsByStatus.PENDING;
  const pendingReviews = stats.data?.reviewsPending;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <strong>Trust Admin</strong>
          <span className="eyebrow">Russia–Africa</span>
        </div>
        <nav className="nav" aria-label="Main">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/operators">
            Operators {!!pendingOperators && <span className="count" aria-label={`${pendingOperators} waiting`}>{pendingOperators}</span>}
          </NavLink>
          <NavLink to="/reviews">
            Reviews {!!pendingReviews && <span className="count" aria-label={`${pendingReviews} waiting`}>{pendingReviews}</span>}
          </NavLink>
        </nav>
        <div className="who">
          <span>
            {admin!.name}
            <span className="role muted">
              {titleCase(admin!.role.replace('_', ' '))}
            </span>
          </span>
          <button className="btn link" onClick={() => logout()} style={{ justifySelf: 'start' }}>
            Sign out
          </button>
        </div>
      </aside>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
