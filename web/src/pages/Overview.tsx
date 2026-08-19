import { Banner, Loading, PageHead, Stat } from '../components';
import { api } from '../lib/api';
import { formatMoney } from '../lib/format';
import { useAuth } from '../lib/auth';
import { useApi } from '../useApi';

export default function Overview() {
  const { user } = useAuth();
  const { data, error, loading } = useApi(() => api.stats());

  if (loading && !data) return <Loading label="Loading platform statistics" />;

  return (
    <>
      <PageHead
        title={`Good day, ${user?.fullName ?? ''}`}
        subtitle={
          user?.role === 'ADMIN'
            ? 'Administrator — you can open accounts, but a manager must approve them.'
            : 'Branch manager — you approve accounts and confirm cash movements.'
        }
      />

      <Banner kind="error">{error}</Banner>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="stat-label">Total customer holdings</div>
        <div style={{ fontSize: 34, fontWeight: 700 }}>
          {data ? formatMoney(data.totalHoldings) : '—'}{' '}
          <span style={{ fontSize: 16, color: 'var(--text-muted)' }}>
            {data?.currency}
          </span>
        </div>
      </div>

      <div className="section-title">Today</div>
      <div className="grid">
        <Stat label="Transactions" value={data?.transactionsToday ?? '—'} />
        <Stat
          label="Volume moved"
          value={data ? formatMoney(data.volumeToday) : '—'}
        />
      </div>

      <div className="section-title">Customers</div>
      <div className="grid">
        <Stat label="Approved" value={data?.activeCustomers ?? '—'} />
        <Stat
          label="Awaiting approval"
          value={data?.pendingApprovals ?? '—'}
          warn={(data?.pendingApprovals ?? 0) > 0}
        />
      </div>

      <div className="section-title">Accounts</div>
      <div className="grid">
        <Stat label="Open accounts" value={data?.totalAccounts ?? '—'} />
        <Stat
          label="Frozen"
          value={data?.frozenAccounts ?? '—'}
          warn={(data?.frozenAccounts ?? 0) > 0}
        />
      </div>

      <div className="section-title">All time</div>
      <div className="card">
        <div className="stat-label">Total volume processed</div>
        <div className="stat-value">
          {data ? formatMoney(data.volumeAllTime) : '—'}{' '}
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {data?.currency}
          </span>
        </div>
      </div>
    </>
  );
}
