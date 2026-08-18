import type {
  AccountStatus,
  AccountType,
  TransactionStatus,
  TransactionType,
} from '../../generated/prisma/enums.ts';
import { formatMinor } from './money';

/**
 * Everything crossing the API boundary goes through here. BigInt is not
 * JSON-serialisable and raw minor units are meaningless to a client, so
 * balances and amounts leave as decimal strings in major units.
 */

export interface AccountView {
  id: string;
  accountNumber: string;
  type: AccountType;
  status: AccountStatus;
  balance: string;
  currency: string;
  createdAt: Date;
}

export function serializeAccount(account: {
  id: string;
  accountNumber: string;
  type: AccountType;
  status: AccountStatus;
  balance: bigint;
  currency: string;
  createdAt: Date;
}): AccountView {
  return {
    id: account.id,
    accountNumber: account.accountNumber,
    type: account.type,
    status: account.status,
    balance: formatMinor(account.balance),
    currency: account.currency,
    createdAt: account.createdAt,
  };
}

export interface TransactionView {
  id: string;
  reference: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: string;
  /** '+' when the entry increased the account's balance, '-' when it reduced it. */
  direction: '+' | '-';
  currency: string;
  balanceAfter: string;
  description: string | null;
  counterpartyAccountNumber: string | null;
  createdAt: Date;
}

const CREDIT_TYPES = new Set<TransactionType>(['DEPOSIT', 'TRANSFER_IN']);

export function serializeTransaction(transaction: {
  id: string;
  reference: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: bigint;
  currency: string;
  balanceAfter: bigint;
  description: string | null;
  createdAt: Date;
  counterpartyAccount?: { accountNumber: string } | null;
}): TransactionView {
  return {
    id: transaction.id,
    reference: transaction.reference,
    type: transaction.type,
    status: transaction.status,
    amount: formatMinor(transaction.amount),
    direction: CREDIT_TYPES.has(transaction.type) ? '+' : '-',
    currency: transaction.currency,
    balanceAfter: formatMinor(transaction.balanceAfter),
    description: transaction.description,
    counterpartyAccountNumber:
      transaction.counterpartyAccount?.accountNumber ?? null,
    createdAt: transaction.createdAt,
  };
}
