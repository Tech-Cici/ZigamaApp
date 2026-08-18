import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  MovementDirection,
  MovementStatus,
} from '../../generated/prisma/enums.ts';
import { withDbRetry } from '../common/db-retry';
import { formatMinor } from '../common/money';
import { CREDIT_TRANSACTION_TYPES } from '../common/serializers';
import { MovementsService } from '../movements/movements.service';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../payments/provider';
import { WebhooksService } from '../payments/webhooks.service';
import { PrismaService } from '../prisma/prisma.service';

/** How long a provider request may sit unresolved before we chase it. */
const STALE_AFTER_MINUTES = 5;

export interface ReconciliationReport {
  ranAt: Date;
  webhookRetries: { attempted: number; deadLettered: number };
  expiredWithdrawals: number;
  resolvedFromProvider: { settled: number; reversed: number; stillUnknown: number };
  ledgerMismatches: { accountNumber: string; stored: string; ledger: string }[];
}

/**
 * The safety net.
 *
 * Everything here exists because callbacks get lost, providers time out, and
 * customers walk away. None of it is optional in a system that moves money: a
 * webhook-only design silently leaves requests stuck forever, and a stuck
 * withdrawal is a customer's money held indefinitely.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly movements: MovementsService,
    private readonly webhooks: WebhooksService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async scheduled(): Promise<void> {
    try {
      const report = await this.run();
      if (report.ledgerMismatches.length > 0) {
        this.logger.error(
          `Reconciliation found ${report.ledgerMismatches.length} ledger mismatch(es)`,
        );
      }
    } catch (error) {
      this.logger.error('Reconciliation sweep failed', error as Error);
    }
  }

  async run(): Promise<ReconciliationReport> {
    const webhookRetries = await this.webhooks.drainRetries();
    const expiredWithdrawals = await this.expireUncollectedWithdrawals();
    const resolvedFromProvider = await this.resolveStaleRequests();
    const ledgerMismatches = await this.findLedgerMismatches();

    return {
      ranAt: new Date(),
      webhookRetries,
      expiredWithdrawals,
      resolvedFromProvider,
      ledgerMismatches,
    };
  }

  /**
   * Gives back cash that was reserved for collection and never collected.
   *
   * Without this, an abandoned branch withdrawal holds a customer's money
   * forever. The reversal goes through the same `settle` path as a rejection,
   * so it cannot double-refund.
   */
  private async expireUncollectedWithdrawals(): Promise<number> {
    const stale = await this.prisma.moneyRequest.findMany({
      where: {
        direction: MovementDirection.WITHDRAWAL,
        status: MovementStatus.PENDING,
        expiresAt: { lt: new Date() },
      },
      select: { id: true, reference: true },
      take: 50,
    });

    let expired = 0;
    for (const request of stale) {
      try {
        await this.movements.expire(request.id);
        expired += 1;
        this.logger.log(`Expired uncollected withdrawal ${request.reference}`);
      } catch (error) {
        this.logger.warn(
          `Could not expire ${request.reference}: ${(error as Error).message}`,
        );
      }
    }
    return expired;
  }

  /**
   * Asks the provider about anything that has been in flight too long.
   *
   * The provider's status API is the source of truth — a missing callback is
   * not evidence of failure. Anything the provider still cannot resolve is left
   * alone with the money held, because reversing a payout that may have been
   * paid is worse than making someone wait.
   */
  private async resolveStaleRequests() {
    const cutoff = new Date(Date.now() - STALE_AFTER_MINUTES * 60_000);

    const stale = await this.prisma.moneyRequest.findMany({
      where: {
        status: { in: [MovementStatus.PROCESSING, MovementStatus.UNRESOLVED] },
        providerRef: { not: null },
        dispatchedAt: { lt: cutoff },
      },
      take: 50,
    });

    let settled = 0;
    let reversed = 0;
    let stillUnknown = 0;

    for (const request of stale) {
      try {
        const { status } = await this.provider.getStatus(request.providerRef!);

        if (status === 'SUCCEEDED') {
          await this.movements.applyProviderOutcome(
            request.providerRef!,
            'SUCCEEDED',
          );
          settled += 1;
        } else if (status === 'FAILED') {
          await this.movements.applyProviderOutcome(
            request.providerRef!,
            'FAILED',
          );
          reversed += 1;
        } else {
          stillUnknown += 1;
          // Mark it so staff can see it needs attention, but leave the money
          // where it is.
          if (request.status !== MovementStatus.UNRESOLVED) {
            await this.prisma.moneyRequest.update({
              where: { id: request.id },
              data: {
                status: MovementStatus.UNRESOLVED,
                failureReason:
                  'Provider could not confirm the outcome. Held pending manual review.',
              },
            });
          }
        }
      } catch (error) {
        stillUnknown += 1;
        this.logger.warn(
          `Could not resolve ${request.reference}: ${(error as Error).message}`,
        );
      }
    }

    return { settled, reversed, stillUnknown };
  }

  /**
   * Recomputes every balance from its ledger entries and reports differences.
   *
   * Deliberately reports rather than repairs. An automatic "fix" would paper
   * over the bug that caused the drift and could itself move money wrongly —
   * a discrepancy in a ledger is a human's decision.
   */
  private async findLedgerMismatches() {
    const credits = CREDIT_TRANSACTION_TYPES as unknown as string[];

    const rows = await withDbRetry('reconcile-balances', () =>
      this.prisma.$queryRaw<
        Array<{ accountNumber: string; stored: bigint | string; ledger: bigint | string }>
      >`
        WITH summed AS (
          SELECT a."id",
                 a."accountNumber",
                 a."balance" AS "stored",
                 COALESCE(SUM(
                   CASE WHEN t."type"::text = ANY(${credits})
                     THEN t."amount" ELSE -t."amount" END
                 ), 0) AS "ledger"
          FROM "Account" a
          LEFT JOIN "Transaction" t ON t."accountId" = a."id"
          GROUP BY a."id", a."accountNumber", a."balance"
        )
        SELECT "accountNumber", "stored", "ledger"
        FROM summed
        WHERE "stored" <> "ledger"
      `,
    );

    return rows.map((row) => ({
      accountNumber: row.accountNumber,
      stored: formatMinor(BigInt(row.stored)),
      ledger: formatMinor(BigInt(row.ledger)),
    }));
  }
}
