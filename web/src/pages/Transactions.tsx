import { useState } from 'react';
import { Banner, Empty, Loading, PageHead } from '../components';
import { api } from '../lib/api';
import {
  formatAccountNumber,
  formatDateTime,
  formatMoney,
  transactionLabel,
} from '../lib/format';
import { useApi } from '../useApi';

export default function Transactions() {
  const [page, setPage] = useState(1);
  const { data, error, loading } = useApi(() => api.transactions(page));

  if (loading && !data) return <Loading label="Loading transactions" />;

  const rows = data?.data ?? [];
  const pages = data?.pagination.totalPages ?? 1;

  return (
    <>
      <PageHead
        title="Transactions"
        subtitle={
          data
            ? `${data.pagination.total} ledger entries across every account`
            : undefined
        }
      />

      <Banner kind="error">{error}</Banner>

      <div className="card" style={{ padding: 0 }}>
        {rows.length === 0 ? (
          <Empty>No transactions recorded yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Customer</th>
                <th>Account</th>
                <th>Type</th>
                <th className="num">Amount</th>
                <th className="num">Balance after</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <tr key={entry.id}>
                  <td className="muted">{formatDateTime(entry.createdAt)}</td>
                  <td>{entry.accountHolder}</td>
                  <td className="mono">
                    {formatAccountNumber(entry.accountNumber)}
                  </td>
                  <td>
                    {transactionLabel(entry.type)}
                    {entry.counterpartyAccountNumber ? (
                      <div className="muted">
                        {entry.direction === '+' ? 'from' : 'to'}{' '}
                        {entry.counterpartyAccountNumber}
                      </div>
                    ) : null}
                  </td>
                  <td className={`num ${entry.direction === '+' ? 'credit' : 'debit'}`}>
                    {entry.direction}
                    {formatMoney(entry.amount)}
                  </td>
                  <td className="num muted">{formatMoney(entry.balanceAfter)}</td>
                  <td className="mono muted">{entry.reference}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pages > 1 ? (
        <div className="row" style={{ marginTop: 16, justifyContent: 'center' }}>
          <button
            className="btn-secondary"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </button>
          <span className="muted">
            Page {page} of {pages}
          </span>
          <button
            className="btn-secondary"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      ) : null}
    </>
  );
}
