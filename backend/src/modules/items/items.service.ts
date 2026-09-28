import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Auction, Item, ItemStatus, Prisma, Role, SessionStatus } from '@prisma/client';
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

  async create(
    tenantId: string,
    dto: CreateItemDto,
    actorRole: Role = Role.ADMIN,
    actorEmail?: string | null,
  ): Promise<Item> {
    if (dto.initialValue <= 0) {
      throw new BadRequestException('O valor inicial deve ser maior que zero.');
    }
    if (dto.durationMinutes != null && dto.durationMinutes < 1) {
      throw new BadRequestException('A duração mínima do leilão é de 1 minuto.');
    }

    let number: number | null = dto.number ?? null;
    let order: number | undefined;

    if (dto.auctionEventId) {
      await this.auctionEventsService.ensureOpen(tenantId, dto.auctionEventId);
      await this.planLimits.assertCanAddItemToEvent(
        tenantId,
        dto.auctionEventId,
        actorRole,
        actorEmail,
      );

      // Nº do item no modo lista: preenche números ausentes (itens legados) e
      // atribui o próximo sequencial quando não informado — mantém o Nº estável
      // mesmo que a posição na lista mude depois.
      const siblings = await this.prisma.item.findMany({
        where: { tenantId, auctionEventId: dto.auctionEventId },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, number: true, order: true },
      });
      const used = new Set<number>(
        siblings.map((s) => s.number).filter((n): n is number => n != null),
      );
      let nextFree = 1;
      for (const sibling of siblings) {
        if (sibling.number != null) continue;
        while (used.has(nextFree)) nextFree += 1;
        await this.prisma.item.update({
          where: { id: sibling.id },
          data: { number: nextFree },
        });
        used.add(nextFree);
      }

      if (number == null) {
        let candidate = 1;
        while (used.has(candidate)) candidate += 1;
        number = candidate;
      } else if (used.has(number)) {
        throw new BadRequestException(
          `Já existe um item com o Nº ${number} neste leilão.`,
        );
      }

      const maxOrder = siblings.reduce((max, s) => Math.max(max, s.order), 0);
      order = dto.order ?? maxOrder + 1;
    }

    try {
      return await this.prisma.item.create({
        data: {
          tenantId,
          auctionEventId: dto.auctionEventId ?? null,
          number,
          name: dto.name,
          description: dto.description ?? null,
          imageUrl: dto.imageUrl ?? null,
          initialValue: new Decimal(dto.initialValue),
          // Sem duração informada => NULL (item sem encerramento individual).
          durationSeconds: dto.durationMinutes != null ? dto.durationMinutes * 60 : null,
          ...(order !== undefined ? { order } : {}),
        },
      });
    } catch (error) {
      if (this.isNumberUniqueViolation(error)) {
        throw new BadRequestException(
          `Já existe um item com o Nº ${number} neste leilão.`,
        );
      }
      throw error;
    }
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

  async update(tenantId: string, itemId: string, data: {
    name?: string;
    description?: string;
    imageUrl?: string;
    initialValue?: number;
    number?: number | null;
    order?: number;
    durationMinutes?: number | null;
  }): Promise<Item> {
    const item = await this.findById(tenantId, itemId);
    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.imageUrl !== undefined) updateData.imageUrl = data.imageUrl;
    if (data.initialValue !== undefined) updateData.initialValue = new Decimal(data.initialValue);
    if (data.order !== undefined) updateData.order = data.order;

    if (data.number !== undefined) {
      let number = data.number;
      // Item de lista não pode ficar sem Nº (mataria o vínculo estável com o
      // status/lance): limpar o número gera o próximo sequencial livre.
      if (number == null && item.auctionEventId) {
        const siblings = await this.prisma.item.findMany({
          where: { tenantId, auctionEventId: item.auctionEventId },
          select: { number: true },
        });
        const used = new Set<number>(
          siblings.map((s) => s.number).filter((n): n is number => n != null),
        );
        let candidate = 1;
        while (used.has(candidate)) candidate += 1;
        number = candidate;
      }
      if (number != null && item.auctionEventId) {
        const clash = await this.prisma.item.findFirst({
          where: {
            tenantId,
            auctionEventId: item.auctionEventId,
            number,
            id: { not: item.id },
          },
          select: { id: true },
        });
        if (clash) {
          throw new BadRequestException(
            `Já existe um item com o Nº ${number} neste leilão.`,
          );
        }
      }
      updateData.number = number;
    }

    if (data.durationMinutes !== undefined) {
      // 0 ou null => sem duração (NULL — encerra apenas pelo painel).
      updateData.durationSeconds =
        data.durationMinutes != null && data.durationMinutes > 0
          ? data.durationMinutes * 60
          : null;
    }

    try {
      return await this.prisma.item.update({
        where: { id: item.id },
        data: updateData,
      });
    } catch (error) {
      if (this.isNumberUniqueViolation(error)) {
        throw new BadRequestException(
          `Já existe um item com o Nº ${data.number} neste leilão.`,
        );
      }
      throw error;
    }
  }

  /** Violação do índice único (auctionEventId, number) ao gravar o Nº do item. */
  private isNumberUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      String((error.meta as { target?: string[] } | undefined)?.target ?? '').includes('number')
    );
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

    // Leilão individual exige prazo (o ticker encerra ao chegar a zero).
    const durationSeconds =
      dto.durationMinutes != null ? dto.durationMinutes * 60 : item.durationSeconds;
    if (durationSeconds == null) {
      throw new BadRequestException(
        'Este item não tem duração definida. Informe a duração (em minutos) para iniciar o leilão individual.',
      );
    }

    const auction = await this.auctionsService.startAuction(tenantId, {
      groupId: group.id,
      itemId: item.id,
      auctionEventId: item.auctionEventId ?? undefined,
      productName: item.name,
      initialValue: Number(item.initialValue),
      durationSeconds,
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
