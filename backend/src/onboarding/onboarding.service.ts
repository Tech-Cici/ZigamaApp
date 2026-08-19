import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.ts';
import {
  AccountStatus,
  AccountType,
  ApprovalStatus,
  Role,
} from '../../generated/prisma/enums.ts';
import type { AuthenticatedUser } from '../common/auth.types';
import { withDbRetry } from '../common/db-retry';
import { formatMinor } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateCustomerDto, PendingQueryDto } from './onboarding.dto';

const BCRYPT_ROUNDS = 10;

/**
 * Customer onboarding, under maker-checker control.
 *
 * An ADMIN opens the record; a MANAGER signs it off. Neither can do both, and
 * nobody may approve a record they created. The point is that no single member
 * of staff can bring a usable account into existence on their own — that is the
 * control which stops a fabricated "ghost" account being created and then used
 * to move money.
 */
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------

  async createCustomer(actor: AuthenticatedUser, dto: CreateCustomerDto) {
    if (actor.role !== Role.ADMIN) {
      throw new ForbiddenException('Only an administrator may open an account');
    }

    const email = dto.email.toLowerCase().trim();
    assertPinIsNotObvious(dto.pin);

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('A customer with this email already exists');
    }

    const pinHash = await bcrypt.hash(dto.pin, BCRYPT_ROUNDS);

    // One transaction: a customer with no account could never sign in (the
    // account number is the username) and could not be repaired from outside.
    const created = await withDbRetry('create-customer', () =>
      this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            fullName: dto.fullName.trim(),
            email,
            phone: dto.phone?.trim() || null,
            role: Role.CUSTOMER,
            pinHash,
            approvalStatus: ApprovalStatus.PENDING,
            createdById: actor.id,
          },
        });

        const account = await tx.account.create({
          data: {
            accountNumber: await this.allocateAccountNumber(tx),
            type: dto.accountType ?? AccountType.CHECKING,
            ownerId: user.id,
            // Stays PENDING until approval activates it, so the account cannot
            // transact in the meantime.
            status: AccountStatus.PENDING,
            balance: 0n,
          },
        });

        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: 'CUSTOMER_CREATED',
            entityType: 'User',
            entityId: user.id,
            metadata: { accountNumber: account.accountNumber } as never,
          },
        });

        return this.present(tx, user.id);
      }),
    ).catch((error: unknown) => {
      // The email pre-check can lose a race with a simultaneous create; the
      // unique index is the real guard.
      if ((error as { code?: string })?.code === 'P2002') {
        throw new ConflictException('A customer with this email already exists');
      }
      throw error;
    });

    return created;
  }

  // ---------------------------------------------------------------------
  // Approve / reject
  // ---------------------------------------------------------------------

  async approve(actor: AuthenticatedUser, customerId: string) {
    this.assertMayDecide(actor);

    const customer = await this.loadPending(customerId);
    this.assertNotOwnWork(actor, customer.createdById);

    return withDbRetry('approve-customer', () =>
      this.prisma.$transaction(async (tx) => {
        // Conditional update: if a second manager approved a moment earlier,
        // this matches zero rows and we stop rather than double-approving.
        const updated = await tx.user.updateMany({
          where: { id: customerId, approvalStatus: ApprovalStatus.PENDING },
          data: {
            approvalStatus: ApprovalStatus.APPROVED,
            approvedById: actor.id,
            approvedAt: new Date(),
            rejectionReason: null,
          },
        });

        if (updated.count === 0) {
          throw new ConflictException(
            'This application has already been decided',
          );
        }

        // Activating the account is what actually lets money move.
        await tx.account.updateMany({
          where: { ownerId: customerId, status: AccountStatus.PENDING },
          data: { status: AccountStatus.ACTIVE },
        });

        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: 'CUSTOMER_APPROVED',
            entityType: 'User',
            entityId: customerId,
            metadata: { createdBy: customer.createdById } as never,
          },
        });

        return this.present(tx, customerId);
      }),
    );
  }

  async reject(actor: AuthenticatedUser, customerId: string, reason: string) {
    this.assertMayDecide(actor);

    const customer = await this.loadPending(customerId);
    this.assertNotOwnWork(actor, customer.createdById);

    return withDbRetry('reject-customer', () =>
      this.prisma.$transaction(async (tx) => {
        const updated = await tx.user.updateMany({
          where: { id: customerId, approvalStatus: ApprovalStatus.PENDING },
          data: {
            approvalStatus: ApprovalStatus.REJECTED,
            approvedById: actor.id,
            approvedAt: new Date(),
            rejectionReason: reason.trim(),
            // Deliberately leaves `isActive` alone. That flag means "an
            // approved account has been suspended"; the application lifecycle
            // is `approvalStatus`. Setting both made login fail with the
            // generic error before it could tell the applicant why they were
            // declined.
          },
        });

        if (updated.count === 0) {
          throw new ConflictException(
            'This application has already been decided',
          );
        }

        // Left CLOSED rather than deleted: the record is evidence of a decision
        // and the audit trail has to stay intact.
        await tx.account.updateMany({
          where: { ownerId: customerId },
          data: { status: AccountStatus.CLOSED },
        });

        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: 'CUSTOMER_REJECTED',
            entityType: 'User',
            entityId: customerId,
            metadata: { reason: reason.trim() } as never,
          },
        });

        return this.present(tx, customerId);
      }),
    );
  }

  // ---------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------

  async listPending(query: PendingQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const where = {
      role: Role.CUSTOMER,
      approvalStatus: ApprovalStatus.PENDING,
    };

    const [total, rows] = await this.prisma.read('pending-customers', () =>
      Promise.all([
        this.prisma.user.count({ where }),
        this.prisma.user.findMany({
          where,
          orderBy: { createdAt: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            accounts: true,
            createdBy: { select: { id: true, fullName: true } },
          },
        }),
      ]),
    );

    return {
      data: rows.map((user) => ({
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        createdAt: user.createdAt,
        // Surfaced so a manager can see at a glance whose work they are
        // signing off, and so the UI can disable approving their own.
        createdBy: user.createdBy
          ? { id: user.createdBy.id, fullName: user.createdBy.fullName }
          : null,
        accounts: user.accounts.map((account) => ({
          accountNumber: account.accountNumber,
          type: account.type,
          status: account.status,
        })),
      })),
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

  /**
   * Approval is a manager's job. Excluding admins is what makes the control
   * real: an admin who could also approve would be able to complete the whole
   * lifecycle alone.
   */
  private assertMayDecide(actor: AuthenticatedUser): void {
    if (actor.role !== Role.MANAGER) {
      throw new ForbiddenException(
        'Only a branch manager may approve or reject an application',
      );
    }
  }

  /** Belt and braces: blocks self-approval even if roles are ever widened. */
  private assertNotOwnWork(
    actor: AuthenticatedUser,
    createdById: string | null,
  ): void {
    if (createdById && createdById === actor.id) {
      throw new ForbiddenException(
        'You cannot approve an application you created yourself',
      );
    }
  }

  private async loadPending(customerId: string) {
    const customer = await this.prisma.user.findUnique({
      where: { id: customerId },
      select: { id: true, role: true, approvalStatus: true, createdById: true },
    });

    if (!customer || customer.role !== Role.CUSTOMER) {
      throw new NotFoundException('Customer not found');
    }
    if (customer.approvalStatus !== ApprovalStatus.PENDING) {
      throw new ConflictException('This application has already been decided');
    }
    return customer;
  }

  /**
   * Builds the response shape.
   *
   * Takes the transaction client so the read runs on the connection the write
   * already holds. Reading afterwards on a fresh connection meant a second
   * round trip that could fail *after* the write had committed — reporting a
   * 500 for an operation that actually succeeded, which invites the caller to
   * retry something already done.
   */
  private async present(
    db: Prisma.TransactionClient,
    customerId: string,
  ) {
    const user = await db.user.findUniqueOrThrow({
      where: { id: customerId },
      include: {
        accounts: true,
        createdBy: { select: { id: true, fullName: true } },
        approvedBy: { select: { id: true, fullName: true } },
      },
    });

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      approvalStatus: user.approvalStatus,
      rejectionReason: user.rejectionReason,
      approvedAt: user.approvedAt,
      createdBy: user.createdBy,
      approvedBy: user.approvedBy,
      createdAt: user.createdAt,
      accounts: user.accounts.map((account) => ({
        id: account.id,
        accountNumber: account.accountNumber,
        type: account.type,
        status: account.status,
        balance: formatMinor(account.balance),
        currency: account.currency,
      })),
    };
  }

  /**
   * Picks an unused 10-digit account number.
   *
   * Random rather than sequential: sequential numbers let anyone holding one
   * guess their neighbours', and the account number is the lookup key for
   * transfers. The unique index is the real guarantee; this loop only avoids
   * wasting a transaction on an unlucky collision.
   */
  private async allocateAccountNumber(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const candidate = randomAccountNumber();
      const clash = await tx.account.findUnique({
        where: { accountNumber: candidate },
        select: { id: true },
      });
      if (!clash) return candidate;
    }
    throw new ServiceUnavailableException(
      'Could not allocate an account number. Please try again.',
    );
  }
}

/**
 * New account numbers start at 3 so they cannot collide with the 1xx/2xx ranges
 * used by seeded demo data, and are otherwise random across the 10-digit space.
 */
function randomAccountNumber(): string {
  const first = randomInt(3, 10); // 3-9
  let rest = '';
  for (let i = 0; i < 9; i++) rest += randomInt(0, 10);
  return `${first}${rest}`;
}

/**
 * Rejects the PINs that get brute-forced first: every digit the same (0000) and
 * simple runs (1234, 9876). A four-digit PIN has only 10,000 combinations and a
 * handful of them dominate real-world choices, so refusing them is worth the
 * small friction.
 */
function assertPinIsNotObvious(pin: string): void {
  if (/^(\d)\1+$/.test(pin)) {
    throw new BadRequestException(
      'Choose a PIN that is not the same digit repeated',
    );
  }

  const digits = [...pin].map(Number);
  const ascending = digits.every((d, i) => i === 0 || d === digits[i - 1] + 1);
  const descending = digits.every((d, i) => i === 0 || d === digits[i - 1] - 1);

  if (ascending || descending) {
    throw new BadRequestException(
      'Choose a PIN that is not a sequence of consecutive digits',
    );
  }
}
