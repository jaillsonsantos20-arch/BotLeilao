import { BadRequestException, Injectable } from '@nestjs/common';
import { AuctionStatus, Role } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

/**
 * Aplica os limites do plano contratado pelo tenant (maxGroups/maxUsers/maxAuctions).
 *
 * Operadores da plataforma (SUPER_ADMIN) e tenants sem plano ativo/em trial
 * não são limitados — mantém o comportamento atual de contas demo/legadas.
 */
@Injectable()
export class PlanLimitsService {
  constructor(private readonly prisma: PrismaService) {}

  async assertCanCreateGroup(tenantId: string, actorRole: Role): Promise<void> {
    await this.assert(
      tenantId,
      actorRole,
      'maxGroups',
      () => this.prisma.group.count({ where: { tenantId } }),
      'grupos vinculados',
    );
  }

  async assertCanCreateUser(tenantId: string, actorRole: Role): Promise<void> {
    await this.assert(
      tenantId,
      actorRole,
      'maxUsers',
      () => this.prisma.user.count({ where: { tenantId } }),
      'usuários',
    );
  }

  async assertCanStartAuction(tenantId: string, actorRole: Role): Promise<void> {
    await this.assert(
      tenantId,
      actorRole,
      'maxAuctions',
      () =>
        this.prisma.auction.count({
          where: { tenantId, status: AuctionStatus.OPEN },
        }),
      'leilões simultâneos',
    );
  }

  private async assert(
    tenantId: string,
    actorRole: Role,
    limitKey: 'maxGroups' | 'maxUsers' | 'maxAuctions',
    count: () => Promise<number>,
    label: string,
  ): Promise<void> {
    if (actorRole === Role.SUPER_ADMIN) return;

    const subscription = await this.prisma.subscription.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });

    if (!subscription) return;

    const plan = subscription.plan as unknown as Record<string, number | null>;
    const limit = plan[limitKey] as number | null;
    if (limit === null || limit === undefined) return;

    const current = await count();
    if (current >= limit) {
      throw new BadRequestException(
        `Limite do plano atingido: ${label} (máximo ${limit}).`,
      );
    }
  }
}