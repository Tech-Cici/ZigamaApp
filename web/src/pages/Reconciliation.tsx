import { useState } from 'react';
import { Banner, Empty, Loading, PageHead, Pill } from '../components';
import { ApiError, api, type ReconciliationReport } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import { useApi } from '../useApi';

/**
 * Operational view of the safety net.
 *
 * The sweep runs on a schedule anyway; this is for looking at what it found and
 * running it on demand while investigating something.
 */
export default function Reconciliation() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const unresolved = useApi(() => api.unresolved());
  const deadLetters = useApi(() => api.deadLetters());
  const webhooks = useApi(() => api.webhookEvents());

  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setError(null);
    setBusy(true);
    try {
      setReport(await api.runReconciliation());
      await Promise.all([
        unresolved.reload(),
        deadLetters.reload(),
        webhooks.reload(),
      ]);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not run reconciliation.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (unresolved.loading && !unresolved.data) {
    return <Loading label="Loading reconciliation" />;
  }

  const unresolvedRows = unresolved.data?.data ?? [];
  const deadRows = deadLetters.data?.data ?? [];
  const eventRows = webhooks.data?.data ?? [];

  return (
    <>
      <PageHead
        title="Reconciliation"
        subtitle="Runs automatically every 5 minutes. Mismatches are reported, never auto-repaired."
        actions={
          isAdmin ? (
            <button className="btn-primary" disabled={busy} onClick={run}>
              {busy ? 'Running…' : 'Run now'}
            </button>
          ) : (
            <Pill label="admin only" tone="neutral" />
          )
        }
      />

      <Banner kind="error">{error}</Banner>

      {report ? (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="stat-label">
            Last run · {formatDateTime(report.ranAt)}
          </div>
          <div className="grid" style={{ marginTop: 12, marginBottom: 0 }}>
            <div>
              <div className="stat-label">Webhook retries</div>
              <div className="stat-value">{report.webhookRetries.attempted}</div>
            </div>
            <div>
              <div className="stat-label">Dead-lettered</div>
              <div
                className={`stat-value${report.webhookRetries.deadLettered ? ' warn' : ''}`}
              >
                {report.webhookRetries.deadLettered}
              </div>
            </div>
            <div>
              <div className="stat-label">Withdrawals expired</div>
              <div className="stat-value">{report.expiredWithdrawals}</div>
            </div>
            <div>
              <div className="stat-label">Ledger mismatches</div>
              <div
                className={`stat-value${report.ledgerMismatches.length ? ' warn' : ''}`}
              >
                {report.ledgerMismatches.length}
              </div>
            </div>
          </div>

          {report.ledgerMismatches.length > 0 ? (
            <Banner kind="error">
              {report.ledgerMismatches.length} account(s) do not reconcile — a
              human needs to look at these:{' '}
              {report.ledgerMismatches.map((m) => m.accountNumber).join(', ')}
            </Banner>
          ) : (
            <Banner kind="success">
              Every balance equals the sum of its ledger entries.
            </Banner>
          )}
        </div>
      ) : null}

      <div className="section-title">
        Held with an unknown outcome ({unresolvedRows.length})
      </div>
      <div className="card" style={{ padding: 0, marginBottom: 8 }}>
        {unresolvedRows.length === 0 ? (
          <Empty>
            Nothing unresolved. Payouts whose outcome we cannot establish appear
            here, with the money still held.
          </Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Reference</th>
                <th>Account</th>
                <th>Direction</th>
                <th>Reason</th>
                <th>Raised</th>
              </tr>
            </thead>
            <tbody>
              {unresolvedRows.map((row, index) => (
                <tr key={String(row.id ?? index)}>
                  <td className="mono">{String(row.reference ?? '—')}</td>
                  <td className="mono">{String(row.accountNumber ?? '—')}</td>
                  <td>{String(row.direction ?? '—')}</td>
                  <td className="muted">{String(row.failureReason ?? '—')}</td>
                  <td className="muted">
                    {row.createdAt ? formatDateTime(String(row.createdAt)) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="section-title">
        Dead-lettered callbacks ({deadRows.length})
      </div>
      <div className="card" style={{ padding: 0, marginBottom: 8 }}>
        {deadRows.length === 0 ? (
          <Empty>
            No dead letters. Callbacks that fail five times land here.
          </Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Provider reference</th>
                <th className="num">Attempts</th>
                <th>Last error</th>
              </tr>
            </thead>
            <tbody>
              {deadRows.map((row, index) => (
                <tr key={String(row.id ?? index)}>
                  <td className="mono">{String(row.providerEventId ?? '—')}</td>
                  <td className="mono">{String(row.providerRef ?? '—')}</td>
                  <td className="num">{String(row.attempts ?? '—')}</td>
                  <td className="muted">{String(row.lastError ?? '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="section-title">Recent provider callbacks</div>
      <div className="card" style={{ padding: 0 }}>
        {eventRows.length === 0 ? (
          <Empty>No callbacks received yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Reference</th>
                <th>Status</th>
                <th>Signature</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {eventRows.slice(0, 25).map((row, index) => (
                <tr key={String(row.id ?? index)}>
                  <td className="mono">{String(row.providerEventId ?? '—')}</td>
                  <td className="mono">{String(row.providerRef ?? '—')}</td>
                  <td>
                    <Pill
                      label={String(row.status ?? '—').toLowerCase()}
                      tone={row.status === 'PROCESSED' ? 'positive' : 'warning'}
                    />
                  </td>
                  <td>
                    {row.signatureValid ? (
                      <Pill label="valid" tone="positive" />
                    ) : (
                      <Pill label="invalid" tone="danger" />
                    )}
                  </td>
                  <td className="muted">
                    {row.createdAt ? formatDateTime(String(row.createdAt)) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
