import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { BYPASS_TENANT_ACCESS_KEY } from '../decorators/bypass-tenant-access.decorator';
import { PrismaService } from '../database/prisma.service';
import { RequestUser } from '../types/auth.types';
import { isTenantAccessAllowed } from './subscription.helpers';

/**
 * Trava de acesso por assinatura.
 *
 * Garante que apenas tenants com TRIAL vigente ou assinatura ACTIVE usem o painel.
 *  - Rotas públicas (sem usuário autenticado) são liberadas.
 *  - SUPER_ADMIN (operador da plataforma) nunca é bloqueado.
 *  - Tenants com trial vencido / assinatura cancelada ou expirada são bloqueados
 *    (402 → o frontend redireciona para o paywall).
 */
@Injectable()
export class TenantAccessGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const bypass = this.reflector.getAllAndOverride<boolean>(BYPASS_TENANT_ACCESS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    const user = request.user;

    if (bypass) {
      return true;
    }

    if (!user) {
      return true; // rota pública — JwtAuthGuard já dispensou a autenticação
    }

    if (user.role === Role.SUPER_ADMIN) {
      return true; // operador da plataforma nunca é bloqueado
    }

    const subscription = await this.prisma.subscription.findFirst({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: 'desc' },
      select: { status: true, trialEndsAt: true, currentPeriodEnd: true },
    });

    if (isTenantAccessAllowed(subscription)) {
      return true;
    }

    throw new ForbiddenException({
      message: 'Assinatura necessária para continuar usando o painel.',
      code: 'PAYMENT_REQUIRED',
    });
  }
}