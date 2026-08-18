import { Inject, Injectable, Logger } from '@nestjs/common';
import { WebhookStatus } from '../../generated/prisma/enums.ts';
import { MovementsService } from '../movements/movements.service';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_PROVIDER, type PaymentProvider } from './provider';

/** Attempts before a callback is parked for a human to look at. */
const MAX_ATTEMPTS = 5;

/** Backoff between retries, in seconds, indexed by attempt number. */
const BACKOFF_SECONDS = [10, 30, 120, 600];

export interface IncomingWebhook {
  eventId: string;
  providerRef?: string;
  status?: string;
  amountMinor?: bigint;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly movements: MovementsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /**
   * Records a callback and tries to act on it.
   *
   * Recording comes first, and the provider's own event id is unique, so a
   * replayed delivery is recognised before any money logic runs. Providers
   * retry hard — a duplicate is normal traffic, not an error.
   *
   * The caller responds 200 regardless of whether processing succeeded:
   * providers treat a non-2xx as "try again", and manufacturing extra
   * deliveries for a problem on our side helps nobody. A failure is queued for
   * retry instead.
   */
  async receive(
    rawBody: Buffer,
    signature: string | undefined,
    parsed: IncomingWebhook,
  ): Promise<{ accepted: boolean; duplicate: boolean; reason?: string }> {
    const signatureValid = this.provider.verifySignature(rawBody, signature);

    // A bad signature is never recorded as pending work. Anyone can POST to a
    // public webhook URL, and queueing unverified payloads for retry would let
    // a stranger fill the queue.
    if (!signatureValid) {
      this.logger.warn(
        `Rejected webhook ${parsed.eventId}: signature did not verify`,
      );
      return { accepted: false, duplicate: false, reason: 'invalid signature' };
    }

    const existing = await this.prisma.webhookEvent.findUnique({
      where: { providerEventId: parsed.eventId },
      select: { id: true, status: true },
    });
    if (existing) {
      return { accepted: true, duplicate: true };
    }

    let event;
    try {
      event = await this.prisma.webhookEvent.create({
        data: {
          provider: this.provider.name,
          providerEventId: parsed.eventId,
          providerRef: parsed.providerRef ?? null,
          payload: JSON.parse(rawBody.toString('utf8')) as never,
          signatureValid: true,
          status: WebhookStatus.PENDING,
        },
      });
    } catch (error) {
      // Two deliveries of the same event arriving at once: the unique index is
      // the real replay guard, and losing that race means the other request is
      // handling it.
      if ((error as { code?: string })?.code === 'P2002') {
        return { accepted: true, duplicate: true };
      }
      throw error;
    }

    await this.process(event.id, parsed);
    return { accepted: true, duplicate: false };
  }

  /**
   * Applies one recorded callback. Safe to call again: the movement's own
   * compare-and-swap decides whether there is anything left to do.
   */
  async process(eventId: string, parsed?: IncomingWebhook): Promise<void> {
    const event = await this.prisma.webhookEvent.findUnique({
      where: { id: eventId },
    });
    if (!event || event.status === WebhookStatus.PROCESSED) return;

    const payload = parsed ?? parsePayload(event.payload);

    try {
      if (!payload.providerRef) {
        throw new Error('Callback carried no provider reference');
      }

      const outcome = normaliseStatus(payload.status);
      if (outcome === 'PENDING') {
        // A progress notification, not an outcome. Nothing to apply, and
        // nothing to retry either.
        await this.markProcessed(eventId, 'progress notification, no action');
        return;
      }

      const result = await this.movements.applyProviderOutcome(
        payload.providerRef,
        outcome,
        payload.amountMinor,
      );

      if (result === 'unknown-reference') {
        // The callback may have overtaken our own record of the dispatch.
        // Retrying is right; giving up would lose a real outcome.
        throw new Error(
          `No movement matches provider reference ${payload.providerRef}`,
        );
      }

      await this.markProcessed(eventId, result);
    } catch (error) {
      await this.scheduleRetry(eventId, event.attempts, (error as Error).message);
    }
  }

  /** Drains callbacks that failed earlier and are due another attempt. */
  async drainRetries(): Promise<{ attempted: number; deadLettered: number }> {
    const due = await this.prisma.webhookEvent.findMany({
      where: {
        status: WebhookStatus.FAILED,
        nextAttemptAt: { lte: new Date() },
      },
      orderBy: { nextAttemptAt: 'asc' },
      take: 20,
    });

    let deadLettered = 0;
    for (const event of due) {
      await this.process(event.id);
      const after = await this.prisma.webhookEvent.findUnique({
        where: { id: event.id },
        select: { status: true },
      });
      if (after?.status === WebhookStatus.DEAD_LETTER) deadLettered += 1;
    }

    return { attempted: due.length, deadLettered };
  }

  private async markProcessed(eventId: string, note: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id: eventId },
      data: {
        status: WebhookStatus.PROCESSED,
        processedAt: new Date(),
        lastError: null,
        nextAttemptAt: null,
        ...(note ? {} : {}),
      },
    });
  }

  private async scheduleRetry(
    eventId: string,
    attempts: number,
    error: string,
  ): Promise<void> {
    const next = attempts + 1;

    if (next >= MAX_ATTEMPTS) {
      this.logger.error(
        `Webhook ${eventId} dead-lettered after ${next} attempts: ${error}`,
      );
      await this.prisma.webhookEvent.update({
        where: { id: eventId },
        data: {
          status: WebhookStatus.DEAD_LETTER,
          attempts: next,
          lastError: error,
          nextAttemptAt: null,
        },
      });
      return;
    }

    const delay = BACKOFF_SECONDS[Math.min(attempts, BACKOFF_SECONDS.length - 1)];
    this.logger.warn(
      `Webhook ${eventId} failed (attempt ${next}), retrying in ${delay}s: ${error}`,
    );

    await this.prisma.webhookEvent.update({
      where: { id: eventId },
      data: {
        status: WebhookStatus.FAILED,
        attempts: next,
        lastError: error,
        nextAttemptAt: new Date(Date.now() + delay * 1000),
      },
    });
  }
}

function normaliseStatus(
  status: string | undefined,
): 'SUCCEEDED' | 'FAILED' | 'PENDING' {
  switch ((status ?? '').toUpperCase()) {
    case 'SUCCEEDED':
    case 'SUCCESSFUL':
    case 'SUCCESS':
    case 'COMPLETED':
      return 'SUCCEEDED';
    case 'FAILED':
    case 'REJECTED':
    case 'DECLINED':
      return 'FAILED';
    default:
      return 'PENDING';
  }
}

function parsePayload(payload: unknown): IncomingWebhook {
  const body = (payload ?? {}) as Record<string, unknown>;
  const amount = body.amountMinor ?? body.amount_minor;

  return {
    eventId: String(body.eventId ?? body.event_id ?? ''),
    providerRef: (body.providerRef ?? body.provider_ref ?? undefined) as
      | string
      | undefined,
    status: (body.status ?? undefined) as string | undefined,
    amountMinor:
      amount === undefined || amount === null ? undefined : BigInt(String(amount)),
  };
}
