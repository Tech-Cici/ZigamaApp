import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { ApprovalStatus, Role } from '../../generated/prisma/enums.ts';
import type { JwtPayload } from '../common/auth.types';
import { PrismaService } from '../prisma/prisma.service';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

/**
 * A deliberately vague message. Telling a caller whether the account number
 * exists or only the PIN was wrong lets an attacker enumerate valid accounts.
 */
const GENERIC_FAILURE = 'Invalid credentials';

interface AuthenticatedResult {
  token: string;
  expiresIn: string;
  user: {
    id: string;
    fullName: string;
    email: string;
    role: Role;
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Customers sign in with their bank account number and PIN. */
  async loginCustomer(
    accountNumber: string,
    pin: string,
    ipAddress?: string,
  ): Promise<AuthenticatedResult> {
    const account = await this.prisma.account.findUnique({
      where: { accountNumber },
      include: { owner: true },
    });

    // Hash against a dummy value when the account is unknown so the response
    // takes about the same time either way (no timing oracle).
    if (!account) {
      await bcrypt.compare(pin, '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
      await this.recordAudit(null, 'LOGIN_CUSTOMER', false, ipAddress, {
        accountNumber,
        reason: 'unknown account',
      });
      throw new UnauthorizedException(GENERIC_FAILURE);
    }

    const user = account.owner;
    this.assertNotLocked(user.lockedUntil);

    if (!user.isActive || user.role !== Role.CUSTOMER || !user.pinHash) {
      await this.recordAudit(user.id, 'LOGIN_CUSTOMER', false, ipAddress, {
        reason: 'inactive or not a customer',
      });
      throw new UnauthorizedException(GENERIC_FAILURE);
    }

    const valid = await bcrypt.compare(pin, user.pinHash);
    if (!valid) {
      await this.registerFailedAttempt(user.id, user.failedLoginAttempts);
      await this.recordAudit(user.id, 'LOGIN_CUSTOMER', false, ipAddress, {
        reason: 'bad pin',
      });
      throw new UnauthorizedException(GENERIC_FAILURE);
    }

    // Only *after* the PIN checks out do we explain an approval hold. Saying
    // "awaiting approval" before verifying the PIN would confirm the account
    // exists to anyone guessing account numbers, undoing the generic-failure
    // protection above. Someone holding the correct PIN already knows it exists.
    this.assertApproved(user.approvalStatus, user.rejectionReason);

    await this.registerSuccess(user.id);
    await this.recordAudit(user.id, 'LOGIN_CUSTOMER', true, ipAddress);
    return this.issue(user);
  }

  /** Managers and admins sign in with email and password. */
  async loginStaff(
    email: string,
    password: string,
    ipAddress?: string,
  ): Promise<AuthenticatedResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user) {
      await bcrypt.compare(password, '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
      await this.recordAudit(null, 'LOGIN_STAFF', false, ipAddress, {
        email,
        reason: 'unknown user',
      });
      throw new UnauthorizedException(GENERIC_FAILURE);
    }

    this.assertNotLocked(user.lockedUntil);

    const isStaff = user.role === Role.ADMIN || user.role === Role.MANAGER;
    if (!user.isActive || !isStaff || !user.passwordHash) {
      await this.recordAudit(user.id, 'LOGIN_STAFF', false, ipAddress, {
        reason: 'inactive or not staff',
      });
      throw new UnauthorizedException(GENERIC_FAILURE);
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      await this.registerFailedAttempt(user.id, user.failedLoginAttempts);
      await this.recordAudit(user.id, 'LOGIN_STAFF', false, ipAddress, {
        reason: 'bad password',
      });
      throw new UnauthorizedException(GENERIC_FAILURE);
    }

    await this.registerSuccess(user.id);
    await this.recordAudit(user.id, 'LOGIN_STAFF', true, ipAddress);
    return this.issue(user);
  }

  /**
   * Staff accounts are created directly and are approved on creation, so this
   * only ever gates customers in practice.
   */
  private assertApproved(
    status: ApprovalStatus,
    rejectionReason: string | null,
  ): void {
    if (status === ApprovalStatus.APPROVED) return;

    if (status === ApprovalStatus.REJECTED) {
      throw new UnauthorizedException(
        rejectionReason
          ? `This application was declined: ${rejectionReason}`
          : 'This application was declined. Please contact your branch.',
      );
    }

    throw new UnauthorizedException(
      'Your account is awaiting approval by a branch manager.',
    );
  }

  private assertNotLocked(lockedUntil: Date | null): void {
    if (lockedUntil && lockedUntil > new Date()) {
      const minutes = Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000);
      throw new UnauthorizedException(
        `Account temporarily locked after too many failed attempts. Try again in ${minutes} minute(s).`,
      );
    }
  }

  private async registerFailedAttempt(
    userId: string,
    currentAttempts: number,
  ): Promise<void> {
    const attempts = currentAttempts + 1;
    const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: attempts,
        lockedUntil: shouldLock
          ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
          : null,
      },
    });

    if (shouldLock) {
      this.logger.warn(`User ${userId} locked after ${attempts} failed attempts`);
    }
  }

  private async registerSuccess(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });
  }

  private issue(user: {
    id: string;
    fullName: string;
    email: string;
    role: Role;
  }): AuthenticatedResult {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not set');

    const expiresIn = process.env.JWT_EXPIRES_IN ?? '12h';
    const payload: JwtPayload = {
      sub: user.id,
      role: user.role,
      email: user.email,
      fullName: user.fullName,
    };

    return {
      token: jwt.sign(payload, secret, { expiresIn } as jwt.SignOptions),
      expiresIn,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
      },
    };
  }

  private async recordAudit(
    actorId: string | null,
    action: string,
    success: boolean,
    ipAddress?: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId,
          action,
          success,
          ipAddress,
          metadata: metadata as never,
          entityType: 'User',
          entityId: actorId,
        },
      });
    } catch (error) {
      // Audit is best-effort: never fail a login because logging broke.
      this.logger.error(`Failed to write audit log for ${action}`, error as Error);
    }
  }
}
