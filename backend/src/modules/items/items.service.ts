import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Auction, Item, ItemStatus, Role, SessionStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { buildPaginatedResult, PaginatedResult } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../common/database/prisma.service';
import { PlanLimitsService } from '../../common/services/plan-limits.service';
import { AuctionEventsService } from '../auction-events/auction-events.service';
import { AuctionsService } from '../auctions/auctions.service';
import { AuctionEngine } from '../whatsapp/auction.engine';
import { WhatsAppClientManager } from '../whatsapp/whatsapp-client.manager';
import { CreateItemDto, StartItemAuctionDto } from './dto/item.dto';

/**
 * Cadastro de itens para leilão.
 *
 * O item é uma "pré-configuração" do leilão criada no painel. Ao acionar
 * "Leiloar item", o backend cria o leilão em um grupo vinculado e o anuncia
 * no WhatsApp (via AuctionEngine), dispensando o fluxo interativo do bot.
 */
@Injectable()
export class ItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auctionsService: AuctionsService,
    private readonly auctionEventsService: AuctionEventsService,
    private readonly whatsappManager: WhatsAppClientManager,
    private readonly engine: AuctionEngine,
    private readonly planLimits: PlanLimitsService,
  ) {}

  async create(tenantId: string, dto: CreateItemDto, actorRole: Role = Role.ADMIN): Promise<Item> {
    if (dto.initialValue <= 0) {
      throw new BadRequestException('O valor inicial deve ser maior que zero.');
    }
    if (dto.durationMinutes !== undefined && dto.durationMinutes < 1) {
      throw new BadRequestException('A duração mínima do leilão é de 1 minuto.');
    }
    if (dto.auctionEventId) {
      await this.auctionEventsService.ensureOpen(tenantId, dto.auctionEventId);
      await this.planLimits.assertCanAddItemToEvent(tenantId, dto.auctionEventId, actorRole);
    }

    return this.prisma.item.create({
      data: {
        tenantId,
        auctionEventId: dto.auctionEventId ?? null,
        name: dto.name,
        description: dto.description ?? null,
        imageUrl: dto.imageUrl ?? null,
        initialValue: new Decimal(dto.initialValue),
        durationSeconds: dto.durationMinutes !== undefined ? dto.durationMinutes * 60 : 0,
      },
    });
  }

  async list(
    tenantId: string,
    params: { page?: number; limit?: number; auctionEventId?: string },
  ): Promise<PaginatedResult<Item & { auctionCount: number }>> {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;

    const where = {
      tenantId,
      ...(params.auctionEventId ? { auctionEventId: params.auctionEventId } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.item.findMany({
        where,
        include: { _count: { select: { auctions: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.item.count({ where }),
    ]);

    const enriched = data.map(({ _count, ...item }) => ({
      ...item,
      auctionCount: _count.auctions,
    }));

    return buildPaginatedResult(enriched, total, page, limit);
  }

  async findById(tenantId: string, itemId: string): Promise<Item> {
    const item = await this.prisma.item.findFirst({
      where: { id: itemId, tenantId },
    });
    if (!item) {
      throw new NotFoundException('Item não encontrado.');
    }
    return item;
  }

  async remove(tenantId: string, itemId: string): Promise<void> {
    const item = await this.findById(tenantId, itemId);
    await this.prisma.item.delete({ where: { id: item.id } });
  }

  /**
   * Inicia o leilão do item em um grupo vinculado e o anuncia no WhatsApp.
   */
  async startAuctionOnWhatsApp(
    tenantId: string,
    itemId: string,
    dto: StartItemAuctionDto,
    startedBy?: string,
  ): Promise<Auction> {
    const item = await this.findById(tenantId, itemId);
    if (item.status === ItemStatus.ON_AUCTION) {
      throw new ConflictException('Este item já está em leilão.');
    }
    if (item.auctionEventId) {
      await this.auctionEventsService.ensureOpen(tenantId, item.auctionEventId);
    }

    const group = await this.prisma.group.findFirst({
      where: { id: dto.groupId, tenantId, isActive: true },
    });
    if (!group) {
      throw new NotFoundException('Grupo não encontrado ou inativo.');
    }
    if (!group.whatsappGroupId) {
      throw new BadRequestException('O grupo não está vinculado a um grupo do WhatsApp.');
    }

    const { status } = await this.whatsappManager.sessionStatus(tenantId);
    if (status !== SessionStatus.CONNECTED) {
      throw new BadRequestException(
        'Conecte o WhatsApp no painel antes de iniciar um leilão.',
      );
    }

    const auction = await this.auctionsService.startAuction(tenantId, {
      groupId: group.id,
      itemId: item.id,
      auctionEventId: item.auctionEventId ?? undefined,
      productName: item.name,
      initialValue: Number(item.initialValue),
      durationSeconds:
      dto.durationMinutes !== undefined ? dto.durationMinutes * 60 : item.durationSeconds,
      startedBy,
    });

    await this.prisma.item.update({
      where: { id: item.id },
      data: { status: ItemStatus.ON_AUCTION },
    });

    await this.engine.launchAuction({
      tenantId,
      whatsappGroupId: group.whatsappGroupId,
      auction,
    });

    return auction;
  }
}
