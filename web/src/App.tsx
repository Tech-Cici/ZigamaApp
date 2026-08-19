import { useEffect } from 'react';
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { Loading } from './components';
import { useApi } from './useApi';
import { api } from './lib/api';
import { useAuth } from './lib/auth';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Onboarding from './pages/Onboarding';
import CashDesk from './pages/CashDesk';
import Customers from './pages/Customers';
import Transactions from './pages/Transactions';
import Reconciliation from './pages/Reconciliation';

export default function App() {
  const { user, restoring } = useAuth();

  if (restoring) return <Loading label="Restoring your session" />;
  if (!user) return <Login />;

  return (
    <div className="shell">
      <Sidebar />
      <main className="main">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/cash" element={<CashDesk />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/reconciliation" element={<Reconciliation />} />
          {/* Anything unrecognised goes home rather than showing a blank page. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function Sidebar() {
  const { user, signOut } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  // Counts drive the badges, so a manager can see at a glance that there is
  // work waiting without opening each page.
  const stats = useApi(() => api.stats());
  const movements = useApi(() => api.pendingMovements());

  // Refetch whenever the operator navigates. Approving something on one page
  // changes the count shown next to another, and a badge that disagrees with
  // the page it points at is worse than no badge.
  const location = useLocation();
  useEffect(() => {
    void stats.reload();
    void movements.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const pendingApprovals = stats.data?.pendingApprovals ?? 0;
  const pendingCash = movements.data?.pagination.total ?? 0;

  return (
    <nav className="sidebar">
      <div className="brand">
        <div className="brand-mark">Z</div>
        <div>
          <div className="brand-name">Zigama</div>
          <div className="brand-sub">Staff console</div>
        </div>
      </div>

      <Item to="/" label="Overview" />
      <Item
        to="/onboarding"
        label={isAdmin ? 'New account' : 'Approvals'}
        badge={isAdmin ? 0 : pendingApprovals}
      />
      <Item to="/cash" label="Cash desk" badge={pendingCash} />
      <Item to="/customers" label="Customers" />
      <Item to="/transactions" label="Transactions" />
      <Item to="/reconciliation" label="Reconciliation" />

      <div className="sidebar-footer">
        <div style={{ fontWeight: 600 }}>{user?.fullName}</div>
        <div style={{ opacity: 0.7, marginBottom: 10 }}>
          {isAdmin ? 'Administrator' : 'Branch manager'}
        </div>
        <button
          className="btn-secondary"
          style={{ width: '100%' }}
          onClick={signOut}
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}

function Item({
  to,
  label,
  badge,
}: {
  to: string;
  label: string;
  badge?: number;
}) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
    >
      <span>{label}</span>
      {badge ? <span className="nav-badge">{badge}</span> : null}
    </NavLink>
  );
}
