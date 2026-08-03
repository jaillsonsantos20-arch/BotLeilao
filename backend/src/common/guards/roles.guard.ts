import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { RequestUser } from '../types/auth.types';

/**
 * RBAC: verifica se o usuário autenticado possui uma das roles exigidas.
 * SUPER_ADMIN é hierarquicamente superior a ADMIN e USER.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user: RequestUser }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Acesso negado.');
    }

    const hierarchy: Record<Role, number> = {
      [Role.USER]: 1,
      [Role.ADMIN]: 2,
      [Role.SUPER_ADMIN]: 3,
    };

    const userLevel = hierarchy[user.role];
    const hasAccess = requiredRoles.some((role) => userLevel >= hierarchy[role]);

    if (!hasAccess) {
      throw new ForbiddenException('Você não possui permissão para esta ação.');
    }

    return true;
  }
}
