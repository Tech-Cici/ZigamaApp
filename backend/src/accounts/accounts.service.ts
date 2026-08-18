import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '../../generated/prisma/enums.ts';
import type { AuthenticatedUser } from '../common/auth.types';
import { formatMinor } from '../common/money';
import { serializeAccount, serializeTransaction } from '../common/serializers';
import { PrismaService } from '../prisma/prisma.service';

const RECENT_TRANSACTION_COUNT = 10;

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Everything the customer dashboard needs, in one round trip. */
  async getDashboard(user: AuthenticatedUser) {
    const accounts = await this.prisma.account.findMany({
      where: { ownerId: user.id },
      orderBy: { createdAt: 'asc' },
    });

    const accountIds = accounts.map((account) => account.id);

    const recent = accountIds.length
      ? await this.prisma.transaction.findMany({
          where: { accountId: { in: accountIds } },
          orderBy: { createdAt: 'desc' },
          take: RECENT_TRANSACTION_COUNT,
          include: {
            counterpartyAccount: { select: { accountNumber: true } },
          },
        })
      : [];

    const totalBalance = accounts.reduce(
      (sum, account) => sum + account.balance,
      0n,
    );

    return {
      user: { id: user.id, fullName: user.fullName, role: user.role },
      totalBalance: formatMinor(totalBalance),
      currency: accounts[0]?.currency ?? 'RWF',
      accounts: accounts.map(serializeAccount),
      recentTransactions: recent.map(serializeTransaction),
    };
  }

  async listMyAccounts(user: AuthenticatedUser) {
    const accounts = await this.prisma.account.findMany({
      where: { ownerId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    return accounts.map(serializeAccount);
  }

  async getAccount(user: AuthenticatedUser, accountId: string) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
    });
    if (!account) throw new NotFoundException('Account not found');

    if (user.role === Role.CUSTOMER && account.ownerId !== user.id) {
      throw new ForbiddenException('You do not have access to this account');
    }

    return serializeAccount(account);
  }

  /**
   * Confirms a recipient exists before a transfer is submitted.
   *
   * The owner's name is masked. Returning it in full would let anyone walk the
   * 10-digit account number space and harvest customer names.
   */
  async lookupByAccountNumber(accountNumber: string) {
    const account = await this.prisma.account.findUnique({
      where: { accountNumber },
      select: {
        accountNumber: true,
        status: true,
        currency: true,
        owner: { select: { fullName: true } },
      },
    });

    if (!account) throw new NotFoundException('Account not found');

    return {
      accountNumber: account.accountNumber,
      accountHolder: maskName(account.owner.fullName),
      status: account.status,
      currency: account.currency,
    };
  }
}

/** "Grace Uwase" -> "G**** U****" */
function maskName(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0] + '*'.repeat(Math.max(1, part.length - 1)))
    .join(' ');
}
