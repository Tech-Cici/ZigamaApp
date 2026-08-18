import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  hmacHex,
  signaturesMatch,
  type PaymentProvider,
  type ProviderStatus,
} from './provider';

/**
 * MTN Mobile Money adapter.
 *
 * Wired but inactive until credentials are configured — set PAYMENT_PROVIDER=mtn
 * along with MTN_SUBSCRIPTION_KEY, MTN_API_USER, MTN_API_KEY and
 * MTN_ENVIRONMENT. Registering those is a manual step on MTN's developer
 * portal, and their sandbox cannot reach `localhost`, so webhooks need a public
 * URL (a tunnel is fine).
 *
 * The mapping from MTN's vocabulary to ours:
 *   requestToPay  -> /collection/v1_0/requesttopay
 *   payout        -> /disbursement/v1_0/transfer
 *   getStatus     -> the matching .../{referenceId} endpoint
 *
 * MTN takes the caller's own UUID as the transaction reference, which is
 * convenient: it means our idempotency key *is* their reference, so a retried
 * dispatch cannot create a second transfer on their side either.
 */
@Injectable()
export class MtnMomoProvider implements PaymentProvider {
  readonly name = 'mtn';

  private readonly logger = new Logger(MtnMomoProvider.name);

  private get baseUrl(): string {
    const environment = process.env.MTN_ENVIRONMENT ?? 'sandbox';
    return environment === 'production'
      ? 'https://proxy.momoapi.mtn.com'
      : 'https://sandbox.momodeveloper.mtn.com';
  }

  async requestToPay(input: {
    amountMinor: bigint;
    currency: string;
    msisdn: string;
    idempotencyKey: string;
    reference: string;
  }) {
    return this.dispatch('collection', 'requesttopay', input);
  }

  async payout(input: {
    amountMinor: bigint;
    currency: string;
    msisdn: string;
    idempotencyKey: string;
    reference: string;
  }) {
    return this.dispatch('disbursement', 'transfer', input);
  }

  async getStatus(providerRef: string) {
    const token = await this.accessToken('collection');
    const response = await fetch(
      `${this.baseUrl}/collection/v1_0/requesttopay/${providerRef}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Target-Environment': process.env.MTN_ENVIRONMENT ?? 'sandbox',
          'Ocp-Apim-Subscription-Key': this.requireEnv('MTN_SUBSCRIPTION_KEY'),
        },
      },
    );

    if (!response.ok) {
      // Deliberately UNKNOWN, not FAILED. Treating an unreachable provider as
      // a failure would let reconciliation reverse a payout that may have
      // already been paid.
      return { status: 'UNKNOWN' as ProviderStatus };
    }

    const body = (await response.json()) as { status?: string };
    return { status: mapStatus(body.status), raw: body };
  }

  verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
    const secret = process.env.PAYMENT_WEBHOOK_SECRET;
    if (!secret || !signature) return false;
    return signaturesMatch(hmacHex(secret, rawBody), signature);
  }

  private async dispatch(
    product: 'collection' | 'disbursement',
    path: string,
    input: {
      amountMinor: bigint;
      currency: string;
      msisdn: string;
      idempotencyKey: string;
      reference: string;
    },
  ) {
    const token = await this.accessToken(product);
    // MTN accepts our UUID as the transaction id, so their side is idempotent
    // on the same key we use.
    const providerRef = deterministicUuid(input.idempotencyKey);

    const response = await fetch(`${this.baseUrl}/${product}/v1_0/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Reference-Id': providerRef,
        'X-Target-Environment': process.env.MTN_ENVIRONMENT ?? 'sandbox',
        'Ocp-Apim-Subscription-Key': this.requireEnv('MTN_SUBSCRIPTION_KEY'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // MTN wants major units as a string.
        amount: (Number(input.amountMinor) / 100).toFixed(2),
        currency: input.currency,
        externalId: input.reference,
        payer: { partyIdType: 'MSISDN', partyId: input.msisdn },
        payee: { partyIdType: 'MSISDN', partyId: input.msisdn },
        payerMessage: 'Zigama Bank',
        payeeNote: 'Zigama Bank',
      }),
    });

    if (response.status === 202) {
      return { providerRef, status: 'PENDING' as ProviderStatus };
    }

    const text = await response.text();
    this.logger.error(`MTN ${product} ${path} failed: ${response.status} ${text}`);
    throw new ServiceUnavailableException(
      'The payment provider is not accepting requests right now.',
    );
  }

  private async accessToken(product: string): Promise<string> {
    const basic = Buffer.from(
      `${this.requireEnv('MTN_API_USER')}:${this.requireEnv('MTN_API_KEY')}`,
    ).toString('base64');

    const response = await fetch(`${this.baseUrl}/${product}/token/`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Ocp-Apim-Subscription-Key': this.requireEnv('MTN_SUBSCRIPTION_KEY'),
      },
    });

    if (!response.ok) {
      throw new ServiceUnavailableException(
        'Could not authenticate with the payment provider.',
      );
    }

    const body = (await response.json()) as { access_token: string };
    return body.access_token;
  }

  private requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
      throw new ServiceUnavailableException(
        `${name} is not configured. Set PAYMENT_PROVIDER=mock to run without ` +
          'MTN credentials.',
      );
    }
    return value;
  }
}

function mapStatus(status: string | undefined): ProviderStatus {
  switch (status) {
    case 'SUCCESSFUL':
      return 'SUCCEEDED';
    case 'FAILED':
      return 'FAILED';
    case 'PENDING':
      return 'PENDING';
    default:
      return 'UNKNOWN';
  }
}

/** A stable UUID for an idempotency key, so retries reuse the same reference. */
function deterministicUuid(key: string): string {
  const hash = hmacHex('mtn-reference', Buffer.from(key)).slice(0, 32);
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    // Version 4 and the RFC variant bits, so MTN accepts it as a UUID.
    `4${hash.slice(13, 16)}`,
    `8${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join('-');
}
