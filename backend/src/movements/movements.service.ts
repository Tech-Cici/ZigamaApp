import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.ts';
import {
  AccountStatus,
  MovementChannel,
  MovementDirection,
  MovementStatus,
  Role,
  TransactionType,
} from '../../generated/prisma/enums.ts';
import type { AuthenticatedUser } from '../common/auth.types';
import { withDbRetry } from '../common/db-retry';
import { formatMinor, InvalidAmountError, parseAmountToMinor } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../payments/provider';
import type {
  DeclareBranchDepositDto,
  MomoDepositDto,
  MomoWithdrawalDto,
  MovementQueryDto,
  RequestBranchWithdrawalDto,
} from './movements.dto';

/**
 * How many unconfirmed deposit claims one customer may have outstanding.
 *
 * A customer-declared deposit is an assertion that cash was handed over at a
 * branch; nothing stops someone claiming money they never paid in. The slip
 * reference is what makes a claim checkable, and this cap is what stops the
 * approval queue being flooded while a manager works through them.
 */
const MAX_OPEN_DEPOSIT_CLAIMS = 3;

/** Uncollected cash goes back to the customer after this long. */
const WITHDRAWAL_COLLECT_WITHIN_HOURS = 72;

@Injectable()
export class MovementsService {
  private readonly logger = new Logger(MovementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  // ---------------------------------------------------------------------
  // Customer: raise a request
  // ---------------------------------------------------------------------

  /**
   * Records a claim that cash was paid in at a branch. Deliberately writes no
   * ledger entry — the balance must not move until a manager has checked the
   * claim against the branch's own records.
   */
  async declareBranchDeposit(
    actor: AuthenticatedUser,
    dto: DeclareBranchDepositDto,
  ) {
    const amount = this.parseAmount(dto.amount);
    const slipReference = dto.slipReference.trim().toUpperCase();

    return withDbRetry('declare-deposit', () =>
      this.prisma.$transaction(async (tx) => {
        const account = await this.loadOwnedAccount(tx, actor, dto.accountId);

        const openClaims = await tx.moneyRequest.count({
          where: {
            requestedById: actor.id,
            direction: MovementDirection.DEPOSIT,
            status: MovementStatus.PENDING,
          },
        });
        if (openClaims >= MAX_OPEN_DEPOSIT_CLAIMS) {
          throw new ConflictException(
            `You already have ${openClaims} deposits awaiting confirmation. ` +
              'Please wait for those to be reviewed first.',
          );
        }

        const duplicate = await tx.moneyRequest.findUnique({
          where: { slipReference },
          select: { id: true },
        });
        if (duplicate) {
          throw new ConflictException(
            'That deposit slip reference has already been submitted',
          );
        }

        const request = await tx.moneyRequest.create({
          data: {
            reference: movementReference('DEP'),
            direction: MovementDirection.DEPOSIT,
            channel: MovementChannel.BRANCH_CASH,
            status: MovementStatus.PENDING,
            amount,
            currency: account.currency,
            accountId: account.id,
            requestedById: actor.id,
            slipReference,
            branchName: dto.branchName.trim(),
            depositedAt: dto.depositedAt ? new Date(dto.depositedAt) : new Date(),
          },
        });

        await this.audit(tx, actor.id, 'DEPOSIT_DECLARED', request.id, {
          amount: amount.toString(),
          slipReference,
        });

        return this.present(tx, request.id);
      }),
    ).catch((error: unknown) => {
      // The duplicate check above can lose a race; the unique index is the
      // real guard.
      if ((error as { code?: string })?.code === 'P2002') {
        throw new ConflictException(
          'That deposit slip reference has already been submitted',
        );
      }
      throw error;
    });
  }

  /**
   * Reserves cash for collection at a branch.
   *
   * Unlike a deposit, this debits immediately. If the money stayed available
   * while the request sat pending, a customer could raise several withdrawals
   * against the same balance and collect them all.
   */
  async requestBranchWithdrawal(
    actor: AuthenticatedUser,
    dto: RequestBranchWithdrawalDto,
  ) {
    const amount = this.parseAmount(dto.amount);

    return withDbRetry('request-withdrawal', () =>
      this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '1s'`);

        const account = await this.lockAccount(tx, dto.accountId);
        this.assertOwned(actor, account.ownerId);
        this.assertActive(account.status);

        if (account.balance < amount) {
          throw new BadRequestException('Insufficient funds');
        }

        const balanceAfter = account.balance - amount;

        await tx.account.update({
          where: { id: account.id },
          data: { balance: balanceAfter },
        });

        const held = await tx.transaction.create({
          data: {
            reference: ledgerReference('WDR'),
            type: TransactionType.WITHDRAWAL,
            amount,
            currency: account.currency,
            balanceAfter,
            accountId: account.id,
            description: `Cash withdrawal reserved for collection at ${dto.branchName.trim()}`,
            initiatedById: actor.id,
          },
        });

        const request = await tx.moneyRequest.create({
          data: {
            reference: movementReference('WDR'),
            direction: MovementDirection.WITHDRAWAL,
            channel: MovementChannel.BRANCH_CASH,
            status: MovementStatus.PENDING,
            amount,
            currency: account.currency,
            accountId: account.id,
            requestedById: actor.id,
            branchName: dto.branchName.trim(),
            transactionId: held.id,
            expiresAt: new Date(
              Date.now() + WITHDRAWAL_COLLECT_WITHIN_HOURS * 3_600_000,
            ),
          },
        });

        await this.audit(tx, actor.id, 'WITHDRAWAL_RESERVED', request.id, {
          amount: amount.toString(),
        });

        return this.present(tx, request.id);
      }),
    );
  }

  /** A customer changing their mind about an uncollected withdrawal. */
  async cancel(actor: AuthenticatedUser, requestId: string) {
    return withDbRetry('cancel-movement', () =>
      this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '1s'`);

        const request = await tx.moneyRequest.findUnique({
          where: { id: requestId },
        });
        if (!request) throw new NotFoundException('Request not found');
        this.assertOwned(actor, request.requestedById);

        await this.settle(tx, requestId, MovementStatus.CANCELLED, {
          actorId: actor.id,
          note: 'Cancelled by the customer',
        });

        return this.present(tx, requestId);
      }),
    );
  }


  // ---------------------------------------------------------------------
  // Mobile money
  // ---------------------------------------------------------------------

  /**
   * Asks the provider to collect money from the customer's phone.
   *
   * Nothing is credited here. The customer still has to approve the debit on
   * their handset, and only the provider's confirmed callback releases the
   * money into the account.
   */
  async requestMomoDeposit(actor: AuthenticatedUser, dto: MomoDepositDto) {
    const amount = this.parseAmount(dto.amount);

    const existing = await this.findByIdempotencyKey(dto.idempotencyKey);
    if (existing) return existing;

    const { account, msisdn } = await this.loadMomoContext(actor, dto.accountId);

    const request = await withDbRetry('momo-deposit-create', () =>
      this.prisma.$transaction(async (tx) =>
        tx.moneyRequest.create({
          data: {
            reference: movementReference('MDP'),
            direction: MovementDirection.DEPOSIT,
            channel: MovementChannel.MOBILE_MONEY,
            status: MovementStatus.PENDING,
            amount,
            currency: account.currency,
            accountId: account.id,
            requestedById: actor.id,
            payerMsisdn: msisdn,
            idempotencyKey: dto.idempotencyKey,
          },
        }),
      ),
    ).catch((error: unknown) => {
      if ((error as { code?: string })?.code === 'P2002') {
        throw new ConflictException('That request has already been submitted');
      }
      throw error;
    });

    return this.dispatchToProvider(request.id, 'collection', {
      amountMinor: amount,
      currency: account.currency,
      msisdn,
      idempotencyKey: dto.idempotencyKey,
      reference: request.reference,
    });
  }

  /**
   * Sends money out to the customer's registered phone number.
   *
   * The funds are debited and held before anything is dispatched — the same
   * reservation a branch withdrawal uses — because a payout that fails must be
   * given back explicitly rather than never having left.
   */
  async requestMomoWithdrawal(actor: AuthenticatedUser, dto: MomoWithdrawalDto) {
    const amount = this.parseAmount(dto.amount);

    const existing = await this.findByIdempotencyKey(dto.idempotencyKey);
    if (existing) return existing;

    const { msisdn } = await this.loadMomoContext(actor, dto.accountId);

    const request = await withDbRetry('momo-withdrawal-reserve', () =>
      this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '1s'`);

        const account = await this.lockAccount(tx, dto.accountId);
        this.assertOwned(actor, account.ownerId);
        this.assertActive(account.status);

        if (account.balance < amount) {
          throw new BadRequestException('Insufficient funds');
        }

        const balanceAfter = account.balance - amount;

        await tx.account.update({
          where: { id: account.id },
          data: { balance: balanceAfter },
        });

        const held = await tx.transaction.create({
          data: {
            reference: ledgerReference('WDR'),
            type: TransactionType.WITHDRAWAL,
            amount,
            currency: account.currency,
            balanceAfter,
            accountId: account.id,
            description: `Mobile money payout to ${maskMsisdn(msisdn)}`,
            initiatedById: actor.id,
          },
        });

        return tx.moneyRequest.create({
          data: {
            reference: movementReference('MWD'),
            direction: MovementDirection.WITHDRAWAL,
            channel: MovementChannel.MOBILE_MONEY,
            status: MovementStatus.PENDING,
            amount,
            currency: account.currency,
            accountId: account.id,
            requestedById: actor.id,
            payerMsisdn: msisdn,
            idempotencyKey: dto.idempotencyKey,
            transactionId: held.id,
          },
        });
      }),
    ).catch((error: unknown) => {
      if ((error as { code?: string })?.code === 'P2002') {
        throw new ConflictException('That request has already been submitted');
      }
      throw error;
    });

    return this.dispatchToProvider(request.id, 'payout', {
      amountMinor: amount,
      currency: request.currency,
      msisdn,
      idempotencyKey: dto.idempotencyKey,
      reference: request.reference,
    });
  }

  /**
   * Hands a reserved request to the provider and records what came back.
   *
   * A dispatch that throws is the dangerous case for a payout: we do not know
   * whether the provider received it. The request is parked as UNRESOLVED with
   * the money still held, and only reconciliation — which asks the provider
   * directly — is allowed to decide. Retrying here could pay twice.
   */
  private async dispatchToProvider(
    requestId: string,
    kind: 'collection' | 'payout',
    input: {
      amountMinor: bigint;
      currency: string;
      msisdn: string;
      idempotencyKey: string;
      reference: string;
    },
  ) {
    try {
      const result =
        kind === 'collection'
          ? await this.provider.requestToPay(input)
          : await this.provider.payout(input);

      await this.prisma.moneyRequest.update({
        where: { id: requestId },
        data: {
          status: MovementStatus.PROCESSING,
          providerRef: result.providerRef,
          providerStatus: result.status,
          dispatchedAt: new Date(),
        },
      });
    } catch (error) {
      const message = (error as Error).message;

      if (kind === 'collection') {
        // Nothing was credited and nothing is held, so a failed collection can
        // simply be marked rejected.
        await this.prisma.moneyRequest.update({
          where: { id: requestId },
          data: {
            status: MovementStatus.REJECTED,
            failureReason: `Provider unavailable: ${message}`,
          },
        });
        throw error;
      }

      this.logger.error(
        `Payout ${requestId} dispatch outcome unknown — parked as UNRESOLVED. ` +
          'Money stays held until reconciliation confirms with the provider.',
      );
      await this.prisma.moneyRequest.update({
        where: { id: requestId },
        data: {
          status: MovementStatus.UNRESOLVED,
          failureReason: `Dispatch outcome unknown: ${message}`,
          dispatchedAt: new Date(),
        },
      });
    }

    return withDbRetry('present-movement', () =>
      this.prisma.$transaction((tx) => this.present(tx, requestId)),
    );
  }

  /**
   * Applies a provider outcome to a request.
   *
   * Called by the webhook processor and by reconciliation, so both paths go
   * through the same compare-and-swap in `settle` and neither can apply an
   * outcome twice.
   */
  async applyProviderOutcome(
    providerRef: string,
    outcome: 'SUCCEEDED' | 'FAILED',
    reportedAmountMinor?: bigint,
  ): Promise<'applied' | 'already-final' | 'unknown-reference'> {
    const request = await this.prisma.moneyRequest.findUnique({
      where: { providerRef },
    });
    if (!request) return 'unknown-reference';

    if (
      request.status !== MovementStatus.PROCESSING &&
      request.status !== MovementStatus.PENDING &&
      request.status !== MovementStatus.UNRESOLVED
    ) {
      // Already decided — a replayed or late callback.
      return 'already-final';
    }

    // Never trust the amount in a callback over the one we recorded. A provider
    // that reports a different figure is either buggy or the payload was
    // tampered with; either way, applying it would move the wrong money.
    if (
      reportedAmountMinor !== undefined &&
      reportedAmountMinor !== request.amount
    ) {
      throw new BadRequestException(
        `Reported amount ${reportedAmountMinor} does not match the request amount ${request.amount}`,
      );
    }

    await withDbRetry('apply-provider-outcome', () =>
      this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '1s'`);
        await this.settle(
          tx,
          request.id,
          outcome === 'SUCCEEDED'
            ? MovementStatus.COMPLETED
            : MovementStatus.REJECTED,
          {
            actorId: request.requestedById,
            note:
              outcome === 'SUCCEEDED'
                ? 'Confirmed by the payment provider'
                : 'Declined by the payment provider',
          },
        );
      }),
    );

    return 'applied';
  }

  private async findByIdempotencyKey(key: string) {
    const existing = await this.prisma.moneyRequest.findUnique({
      where: { idempotencyKey: key },
    });
    if (!existing) return null;

    // Returning the original rather than erroring is the point of an
    // idempotency key: a client that retries because it never saw our response
    // should get the same answer, not a conflict.
    return withDbRetry('present-existing', () =>
      this.prisma.$transaction((tx) => this.present(tx, existing.id)),
    );
  }

  /** Payouts and collections use the number on the customer's profile. */
  private async loadMomoContext(actor: AuthenticatedUser, accountId: string) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      include: { owner: { select: { phone: true } } },
    });
    if (!account) throw new NotFoundException('Account not found');
    this.assertOwned(actor, account.ownerId);
    this.assertActive(account.status);

    const msisdn = account.owner.phone?.replace(/[^\d+]/g, '');
    if (!msisdn) {
      throw new BadRequestException(
        'No mobile number is registered on your account. Visit a branch to add one.',
      );
    }

    return { account, msisdn };
  }

  /**
   * Gives back a reserved withdrawal nobody collected. Called by the
   * reconciliation sweep, not by a person, so there is no actor to attribute it
   * to beyond the customer whose money it is.
   */
  async expire(requestId: string) {
    return withDbRetry('expire-movement', () =>
      this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '1s'`);

        const request = await tx.moneyRequest.findUnique({
          where: { id: requestId },
          select: { requestedById: true },
        });
        if (!request) throw new NotFoundException('Request not found');

        await this.settle(tx, requestId, MovementStatus.EXPIRED, {
          actorId: request.requestedById,
          note: 'Not collected within the allowed time',
        });
        return this.present(tx, requestId);
      }),
    );
  }

  // ---------------------------------------------------------------------
  // Staff: decide
  // ---------------------------------------------------------------------

  async approve(actor: AuthenticatedUser, requestId: string, note?: string) {
    this.assertMayDecide(actor);

    return withDbRetry('approve-movement', () =>
      this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '1s'`);
        await this.settle(tx, requestId, MovementStatus.COMPLETED, {
          actorId: actor.id,
          note,
        });
        return this.present(tx, requestId);
      }),
    );
  }

  async reject(actor: AuthenticatedUser, requestId: string, reason: string) {
    this.assertMayDecide(actor);

    return withDbRetry('reject-movement', () =>
      this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '1s'`);
        await this.settle(tx, requestId, MovementStatus.REJECTED, {
          actorId: actor.id,
          note: reason,
        });
        return this.present(tx, requestId);
      }),
    );
  }

  // ---------------------------------------------------------------------
  // The state transition — the only place a movement changes state
  // ---------------------------------------------------------------------

  /**
   * Moves a PENDING request to its final state and applies the ledger
   * consequence exactly once.
   *
   * The status change is a compare-and-swap (`updateMany ... where status =
   * PENDING`). If two managers press Approve at the same moment, one matches a
   * row and the other matches none — so the credit can only ever be written
   * once. The unique `transactionId` on the request is the backstop.
   */
  private async settle(
    tx: Prisma.TransactionClient,
    requestId: string,
    outcome: MovementStatus,
    by: { actorId: string; note?: string },
  ): Promise<void> {
    const request = await tx.moneyRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('Request not found');

    // States a request can still be decided from. PROCESSING covers mobile
    // money awaiting a provider callback; UNRESOLVED covers a payout whose
    // outcome reconciliation has since established.
    const OPEN: MovementStatus[] = [
      MovementStatus.PENDING,
      MovementStatus.PROCESSING,
      MovementStatus.UNRESOLVED,
    ];

    if (!OPEN.includes(request.status)) {
      throw new ConflictException(
        `This request was already ${request.status.toLowerCase()}`,
      );
    }

    const claimed = await tx.moneyRequest.updateMany({
      where: { id: requestId, status: { in: OPEN } },
      data: {
        status: outcome,
        decidedById: by.actorId,
        decidedAt: new Date(),
        decisionNote: by.note?.trim() ?? null,
      },
    });
    if (claimed.count === 0) {
      throw new ConflictException('This request was already decided');
    }

    const isDeposit = request.direction === MovementDirection.DEPOSIT;
    const completed = outcome === MovementStatus.COMPLETED;

    if (isDeposit && completed) {
      // The money has been verified as received, so credit it now. This is the
      // first and only ledger entry a deposit produces.
      const account = await this.lockAccount(tx, request.accountId);
      this.assertActive(account.status);

      const balanceAfter = account.balance + request.amount;

      await tx.account.update({
        where: { id: account.id },
        data: { balance: balanceAfter },
      });

      const entry = await tx.transaction.create({
        data: {
          reference: ledgerReference('DEP'),
          type: TransactionType.DEPOSIT,
          amount: request.amount,
          currency: request.currency,
          balanceAfter,
          accountId: account.id,
          description: `Branch cash deposit, slip ${request.slipReference}`,
          initiatedById: by.actorId,
        },
      });

      await tx.moneyRequest.update({
        where: { id: requestId },
        data: { transactionId: entry.id },
      });
    }

    if (!isDeposit && !completed) {
      // A held withdrawal that will not be collected. Give the money back with
      // a compensating entry rather than deleting the original — the ledger is
      // append-only, and the attempt is part of the account's history.
      const account = await this.lockAccount(tx, request.accountId);
      const balanceAfter = account.balance + request.amount;

      await tx.account.update({
        where: { id: account.id },
        data: { balance: balanceAfter },
      });

      const reversal = await tx.transaction.create({
        data: {
          reference: ledgerReference('REV'),
          type: TransactionType.REVERSAL_CREDIT,
          amount: request.amount,
          currency: request.currency,
          balanceAfter,
          accountId: account.id,
          description: `Reversal of uncollected withdrawal ${request.reference}`,
          initiatedById: by.actorId,
        },
      });

      await tx.moneyRequest.update({
        where: { id: requestId },
        data: { reversalTransactionId: reversal.id },
      });

      if (request.transactionId) {
        await tx.transaction.update({
          where: { id: request.transactionId },
          data: { status: 'REVERSED' },
        });
      }
    }

    // A completed withdrawal needs no ledger work: the debit was written when
    // the money was reserved, and the cash has now simply been handed over.
    // A rejected deposit needs none either: nothing was ever credited.

    await this.audit(tx, by.actorId, `MOVEMENT_${outcome}`, requestId, {
      direction: request.direction,
      amount: request.amount.toString(),
    });
  }

  // ---------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------

  /** A customer's own requests. */
  async listMine(actor: AuthenticatedUser, query: MovementQueryDto) {
    return this.list({ requestedById: actor.id }, query);
  }

  /** Everything awaiting a decision, for the staff queue. */
  async listPending(query: MovementQueryDto) {
    return this.list({ status: MovementStatus.PENDING }, query);
  }

  private async list(
    where: Prisma.MoneyRequestWhereInput,
    query: MovementQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;

    const [total, rows] = await this.prisma.read('movements-list', () =>
      Promise.all([
        this.prisma.moneyRequest.count({ where }),
        this.prisma.moneyRequest.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            account: {
              select: {
                accountNumber: true,
                owner: { select: { id: true, fullName: true } },
              },
            },
          },
        }),
      ]),
    );

    return {
      data: rows.map((row) => ({
        id: row.id,
        reference: row.reference,
        direction: row.direction,
        channel: row.channel,
        status: row.status,
        amount: formatMinor(row.amount),
        currency: row.currency,
        providerRef: row.providerRef,
        failureReason: row.failureReason,
        slipReference: row.slipReference,
        branchName: row.branchName,
        depositedAt: row.depositedAt,
        decisionNote: row.decisionNote,
        decidedAt: row.decidedAt,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
        accountNumber: row.account.accountNumber,
        accountHolder: row.account.owner.fullName,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  private async present(db: Prisma.TransactionClient, requestId: string) {
    const row = await db.moneyRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: {
        account: { select: { accountNumber: true, balance: true } },
      },
    });

    return {
      id: row.id,
      reference: row.reference,
      direction: row.direction,
      channel: row.channel,
      status: row.status,
      amount: formatMinor(row.amount),
      currency: row.currency,
      providerRef: row.providerRef,
      failureReason: row.failureReason,
      slipReference: row.slipReference,
      branchName: row.branchName,
      decisionNote: row.decisionNote,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      accountNumber: row.account.accountNumber,
      accountBalance: formatMinor(row.account.balance),
    };
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private parseAmount(input: unknown): bigint {
    try {
      return parseAmountToMinor(input);
    } catch (error) {
      if (error instanceof InvalidAmountError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private assertMayDecide(actor: AuthenticatedUser): void {
    if (actor.role !== Role.MANAGER) {
      throw new ForbiddenException(
        'Only a branch manager may confirm or reject a cash movement',
      );
    }
  }

  private assertOwned(actor: AuthenticatedUser, ownerId: string): void {
    if (actor.role === Role.CUSTOMER && ownerId === actor.id) return;
    throw new ForbiddenException('This request does not belong to you');
  }

  /** Only ACTIVE accounts may move money — see AccountStatus in the schema. */
  private assertActive(status: AccountStatus): void {
    if (status === AccountStatus.ACTIVE) return;
    throw new ForbiddenException(
      status === AccountStatus.PENDING
        ? 'This account has not been approved yet.'
        : `This account is ${status.toLowerCase()}.`,
    );
  }

  private async loadOwnedAccount(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    accountId: string,
  ) {
    const account = await tx.account.findUnique({ where: { id: accountId } });
    if (!account) throw new NotFoundException('Account not found');
    this.assertOwned(actor, account.ownerId);
    this.assertActive(account.status);
    return account;
  }

  private async lockAccount(tx: Prisma.TransactionClient, accountId: string) {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        balance: bigint | string;
        status: AccountStatus;
        currency: string;
        ownerId: string;
      }>
    >`
      SELECT "id", "balance", "status", "currency", "ownerId"
      FROM "Account"
      WHERE "id" = ${accountId}
      FOR UPDATE
    `;

    const row = rows[0];
    if (!row) throw new NotFoundException('Account not found');
    return { ...row, balance: BigInt(row.balance) };
  }

  private async audit(
    tx: Prisma.TransactionClient,
    actorId: string,
    action: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorId,
        action,
        entityType: 'MoneyRequest',
        entityId,
        metadata: metadata as never,
      },
    });
  }
}

function movementReference(prefix: string): string {
  return `${prefix}R-${randomBytes(4).toString('hex').toUpperCase()}`;
}

/** Shows enough of a number to be recognisable without printing all of it. */
function maskMsisdn(msisdn: string): string {
  return msisdn.length <= 4
    ? msisdn
    : `${'*'.repeat(msisdn.length - 4)}${msisdn.slice(-4)}`;
}

function ledgerReference(prefix: string): string {
  const stamp = Date.now().toString(36).toUpperCase();
  return `${prefix}-${stamp}-${randomBytes(3).toString('hex').toUpperCase()}`;
}
