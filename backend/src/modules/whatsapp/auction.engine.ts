import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Auction, AuctionStatus, Prisma } from '@prisma/client';
import { AuctionsService } from '../auctions/auctions.service';
import { GroupsService } from '../groups/groups.service';
import { PrismaService } from '../../common/database/prisma.service';
import {
  WHATSAPP_DB_SWEEP_INTERVAL_MS,
  WHATSAPP_DEFAULT_DURATION_SECONDS,
  WHATSAPP_MIN_DURATION_SECONDS,
  WHATSAPP_TICK_INTERVAL_MS,
  WHATSAPP_WARNING_FIRST_SECONDS,
  WHATSAPP_WARNING_SECOND_SECONDS,
} from './whatsapp.constants';
import { formatCurrency, imageUrlToLocalPath, parseAmount } from './whatsapp.utils';
import { ActiveAuctionMemory, AuctionSetupState, WhatsAppGroupContext } from './whatsapp.types';

export type MessageSender = (
  tenantId: string,
  groupId: string,
  text: string,
  mediaPath?: string,
) => Promise<void>;

/**
 * Motor de leilões do WhatsApp.
 *
 * Estado e tempo:
 *  - O prazo é absoluto (`endsAt`) e persistido no banco — recuperação trivial
 *    após reinício do servidor (sem deriva de relógio).
 *  - Um ticker central (1s) dispara os avisos (60s/30s) e o encerramento.
 *  - Um varredura lenta no banco (30s) fecha leilões órfãos por segurança.
 *
 * Regras:
 *  - Apenas um leilão aberto por grupo (imposta também pelo banco).
 *  - Todo lance reinicia o cronômetro.
 *  - Mensagens numéricas de participantes são interpretadas como lances.
 *
 * Desacoplamento: o motor NÃO depende do transporte. O envio de mensagens é
 * feito via inscrição (subscribe) — o WhatsAppClientManager se registra.
 */
@Injectable()
export class AuctionEngine implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuctionEngine.name);

  /** groupId (whatsapp serialized) -> setup em andamento */
  private readonly setups = new Map<string, AuctionSetupState>();

  /** groupId -> leilão ativo em memória */
  private readonly active = new Map<string, ActiveAuctionMemory>();

  /** assinantes para envio de mensagens (desacopla o transporte) */
  private readonly subscribers = new Set<MessageSender>();

  private tickTimer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auctionsService: AuctionsService,
    private readonly groupsService: GroupsService,
  ) {}

  subscribe(sender: MessageSender): void {
    this.subscribers.add(sender);
  }

  async onModuleInit(): Promise<void> {
    await this.loadActiveAuctions();
    this.tickTimer = setInterval(() => this.tick(), WHATSAPP_TICK_INTERVAL_MS);
    this.sweepTimer = setInterval(
      () => void this.sweepExpiredFromDb(),
      WHATSAPP_DB_SWEEP_INTERVAL_MS,
    );
    this.logger.log(
      `Motor de leilões iniciado com ${this.active.size} leilão(ões) recuperado(s).`,
    );
  }

  onModuleDestroy(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  /**
   * Recupera leilões abertos do banco para a memória (após restart).
   */
  private async loadActiveAuctions(): Promise<void> {
    const auctions = await this.prisma.auction.findMany({
      where: { status: AuctionStatus.OPEN },
      select: {
        id: true,
        tenantId: true,
        groupId: true,
        productName: true,
        endsAt: true,
        group: { select: { whatsappGroupId: true } },
      },
    });

    for (const auction of auctions) {
      if (!auction.endsAt) continue;
      const remainingSeconds = this.remainingSeconds(auction.endsAt);
      const whatsappGroupId = auction.group.whatsappGroupId;

      this.active.set(whatsappGroupId, {
        auctionId: auction.id,
        tenantId: auction.tenantId,
        groupId: whatsappGroupId,
        productName: auction.productName,
        endsAt: auction.endsAt,
        warnedFirst: remainingSeconds <= WHATSAPP_WARNING_FIRST_SECONDS,
        warnedSecond: remainingSeconds <= WHATSAPP_WARNING_SECOND_SECONDS,
        closed: false,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Comandos
  // -------------------------------------------------------------------------

  async startSetup(context: WhatsAppGroupContext): Promise<string> {
    if (this.active.has(context.groupId)) {
      return '⚠️ Já existe um leilão em andamento neste grupo.';
    }

    this.setups.set(context.groupId, {
      tenantId: context.tenantId,
      groupId: context.groupId,
      step: 'product',
    });

    return [
      '🏷️ *INICIANDO NOVO LEILÃO*',
      '',
      'Qual é o *nome do produto*?',
    ].join('\n');
  }

  /**
   * Inicia um leilão diretamente a partir do painel (item cadastrado).
   * Cria a entrada em memória e anuncia o início no grupo do WhatsApp.
   */
  async launchAuction(input: {
    tenantId: string;
    whatsappGroupId: string;
    auction: Auction;
  }): Promise<void> {
    if (this.active.has(input.whatsappGroupId)) {
      throw new ConflictException('Já existe um leilão em andamento neste grupo.');
    }
    if (!input.auction.endsAt) {
      throw new ConflictException('Leilão sem prazo definido.');
    }

    const memory: ActiveAuctionMemory = {
      auctionId: input.auction.id,
      tenantId: input.tenantId,
      groupId: input.whatsappGroupId,
      productName: input.auction.productName,
      endsAt: input.auction.endsAt,
      warnedFirst: false,
      warnedSecond: false,
      closed: false,
    };
    this.active.set(input.whatsappGroupId, memory);

    const mediaPath = await this.resolveItemMediaPath(input.auction.itemId);

    await this.sendToGroup(
      memory,
      [
        '🔨 *LEILÃO INICIADO*',
        '',
        `📦 Produto: *${input.auction.productName}*`,
        `💰 Valor inicial: *${formatCurrency(input.auction.initialValue)}*`,
        `⏱️ Tempo: *${input.auction.durationSeconds}s*`,
        '',
        'Envie o *valor* para dar o primeiro lance! 🚀',
      ].join('\n'),
      mediaPath,
    );
  }

  /**
   * Resolve o caminho local da foto do item (enviada pelo painel) para ser
   * anexada à mensagem de abertura. Sem foto, retorna undefined.
   */
  private async resolveItemMediaPath(
    itemId: string | null | undefined,
  ): Promise<string | undefined> {
    if (!itemId) return undefined;
    const item = await this.prisma.item.findUnique({ where: { id: itemId } });
    if (!item?.imageUrl) return undefined;
    return imageUrlToLocalPath(item.imageUrl);
  }

  async getStatus(context: WhatsAppGroupContext): Promise<string> {
    const active = this.active.get(context.groupId);
    if (!active) {
      return 'ℹ️ Não há leilão em andamento neste grupo.\nUse *!iniciar* para começar.';
    }

    const auction = await this.auctionsService.findById(active.tenantId, active.auctionId);
    const bids = await this.auctionsService.getBids(active.tenantId, active.auctionId, 1, 1);
    const leader = (bids.data as unknown[])[0] as
      | { amount: Prisma.Decimal; participantName: string | null; participantPhone: string }
      | undefined;
    const remaining = Math.max(0, Math.ceil(this.remainingSeconds(active.endsAt)));

    return [
      '📊 *STATUS DO LEILÃO*',
      '',
      `📦 Produto: *${auction.productName}*`,
      `💰 Maior lance: *${leader ? formatCurrency(leader.amount) : formatCurrency(auction.initialValue)}*`,
      `👤 Líder: *${leader ? (leader.participantName ?? leader.participantPhone) : '—'}*`,
      `⏱️ Tempo restante: *${remaining}s*`,
      `🔢 Lances: *${bids.meta.total}*`,
    ].join('\n');
  }

  async cancel(context: WhatsAppGroupContext): Promise<string> {
    if (!context.isAdmin) {
      return '⛔ Apenas *administradores do grupo* podem encerrar o leilão.';
    }

    const active = this.active.get(context.groupId);
    if (!active) {
      return 'ℹ️ Não há leilão em andamento neste grupo.';
    }

    await this.auctionsService.cancelAuction(active.auctionId, active.tenantId);
    this.active.delete(context.groupId);

    return [
      '🚫 *LEILÃO CANCELADO*',
      '',
      `📦 Produto: *${active.productName}*`,
      'O leilão foi cancelado por um administrador.',
    ].join('\n');
  }

  async getHistory(context: WhatsAppGroupContext): Promise<string> {
    const history = await this.auctionsService.history(context.tenantId, context.groupId, {
      page: 1,
      limit: 5,
    });

    const rows = history.data as Array<{
      productName: string;
      status: AuctionStatus;
      initialValue: Prisma.Decimal;
      winnerBid: {
        amount: Prisma.Decimal;
        participantName: string | null;
        participantPhone: string;
      } | null;
      closedAt: Date | null;
    }>;

    if (rows.length === 0) {
      return '📜 Nenhum leilão realizado ainda neste grupo.';
    }

    const lines = rows.map((auction) => {
      const status =
        auction.status === AuctionStatus.CLOSED
          ? '✅ Encerrado'
          : auction.status === AuctionStatus.CANCELLED
            ? '🚫 Cancelado'
            : '⏳ Em andamento';
      const winner = auction.winnerBid
        ? `${auction.winnerBid.participantName ?? auction.winnerBid.participantPhone} (${formatCurrency(auction.winnerBid.amount)})`
        : '—';
      return `📦 ${auction.productName}\n   ${status} | Vencedor: ${winner}`;
    });

    return ['📜 *ÚLTIMOS LEILÕES*', '', ...lines].join('\n');
  }

  /**
   * Vincula o grupo ao painel via código gerado na plataforma.
   * O admin envia `!vincular CODIGO` no próprio grupo.
   */
  async linkGroup(context: WhatsAppGroupContext, code: string): Promise<string> {
    if (!context.isAdmin) {
      return '⛔ Apenas *administradores do grupo* podem vincular este grupo ao painel.';
    }

    if (!this.groupsService.consumeLinkCode(context.tenantId, code)) {
      return '❌ Código inválido ou expirado.\nGere um novo código no painel (Grupos → Vincular grupo).';
    }

    const existing = await this.prisma.group.findFirst({
      where: { tenantId: context.tenantId, whatsappGroupId: context.groupId },
    });

    if (existing) {
      await this.prisma.group.update({
        where: { id: existing.id },
        data: { name: context.groupName, isActive: true },
      });
      return [
        '✅ *GRUPO VINCULADO*',
        '',
        `📦 Grupo: *${context.groupName}*`,
        'Este grupo já estava cadastrado e foi reativado.',
      ].join('\n');
    }

    await this.prisma.group.create({
      data: {
        tenantId: context.tenantId,
        name: context.groupName,
        whatsappGroupId: context.groupId,
      },
    });

    return [
      '✅ *GRUPO VINCULADO AO PAINEL*',
      '',
      `📦 Grupo: *${context.groupName}*`,
      'Já pode usar o comando *!iniciar* para começar um leilão.',
    ].join('\n');
  }

  help(): string {
    return [
      '🤖 *AJUDA — COMANDOS DO LEILÃO*',
      '',
      '!vincular CODIGO — Vincula este grupo ao painel (admin)',
      '!iniciar — Inicia um leilão',
      '!status — Mostra o andamento do leilão',
      '!encerrar — Cancela o leilão (somente admin)',
      '!historico — Últimos leilões do grupo',
      '!ajuda — Lista os comandos',
      '',
      '💰 Para dar um lance, basta enviar o *valor* no chat.',
      'Ex.: 100, 150, R$ 300, 1.500,00',
      'Todo lance reinicia o cronômetro.',
    ].join('\n');
  }

  // -------------------------------------------------------------------------
  // Fluxo de criação e lances (mensagens que não são comandos)
  // -------------------------------------------------------------------------

  async handleChatInput(context: WhatsAppGroupContext, text: string): Promise<void> {
    const setup = this.setups.get(context.groupId);
    if (setup) {
      await this.advanceSetup(context, setup, text);
      return;
    }

    const amount = parseAmount(text);
    if (amount !== null && amount > 0) {
      await this.placeBid(context, amount);
    }
  }

  private async advanceSetup(
    context: WhatsAppGroupContext,
    setup: AuctionSetupState,
    input: string,
  ): Promise<void> {
    switch (setup.step) {
      case 'product': {
        setup.productName = input.slice(0, 200);
        setup.step = 'value';
        this.setups.set(context.groupId, setup);
        await this.reply(
          context,
          `📦 Produto: *${setup.productName}*\n\nQual é o *valor inicial*?`,
        );
        return;
      }

      case 'value': {
        const value = parseAmount(input);
        if (value === null || value <= 0) {
          await this.reply(context, '❌ Valor inválido. Envie um número, ex.: *150* ou *R$ 150*');
          return;
        }
        setup.initialValue = value;
        setup.step = 'duration';
        this.setups.set(context.groupId, setup);
        await this.reply(
          context,
          `💰 Valor inicial: *${formatCurrency(value)}*\n\n⏱️ Qual o *tempo do leilão* em segundos? (padrão: ${WHATSAPP_DEFAULT_DURATION_SECONDS}s)`,
        );
        return;
      }

      case 'duration': {
        const duration = Math.round(Number(input.replace(/\D/g, '')));
        const validDuration =
          Number.isInteger(duration) &&
          duration >= WHATSAPP_MIN_DURATION_SECONDS &&
          duration <= 86400;

        if (!validDuration) {
          await this.reply(
            context,
            `❌ Tempo inválido. Envie segundos entre ${WHATSAPP_MIN_DURATION_SECONDS} e 86400, ex.: *120*`,
          );
          return;
        }

        this.setups.delete(context.groupId);

        try {
          const auction = await this.auctionsService.startAuction(setup.tenantId, {
            groupId: await this.resolveInternalGroupId(setup.tenantId, context.groupId),
            productName: setup.productName!,
            initialValue: setup.initialValue!,
            durationSeconds: duration,
          });

          this.active.set(context.groupId, {
            auctionId: auction.id,
            tenantId: setup.tenantId,
            groupId: context.groupId,
            productName: auction.productName,
            endsAt: auction.endsAt!,
            warnedFirst: false,
            warnedSecond: false,
            closed: false,
          });

          await this.reply(
            context,
            [
              '🔨 *LEILÃO INICIADO!*',
              '',
              `📦 Produto: *${auction.productName}*`,
              `💰 Valor inicial: *${formatCurrency(auction.initialValue)}*`,
              `⏱️ Tempo: *${duration}s*`,
              '',
              'Envie o *valor* para dar o primeiro lance! 🚀',
            ].join('\n'),
          );
        } catch (error) {
          await this.reply(context, this.friendlyError(error));
        }
        return;
      }
    }
  }

  private async placeBid(context: WhatsAppGroupContext, amount: number): Promise<void> {
    const active = this.active.get(context.groupId);
    if (!active || active.closed) {
      return;
    }

    try {
      const { auction } = await this.auctionsService.placeBid(active.tenantId, {
        auctionId: active.auctionId,
        amount,
        participantPhone: context.senderId.split('@')[0],
        participantName: context.senderName ?? undefined,
      });

      // Reinicia o cronômetro e os avisos.
      active.endsAt = auction.endsAt!;
      active.warnedFirst = false;
      active.warnedSecond = false;
      this.active.set(context.groupId, active);

      await this.reply(
        context,
        [
          '✅ *LANCE REGISTRADO!*',
          `💵 Valor: *${formatCurrency(amount)}*`,
          `👤 Líder: *${context.senderName ?? context.senderId.split('@')[0]}*`,
          `⏱️ Leilão reiniciado: *${auction.durationSeconds}s*`,
        ].join('\n'),
      );
    } catch (error) {
      await this.reply(context, this.friendlyError(error));
    }
  }

  // -------------------------------------------------------------------------
  // Ticker de contagem regressiva
  // -------------------------------------------------------------------------

  private async tick(): Promise<void> {
    for (const [groupId, auction] of this.active) {
      const remaining = this.remainingSeconds(auction.endsAt);

      if (remaining <= 0) {
        if (!auction.closed) {
          auction.closed = true;
          await this.closeAndAnnounce(auction);
        }
        this.active.delete(groupId);
        continue;
      }

      if (remaining <= WHATSAPP_WARNING_SECOND_SECONDS && !auction.warnedSecond) {
        auction.warnedSecond = true;
        await this.sendToGroup(auction, '🔔 *DOU-LHE DUAS!*');
      } else if (remaining <= WHATSAPP_WARNING_FIRST_SECONDS && !auction.warnedFirst) {
        auction.warnedFirst = true;
        await this.sendToGroup(auction, '🔔 *DOU-LHE UMA!*');
      }
    }
  }

  /**
   * Encerra o leilão expirado, persiste o vencedor e anuncia no grupo.
   */
  private async closeAndAnnounce(auction: ActiveAuctionMemory): Promise<void> {
    try {
      const closed = await this.auctionsService.closeAuction(auction.auctionId, auction.tenantId);
      const winner = await this.getWinner(auction);

      const lines = [
        '🏆 *LEILÃO ENCERRADO!*',
        '',
        `📦 Produto: *${auction.productName}*`,
        `👤 Vencedor: *${winner ? (winner.participantName ?? winner.participantPhone) : '—'}*`,
        `💰 Valor final: *${winner ? formatCurrency(winner.amount) : formatCurrency(closed.initialValue)}*`,
      ];

      await this.sendToGroup(auction, lines.join('\n'));
    } catch (error) {
      this.logger.error(
        `Falha ao encerrar leilão ${auction.auctionId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Varredura de segurança no banco: fecha leilões cujo prazo expirou e que,
   * por qualquer motivo, não estavam na memória (ex.: criados via API REST).
   */
  private async sweepExpiredFromDb(): Promise<void> {
    const closed = await this.auctionsService.processExpiredAuctions();
    for (const auction of closed) {
      const memory = this.active.get(auction.groupId);
      if (memory && !memory.closed) {
        memory.closed = true;
        await this.closeAndAnnounce(memory);
        this.active.delete(auction.groupId);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Auxiliares
  // -------------------------------------------------------------------------

  private async getWinner(auction: ActiveAuctionMemory) {
    const bids = await this.auctionsService.getBids(auction.tenantId, auction.auctionId, 1, 1);
    return (bids.data as unknown[])[0] as
      | { amount: Prisma.Decimal; participantName: string | null; participantPhone: string }
      | undefined;
  }

  private async sendToGroup(
    auction: ActiveAuctionMemory,
    text: string,
    mediaPath?: string,
  ): Promise<void> {
    await this.emit(auction.tenantId, auction.groupId, text, mediaPath);
  }

  private async reply(context: WhatsAppGroupContext, text: string): Promise<void> {
    await this.emit(context.tenantId, context.groupId, text);
  }

  private async emit(
    tenantId: string,
    groupId: string,
    text: string,
    mediaPath?: string,
  ): Promise<void> {
    await Promise.allSettled(
      Array.from(this.subscribers).map((send) => send(tenantId, groupId, text, mediaPath)),
    );
  }

  /**
   * Mapeia o id serializado do WhatsApp para o id interno do grupo (Grupo cadastrado).
   */
  private async resolveInternalGroupId(
    tenantId: string,
    whatsappGroupId: string,
  ): Promise<string> {
    const group = await this.prisma.group.findFirst({
      where: { tenantId, whatsappGroupId },
    });
    if (!group) {
      throw new Error('Grupo não vinculado à plataforma.');
    }
    return group.id;
  }

  private remainingSeconds(endsAt: Date): number {
    return (endsAt.getTime() - Date.now()) / 1000;
  }

  private friendlyError(error: unknown): string {
    const message = (error as Error).message;
    if (message.includes('não encontrado') || message.includes('não vinculado')) {
      return `⚠️ ${message}\nVincule este grupo ao seu painel antes de leiloar.`;
    }
    if (message.includes('lance deve ser') || message.includes('primeiro lance')) {
      return `❌ ${message}`;
    }
    if (message.includes('não está mais aberto')) {
      return '⚠️ Este leilão não está mais aberto.';
    }
    if (message.includes('aberto neste grupo')) {
      return '⚠️ Já existe um leilão aberto neste grupo.';
    }
    this.logger.error(`Erro não mapeado no motor: ${message}`);
    return '❌ Ocorreu um erro. Tente novamente.';
  }
}
