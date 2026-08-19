import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.ts';
import { AccountStatus, Role } from '../../generated/prisma/enums.ts';
import type { AuthenticatedUser } from '../common/auth.types';
import { formatMinor } from '../common/money';
import { serializeAccount, serializeTransaction } from '../common/serializers';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ListTransactionsQueryDto,
  ListUsersQueryDto,
} from './admin.dto';

/**
 * Postgres COUNT returns BIGINT and SUM over BIGINT returns NUMERIC; the driver
 * hands both back as strings to avoid precision loss. Counts are small enough
 * for a JS number, but money must stay a bigint.
 */
function toNumber(value: string | number | bigint): number {
  return Number(value);
}

function toBigInt(value: string | number | bigint): bigint {
  return BigInt(String(value).split('.')[0]);
}

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Headline numbers for the staff dashboard.
   *
   * These are eight independent aggregates. Issuing them as eight parallel
   * queries needs eight pooled connections at once, which starves a small pool
   * and makes a perfectly ordinary dashboard request fail under light load.
   * Postgres computes all of them in a single scan-friendly statement, so this
   * is one round trip and one connection.
   */
  async getStats() {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [row] = await this.prisma.read('stats', () =>
      this.prisma.$queryRaw<Array<Record<string, string | number | bigint>>>`
      SELECT
        (SELECT COUNT(*) FROM "User" WHERE "role" = 'CUSTOMER'::"Role")
          AS "totalCustomers",
        (SELECT COUNT(*) FROM "User"
          WHERE "role" = 'CUSTOMER'::"Role" AND "isActive"
            AND "approvalStatus" = 'APPROVED'::"ApprovalStatus")
          AS "activeCustomers",
        (SELECT COUNT(*) FROM "User"
          WHERE "role" = 'CUSTOMER'::"Role"
            AND "approvalStatus" = 'PENDING'::"ApprovalStatus")
          AS "pendingApprovals",
        (SELECT COUNT(*) FROM "Account") AS "totalAccounts",
        (SELECT COUNT(*) FROM "Account"
          WHERE "status" = 'FROZEN'::"AccountStatus")
          AS "frozenAccounts",
        (SELECT COALESCE(SUM("balance"), 0) FROM "Account") AS "totalHoldings",
        (SELECT COUNT(*) FROM "Transaction" WHERE "createdAt" >= ${startOfToday})
          AS "transactionsToday",
        (SELECT COALESCE(SUM("amount"), 0) FROM "Transaction"
          WHERE "createdAt" >= ${startOfToday})
          AS "volumeToday",
        (SELECT COALESCE(SUM("amount"), 0) FROM "Transaction")
          AS "volumeAllTime"
    `,
    );

    return {
      totalCustomers: toNumber(row.totalCustomers),
      activeCustomers: toNumber(row.activeCustomers),
      pendingApprovals: toNumber(row.pendingApprovals),
      totalAccounts: toNumber(row.totalAccounts),
      frozenAccounts: toNumber(row.frozenAccounts),
      totalHoldings: formatMinor(toBigInt(row.totalHoldings)),
      transactionsToday: toNumber(row.transactionsToday),
      volumeToday: formatMinor(toBigInt(row.volumeToday)),
      volumeAllTime: formatMinor(toBigInt(row.volumeAllTime)),
      currency: 'RWF',
    };
  }

  async listUsers(query: ListUsersQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();

    const where: Prisma.UserWhereInput = search
      ? {
          OR: [
            { fullName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { accounts: { some: { accountNumber: { contains: search } } } },
          ],
        }
      : {};

    const [total, users] = await this.prisma.read('users-list', () =>
      Promise.all([
        this.prisma.user.count({ where }),
        this.prisma.user.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: { accounts: { orderBy: { createdAt: 'asc' } } },
        }),
      ]),
    );

    return {
      data: users.map((user) => ({
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isActive: user.isActive,
        isLocked: !!user.lockedUntil && user.lockedUntil > new Date(),
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
        accounts: user.accounts.map(serializeAccount),
        totalBalance: formatMinor(
          user.accounts.reduce((sum, account) => sum + account.balance, 0n),
        ),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async getUser(userId: string) {
    const user = await this.prisma.read('admin-user', () =>
      this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        accounts: {
          orderBy: { createdAt: 'asc' },
          include: {
            transactions: {
              orderBy: { createdAt: 'desc' },
              take: 20,
              include: {
                counterpartyAccount: { select: { accountNumber: true } },
              },
            },
          },
        },
      },
      }),
    );

    if (!user) throw new NotFoundException('User not found');

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isActive: user.isActive,
      isLocked: !!user.lockedUntil && user.lockedUntil > new Date(),
      failedLoginAttempts: user.failedLoginAttempts,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      totalBalance: formatMinor(
        user.accounts.reduce((sum, account) => sum + account.balance, 0n),
      ),
      accounts: user.accounts.map((account) => ({
        ...serializeAccount(account),
        transactions: account.transactions.map(serializeTransaction),
      })),
    };
  }

  /** Platform-wide transaction feed for oversight. */
  async listTransactions(query: ListTransactionsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;

    const where: Prisma.TransactionWhereInput = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.accountNumber
        ? { account: { accountNumber: { contains: query.accountNumber } } }
        : {}),
    };

    const [total, rows] = await this.prisma.read('transactions-feed', () =>
      Promise.all([
        this.prisma.transaction.count({ where }),
        this.prisma.transaction.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            counterpartyAccount: { select: { accountNumber: true } },
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
        ...serializeTransaction(row),
        accountNumber: row.account.accountNumber,
        accountHolder: row.account.owner.fullName,
        accountHolderId: row.account.owner.id,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async setAccountStatus(
    actor: AuthenticatedUser,
    accountId: string,
    status: AccountStatus,
  ) {
    await this.assertActorStillActive(actor);

    const existing = await this.prisma.account.findUnique({
      where: { id: accountId },
    });
    if (!existing) throw new NotFoundException('Account not found');

    const account = await this.prisma.account.update({
      where: { id: accountId },
      data: { status },
    });

    await this.writeAudit(actor.id, 'ACCOUNT_STATUS_CHANGED', accountId, {
      from: existing.status,
      to: status,
    });

    return serializeAccount(account);
  }

  async setUserActive(
    actor: AuthenticatedUser,
    userId: string,
    isActive: boolean,
  ) {
    await this.assertActorStillActive(actor);

    if (actor.id === userId && !isActive) {
      throw new ForbiddenException('You cannot deactivate your own account');
    }

    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!existing) throw new NotFoundException('User not found');

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        isActive,
        // Reactivating should also clear a lockout, otherwise the user still
        // cannot sign in and staff have no way to see why.
        ...(isActive ? { lockedUntil: null, failedLoginAttempts: 0 } : {}),
      },
    });

    await this.writeAudit(actor.id, 'USER_STATUS_CHANGED', userId, {
      from: existing.isActive,
      to: isActive,
    });

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      isActive: user.isActive,
    };
  }

  async listAuditLogs(page = 1, limit = 50) {
    const [total, logs] = await this.prisma.read('audit-logs', () =>
      Promise.all([
        this.prisma.auditLog.count(),
        this.prisma.auditLog.findMany({
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            actor: { select: { id: true, fullName: true, role: true } },
          },
        }),
      ]),
    );

    return {
      data: logs.map((log) => ({
        id: log.id,
        action: log.action,
        success: log.success,
        entityType: log.entityType,
        entityId: log.entityId,
        metadata: log.metadata,
        ipAddress: log.ipAddress,
        createdAt: log.createdAt,
        actor: log.actor
          ? {
              id: log.actor.id,
              fullName: log.actor.fullName,
              role: log.actor.role,
            }
          : null,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  /**
   * The auth guard trusts the token's claims and does not hit the database, so
   * privileged writes confirm the actor is still an active staff member before
   * taking effect. Reads are left alone: a stale read until token expiry is a
   * far smaller problem than a revoked admin still able to freeze accounts.
   */
  private async assertActorStillActive(
    actor: AuthenticatedUser,
  ): Promise<void> {
    const current = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { isActive: true, role: true },
    });

    if (!current?.isActive) {
      throw new ForbiddenException('Your account is no longer active');
    }
    if (current.role !== Role.ADMIN && current.role !== Role.MANAGER) {
      throw new ForbiddenException('Your account no longer has staff access');
    }
  }

  private async writeAudit(
    actorId: string,
    action: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action,
        entityType: 'Account',
        entityId,
        metadata: metadata as never,
      },
    });
  }
}
