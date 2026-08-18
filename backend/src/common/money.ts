/**
 * Money handling for the platform.
 *
 * Internally every amount is a `bigint` of *minor units* (1 RWF = 100 minor
 * units). Integers are exact, so no rounding error can accumulate across
 * deposits, withdrawals and transfers.
 *
 * At the API boundary amounts are decimal strings in major units ("1500.50"),
 * which is what a client wants to render. Parsing goes through
 * `parseAmountToMinor`, which works on the *string* form of the input so a
 * float like 0.1 + 0.2 can never leak in.
 */

export const MINOR_UNITS_PER_MAJOR = 100n;
const MINOR_UNIT_DIGITS = 2;

/** Largest amount a single operation may move: 100,000,000.00 */
export const MAX_TRANSACTION_MINOR = 10_000_000_000n;

export class InvalidAmountError extends Error {}

/**
 * Parse a user-supplied amount in major units into minor units.
 * Accepts "1500", "1500.5", "1500.50" or the equivalent numbers.
 * Rejects negatives, zero, blanks, NaN and more than 2 decimal places.
 */
export function parseAmountToMinor(input: unknown): bigint {
  if (input === null || input === undefined || input === '') {
    throw new InvalidAmountError('Amount is required');
  }

  let raw: string;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      throw new InvalidAmountError('Amount must be a finite number');
    }
    // Number -> string before any arithmetic, so binary float artefacts
    // (0.30000000000000004) never reach the ledger.
    raw = input.toFixed(MINOR_UNIT_DIGITS);
  } else if (typeof input === 'string') {
    raw = input.trim();
  } else {
    throw new InvalidAmountError('Amount must be a number or a numeric string');
  }

  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) {
    throw new InvalidAmountError(
      'Amount must be a positive value with at most 2 decimal places',
    );
  }

  const [, majorPart, fractionPart = ''] = match;
  const fraction = fractionPart.padEnd(MINOR_UNIT_DIGITS, '0');
  const minor = BigInt(majorPart) * MINOR_UNITS_PER_MAJOR + BigInt(fraction);

  if (minor <= 0n) {
    throw new InvalidAmountError('Amount must be greater than zero');
  }
  if (minor > MAX_TRANSACTION_MINOR) {
    throw new InvalidAmountError(
      `Amount exceeds the maximum of ${formatMinor(MAX_TRANSACTION_MINOR)}`,
    );
  }

  return minor;
}

/** Render minor units as a decimal string in major units: 150050n -> "1500.50". */
export function formatMinor(minor: bigint): string {
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;

  const major = absolute / MINOR_UNITS_PER_MAJOR;
  const fraction = absolute % MINOR_UNITS_PER_MAJOR;

  const rendered = `${major}.${fraction.toString().padStart(MINOR_UNIT_DIGITS, '0')}`;
  return negative ? `-${rendered}` : rendered;
}
