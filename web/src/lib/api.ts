/**
 * Client for the Zigama API.
 *
 * Deliberately a near-copy of the mobile client rather than a shared package.
 * The two apps call different halves of the API and will drift apart; a
 * workspace package to share ~400 lines would cost more in build plumbing than
 * the duplication costs in maintenance at this size.
 */

const RAW_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';
export const API_URL = RAW_BASE.replace(/\/+$/, '');

const TOKEN_KEY = 'zigama.staff.token';

/**
 * The session token lives in localStorage, which any script on this origin can
 * read. For a console that can freeze accounts and approve money, httpOnly
 * cookies plus CSRF protection would be materially better — that is a backend
 * change and is noted as a known gap in the README rather than pretended away.
 */
export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private browsing can block storage; the session still works in-memory.
  }
}

export class ApiError extends Error {
  // Declared and assigned explicitly rather than as a constructor parameter
  // property: this project builds with `erasableSyntaxOnly`, which only allows
  // TypeScript that erases to nothing at runtime.
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

const TIMEOUT_MS = 20_000;

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const token = getToken();

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = (error as Error)?.name === 'AbortError';
    throw new ApiError(
      aborted
        ? 'The server took too long to respond.'
        : `Could not reach the API at ${API_URL}. Is it running?`,
      0,
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  const payload = text ? safeParse(text) : null;

  if (!response.ok) {
    // A rejected token ends the session. Login is excluded: a wrong password is
    // also a 401 and signing out in response to it would be pointless.
    if (response.status === 401 && !path.startsWith('/auth/')) {
      onUnauthorized?.();
    }
    throw new ApiError(extractMessage(payload, response.status), response.status);
  }

  return payload as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractMessage(payload: unknown, status: number): string {
  const message = (payload as { message?: string | string[] })?.message;
  if (Array.isArray(message)) return message[0];
  if (typeof message === 'string') return message;
  return `Request failed (${status})`;
}

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

export type Role = 'CUSTOMER' | 'MANAGER' | 'ADMIN';
export type AccountStatus = 'PENDING' | 'ACTIVE' | 'FROZEN' | 'CLOSED';
export type MovementStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'UNRESOLVED';

export interface SessionUser {
  id: string;
  fullName: string;
  email: string;
  role: Role;
}

export interface AdminStats {
  totalCustomers: number;
  activeCustomers: number;
  pendingApprovals: number;
  totalAccounts: number;
  frozenAccounts: number;
  totalHoldings: string;
  transactionsToday: number;
  volumeToday: string;
  volumeAllTime: string;
  currency: string;
}

export interface AccountView {
  id: string;
  accountNumber: string;
  type: 'CHECKING' | 'SAVINGS';
  status: AccountStatus;
  balance: string;
  currency: string;
}

export interface AdminUserRow {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: Role;
  isActive: boolean;
  isLocked: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  accounts: AccountView[];
  totalBalance: string;
}

export interface PendingCustomer {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  createdAt: string;
  createdBy: { id: string; fullName: string } | null;
  accounts: { accountNumber: string; type: string; status: string }[];
}

export interface CustomerRecord {
  id: string;
  fullName: string;
  email: string;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdBy: { id: string; fullName: string } | null;
  approvedBy: { id: string; fullName: string } | null;
  accounts: AccountView[];
}

export interface MovementView {
  id: string;
  reference: string;
  direction: 'DEPOSIT' | 'WITHDRAWAL';
  channel: 'BRANCH_CASH' | 'MOBILE_MONEY';
  status: MovementStatus;
  amount: string;
  currency: string;
  providerRef: string | null;
  failureReason: string | null;
  slipReference: string | null;
  branchName: string | null;
  createdAt: string;
  accountNumber: string;
  accountHolder: string;
}

export interface AdminTransactionView {
  id: string;
  reference: string;
  type: string;
  amount: string;
  direction: '+' | '-';
  currency: string;
  balanceAfter: string;
  description: string | null;
  counterpartyAccountNumber: string | null;
  createdAt: string;
  accountNumber: string;
  accountHolder: string;
}

export interface Paginated<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface ReconciliationReport {
  ranAt: string;
  webhookRetries: { attempted: number; deadLettered: number };
  expiredWithdrawals: number;
  resolvedFromProvider: {
    settled: number;
    reversed: number;
    stillUnknown: number;
  };
  ledgerMismatches: { accountNumber: string; stored: string; ledger: string }[];
}

// ---------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------

export const api = {
  loginStaff: (email: string, password: string) =>
    request<{ token: string; user: SessionUser }>('/auth/staff/login', {
      method: 'POST',
      body: { email, password },
    }),

  me: () => request<SessionUser>('/auth/me'),

  stats: () => request<AdminStats>('/admin/stats'),

  users: (search = '', page = 1) =>
    request<Paginated<AdminUserRow>>(
      `/admin/users?page=${page}&limit=25` +
        (search ? `&search=${encodeURIComponent(search)}` : ''),
    ),

  transactions: (page = 1) =>
    request<Paginated<AdminTransactionView>>(
      `/admin/transactions?page=${page}&limit=25`,
    ),

  setAccountStatus: (accountId: string, status: AccountStatus) =>
    request<AccountView>(`/admin/accounts/${accountId}/status`, {
      method: 'PATCH',
      body: { status },
    }),

  // --- onboarding ---
  pendingCustomers: () =>
    request<Paginated<PendingCustomer>>('/admin/customers/pending'),

  createCustomer: (input: {
    fullName: string;
    email: string;
    phone?: string;
    pin: string;
    accountType?: 'CHECKING' | 'SAVINGS';
  }) =>
    request<CustomerRecord>('/admin/customers', { method: 'POST', body: input }),

  approveCustomer: (id: string) =>
    request<CustomerRecord>(`/admin/customers/${id}/approve`, {
      method: 'POST',
    }),

  rejectCustomer: (id: string, reason: string) =>
    request<CustomerRecord>(`/admin/customers/${id}/reject`, {
      method: 'POST',
      body: { reason },
    }),

  // --- cash desk ---
  pendingMovements: () => request<Paginated<MovementView>>('/movements/pending'),

  approveMovement: (id: string, note?: string) =>
    request<MovementView>(`/movements/${id}/approve`, {
      method: 'POST',
      body: { note },
    }),

  rejectMovement: (id: string, reason: string) =>
    request<MovementView>(`/movements/${id}/reject`, {
      method: 'POST',
      body: { reason },
    }),

  // --- reconciliation ---
  runReconciliation: () =>
    request<ReconciliationReport>('/admin/reconciliation/run', {
      method: 'POST',
    }),

  unresolved: () =>
    request<{ data: Array<Record<string, unknown>> }>(
      '/admin/reconciliation/unresolved',
    ),

  deadLetters: () =>
    request<{ data: Array<Record<string, unknown>> }>(
      '/admin/reconciliation/dead-letters',
    ),

  webhookEvents: () =>
    request<{ data: Array<Record<string, unknown>> }>(
      '/admin/reconciliation/webhooks',
    ),
};
