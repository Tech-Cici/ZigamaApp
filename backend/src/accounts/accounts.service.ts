import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
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
    // The auth guard trusts the token's claims and never queries the database,
    // which means a token can outlive the user it names — an account closed by
    // staff, or a database restored from a backup. Without this check the client
    // gets an empty-but-successful dashboard, keeps showing whatever it fetched
    // before, and then fails confusingly when it acts on a stale account id.
    // The dashboard is the natural place to notice, and it is one query on one
    // screen rather than on every request.
    const owner = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true },
    });
    if (!owner) {
      throw new UnauthorizedException(
        'Your session is no longer valid. Please sign in again.',
      );
    }

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
