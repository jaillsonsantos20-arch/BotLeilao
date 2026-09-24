import { BadRequestException, Injectable } from '@nestjs/common';
import { AuctionStatus, Role } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

/**
 * Aplica os limites do plano contratado pelo tenant (maxGroups/maxUsers/maxAuctions
 * e itens por lista/evento).
 *
 * Convenção de features (definida pelo plano escolhido no landing):
 * - 'listas' = pode usar listas/eventos.
 * - 'listas_ilimitadas' = sem teto de itens por lista (ex.: Profissional).
 *   Sem essa feature, o teto é MAX_ITEMS_PER_LIST_BASIC (5, ex.: Básico).
 *
 * Exceções (itens ilimitados):
 * - Operadores da plataforma (SUPER_ADMIN);
 * - E-mails em UNLIMITED_ITEMS_EMAILS (ex.: admin@botleilao.com.br);
 * - Tenants sem plano (demo/legados sem assinatura).
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

  /**
   * Teto de itens por lista nos planos sem a feature 'listas_ilimitadas'
   * (ex.: plano Básico). Planos com 'listas_ilimitadas' não têm teto.
   */
  static readonly MAX_ITEMS_PER_LIST_BASIC = 5;

  /**
   * E-mails com itens por lista ilimitados, independente do plano.
   * Pode ser estendido via env UNLIMITED_ITEMS_EMAILS (separados por vírgula).
   */
  static readonly UNLIMITED_ITEMS_EMAILS = ['admin@botleilao.com.br'];

  /** Retorna o teto de itens por lista do tenant (null = ilimitado). */
  async getMaxItemsPerList(
    tenantId: string,
    actorRole: Role,
    actorEmail?: string | null,
  ): Promise<number | null> {
    if (actorRole === Role.SUPER_ADMIN) return null;
    if (this.isUnlimitedEmail(actorEmail)) return null;
    const plan = await this.getPlan(tenantId);
    if (!plan) return null;
    const features = (plan.features as unknown as string[]) ?? [];
    if (features.includes('listas_ilimitadas')) return null;
    return PlanLimitsService.MAX_ITEMS_PER_LIST_BASIC;
  }

  /** Bloqueia adicionar item além do teto do plano na lista/evento. */
  async assertCanAddItemToEvent(
    tenantId: string,
    eventId: string,
    actorRole: Role,
    actorEmail?: string | null,
  ): Promise<void> {
    const max = await this.getMaxItemsPerList(tenantId, actorRole, actorEmail);
    if (max === null) return;
    const current = await this.prisma.item.count({
      where: { tenantId, auctionEventId: eventId },
    });
    if (current >= max) {
      throw new BadRequestException(
        `Limite do plano atingido: máximo ${max} itens por lista. Exclua um item ou faça upgrade de plano.`,
      );
    }
  }

  private async assert(
    tenantId: string,
    actorRole: Role,
    limitKey: 'maxGroups' | 'maxUsers' | 'maxAuctions',
    count: () => Promise<number>,
    label: string,
  ): Promise<void> {
    if (actorRole === Role.SUPER_ADMIN) return;

    const plan = await this.getPlan(tenantId);
    if (!plan) return;

    const limit = (plan as unknown as Record<string, number | null>)[limitKey] as
      | number
      | null;
    if (limit === null || limit === undefined) return;

    const current = await count();
    if (current >= limit) {
      throw new BadRequestException(
        `Limite do plano atingido: ${label} (máximo ${limit}).`,
      );
    }
  }

  private async getPlan(tenantId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });
    return subscription?.plan ?? null;
  }

  /** E-mails isentos do teto de itens (comparação sem diferenciar maiúsculas). */
  private isUnlimitedEmail(email?: string | null): boolean {
    if (!email) return false;
    const normalized = email.trim().toLowerCase();
    const fromEnv = (process.env.UNLIMITED_ITEMS_EMAILS ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    const allowed = new Set([
      ...PlanLimitsService.UNLIMITED_ITEMS_EMAILS.map((entry) => entry.toLowerCase()),
      ...fromEnv,
    ]);
    return allowed.has(normalized);
  }
}