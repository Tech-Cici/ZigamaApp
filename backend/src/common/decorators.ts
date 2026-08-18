import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Role } from '../../generated/prisma/enums.ts';
import type { AuthenticatedUser } from './auth.types';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

/** Opt a route out of the globally applied JWT guard. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restrict a route to the given roles. Requires authentication. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Inject the authenticated user into a handler parameter. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
