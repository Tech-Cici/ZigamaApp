import { useState } from 'react';
import { Banner, Empty, Loading, PageHead, Pill, statusTone } from '../components';
import { ApiError, api, type AccountView } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatAccountNumber, formatDate, formatMoney } from '../lib/format';
import { useApi } from '../useApi';

export default function Customers() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, error, loading, reload } = useApi(() => api.users(applied));

  async function toggleFreeze(account: AccountView, holder: string) {
    const freezing = account.status !== 'FROZEN';
    const question = freezing
      ? `Freeze ${formatAccountNumber(account.accountNumber)} (${holder})?\n\nDeposits, withdrawals and transfers will all be blocked.`
      : `Unfreeze ${formatAccountNumber(account.accountNumber)} (${holder})?`;
    if (!window.confirm(question)) return;

    setActionError(null);
    setBusyId(account.id);
    try {
      await api.setAccountStatus(account.id, freezing ? 'FROZEN' : 'ACTIVE');
      await reload();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : 'Could not update the account.',
      );
    } finally {
      setBusyId(null);
    }
  }

  if (loading && !data) return <Loading label="Loading customers" />;

  const rows = data?.data ?? [];

  return (
    <>
      <PageHead
        title="Customers"
        subtitle={
          isAdmin
            ? 'Freezing an account blocks every money movement on it.'
            : 'Read only. Freezing an account requires an administrator.'
        }
      />

      <form
        className="row"
        style={{ marginBottom: 16, maxWidth: 460 }}
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(search.trim());
        }}
      >
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email or account number"
        />
        <button className="btn-secondary" type="submit">
          Search
        </button>
      </form>

      <Banner kind="error">{error ?? actionError}</Banner>

      <div className="card" style={{ padding: 0 }}>
        {rows.length === 0 ? (
          <Empty>No customers match that search.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Accounts</th>
                <th className="num">Total held</th>
                <th>Status</th>
                <th>Last seen</th>
                {isAdmin ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((customer) => (
                <tr key={customer.id}>
                  <td>
                    <strong>{customer.fullName}</strong>
                    <div className="muted">{customer.email}</div>
                  </td>
                  <td>
                    {customer.accounts.map((account) => (
                      <div key={account.id} style={{ marginBottom: 4 }}>
                        <span className="mono">
                          {formatAccountNumber(account.accountNumber)}
                        </span>{' '}
                        <span className="muted">
                          {account.type === 'CHECKING' ? 'Current' : 'Savings'} ·{' '}
                          {formatMoney(account.balance)}
                        </span>{' '}
                        {account.status !== 'ACTIVE' ? (
                          <Pill
                            label={account.status.toLowerCase()}
                            tone={statusTone(account.status)}
                          />
                        ) : null}
                      </div>
                    ))}
                  </td>
                  <td className="num">
                    <strong>{formatMoney(customer.totalBalance)}</strong>
                  </td>
                  <td>
                    {!customer.isActive ? (
                      <Pill label="inactive" tone="danger" />
                    ) : customer.isLocked ? (
                      <Pill label="locked" tone="warning" />
                    ) : (
                      <Pill label="active" tone="positive" />
                    )}
                  </td>
                  <td className="muted">
                    {customer.lastLoginAt
                      ? formatDate(customer.lastLoginAt)
                      : 'never'}
                  </td>
                  {isAdmin ? (
                    <td>
                      {customer.accounts.map((account) => (
                        <button
                          key={account.id}
                          className={
                            account.status === 'FROZEN'
                              ? 'btn-secondary'
                              : 'btn-danger'
                          }
                          style={{ marginBottom: 4, display: 'block' }}
                          disabled={busyId === account.id}
                          onClick={() => void toggleFreeze(account, customer.fullName)}
                        >
                          {busyId === account.id
                            ? '…'
                            : account.status === 'FROZEN'
                              ? 'Unfreeze'
                              : 'Freeze'}
                        </button>
                      ))}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
