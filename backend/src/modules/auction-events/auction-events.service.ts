import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Auction, AuctionEvent, AuctionEventStatus, AuctionStatus, ItemStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../common/database/prisma.service';
import { AuctionsService } from '../auctions/auctions.service';
import { CreateAuctionEventDto, UpdateAuctionEventDto } from './dto/auction-event.dto';

export interface AuctionListItem {
  number: number;
  auctionId: string | null;
  itemId: string;
  name: string;
  initialValue: Decimal;
  value: Decimal;
  imageUrl: string | null;
  status: string;
  leader: { name: string; amount: Decimal } | null;
  bidCount: number;
}

/**
 * Leilões (eventos) — contêineres que agrupam itens cadastrados.
 *
 * Ex.: "LEILÃO - FESTEJO SANTA CLARA", "Leilão de Domingo". Um leilão (evento)
 * aberto pode ser aberto como **lista** em um grupo do WhatsApp: todos os itens
 * recebem um leilão (Auction) aberto simultaneamente, lances no formato "NN - VALOR".
 */
@Injectable()
export class AuctionEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auctionsService: AuctionsService,
  ) {}

  async create(tenantId: string, dto: CreateAuctionEventDto): Promise<AuctionEvent> {
    await this.assertGroup(tenantId, dto.groupId);
    return this.prisma.auctionEvent.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description ?? null,
        groupId: dto.groupId ?? null,
        periodicStatusMinutes: dto.periodicStatusMinutes ?? null,
      },
    });
  }

  async list(tenantId: string): Promise<Array<AuctionEvent & { itemCount: number; auctionCount: number }>> {
    const events = await this.prisma.auctionEvent.findMany({
      where: { tenantId },
      include: {
        _count: { select: { items: true, auctions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return events.map(({ _count, ...event }) => ({
      ...event,
      itemCount: _count.items,
      auctionCount: _count.auctions,
    }));
  }

  async findById(tenantId: string, eventId: string): Promise<AuctionEvent & { itemCount: number }> {
    const event = await this.prisma.auctionEvent.findFirst({
      where: { id: eventId, tenantId },
      include: {
        _count: { select: { items: true } },
      },
    });
    if (!event) {
      throw new NotFoundException('Leilão não encontrado.');
    }
    const { _count, ...rest } = event;
    return { ...rest, itemCount: _count.items };
  }

  async items(tenantId: string, eventId: string) {
    await this.findById(tenantId, eventId);
    return this.prisma.item.findMany({
      where: { tenantId, auctionEventId: eventId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async update(tenantId: string, eventId: string, dto: UpdateAuctionEventDto): Promise<AuctionEvent> {
    await this.findById(tenantId, eventId);
    if (dto.groupId !== undefined) {
      await this.assertGroup(tenantId, dto.groupId);
    }
    return this.prisma.auctionEvent.update({
      where: { id: eventId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.groupId !== undefined ? { groupId: dto.groupId } : {}),
        ...(dto.periodicStatusMinutes !== undefined
          ? { periodicStatusMinutes: dto.periodicStatusMinutes }
          : {}),
      },
    });
  }

  /**
   * Abre o evento como **lista** em um grupo: cria um leilão aberto por item
   * (todos simultâneos) e marca os itens como ON_AUCTION.
   */
  async startList(tenantId: string, eventId: string, groupId: string): Promise<Auction[]> {
    const event = await this.ensureOpen(tenantId, eventId);
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, tenantId, isActive: true },
    });
    if (!group) {
      throw new NotFoundException('Grupo não encontrado ou inativo.');
    }
    if (!group.whatsappGroupId) {
      throw new BadRequestException('O grupo não está vinculado a um grupo do WhatsApp.');
    }

    const items = await this.prisma.item.findMany({
      where: { tenantId, auctionEventId: event.id },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    if (items.length === 0) {
      throw new BadRequestException('Cadastre itens neste leilão antes de iniciar.');
    }

    const open = await this.prisma.auction.findMany({
      where: { tenantId, groupId: group.id, status: AuctionStatus.OPEN },
      select: { id: true },
    });
    if (open.length > 0) {
      throw new ConflictException('Já existe um leilão ativo neste grupo.');
    }

    const auctions: Auction[] = [];
    for (const item of items) {
      const auction = await this.prisma.auction.create({
        data: {
          tenantId,
          groupId: group.id,
          itemId: item.id,
          auctionEventId: event.id,
          productName: item.name,
          initialValue: item.initialValue,
          durationSeconds: item.durationSeconds,
          status: AuctionStatus.OPEN,
          startedAt: new Date(),
          endsAt: new Date(Date.now() + item.durationSeconds * 1000),
        },
      });
      await this.prisma.item.update({
        where: { id: item.id },
        data: { status: ItemStatus.ON_AUCTION },
      });
      auctions.push(auction);
    }

    return auctions;
  }

  /**
   * Retorna o estado atual da lista (evento) para o painel e para o bot:
   * item por item, com lance líder e valor no momento.
   */
  async listSummary(tenantId: string, eventId: string): Promise<AuctionListItem[]> {
    await this.findById(tenantId, eventId);

    const [items, auctions] = await Promise.all([
      this.prisma.item.findMany({
        where: { tenantId, auctionEventId: eventId },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.auction.findMany({
        where: { tenantId, auctionEventId: eventId },
        include: {
          winnerBid: {
            select: { amount: true, participantName: true, participantPhone: true },
          },
          bids: {
            where: { isCurrentLeader: true },
            select: { amount: true, participantName: true, participantPhone: true },
          },
          _count: { select: { bids: true } },
        },
        orderBy: { startedAt: 'asc' },
      }),
    ]);

    const byItem = new Map<string, (typeof auctions)[number]>();
    for (const auction of auctions) {
      if (auction.itemId) byItem.set(auction.itemId, auction);
    }

    return items.map((item, index) => {
      const auction = byItem.get(item.id);
      const leading = auction?.bids[0] ?? auction?.winnerBid ?? null;
      return {
        number: index + 1,
        auctionId: auction?.id ?? null,
        itemId: item.id,
        name: item.name,
        initialValue: item.initialValue,
        value: (leading?.amount ?? item.initialValue) as Decimal,
        imageUrl: item.imageUrl,
        status: (auction?.status ?? 'AVAILABLE') as string,
        leader: leading
          ? { name: leading.participantName ?? leading.participantPhone, amount: leading.amount }
          : null,
        bidCount: auction?._count.bids ?? 0,
      };
    });
  }

  /**
   * Encerra a lista inteira: fecha todos os leilões abertos itens da lista
   * (usado quando o administrador fecha o evento pelo painel).
   */
  async close(tenantId: string, eventId: string): Promise<AuctionEvent> {
    const event = await this.findById(tenantId, eventId);
    if (event.status === AuctionEventStatus.CLOSED) {
      throw new ConflictException('Este leilão já está encerrado.');
    }

    const openAuctions = await this.prisma.auction.findMany({
      where: { tenantId, auctionEventId: event.id, status: AuctionStatus.OPEN },
      select: { id: true },
    });
    for (const auction of openAuctions) {
      await this.auctionsService.closeAuction(auction.id, tenantId, 'manual');
    }

    return this.prisma.auctionEvent.update({
      where: { id: event.id },
      data: { status: AuctionEventStatus.CLOSED },
    });
  }

  /**
   * Remove o leilão (evento). Só é permitido quando ainda não há leilões
   * realizados nem itens em leilão — preserva o histórico.
   */
  async remove(tenantId: string, eventId: string): Promise<void> {
    const event = await this.findById(tenantId, eventId);

    // Exclui o evento (itens são removidos via onDelete: Cascade; os leilões
    // realizados são preservados no histórico e apenas desvinculados do evento).
    await this.prisma.auctionEvent.delete({ where: { id: event.id } });
  }

  /**
   * Garante que o evento existe, pertence ao tenant e está aberto.
   */
  async ensureOpen(tenantId: string, eventId: string): Promise<AuctionEvent> {
    const event = await this.findById(tenantId, eventId);
    if (event.status !== AuctionEventStatus.OPEN) {
      throw new ConflictException('Este leilão está encerrado e não aceita mais itens.');
    }
    return event;
  }

  private async assertGroup(tenantId: string, groupId?: string): Promise<void> {
    if (!groupId) return;
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, tenantId, isActive: true },
    });
    if (!group) {
      throw new NotFoundException('Grupo não encontrado ou inativo.');
    }
  }
}