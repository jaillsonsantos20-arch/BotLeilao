import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Auction, AuctionStatus, AuditAction, Bid, ItemStatus, PaymentStatus, Prisma, Role } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../common/database/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { PlanLimitsService } from '../../common/services/plan-limits.service';
import { buildPaginatedResult, PaginatedResult } from '../../common/dto/pagination.dto';
import { PlaceBidInput, StartAuctionInput } from './auction.types';

/**
 * Regras de negócio dos leilões. Usado tanto pela API REST quanto pelo motor
 * do WhatsApp — não depende de transporte.
 *
 * Regras implementadas:
 *  - Apenas um leilão aberto por grupo (imposta também via índice parcial no banco).
 *  - Todo lance deve ser maior que o lance atual (ou >= valor inicial no primeiro).
 *  - Cada lance reinicia o cronômetro (endsAt = now + durationSeconds).
 *  - Vencedor = maior lance no momento do encerramento.
 */
@Injectable()
export class AuctionsService {
  private readonly logger = new Logger(AuctionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly planLimits: PlanLimitsService,
  ) {}

  async startAuction(tenantId: string, input: StartAuctionInput): Promise<Auction> {
    if (input.initialValue <= 0) {
      throw new BadRequestException('O valor inicial deve ser maior que zero.');
    }
    if (input.durationSeconds < 10) {
      throw new BadRequestException('A duração mínima do leilão é de 10 segundos.');
    }

    // undefined (chamadas do bot/engine) => limite aplicado; SUPER_ADMIN não é limitado.
    await this.planLimits.assertCanStartAuction(tenantId, input.actorRole ?? Role.USER);

    const group = await this.prisma.group.findFirst({
      where: { id: input.groupId, tenantId, isActive: true },
    });
    if (!group) {
      throw new NotFoundException('Grupo não encontrado.');
    }

    const now = new Date();

    try {
      const auction = await this.prisma.auction.create({
        data: {
          tenantId,
          groupId: group.id,
          productName: input.productName,
          initialValue: new Decimal(input.initialValue),
          durationSeconds: input.durationSeconds,
          itemId: input.itemId ?? null,
          auctionEventId: input.auctionEventId ?? null,
          status: AuctionStatus.OPEN,
          startedAt: now,
          minBidStep: input.minBidStep != null ? new Decimal(input.minBidStep) : null,
          endsAt: new Date(now.getTime() + input.durationSeconds * 1000),
        },
      });

      await this.audit.record({
        tenantId,
        userId: input.startedBy ?? null,
        action: AuditAction.AUCTION_START,
        entity: 'Auction',
        entityId: auction.id,
        after: {
          groupId: group.id,
          productName: auction.productName,
          initialValue: auction.initialValue.toString(),
        },
      });

      return auction;
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Já existe um leilão aberto neste grupo.');
      }
      throw error;
    }
  }

  async getActiveByGroup(tenantId: string, groupId: string): Promise<Auction | null> {
    return this.prisma.auction.findFirst({
      where: { tenantId, groupId, status: AuctionStatus.OPEN },
    });
  }

  async findById(tenantId: string, auctionId: string): Promise<Auction> {
    const auction = await this.prisma.auction.findFirst({
      where: { id: auctionId, tenantId },
    });
    if (!auction) {
      throw new NotFoundException('Leilão não encontrado.');
    }
    return auction;
  }

  /**
   * Registra um lance. Concorrência segura via SELECT ... FOR UPDATE.
   */
  async placeBid(tenantId: string, input: PlaceBidInput): Promise<{ bid: Bid; auction: Auction }> {
    if (input.amount <= 0) {
      throw new BadRequestException('O valor do lance deve ser maior que zero.');
    }

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Auction" WHERE id = ${input.auctionId} FOR UPDATE
      `;
      if (rows.length === 0) {
        throw new NotFoundException('Leilão não encontrado.');
      }

      const auction = await tx.auction.findUnique({
        where: { id: input.auctionId },
        include: {
          group: { select: { tenantId: true } },
        },
      });
      if (!auction || auction.group.tenantId !== tenantId) {
        throw new NotFoundException('Leilão não encontrado.');
      }
      if (auction.status !== AuctionStatus.OPEN) {
        throw new ConflictException('Este leilão não está mais aberto.');
      }

      const currentMax = await tx.bid.aggregate({
        where: { auctionId: auction.id },
        _max: { amount: true },
      });

      const bidAmount = new Decimal(input.amount);
      const minimum =
        currentMax._max.amount !== null ? currentMax._max.amount : auction.initialValue;
      const isFirstBid = currentMax._max.amount === null;
      const step = auction.minBidStep;
      const hasStep = step != null && step.gt(0);

      // Com incremento mínimo definido, o lance seguinte precisa ser no mínimo
      // "atual + incremento" (ex.: atual R$ 50,00 e incremento R$ 1,00 => >= 51,00).
      const valid = isFirstBid
        ? bidAmount.gte(auction.initialValue)
        : hasStep
          ? bidAmount.gte(currentMax._max.amount!.plus(step))
          : bidAmount.gt(currentMax._max.amount!);

      if (!valid) {
        throw new BadRequestException(
          isFirstBid
            ? `O primeiro lance deve ser igual ou maior que R$ ${auction.initialValue.toString()}.`
            : hasStep
              ? `O lance deve ser no mínimo R$ ${step.toString()} acima do atual (R$ ${minimum.toString()}).`
              : `O lance deve ser maior que o atual (R$ ${minimum.toString()}).`,
        );
      }

      await tx.bid.updateMany({
        where: { auctionId: auction.id, isCurrentLeader: true },
        data: { isCurrentLeader: false },
      });

      const bid = await tx.bid.create({
        data: {
          auctionId: auction.id,
          tenantId,
          amount: bidAmount,
          participantPhone: input.participantPhone,
          participantName: input.participantName ?? null,
          isCurrentLeader: true,
        },
      });

      // Prazo fixo agendado (painel) não é estendido por lances: o item encerra
      // no horário determinado mesmo com lances novos no meio.
      const endsAt = auction.scheduledEndAt
        ? auction.scheduledEndAt
        : auction.durationSeconds > 0
          ? new Date(Date.now() + auction.durationSeconds * 1000)
          : auction.endsAt;
      const updated = await tx.auction.update({
        where: { id: auction.id },
        data: { endsAt },
      });

      return { bid, auction: updated };
    });
  }

  /**
   * Encerra o leilão e fixa o vencedor (maior lance líder).
   */
  async closeAuction(
    auctionId: string,
    tenantId: string,
    reason: 'auto' | 'manual' = 'auto',
  ): Promise<Auction> {
    return this.prisma.$transaction(async (tx) => {
      // Lock FOR UPDATE evita TOCTOU entre o scheduler (auto-close), o painel
      // (manual) e um lance concorrente: apenas uma transação encerra o leilão.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Auction" WHERE id = ${auctionId} FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new NotFoundException('Leilão não encontrado.');
      }

      const auction = await tx.auction.findFirst({
        where: { id: auctionId, tenantId },
        include: { bids: { where: { isCurrentLeader: true } } },
      });
      if (!auction) {
        throw new NotFoundException('Leilão não encontrado.');
      }
      if (auction.status !== AuctionStatus.OPEN) {
        return auction;
      }

      const winnerBid = auction.bids[0] ?? null;

      const closed = await tx.auction.update({
        where: { id: auction.id },
        data: {
          status: AuctionStatus.CLOSED,
          closedAt: new Date(),
          winnerBidId: winnerBid?.id ?? null,
          endsAt: auction.endsAt,
        },
      });

      if (auction.itemId) {
        await tx.item.update({
          where: { id: auction.itemId },
          data: { status: winnerBid ? ItemStatus.SOLD : ItemStatus.AVAILABLE },
        });
      }

      await this.audit.record({
        tenantId,
        action: AuditAction.AUCTION_CLOSE,
        entity: 'Auction',
        entityId: auction.id,
        after: {
          reason,
          winnerBidId: winnerBid?.id ?? null,
          finalAmount: winnerBid?.amount.toString() ?? null,
        },
      });

      return closed;
    });
  }

  /**
   * Cancela imediatamente um leilão aberto (comando !encerrar — somente admin do grupo).
   */
  async cancelAuction(auctionId: string, tenantId: string): Promise<Auction> {
    return this.prisma.$transaction(async (tx) => {
      // Lock FOR UPDATE evita TOCTOU: um encerramento (auto) não pode correr
      // junto com um cancelamento manual sem que um deles espere o outro.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Auction" WHERE id = ${auctionId} FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new NotFoundException('Leilão não encontrado.');
      }

      const auction = await tx.auction.findFirst({ where: { id: auctionId, tenantId } });
      if (!auction) {
        throw new NotFoundException('Leilão não encontrado.');
      }
      if (auction.status !== AuctionStatus.OPEN) {
        throw new ConflictException('Este leilão não está aberto.');
      }

      const cancelled = await tx.auction.update({
        where: { id: auction.id },
        data: { status: AuctionStatus.CANCELLED, closedAt: new Date() },
      });

      if (auction.itemId) {
        await tx.item.update({
          where: { id: auction.itemId },
          data: { status: ItemStatus.AVAILABLE },
        });
      }

      await this.audit.record({
        tenantId,
        action: AuditAction.AUCTION_CANCEL,
        entity: 'Auction',
        entityId: auction.id,
      });

      return cancelled;
    });
  }

  /**
   * Encerra automaticamente todos os leilões cujo prazo já expirou.
   * Chamado periodicamente pelo scheduler — recupera também leilões órfãos
   * após reinício do servidor.
   */
  async processExpiredAuctions(): Promise<Auction[]> {
    // Inclui itens de lista (evento): cada item tem prazo próprio e é encerrado
    // automaticamente quando esgota (recuperação pós-restart do servidor).
    const expired = await this.prisma.auction.findMany({
      where: {
        status: AuctionStatus.OPEN,
        endsAt: { lte: new Date() },
      },
      include: {
        group: true,
        bids: { where: { isCurrentLeader: true }, include: { auction: true } },
      },
    });

    const closed: Auction[] = [];
    for (const auction of expired) {
      closed.push(await this.closeAuction(auction.id, auction.tenantId, 'auto'));
    }
    return closed;
  }

  async list(
    tenantId: string,
    params: { page?: number; limit?: number; status?: AuctionStatus; groupId?: string },
  ): Promise<PaginatedResult<unknown>> {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;

    const where: Prisma.AuctionWhereInput = {
      tenantId,
      ...(params.status ? { status: params.status } : {}),
      ...(params.groupId ? { groupId: params.groupId } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.auction.findMany({
        where,
        include: {
          group: { select: { id: true, name: true } },
          auctionEvent: { select: { id: true, name: true } },
          winnerBid: { select: { amount: true, participantName: true, participantPhone: true } },
          _count: { select: { bids: true } },
        },
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auction.count({ where }),
    ]);

    return buildPaginatedResult(data, total, page, limit);
  }

  async history(
    tenantId: string,
    groupId: string,
    params: { page?: number; limit?: number },
  ): Promise<PaginatedResult<unknown>> {
    return this.list(tenantId, { ...params, groupId });
  }

  /**
   * Apaga todos os leilões do tenant (histórico).
   * Lances são removidos via onDelete: Cascade. Itens que estavam em leilão
   * voltam a ficar disponíveis para evitar status inconsistente.
   */
  async clearHistory(tenantId: string): Promise<{ deleted: number }> {
    const { count } = await this.prisma.auction.deleteMany({ where: { tenantId } });

    await this.prisma.item.updateMany({
      where: { tenantId, status: ItemStatus.ON_AUCTION },
      data: { status: ItemStatus.AVAILABLE },
    });

    return { deleted: count };
  }

  async getBids(tenantId: string, auctionId: string, page = 1, limit = 50) {
    const where: Prisma.BidWhereInput = { auctionId, tenantId };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.bid.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.bid.count({ where }),
    ]);
    return buildPaginatedResult(data, total, page, limit);
  }

  /**
   * Atualiza o status de pagamento do leilão (ex.: pendente x pago pelo vencedor).
   */
  async updatePaymentStatus(
    tenantId: string,
    auctionId: string,
    status: PaymentStatus,
  ): Promise<Auction> {
    const auction = await this.findById(tenantId, auctionId);
    return this.prisma.auction.update({
      where: { id: auction.id },
      data: { paymentStatus: status },
    });
  }

  /**
   * Atualiza informações de um leilão (nome do produto, valor inicial, duração, etc.).
   * Só permite editar leilões que ainda não foram encerrados.
   */
  async updateAuction(
    tenantId: string,
    auctionId: string,
    data: { productName?: string; initialValue?: number; durationSeconds?: number; minBidStep?: number | null },
  ): Promise<Auction> {
    const auction = await this.findById(tenantId, auctionId);
    if (auction.status !== AuctionStatus.OPEN) {
      throw new ConflictException('Só é possível editar leilões que estão em andamento.');
    }

    const updateData: Prisma.AuctionUpdateInput = {};
    if (data.productName !== undefined) updateData.productName = data.productName;
    if (data.initialValue !== undefined) updateData.initialValue = new Decimal(data.initialValue);
    if (data.durationSeconds !== undefined) {
      updateData.durationSeconds = data.durationSeconds;
      updateData.endsAt = new Date(auction.startedAt.getTime() + data.durationSeconds * 1000);
    }
    if (data.minBidStep !== undefined) {
      updateData.minBidStep = data.minBidStep !== null ? new Decimal(data.minBidStep) : null;
    }

    return this.prisma.auction.update({
      where: { id: auction.id },
      data: updateData,
    });
  }

  /**
   * Atualiza o valor de um lance (uso exclusivo do admin para corrigir erros).
   * Recalcula o lance líder se necessário.
   */
  async updateBid(
    tenantId: string,
    bidId: string,
    data: { amount: number; participantName?: string; participantPhone?: string },
  ): Promise<Bid> {
    const bid = await this.prisma.bid.findFirst({
      where: { id: bidId, tenantId },
      include: { auction: true },
    });
    if (!bid) {
      throw new NotFoundException('Lance não encontrado.');
    }
    if (bid.auction.status !== AuctionStatus.OPEN) {
      throw new ConflictException('Só é possível editar lances de leilões em andamento.');
    }

    return this.prisma.bid.update({
      where: { id: bidId },
      data: {
        amount: new Decimal(data.amount),
        ...(data.participantName !== undefined ? { participantName: data.participantName } : {}),
        ...(data.participantPhone !== undefined ? { participantPhone: data.participantPhone } : {}),
      },
    });
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
    );
  }
}
