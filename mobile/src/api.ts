import { API_URL, IS_REMOTE_API } from './config';

export interface AccountView {
  id: string;
  accountNumber: string;
  type: 'CHECKING' | 'SAVINGS';
  status: 'ACTIVE' | 'FROZEN' | 'CLOSED';
  balance: string;
  currency: string;
  createdAt: string;
}

export interface TransactionView {
  id: string;
  reference: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER_IN' | 'TRANSFER_OUT';
  status: 'COMPLETED' | 'REVERSED';
  amount: string;
  direction: '+' | '-';
  currency: string;
  balanceAfter: string;
  description: string | null;
  counterpartyAccountNumber: string | null;
  createdAt: string;
}

export interface AdminTransactionView extends TransactionView {
  accountNumber: string;
  accountHolder: string;
  accountHolderId: string;
}

export interface Dashboard {
  user: { id: string; fullName: string; role: Role };
  totalBalance: string;
  currency: string;
  accounts: AccountView[];
  recentTransactions: TransactionView[];
}

export type Role = 'CUSTOMER' | 'MANAGER' | 'ADMIN';

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

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface PendingCustomer {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  createdAt: string;
  /** Who opened the record — a manager may not approve their own. */
  createdBy: { id: string; fullName: string } | null;
  accounts: { accountNumber: string; type: string; status: string }[];
}

export interface CustomerRecord {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  approvalStatus: ApprovalStatus;
  rejectionReason: string | null;
  approvedAt: string | null;
  createdBy: { id: string; fullName: string } | null;
  approvedBy: { id: string; fullName: string } | null;
  createdAt: string;
  accounts: {
    id: string;
    accountNumber: string;
    type: string;
    status: string;
    balance: string;
    currency: string;
  }[];
}

export type MovementDirection = 'DEPOSIT' | 'WITHDRAWAL';
export type MovementStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'UNRESOLVED';

export interface MovementView {
  id: string;
  reference: string;
  direction: MovementDirection;
  channel: 'BRANCH_CASH' | 'MOBILE_MONEY';
  status: MovementStatus;
  amount: string;
  currency: string;
  providerRef: string | null;
  failureReason: string | null;
  slipReference: string | null;
  branchName: string | null;
  depositedAt: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  accountNumber: string;
  accountHolder: string;
}

export interface Paginated<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

/**
 * An error carrying the HTTP status, so callers can tell "you typed the wrong
 * PIN" (401) apart from "the server is unreachable" (0) and say something
 * useful either way.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Free hosting tiers idle a server out after a few minutes and take 30-60s to
 * boot it again. The first request after that would hit the normal timeout and
 * look like an outage, so remote deployments get a much longer budget until one
 * request has succeeded. After that the server is warm and the normal timeout
 * applies.
 */
const COLD_START_TIMEOUT_MS = 75_000;

let serverIsWarm = false;

/** True while we are waiting on what is probably a cold start. */
export function isProbablyColdStart(): boolean {
  return IS_REMOTE_API && !serverIsWarm;
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const controller = new AbortController();
  const budget = isProbablyColdStart()
    ? COLD_START_TIMEOUT_MS
    : REQUEST_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), budget);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    // A network-level failure is by far the most common problem when running
    // against a laptop, so say something actionable instead of "Network
    // request failed".
    const aborted = (error as Error)?.name === 'AbortError';
    throw new ApiError(
      aborted
        ? IS_REMOTE_API
          ? 'The server is taking too long to wake up. Free hosting sleeps when idle — please try again in a moment.'
          : 'The request timed out. Is the API still running?'
        : IS_REMOTE_API
          ? 'Could not reach the server. Check your internet connection and try again.'
          : `Could not reach the server at ${API_URL}. Check that the API is running and that your phone is on the same network.`,
      0,
    );
  } finally {
    clearTimeout(timeout);
  }

  // Anything at all coming back means the instance is up.
  serverIsWarm = true;

  const text = await response.text();
  const payload = text ? safeParse(text) : null;

  if (!response.ok) {
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

export const api = {
  loginCustomer: (accountNumber: string, pin: string) =>
    request<{ token: string; user: SessionUser }>('/auth/login', {
      method: 'POST',
      body: { accountNumber, pin },
    }),

  loginStaff: (email: string, password: string) =>
    request<{ token: string; user: SessionUser }>('/auth/staff/login', {
      method: 'POST',
      body: { email, password },
    }),

  me: () => request<SessionUser>('/auth/me'),

  /**
   * Cheap unauthenticated ping. Called on launch so a sleeping free-tier
   * instance starts booting while the user is still typing their PIN, instead
   * of after they press Sign in.
   */
  health: () =>
    request<{ status: string; database: string }>('/health'),

  dashboard: () => request<Dashboard>('/accounts/dashboard'),

  lookupAccount: (accountNumber: string) =>
    request<{
      accountNumber: string;
      accountHolder: string;
      status: string;
      currency: string;
    }>(`/accounts/lookup/${accountNumber}`),

  deposit: (accountId: string, amount: string, description?: string) =>
    request<TransactionView>('/transactions/deposit', {
      method: 'POST',
      body: { accountId, amount, description },
    }),

  withdraw: (accountId: string, amount: string, description?: string) =>
    request<TransactionView>('/transactions/withdraw', {
      method: 'POST',
      body: { accountId, amount, description },
    }),

  transfer: (
    fromAccountId: string,
    toAccountNumber: string,
    amount: string,
    description?: string,
  ) =>
    request<TransactionView>('/transactions/transfer', {
      method: 'POST',
      body: { fromAccountId, toAccountNumber, amount, description },
    }),

  history: (page = 1, limit = 25, accountId?: string) =>
    request<Paginated<TransactionView>>(
      `/transactions?page=${page}&limit=${limit}` +
        (accountId ? `&accountId=${accountId}` : ''),
    ),

  // --- Cash movements needing confirmation -----------------------------

  declareBranchDeposit: (input: {
    accountId: string;
    amount: string;
    slipReference: string;
    branchName: string;
  }) =>
    request<MovementView>('/movements/deposits/branch', {
      method: 'POST',
      body: input,
    }),

  requestBranchWithdrawal: (input: {
    accountId: string;
    amount: string;
    branchName: string;
  }) =>
    request<MovementView>('/movements/withdrawals/branch', {
      method: 'POST',
      body: input,
    }),

  momoDeposit: (input: {
    accountId: string;
    amount: string;
    idempotencyKey: string;
  }) =>
    request<MovementView>('/movements/deposits/momo', {
      method: 'POST',
      body: input,
    }),

  momoWithdrawal: (input: {
    accountId: string;
    amount: string;
    idempotencyKey: string;
  }) =>
    request<MovementView>('/movements/withdrawals/momo', {
      method: 'POST',
      body: input,
    }),

  myMovements: () => request<Paginated<MovementView>>('/movements/mine'),

  cancelMovement: (id: string) =>
    request<MovementView>(`/movements/${id}/cancel`, { method: 'POST' }),

  pendingMovements: () =>
    request<Paginated<MovementView>>('/movements/pending'),

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

  adminStats: () => request<AdminStats>('/admin/stats'),

  adminUsers: (search = '', page = 1) =>
    request<Paginated<AdminUserRow>>(
      `/admin/users?page=${page}&limit=20` +
        (search ? `&search=${encodeURIComponent(search)}` : ''),
    ),

  adminTransactions: (page = 1, limit = 25) =>
    request<Paginated<AdminTransactionView>>(
      `/admin/transactions?page=${page}&limit=${limit}`,
    ),

  setAccountStatus: (accountId: string, status: 'ACTIVE' | 'FROZEN' | 'CLOSED') =>
    request<AccountView>(`/admin/accounts/${accountId}/status`, {
      method: 'PATCH',
      body: { status },
    }),

  createCustomer: (input: {
    fullName: string;
    email: string;
    phone?: string;
    pin: string;
    accountType?: 'CHECKING' | 'SAVINGS';
  }) =>
    request<CustomerRecord>('/admin/customers', {
      method: 'POST',
      body: input,
    }),

  pendingCustomers: () =>
    request<Paginated<PendingCustomer>>('/admin/customers/pending'),

  approveCustomer: (id: string) =>
    request<CustomerRecord>(`/admin/customers/${id}/approve`, {
      method: 'POST',
    }),

  rejectCustomer: (id: string, reason: string) =>
    request<CustomerRecord>(`/admin/customers/${id}/reject`, {
      method: 'POST',
      body: { reason },
    }),

  setUserActive: (userId: string, isActive: boolean) =>
    request<{ id: string; isActive: boolean }>(`/admin/users/${userId}/status`, {
      method: 'PATCH',
      body: { isActive },
    }),
};
