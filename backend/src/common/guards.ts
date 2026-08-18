import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import type { Role } from '../../generated/prisma/enums.ts';
import type { JwtPayload } from './auth.types';
import { IS_PUBLIC_KEY, ROLES_KEY } from './decorators';

/**
 * Verifies the bearer token. Identity comes from the signed claims only — the
 * guard deliberately does not touch the database.
 *
 * An earlier version re-read the user on every request so that deactivating an
 * account took effect instantly. That cost a second connection for *every*
 * authenticated request, and under load those extra reads competed with the
 * connections held open by in-flight transactions. Requests then failed while
 * merely authenticating, which is a worse outcome than slightly stale
 * authorisation.
 *
 * Freshness is preserved where it actually matters instead:
 *   - money movement re-reads the owner's `isActive` inside the row lock it
 *     already takes (see TransactionsService.lockAccount), so a deactivated or
 *     frozen account cannot move money even with a valid token;
 *   - admin mutations re-check the actor before acting.
 *
 * The residual exposure is that a deactivated user can still *read* their own
 * data until the token expires (JWT_EXPIRES_IN, 12h by default). Shorten that
 * value if the tradeoff is not acceptable for your deployment.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers?.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET is not set');
    }

    let payload: JwtPayload;
    try {
      payload = jwt.verify(header.slice(7), secret) as JwtPayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    request.user = {
      id: payload.sub,
      email: payload.email,
      fullName: payload.fullName,
      role: payload.role,
    };
    return true;
  }
}

/** Enforces `@Roles(...)`. Runs after JwtAuthGuard, so `request.user` is set. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const role: Role | undefined = request.user?.role;

    if (!role || !required.includes(role)) {
      throw new ForbiddenException(
        'Your role does not have access to this resource',
      );
    }
    return true;
  }
}
