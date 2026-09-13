import { Injectable } from '@nestjs/common';
import { PlanStatus } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';

export interface PublicPlan {
  id: string;
  name: string;
  description: string | null;
  price: number;
  maxGroups: number;
  maxAuctions: number | null;
  maxUsers: number;
  features: string[];
}

/**
 * Consulta de planos para a página pública de vendas.
 */
@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  async listPublic(): Promise<PublicPlan[]> {
    const plans = await this.prisma.plan.findMany({
      where: { status: PlanStatus.ACTIVE },
      orderBy: { price: 'asc' },
    });

    return plans.map((plan) => ({ ...plan, price: Number(plan.price) }));
  }

  async findById(id: string): Promise<PublicPlan | null> {
    const plan = await this.prisma.plan.findFirst({
      where: { id, status: PlanStatus.ACTIVE },
    });

    return plan ? { ...plan, price: Number(plan.price) } : null;
  }

  /** Retorna o plano padrão (menor preço ativo) escolhido quando o cadastro não informa um. */
  async findDefault(): Promise<PublicPlan | null> {
    const plans = await this.listPublic();
    return plans[0] ?? null;
  }

  /** Lista todos os planos (ativos e inativos) para a gestão da plataforma. */
  async listAll(): Promise<PublicPlan[]> {
    const plans = await this.prisma.plan.findMany({
      orderBy: { price: 'asc' },
    });

    return plans.map((plan) => ({ ...plan, price: Number(plan.price) }));
  }
}