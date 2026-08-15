import { Role } from '@prisma/client';

/**
 * Usuário autenticado presente em `req.user` após o JwtAuthGuard.
 * Inclui o tenantId para filtragem multi-tenant em todos os services.
 */
export interface RequestUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  emailVerifiedAt: Date | null;
  totpEnabled: boolean;
}

export interface JwtPayload {
  sub: string;
  email: string;
  tenantId: string;
  role: Role;
  scope?: 'mfa-login';
}

export interface JwtRefreshPayload extends JwtPayload {
  jti: string;
}
