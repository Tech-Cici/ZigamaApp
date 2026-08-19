import { useState, type FormEvent } from 'react';
import { Banner, Empty, Loading, PageHead, Pill } from '../components';
import { ApiError, api, type PendingCustomer } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatAccountNumber, formatDate } from '../lib/format';
import { useApi } from '../useApi';

/**
 * Split by role on purpose. An administrator opens accounts here; a manager
 * signs them off. Showing each of them only the half they may perform makes
 * the separation of duties visible rather than a surprise 403.
 */
export default function Onboarding() {
  const { user } = useAuth();
  return user?.role === 'ADMIN' ? <NewCustomer /> : <ApprovalQueue />;
}

function NewCustomer() {
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    pin: '',
    accountType: 'CHECKING' as 'CHECKING' | 'SAVINGS',
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const valid =
    form.fullName.trim().length >= 3 &&
    form.email.includes('@') &&
    /^\d{4,6}$/.test(form.pin);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const created = await api.createCustomer({
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        pin: form.pin,
        accountType: form.accountType,
      });
      setSuccess(
        `Account ${formatAccountNumber(created.accounts[0].accountNumber)} opened for ` +
          `${created.fullName}. A branch manager must approve it before they can sign in.`,
      );
      setForm({ ...form, fullName: '', email: '', phone: '', pin: '' });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not open the account.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead
        title="Open a customer account"
        subtitle="You cannot approve accounts you open — a branch manager reviews them."
      />

      <form className="card" style={{ maxWidth: 520 }} onSubmit={submit}>
        <Banner kind="error">{error}</Banner>
        <Banner kind="success">{success}</Banner>

        <div className="field">
          <label htmlFor="fullName">Full name</label>
          <input
            id="fullName"
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            placeholder="Grace Uwase"
          />
        </div>

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="customer@example.com"
          />
        </div>

        <div className="field">
          <label htmlFor="phone">Phone (optional)</label>
          <input
            id="phone"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="+250 780 000 000"
          />
          <div className="hint">
            Mobile money payouts go to this number, so it is worth capturing.
          </div>
        </div>

        <div className="field">
          <label htmlFor="accountType">Account type</label>
          <select
            id="accountType"
            value={form.accountType}
            onChange={(e) =>
              setForm({
                ...form,
                accountType: e.target.value as 'CHECKING' | 'SAVINGS',
              })
            }
          >
            <option value="CHECKING">Current</option>
            <option value="SAVINGS">Savings</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="pin">Initial PIN</label>
          <input
            id="pin"
            type="password"
            inputMode="numeric"
            value={form.pin}
            onChange={(e) =>
              setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })
            }
            placeholder="••••"
          />
          <div className="hint">
            Chosen by the customer at the desk. Not a repeated digit or a run
            like 1234.
          </div>
        </div>

        <button type="submit" className="btn-primary" disabled={!valid || busy}>
          {busy ? 'Opening…' : 'Open account'}
        </button>
      </form>
    </>
  );
}

function ApprovalQueue() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useApi(() => api.pendingCustomers());
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function decide(application: PendingCustomer, approve: boolean) {
    if (approve && !window.confirm(`Approve ${application.fullName}?`)) return;

    const reason = approve
      ? undefined
      : window.prompt('Why is this application being rejected?');
    if (!approve && !reason) return;

    setActionError(null);
    setBusyId(application.id);
    try {
      if (approve) await api.approveCustomer(application.id);
      else await api.rejectCustomer(application.id, reason!);
      await reload();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : 'Could not record the decision.',
      );
    } finally {
      setBusyId(null);
    }
  }

  if (loading && !data) return <Loading label="Loading applications" />;

  const rows = data?.data ?? [];

  return (
    <>
      <PageHead
        title="Approvals"
        subtitle="You cannot approve an application you created yourself."
      />

      <Banner kind="error">{error ?? actionError}</Banner>

      <div className="card" style={{ padding: 0 }}>
        {rows.length === 0 ? (
          <Empty>
            Nothing waiting. New applications from an administrator appear here.
          </Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Account</th>
                <th>Opened by</th>
                <th>Raised</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((application) => {
                const ownWork = application.createdBy?.id === user?.id;
                return (
                  <tr key={application.id}>
                    <td>
                      <strong>{application.fullName}</strong>
                      <div className="muted">{application.email}</div>
                    </td>
                    <td className="mono">
                      {application.accounts
                        .map((a) => formatAccountNumber(a.accountNumber))
                        .join(', ')}
                    </td>
                    <td>{application.createdBy?.fullName ?? 'unknown'}</td>
                    <td className="muted">{formatDate(application.createdAt)}</td>
                    <td>
                      {ownWork ? (
                        <Pill label="your own — needs someone else" tone="warning" />
                      ) : (
                        <div className="row">
                          <button
                            className="btn-danger"
                            disabled={busyId === application.id}
                            onClick={() => void decide(application, false)}
                          >
                            Reject
                          </button>
                          <button
                            className="btn-primary"
                            disabled={busyId === application.id}
                            onClick={() => void decide(application, true)}
                          >
                            {busyId === application.id ? '…' : 'Approve'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
