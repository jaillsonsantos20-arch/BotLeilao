import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Define as roles permitidas em uma rota.
 * Ex.: @Roles(Role.ADMIN) — somente admin e super_admin acessam.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
