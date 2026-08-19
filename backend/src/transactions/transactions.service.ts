import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.ts';
import {
  AccountStatus,
  Role,
  TransactionType,
} from '../../generated/prisma/enums.ts';
import type { AuthenticatedUser } from '../common/auth.types';
import { withDbRetry } from '../common/db-retry';
import { InvalidAmountError, parseAmountToMinor } from '../common/money';
import {
  serializeTransaction,
  type TransactionView,
} from '../common/serializers';
import { PrismaService } from '../prisma/prisma.service';
import type {
  DepositDto,
  HistoryQueryDto,
  TransferDto,
  WithdrawDto,
} from './transactions.dto';

/** An account row read under a `FOR UPDATE` lock. */
interface LockedAccount {
  id: string;
  accountNumber: string;
  balance: bigint;
  status: AccountStatus;
  currency: string;
  ownerId: string;
  ownerIsActive: boolean;
}

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------
  // Operations
  // ---------------------------------------------------------------------

  async deposit(
    actor: AuthenticatedUser,
    dto: DepositDto,
  ): Promise<TransactionView> {
    const amount = this.parseAmount(dto.amount);

    return this.runLocked(async (tx) => {
      const account = await this.lockAccount(tx, dto.accountId);
      this.assertMayOperate(actor, account, 'cash');
      this.assertOperable(account);

      const balanceAfter = account.balance + amount;

      await tx.account.update({
        where: { id: account.id },
        data: { balance: balanceAfter },
      });

      const record = await tx.transaction.create({
        data: {
          reference: reference('DEP'),
          type: TransactionType.DEPOSIT,
          amount,
          currency: account.currency,
          balanceAfter,
          accountId: account.id,
          description: dto.description ?? 'Cash deposit',
          initiatedById: actor.id,
        },
      });

      await this.audit(tx, actor.id, 'DEPOSIT', account.id, {
        amount: amount.toString(),
        reference: record.reference,
      });

      return serializeTransaction(record);
    });
  }

  async withdraw(
    actor: AuthenticatedUser,
    dto: WithdrawDto,
  ): Promise<TransactionView> {
    const amount = this.parseAmount(dto.amount);

    return this.runLocked(async (tx) => {
      const account = await this.lockAccount(tx, dto.accountId);
      this.assertMayOperate(actor, account, 'cash');
      this.assertOperable(account);

      // The balance was read under the row lock, so no concurrent withdrawal
      // can slip between this check and the update below.
      if (account.balance < amount) {
        throw new BadRequestException('Insufficient funds');
      }

      const balanceAfter = account.balance - amount;

      await tx.account.update({
        where: { id: account.id },
        data: { balance: balanceAfter },
      });

      const record = await tx.transaction.create({
        data: {
          reference: reference('WDR'),
          type: TransactionType.WITHDRAWAL,
          amount,
          currency: account.currency,
          balanceAfter,
          accountId: account.id,
          description: dto.description ?? 'Cash withdrawal',
          initiatedById: actor.id,
        },
      });

      await this.audit(tx, actor.id, 'WITHDRAWAL', account.id, {
        amount: amount.toString(),
        reference: record.reference,
      });

      return serializeTransaction(record);
    });
  }

  /**
   * Moves money between two accounts as a single atomic unit and writes two
   * ledger rows (TRANSFER_OUT and TRANSFER_IN) sharing a `transferGroupId`.
   * Either both sides commit or neither does.
   */
  async transfer(
    actor: AuthenticatedUser,
    dto: TransferDto,
  ): Promise<TransactionView> {
    const amount = this.parseAmount(dto.amount);

    return this.runLocked(async (tx) => {
      const recipient = await tx.account.findUnique({
        where: { accountNumber: dto.toAccountNumber },
        select: { id: true },
      });
      if (!recipient) {
        throw new NotFoundException('Recipient account not found');
      }
      if (recipient.id === dto.fromAccountId) {
        throw new BadRequestException('Cannot transfer to the same account');
      }

      // Always take locks in a deterministic order. Two simultaneous transfers
      // in opposite directions would otherwise each hold the lock the other
      // needs, and deadlock.
      const ordered = [dto.fromAccountId, recipient.id].sort();
      const locked = new Map<string, LockedAccount>();
      for (const id of ordered) {
        locked.set(id, await this.lockAccount(tx, id));
      }

      const source = locked.get(dto.fromAccountId)!;
      const destination = locked.get(recipient.id)!;

      this.assertMayOperate(actor, source, 'transfer');
      this.assertOperable(source);
      this.assertOperable(destination, 'Recipient account');

      if (source.currency !== destination.currency) {
        throw new BadRequestException(
          'Cannot transfer between accounts in different currencies',
        );
      }
      if (source.balance < amount) {
        throw new BadRequestException('Insufficient funds');
      }

      const sourceBalanceAfter = source.balance - amount;
      const destinationBalanceAfter = destination.balance + amount;

      await tx.account.update({
        where: { id: source.id },
        data: { balance: sourceBalanceAfter },
      });
      await tx.account.update({
        where: { id: destination.id },
        data: { balance: destinationBalanceAfter },
      });

      const groupId = randomBytes(12).toString('hex');
      const description = dto.description ?? 'Funds transfer';

      const outgoing = await tx.transaction.create({
        data: {
          reference: reference('TRF'),
          type: TransactionType.TRANSFER_OUT,
          amount,
          currency: source.currency,
          balanceAfter: sourceBalanceAfter,
          accountId: source.id,
          counterpartyAccountId: destination.id,
          transferGroupId: groupId,
          description,
          initiatedById: actor.id,
        },
        include: { counterpartyAccount: { select: { accountNumber: true } } },
      });

      await tx.transaction.create({
        data: {
          reference: reference('TRF'),
          type: TransactionType.TRANSFER_IN,
          amount,
          currency: destination.currency,
          balanceAfter: destinationBalanceAfter,
          accountId: destination.id,
          counterpartyAccountId: source.id,
          transferGroupId: groupId,
          description,
          initiatedById: actor.id,
        },
      });

      await this.audit(tx, actor.id, 'TRANSFER', source.id, {
        amount: amount.toString(),
        to: destination.accountNumber,
        transferGroupId: groupId,
      });

      return serializeTransaction(outgoing);
    });
  }

  // ---------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------

  async history(actor: AuthenticatedUser, query: HistoryQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    // Customers may only ever see entries on accounts they own.
    const accountFilter: Prisma.TransactionWhereInput =
      actor.role === Role.CUSTOMER
        ? { account: { ownerId: actor.id } }
        : {};

    if (query.accountId) {
      await this.assertCanReadAccount(actor, query.accountId);
    }

    const where: Prisma.TransactionWhereInput = {
      ...accountFilter,
      ...(query.accountId ? { accountId: query.accountId } : {}),
    };

    const [total, rows] = await this.prisma.read('history', () =>
      Promise.all([
        this.prisma.transaction.count({ where }),
        this.prisma.transaction.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: { counterpartyAccount: { select: { accountNumber: true } } },
        }),
      ]),
    );

    return {
      data: rows.map(serializeTransaction),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
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

  /**
   * `SELECT ... FOR UPDATE` blocks any other transaction from reading this row
   * for update until we commit, which is what makes the read-modify-write of a
   * balance safe. Prisma has no first-class API for row locks, so this is raw.
   */
  private async lockAccount(
    tx: Prisma.TransactionClient,
    accountId: string,
  ): Promise<LockedAccount> {
    // The owner's `isActive` is joined in here rather than checked by the auth
    // guard. Reading it under the same lock means a deactivated user cannot
    // move money even while holding a still-valid token, and it costs no extra
    // round trip. `FOR UPDATE OF a` locks only the account row — we are reading
    // the user row, not modifying it.
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        accountNumber: string;
        balance: bigint | string;
        status: AccountStatus;
        currency: string;
        ownerId: string;
        ownerIsActive: boolean;
      }>
    >`
      SELECT a."id", a."accountNumber", a."balance", a."status", a."currency",
             a."ownerId", u."isActive" AS "ownerIsActive"
      FROM "Account" a
      JOIN "User" u ON u."id" = a."ownerId"
      WHERE a."id" = ${accountId}
      FOR UPDATE OF a
    `;

    const row = rows[0];
    if (!row) {
      throw new NotFoundException('Account not found');
    }
    if (!row.ownerIsActive) {
      throw new ForbiddenException(
        'This account belongs to a deactivated user',
      );
    }

    return { ...row, balance: BigInt(row.balance) };
  }

  /**
   * Who may move money directly on the ledger.
   *
   * Transfers are a customer's own instruction and settle immediately, so a
   * customer may make them on an account they own.
   *
   * Deposits and withdrawals are different: cash has to physically change
   * hands, and a customer able to call them from a phone can simply invent a
   * balance. Those are teller operations — an ADMIN recording a counter
   * transaction. Customers go through MovementsService instead, where a
   * manager confirms the cash before the ledger moves.
   */
  private assertMayOperate(
    actor: AuthenticatedUser,
    account: LockedAccount,
    operation: 'transfer' | 'cash',
  ): void {
    if (actor.role === Role.ADMIN) return;

    if (
      operation === 'transfer' &&
      actor.role === Role.CUSTOMER &&
      account.ownerId === actor.id
    ) {
      return;
    }

    if (operation === 'cash' && actor.role === Role.CUSTOMER) {
      throw new ForbiddenException(
        'Deposits and withdrawals are handled at a branch. Use the Move money ' +
          'screen to record a branch deposit or request a cash withdrawal.',
      );
    }

    throw new ForbiddenException(
      'You are not permitted to operate on this account',
    );
  }

  /**
   * Allow-list, not a deny-list.
   *
   * This previously rejected FROZEN and CLOSED by name and let anything else
   * through. When PENDING was added for the approval workflow it fell straight
   * into the "else" and unapproved accounts could receive money. Enumerating
   * the states that may *not* transact is a standing invitation for the next
   * new state to be permitted by accident, so only ACTIVE passes.
   */
  private assertOperable(account: LockedAccount, label = 'Account'): void {
    if (account.status === AccountStatus.ACTIVE) return;

    const reason: Record<Exclude<AccountStatus, 'ACTIVE'>, string> = {
      PENDING: `${label} has not been approved yet.`,
      FROZEN: `${label} is frozen. Contact support.`,
      CLOSED: `${label} is closed.`,
    };

    throw new ForbiddenException(
      reason[account.status as Exclude<AccountStatus, 'ACTIVE'>] ??
        `${label} is not available for transactions.`,
    );
  }

  private async assertCanReadAccount(
    actor: AuthenticatedUser,
    accountId: string,
  ): Promise<void> {
    if (actor.role !== Role.CUSTOMER) return;

    const owned = await this.prisma.account.findFirst({
      where: { id: accountId, ownerId: actor.id },
      select: { id: true },
    });
    if (!owned) {
      throw new ForbiddenException('You do not have access to this account');
    }
  }

  /**
   * Runs a balance mutation in a transaction.
   *
   * Isolation is Postgres' default READ COMMITTED, which is correct here
   * *because* every balance is read through `SELECT ... FOR UPDATE`. That lock
   * makes concurrent writers queue up and re-read the newest committed row, so
   * a read-modify-write cannot interleave. SERIALIZABLE would add nothing on
   * top of the row lock and would instead abort competing transactions with
   * 40001, turning ordinary contention into failed requests.
   *
   * The retry loop remains for deadlocks, which locking can still produce.
   */
  private runLocked<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return withDbRetry('ledger', () =>
      this.prisma.$transaction(
        async (tx) => {
          // Bound how long we will sit waiting for a row lock. Without this a
          // contended transaction blocks indefinitely, holding its connection;
          // some Postgres deployments kill such connections outright, which
          // surfaces as an opaque failure instead of something retryable.
          // Failing fast and replaying is both quicker and easier to reason
          // about.
          await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '1s'`);
          return work(tx);
        },
        { timeout: 15_000, maxWait: 10_000 },
      ),
    );
  }

  private async audit(
    tx: Prisma.TransactionClient,
    actorId: string,
    action: string,
    accountId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorId,
        action,
        entityType: 'Account',
        entityId: accountId,
        metadata: metadata as never,
      },
    });
  }
}

function reference(prefix: string): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const suffix = randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${stamp}-${suffix}`;
}


