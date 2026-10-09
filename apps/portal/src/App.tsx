import { useQuery } from '@tanstack/react-query';
import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api';
import { useAuth } from './auth';
import { DmcFamTripsPage, DmcListingsPage, DmcPendingPage, DmcQuotesPage, InventoryPage } from './pages/Dmc';
import { LoginPage, SetPasswordPage, SignupPage } from './pages/Public';
import { OperatorFamTripsPage, OperatorOverviewPage, OperatorQuotesPage, PackageFormPage, PackagesPage } from './pages/Operator';

export function App() {
  const { account } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/set-password" element={<SetPasswordPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route element={<RequireAuth />}>
        {account?.role === 'OPERATOR' && (
          <Route element={<OperatorShell />}>
            <Route index element={<OperatorOverviewPage />} />
            <Route path="packages" element={<PackagesPage />} />
            <Route path="packages/new" element={<PackageFormPage />} />
            <Route path="packages/:id" element={<PackageFormPage />} />
            <Route path="quotes" element={<OperatorQuotesPage />} />
            <Route path="fam-trips" element={<OperatorFamTripsPage />} />
          </Route>
        )}
        {account?.role === 'DMC' && (
          <Route element={<DmcShell />}>
            {account.dmc?.status === 'APPROVED' ? (
              <>
                <Route index element={<InventoryPage />} />
                <Route path="quotes" element={<DmcQuotesPage />} />
                <Route path="listings" element={<DmcListingsPage />} />
                <Route path="fam-trips" element={<DmcFamTripsPage />} />
              </>
            ) : (
              <Route index element={<DmcPendingPage />} />
            )}
          </Route>
        )}
        {account?.role === 'TRANSLATOR' && <Route index element={<TranslatorNotice />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function RequireAuth() {
  const { account, checking } = useAuth();
  const location = useLocation();
  if (checking) return <p className="center muted">…</p>;
  if (!account) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

function Who({ label, signOut }: { label: string; signOut: string }) {
  const { account, logout } = useAuth();
  return (
    <div className="who">
      <span className="muted">{account?.email}</span>
      <button className="btn link" onClick={() => logout()} aria-label={label}>{signOut}</button>
    </div>
  );
}

function OperatorShell() {
  const { account } = useAuth();
  const overview = useQuery({ queryKey: ['overview'], queryFn: api.overview });
  const open = overview.data?.openQuotes;
  return (
    <div lang="en">
      <header className="topbar">
        <div className="inner">
          <div className="brand"><strong>{account?.operator?.name}</strong><span className="eyebrow">Operator portal</span></div>
          <nav className="nav" aria-label="Main">
            <NavLink to="/" end>Overview</NavLink>
            <NavLink to="/packages">Tours</NavLink>
            <NavLink to="/quotes">Quote requests {!!open && <span className="count" aria-label={`${open} open`}>{open}</span>}</NavLink>
            <NavLink to="/fam-trips">Fam trips</NavLink>
          </nav>
          <Who label="Sign out" signOut="Sign out" />
        </div>
      </header>
      <main><Outlet /></main>
    </div>
  );
}

function DmcShell() {
  const { account } = useAuth();
  const approved = account?.dmc?.status === 'APPROVED';
  return (
    <div lang="ru">
      <header className="topbar">
        <div className="inner">
          <div className="brand"><strong>{account?.dmc?.name}</strong><span className="eyebrow">Оптовый портал</span></div>
          {approved && (
            <nav className="nav" aria-label="Разделы">
              <NavLink to="/" end>Туры</NavLink>
              <NavLink to="/quotes">Запросы цен</NavLink>
              <NavLink to="/listings">Мои туры</NavLink>
              <NavLink to="/fam-trips">Инфотуры</NavLink>
            </nav>
          )}
          <Who label="Выйти" signOut="Выйти" />
        </div>
      </header>
      <main><Outlet /></main>
    </div>
  );
}

function TranslatorNotice() {
  return (
    <div className="center" lang="ru">
      <div className="panel">
        <h1>Переводчикам</h1>
        <p>Заявки приходят в наш Telegram-бот, отдельный кабинет не нужен.</p>
      </div>
    </div>
  );
}
