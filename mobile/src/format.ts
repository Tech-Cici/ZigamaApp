/**
 * The API sends money as a decimal string in major units ("1500.50") rather
 * than a number, so no precision is lost in transit. Format the string
 * directly — never parse it to a float first.
 */
export function formatMoney(amount: string): string {
  const negative = amount.startsWith('-');
  const [whole = '0', fraction = '00'] = amount.replace('-', '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${fraction.padEnd(2, '0')}`;
}

export function formatAccountNumber(accountNumber: string): string {
  return accountNumber.replace(/(\d{4})(?=\d)/g, '$1 ');
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return `${formatDate(iso)} · ${date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

const TRANSACTION_LABELS: Record<string, string> = {
  DEPOSIT: 'Deposit',
  WITHDRAWAL: 'Withdrawal',
  TRANSFER_IN: 'Transfer received',
  TRANSFER_OUT: 'Transfer sent',
};

export function transactionLabel(type: string): string {
  return TRANSACTION_LABELS[type] ?? type;
}
