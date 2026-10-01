import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Auction, Item, ItemAlias, ItemStatus, Prisma, Role, SessionStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { buildPaginatedResult, PaginatedResult } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../common/database/prisma.service';
import { PlanLimitsService } from '../../common/services/plan-limits.service';
import { AuctionEventsService } from '../auction-events/auction-events.service';
import { AuctionsService } from '../auctions/auctions.service';
import { AuctionEngine } from '../whatsapp/auction.engine';
import { normalizeMessage } from '../whatsapp/list-bid.parser';
import { WhatsAppClientManager } from '../whatsapp/whatsapp-client.manager';
import {
  CreateItemAliasDto,
  CreateItemDto,
  ITEM_ALIAS_MAX_PER_ITEM,
  StartItemAuctionDto,
  UpdateItemAliasDto,
} from './dto/item.dto';

/**
 * Cadastro de itens para leilão.
 *
 * O item é uma "pré-configuração" do leilão criada no painel. Ao acionar
 * "Leiloar item", o backend cria o leilão em um grupo vinculado e o anuncia
 * no WhatsApp (via AuctionEngine), dispensando o fluxo interativo do bot.
 */
@Injectable()
export class ItemsService {
  private readonly logger = new Logger(ItemsService.name);

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

    // Variações (sinônimos) do item: valida tudo ANTES de criar o item para
    // não deixar o cadastro pela metade (item novo ainda não tem variação).
    const aliasValues = this.prepareAliasPayload(dto.aliases ?? []);

    let created: Item;
    try {
      created = await this.prisma.item.create({
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

    if (aliasValues.length > 0) {
      try {
        await this.prisma.itemAlias.createMany({
          data: aliasValues.map((a) => ({
            tenantId,
            itemId: created.id,
            value: a.value,
            normalizedValue: a.normalized,
          })),
        });
      } catch (error) {
        this.logger.error(
          `Item ${created.id} criado, mas falhou ao salvar as variações: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        // Ainda não foi publicado no WhatsApp: desfaz para não deixar o
        // cadastro pela metade (sem as variações que o usuário pediu).
        await this.prisma.item.delete({ where: { id: created.id } }).catch(() => undefined);
        throw new BadRequestException('Não foi possível salvar as variações do item.');
      }
    }

    // Lista EM ANDAMENTO: publica somente este item no grupo na hora (card com
    // foto/texto + vínculo p/ lance via "Responder"). Se a lista ainda não foi
    // iniciada, o motor não faz nada e o item sai no início normal. Falha de
    // envio NÃO desfaz o cadastro: o erro é registrado e o item fica pendente
    // de reenvio ("Atualizar lista" do painel reenvia cards não confirmados).
    if (created.auctionEventId) {
      try {
        await this.engine.publishItemToList(tenantId, created.auctionEventId, created.id);
      } catch (error) {
        this.logger.error(
          `Item ${created.id} salvo, mas falhou ao publicar no WhatsApp: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return created;
  }

  async list(
    tenantId: string,
    params: { page?: number; limit?: number; auctionEventId?: string },
  ): Promise<PaginatedResult<Item & { auctionCount: number; aliases: ItemAlias[] }>> {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;

    const where = {
      tenantId,
      ...(params.auctionEventId ? { auctionEventId: params.auctionEventId } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.item.findMany({
        where,
        include: {
          _count: { select: { auctions: true } },
          // Painel precisa de TODAS as variações (inclusive inativas, para
          // reativar); o motor consome só as ativas.
          aliases: { orderBy: { createdAt: 'asc' } },
        },
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

  async findById(tenantId: string, itemId: string): Promise<Item & { aliases: ItemAlias[] }> {
    const item = await this.prisma.item.findFirst({
      where: { id: itemId, tenantId },
      include: { aliases: { orderBy: { createdAt: 'asc' } } },
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

  // ---------------------------------------------------------------------
  // Variações / sinônimos do item ("boi", "gado" → item "Garrote")
  // ---------------------------------------------------------------------

  /** Lista TODAS as variações do item (inclusive inativas, p/ reativar). */
  async listAliases(tenantId: string, itemId: string): Promise<ItemAlias[]> {
    await this.findById(tenantId, itemId);
    return this.prisma.itemAlias.findMany({
      where: { itemId, tenantId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createAlias(
    tenantId: string,
    itemId: string,
    dto: CreateItemAliasDto,
  ): Promise<ItemAlias> {
    const item = await this.findById(tenantId, itemId);
    const { value, normalized } = this.normalizeAlias(dto.value);

    const existing = await this.prisma.itemAlias.findFirst({
      where: { itemId: item.id, normalizedValue: normalized },
      select: { id: true, active: true },
    });
    if (existing) {
      throw new BadRequestException(
        existing.active
          ? 'Este item já tem uma variação com esse texto.'
          : 'Este item já tem essa variação, mas está inativada. Reative-a em vez de criar outra.',
      );
    }

    const total = await this.prisma.itemAlias.count({ where: { itemId: item.id } });
    if (total >= ITEM_ALIAS_MAX_PER_ITEM) {
      throw new BadRequestException(
        `Máximo de ${ITEM_ALIAS_MAX_PER_ITEM} variações por item.`,
      );
    }

    try {
      return await this.prisma.itemAlias.create({
        data: {
          tenantId: item.tenantId,
          itemId: item.id,
          value,
          normalizedValue: normalized,
        },
      });
    } catch (error) {
      if (this.isAliasUniqueViolation(error)) {
        throw new BadRequestException('Este item já tem uma variação com esse texto.');
      }
      throw error;
    }
  }

  async updateAlias(
    tenantId: string,
    itemId: string,
    aliasId: string,
    dto: UpdateItemAliasDto,
  ): Promise<ItemAlias> {
    const item = await this.findById(tenantId, itemId);
    const alias = await this.findAliasOrThrow(tenantId, item.id, aliasId);

    const data: Prisma.ItemAliasUpdateInput = {};
    if (dto.value !== undefined) {
      const { value, normalized } = this.normalizeAlias(dto.value);
      if (normalized !== alias.normalizedValue) {
        const clash = await this.prisma.itemAlias.findFirst({
          where: {
            itemId: item.id,
            normalizedValue: normalized,
            id: { not: alias.id },
          },
          select: { id: true },
        });
        if (clash) {
          throw new BadRequestException('Este item já tem uma variação com esse texto.');
        }
      }
      data.value = value;
      data.normalizedValue = normalized;
    }
    if (dto.active !== undefined) {
      data.active = dto.active;
    }

    if (Object.keys(data).length === 0) {
      return alias;
    }

    try {
      return await this.prisma.itemAlias.update({ where: { id: alias.id }, data });
    } catch (error) {
      if (this.isAliasUniqueViolation(error)) {
        throw new BadRequestException('Este item já tem uma variação com esse texto.');
      }
      throw error;
    }
  }

  async removeAlias(tenantId: string, itemId: string, aliasId: string): Promise<void> {
    const item = await this.findById(tenantId, itemId);
    const alias = await this.findAliasOrThrow(tenantId, item.id, aliasId);
    await this.prisma.itemAlias.delete({ where: { id: alias.id } });
  }

  private async findAliasOrThrow(tenantId: string, itemId: string, aliasId: string): Promise<ItemAlias> {
    const alias = await this.prisma.itemAlias.findFirst({
      where: { id: aliasId, itemId, tenantId },
    });
    if (!alias) {
      throw new NotFoundException('Variação não encontrada.');
    }
    return alias;
  }

  /**
   * Valida e normaliza uma variação enviada pelo painel. A normalização é a
   * MESMA usada na interpretação do lance (§5): minúsculas, sem acentos e
   * espaços colapsados — assim "Bói" e "boi" são a mesma variação.
   */
  private normalizeAlias(raw: string): { value: string; normalized: string } {
    const value = String(raw ?? '').trim().replace(/\s+/g, ' ');
    if (value.length < 1 || value.length > 60) {
      throw new BadRequestException('A variação deve ter entre 1 e 60 caracteres.');
    }
    const normalized = normalizeMessage(value)
      // Pontuação só nas bordas ("boi!" → "boi"): o participante pode escrever
      // com vírgula/ponto e a variação precisa continuar casando.
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) {
      throw new BadRequestException('A variação não pode ficar vazia.');
    }
    // Variação só numérica competiria com o nº do item (que tem prioridade
    // absoluta) e só geraria confusão.
    if (/^\d[\d.,\s]*$/.test(normalized)) {
      throw new BadRequestException(
        'A variação não pode ser apenas números: use o Nº do item para identificar o lote.',
      );
    }
    return { value, normalized };
  }

  /** Valida as variações enviadas junto com a criação do item. */
  private prepareAliasPayload(values: string[]): { value: string; normalized: string }[] {
    if (values.length > ITEM_ALIAS_MAX_PER_ITEM) {
      throw new BadRequestException(`Máximo de ${ITEM_ALIAS_MAX_PER_ITEM} variações por item.`);
    }
    const seen = new Map<string, string>();
    return values.map((raw) => {
      const alias = this.normalizeAlias(raw);
      const previous = seen.get(alias.normalized);
      if (previous) {
        throw new BadRequestException(
          `As variações "${previous}" e "${raw}" são a mesma variação.`,
        );
      }
      seen.set(alias.normalized, raw);
      return alias;
    });
  }

  /** Violação do índice único (itemId, normalizedValue) ao gravar variação. */
  private isAliasUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      String((error.meta as { target?: string[] } | undefined)?.target ?? '').includes('normalizedValue')
    );
  }
}
