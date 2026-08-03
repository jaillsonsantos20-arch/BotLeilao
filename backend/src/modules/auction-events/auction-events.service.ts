import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuctionEvent, AuctionEventStatus, ItemStatus } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { CreateAuctionEventDto, UpdateAuctionEventDto } from './dto/auction-event.dto';

/**
 * Leilões (eventos) — contêineres que agrupam itens cadastrados.
 *
 * Ex.: "Leilão da Igreja", "Leilão de Domingo". Um leilão (evento) aberto
 * aceita itens novos e itens disponíveis podem ser leiloados no WhatsApp.
 */
@Injectable()
export class AuctionEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateAuctionEventDto): Promise<AuctionEvent> {
    return this.prisma.auctionEvent.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description ?? null,
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
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(tenantId: string, eventId: string, dto: UpdateAuctionEventDto): Promise<AuctionEvent> {
    await this.findById(tenantId, eventId);
    return this.prisma.auctionEvent.update({
      where: { id: eventId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
      },
    });
  }

  /**
   * Encerra o leilão (evento): itens não podem mais ser adicionados nem leiloados.
   */
  async close(tenantId: string, eventId: string): Promise<AuctionEvent> {
    const event = await this.findById(tenantId, eventId);
    if (event.status === AuctionEventStatus.CLOSED) {
      throw new ConflictException('Este leilão já está encerrado.');
    }

    const onAuctionCount = await this.prisma.item.count({
      where: { tenantId, auctionEventId: event.id, status: ItemStatus.ON_AUCTION },
    });
    if (onAuctionCount > 0) {
      throw new ConflictException(
        'Aguarde o leilão de algum item terminar antes de encerrar este leilão.',
      );
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
   * Usado ao cadastrar itens e ao iniciar leilões vinculados a ele.
   */
  async ensureOpen(tenantId: string, eventId: string): Promise<AuctionEvent> {
    const event = await this.findById(tenantId, eventId);
    if (event.status !== AuctionEventStatus.OPEN) {
      throw new ConflictException('Este leilão está encerrado e não aceita mais itens.');
    }
    return event;
  }
}
