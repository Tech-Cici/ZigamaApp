import { useState } from 'react';
import { Banner, Empty, Loading, PageHead, Pill, statusTone } from '../components';
import { ApiError, api, type MovementView } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatAccountNumber, formatDateTime, formatMoney } from '../lib/format';
import { useApi } from '../useApi';

/**
 * The cash desk.
 *
 * A deposit here is an unverified claim — approving it is what creates the
 * money in the customer's account, so the slip reference has to be checked
 * against the branch record first. A withdrawal is the opposite: the money is
 * already held, and approving only records that the cash was handed over.
 */
export default function CashDesk() {
  const { user } = useAuth();
  const isManager = user?.role === 'MANAGER';
  const { data, error, loading, reload } = useApi(() => api.pendingMovements());
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function decide(movement: MovementView, approve: boolean) {
    const isDeposit = movement.direction === 'DEPOSIT';

    if (approve) {
      const question = isDeposit
        ? `Credit ${formatMoney(movement.amount)} ${movement.currency} to ${movement.accountHolder}?\n\n` +
          `Check slip ${movement.slipReference} against the branch record first.`
        : `Confirm ${formatMoney(movement.amount)} ${movement.currency} was handed to ${movement.accountHolder}?`;
      if (!window.confirm(question)) return;
    }

    const reason = approve
      ? undefined
      : window.prompt(
          isDeposit
            ? 'Why is this deposit being rejected?'
            : 'Why is this withdrawal being returned?',
          isDeposit ? 'No matching deposit found at the branch' : 'Cash was not collected',
        );
    if (!approve && !reason) return;

    setActionError(null);
    setBusyId(movement.id);
    try {
      if (approve) await api.approveMovement(movement.id, 'Verified at branch');
      else await api.rejectMovement(movement.id, reason!);
      await reload();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : 'Could not record the decision.',
      );
    } finally {
      setBusyId(null);
    }
  }

  if (loading && !data) return <Loading label="Loading cash desk" />;

  const rows = data?.data ?? [];
  const deposits = rows.filter((r) => r.direction === 'DEPOSIT');
  const withdrawals = rows.filter((r) => r.direction === 'WITHDRAWAL');

  return (
    <>
      <PageHead
        title="Cash desk"
        subtitle={
          isManager
            ? 'Check each deposit slip against the branch record before confirming — approving is what credits the money.'
            : 'Read only. Confirming cash movements requires a branch manager.'
        }
      />

      <Banner kind="error">{error ?? actionError}</Banner>

      <div className="section-title">
        Deposits to verify ({deposits.length})
      </div>
      <MovementTable
        rows={deposits}
        isManager={isManager}
        busyId={busyId}
        onDecide={decide}
        emptyText="No deposit claims waiting."
        approveLabel="Confirm deposit"
      />

      <div className="section-title">
        Cash to hand over ({withdrawals.length})
      </div>
      <MovementTable
        rows={withdrawals}
        isManager={isManager}
        busyId={busyId}
        onDecide={decide}
        emptyText="No withdrawals waiting for collection."
        approveLabel="Cash handed over"
      />
    </>
  );
}

function MovementTable({
  rows,
  isManager,
  busyId,
  onDecide,
  emptyText,
  approveLabel,
}: {
  rows: MovementView[];
  isManager: boolean;
  busyId: string | null;
  onDecide: (movement: MovementView, approve: boolean) => void;
  emptyText: string;
  approveLabel: string;
}) {
  return (
    <div className="card" style={{ padding: 0, marginBottom: 8 }}>
      {rows.length === 0 ? (
        <Empty>{emptyText}</Empty>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Account</th>
              <th>Channel</th>
              <th>Slip / reference</th>
              <th className="num">Amount</th>
              <th>Raised</th>
              {isManager ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((movement) => (
              <tr key={movement.id}>
                <td>
                  <strong>{movement.accountHolder}</strong>
                  <div className="muted">{movement.branchName}</div>
                </td>
                <td className="mono">
                  {formatAccountNumber(movement.accountNumber)}
                </td>
                <td>
                  <Pill
                    label={
                      movement.channel === 'BRANCH_CASH' ? 'branch' : 'mobile money'
                    }
                    tone={statusTone(movement.status)}
                  />
                </td>
                <td className="mono">
                  {movement.slipReference ?? movement.providerRef ?? '—'}
                </td>
                <td className="num">
                  <strong>{formatMoney(movement.amount)}</strong>{' '}
                  <span className="muted">{movement.currency}</span>
                </td>
                <td className="muted">{formatDateTime(movement.createdAt)}</td>
                {isManager ? (
                  <td>
                    <div className="row">
                      <button
                        className="btn-danger"
                        disabled={busyId === movement.id}
                        onClick={() => onDecide(movement, false)}
                      >
                        Reject
                      </button>
                      <button
                        className="btn-primary"
                        disabled={busyId === movement.id}
                        onClick={() => onDecide(movement, true)}
                      >
                        {busyId === movement.id ? '…' : approveLabel}
                      </button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
