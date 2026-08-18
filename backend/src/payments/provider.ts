import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * What a payment provider has to be able to do.
 *
 * Everything provider-specific lives behind this interface so the money logic
 * never learns which rail it is on. Swapping MTN for Airtel, or the mock for a
 * real provider, is a change of one binding in the module.
 */
export interface PaymentProvider {
  readonly name: string;

  /** Ask the customer to approve paying money in (a "collection"). */
  requestToPay(input: {
    amountMinor: bigint;
    currency: string;
    msisdn: string;
    /** Passed to the provider so *their* side is idempotent too. */
    idempotencyKey: string;
    reference: string;
  }): Promise<{ providerRef: string; status: ProviderStatus }>;

  /** Send money out to a phone number (a "disbursement"). */
  payout(input: {
    amountMinor: bigint;
    currency: string;
    msisdn: string;
    idempotencyKey: string;
    reference: string;
  }): Promise<{ providerRef: string; status: ProviderStatus }>;

  /**
   * The provider's own view of a transaction. This is the source of truth —
   * webhooks get lost, so reconciliation always asks rather than assumes.
   */
  getStatus(providerRef: string): Promise<{ status: ProviderStatus; raw?: unknown }>;

  /** Confirms a callback really came from the provider. */
  verifySignature(rawBody: Buffer, signature: string | undefined): boolean;
}

export type ProviderStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

/**
 * Compares HMAC signatures without leaking timing information.
 *
 * `a === b` on secrets returns as soon as bytes differ, which measurably
 * reveals how much of a guess was correct. Length is checked first because
 * timingSafeEqual throws on mismatched lengths.
 */
export function signaturesMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function hmacHex(secret: string, body: Buffer): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function providerReference(prefix: string): string {
  return `${prefix}-${randomBytes(8).toString('hex').toUpperCase()}`;
}
