import { Injectable, Logger } from '@nestjs/common';
import {
  hmacHex,
  providerReference,
  signaturesMatch,
  type PaymentProvider,
  type ProviderStatus,
} from './provider';

/**
 * A stand-in for a real mobile money provider.
 *
 * This exists so the whole payment flow — request, callback, idempotency,
 * reconciliation — can be demonstrated and tested with no credentials, no
 * network, and no public URL for webhooks. MTN's sandbox needs an API user and
 * subscription key you have to register for, and it cannot reach `localhost`.
 *
 * It deliberately does **not** fire callbacks on a timer. Tests and demos post
 * the webhook themselves, which makes replay, duplication and out-of-order
 * delivery something you can actually exercise rather than hope about.
 *
 * Amounts ending in specific cents let a caller choose an outcome:
 *   .01 -> the provider will report failure
 *   .02 -> the provider never resolves (simulates a timeout)
 * anything else succeeds.
 */
@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';

  private readonly logger = new Logger(MockPaymentProvider.name);

  /** Outcome the mock will report for a given reference, set at request time. */
  private readonly scripted = new Map<string, ProviderStatus>();

  async requestToPay(input: {
    amountMinor: bigint;
    msisdn: string;
    idempotencyKey: string;
  }) {
    const providerRef = providerReference('MOCKC');
    const status = this.scriptFor(input.amountMinor);
    this.scripted.set(providerRef, status);

    this.logger.log(
      `mock collection ${providerRef} for ${input.msisdn}, will report ${status}`,
    );
    return { providerRef, status: 'PENDING' as ProviderStatus };
  }

  async payout(input: {
    amountMinor: bigint;
    msisdn: string;
    idempotencyKey: string;
  }) {
    const providerRef = providerReference('MOCKD');
    const status = this.scriptFor(input.amountMinor);
    this.scripted.set(providerRef, status);

    this.logger.log(
      `mock payout ${providerRef} to ${input.msisdn}, will report ${status}`,
    );
    return { providerRef, status: 'PENDING' as ProviderStatus };
  }

  async getStatus(providerRef: string) {
    const scripted = this.scripted.get(providerRef);
    // An unknown reference is reported as UNKNOWN rather than FAILED. Guessing
    // "failed" would let reconciliation hand money back for a payout that may
    // actually have gone out.
    return { status: scripted ?? ('UNKNOWN' as ProviderStatus) };
  }

  verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
    const secret = process.env.PAYMENT_WEBHOOK_SECRET;
    if (!secret || !signature) return false;
    return signaturesMatch(hmacHex(secret, rawBody), signature);
  }

  /** Lets a test or demo pick the outcome through the amount's cents. */
  private scriptFor(amountMinor: bigint): ProviderStatus {
    const cents = Number(amountMinor % 100n);
    if (cents === 1) return 'FAILED';
    if (cents === 2) return 'UNKNOWN';
    return 'SUCCEEDED';
  }
}
