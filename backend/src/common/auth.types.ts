import type { Role } from '../../generated/prisma/enums.ts';

/** Claims carried in the signed JWT. */
export interface JwtPayload {
  sub: string;
  role: Role;
  email: string;
  fullName: string;
  iat?: number;
  exp?: number;
}

/** Shape attached to `request.user` once the JWT guard has run. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
}

/** Express request after authentication. */
export interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
}
