import type { ReactNode } from 'react';

export function Banner({
  kind,
  children,
}: {
  kind: 'error' | 'success' | 'info';
  children: ReactNode;
}) {
  if (!children) return null;
  return (
    <div className={`banner ${kind}`} role={kind === 'error' ? 'alert' : undefined}>
      {children}
    </div>
  );
}

export function Pill({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'positive' | 'warning' | 'danger';
}) {
  return <span className={`pill ${tone === 'neutral' ? '' : tone}`}>{label}</span>;
}

export function Stat({
  label,
  value,
  warn,
}: {
  label: string;
  value: string | number;
  warn?: boolean;
}) {
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value${warn ? ' warn' : ''}`}>{value}</div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return <div className="empty">{label}…</div>;
}

export function PageHead({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head row" style={{ justifyContent: 'space-between' }}>
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="page-sub">{subtitle}</p> : null}
      </div>
      {actions}
    </div>
  );
}

/** Maps a movement or account status to a colour, so it reads at a glance. */
export function statusTone(
  status: string,
): 'neutral' | 'positive' | 'warning' | 'danger' {
  switch (status) {
    case 'COMPLETED':
    case 'ACTIVE':
    case 'APPROVED':
      return 'positive';
    case 'PENDING':
    case 'PROCESSING':
    case 'UNRESOLVED':
      return 'warning';
    case 'REJECTED':
    case 'CANCELLED':
    case 'EXPIRED':
    case 'FROZEN':
    case 'CLOSED':
      return 'danger';
    default:
      return 'neutral';
  }
}
