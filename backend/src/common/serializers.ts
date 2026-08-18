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

/**
 * Whether an entry adds to the account or takes from it.
 *
 * Written as an exhaustive map rather than a set of "the credits", so adding a
 * transaction type is a compile error here until its direction is declared.
 * Getting this wrong silently flips a sign on someone's statement.
 */
const ENTRY_DIRECTION: Record<TransactionType, '+' | '-'> = {
  DEPOSIT: '+',
  TRANSFER_IN: '+',
  REVERSAL_CREDIT: '+',
  WITHDRAWAL: '-',
  TRANSFER_OUT: '-',
  REVERSAL_DEBIT: '-',
};

/**
 * The credit types, derived from the map above so there is exactly one place
 * that decides direction. Raw SQL that has to classify entries builds its
 * predicate from this rather than repeating the list — a second copy would
 * silently misclassify the next type someone adds.
 */
export const CREDIT_TRANSACTION_TYPES = (
  Object.keys(ENTRY_DIRECTION) as TransactionType[]
).filter((type) => ENTRY_DIRECTION[type] === '+');


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
    direction: ENTRY_DIRECTION[transaction.type],
    currency: transaction.currency,
    balanceAfter: formatMinor(transaction.balanceAfter),
    description: transaction.description,
    counterpartyAccountNumber:
      transaction.counterpartyAccount?.accountNumber ?? null,
    createdAt: transaction.createdAt,
  };
}
