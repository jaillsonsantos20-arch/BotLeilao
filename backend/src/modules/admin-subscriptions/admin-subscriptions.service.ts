import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { buildPaginatedResult, PaginatedResult } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../common/database/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import {
  ListAdminSubscriptionsQueryDto,
  UpdateAdminSubscriptionDto,
} from './dto/admin-subscription.dto';

/**
 * Gestão de assinaturas pela plataforma (SUPER_ADMIN).
 *
 * Permite listar todas as assinaturas dos tenants, consultar o histórico de
 * pagamentos e ajustar manualmente status, plano e datas de vigência. Toda
 * alteração é registrada em auditoria.
 */
@Injectable()
export class AdminSubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListAdminSubscriptionsQueryDto): Promise<PaginatedResult<unknown>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.SubscriptionWhereInput = {
      ...(query.search
        ? {
            OR: [
              { tenant: { name: { contains: query.search, mode: 'insensitive' } } },
              { tenant: { email: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.subscription.findMany({
        where,
        include: {
          tenant: { select: { id: true, name: true, email: true } },
          plan: {
            select: { id: true, name: true, price: true, features: true, maxGroups: true, maxUsers: true },
          },
          payments: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { status: true, paidAt: true, amount: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.subscription.count({ where }),
    ]);

    const items = data.map((subscription) => ({
      id: subscription.id,
      status: subscription.status,
      trialEndsAt: subscription.trialEndsAt,
      currentPeriodEnd: subscription.currentPeriodEnd,
      canceledAt: subscription.canceledAt,
      createdAt: subscription.createdAt,
      tenant: subscription.tenant,
      plan: { ...subscription.plan, price: Number(subscription.plan.price) },
      latestPayment: subscription.payments[0]
        ? {
            status: subscription.payments[0].status,
            paidAt: subscription.payments[0].paidAt,
            amount: Number(subscription.payments[0].amount),
          }
        : null,
    }));

    return buildPaginatedResult(items, total, page, limit);
  }

  async summary() {
    const [trial, active, canceled, expired, totalTenants, paidRevenue, activeMrr] =
      await this.prisma.$transaction([
        this.prisma.subscription.count({ where: { status: 'TRIAL' } }),
        this.prisma.subscription.count({ where: { status: 'ACTIVE' } }),
        this.prisma.subscription.count({ where: { status: 'CANCELED' } }),
        this.prisma.subscription.count({ where: { status: 'EXPIRED' } }),
        this.prisma.tenant.count(),
        this.prisma.payment.aggregate({
          where: { status: 'PAID' },
          _sum: { amount: true },
        }),
        this.prisma.subscription.findMany({
          where: { status: 'ACTIVE' },
          select: { plan: { select: { price: true } } },
        }),
      ]);

    const mrr = activeMrr.reduce((sum, item) => sum + Number(item.plan.price), 0);

    return {
      totalTenants,
      totalSubscriptions: trial + active + canceled + expired,
      byStatus: { TRIAL: trial, ACTIVE: active, CANCELED: canceled, EXPIRED: expired },
      paidRevenue: Number(paidRevenue._sum.amount ?? 0),
      activeMrr: mrr,
    };
  }

  async findById(id: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
      include: {
        tenant: { select: { id: true, name: true, email: true, cnpj: true, createdAt: true } },
        plan: true,
        payments: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            amount: true,
            method: true,
            status: true,
            paidAt: true,
            createdAt: true,
            externalId: true,
          },
        },
      },
    });

    if (!subscription) {
      throw new NotFoundException('Assinatura não encontrada.');
    }

    const { plan, payments, ...rest } = subscription;
    return {
      ...rest,
      plan: { ...plan, price: Number(plan.price) },
      payments: payments.map((payment) => ({ ...payment, amount: Number(payment.amount) })),
    };
  }

  async update(id: string, dto: UpdateAdminSubscriptionDto) {
    const existing = await this.prisma.subscription.findUnique({
      where: { id },
      include: { plan: true },
    });

    if (!existing) {
      throw new NotFoundException('Assinatura não encontrada.');
    }

    if (dto.planId && dto.planId !== existing.planId) {
      const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
      if (!plan) {
        throw new NotFoundException('Plano não encontrado.');
      }
    }

    const data: Prisma.SubscriptionUpdateInput = {
      ...(dto.planId !== undefined ? { plan: { connect: { id: dto.planId } } } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.trialEndsAt !== undefined ? { trialEndsAt: dto.trialEndsAt } : {}),
      ...(dto.currentPeriodEnd !== undefined ? { currentPeriodEnd: dto.currentPeriodEnd } : {}),
      ...(dto.canceledAt !== undefined ? { canceledAt: dto.canceledAt } : {}),
    };

    const updated = await this.prisma.subscription.update({
      where: { id },
      data,
      include: {
        tenant: { select: { id: true, name: true, email: true } },
        plan: true,
      },
    });

    await this.audit.record({
      tenantId: updated.tenantId,
      action: AuditAction.UPDATE,
      entity: 'subscription',
      entityId: updated.id,
      before: {
        planId: existing.planId,
        status: existing.status,
        trialEndsAt: existing.trialEndsAt,
        currentPeriodEnd: existing.currentPeriodEnd,
        canceledAt: existing.canceledAt,
      },
      after: {
        planId: updated.planId,
        status: updated.status,
        trialEndsAt: updated.trialEndsAt,
        currentPeriodEnd: updated.currentPeriodEnd,
        canceledAt: updated.canceledAt,
      },
    });

    const { plan, ...rest } = updated;
    return { ...rest, plan: { ...plan, price: Number(plan.price) } };
  }
}