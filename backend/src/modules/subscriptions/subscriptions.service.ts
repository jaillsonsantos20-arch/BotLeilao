import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { isTenantAccessAllowed } from '../../common/guards/subscription.helpers';

/**
 * Consulta da assinatura do tenant. Usada pelo painel para exibir o status
 * e pelo frontend para decidir quando mostrar o paywall.
 */
@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrent(tenantId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });

    if (!subscription) {
      return null;
    }

    const { plan, ...rest } = subscription;

    return {
      ...rest,
      plan: { ...plan, price: Number(plan.price) },
      paymentRequired: !isTenantAccessAllowed(subscription),
    };
  }
}