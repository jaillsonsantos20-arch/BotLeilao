import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SessionStatus } from '@prisma/client';
import { Client, Contact, GroupChat, LocalAuth, Message, MessageMedia } from 'whatsapp-web.js';
import * as qrcode from 'qrcode-terminal';
import { existsSync } from 'fs';
import { PrismaService } from '../../common/database/prisma.service';
import { AuctionEngine } from './auction.engine';
import { CommandRouter } from './command-handler';
import { WhatsAppGroupContext } from './whatsapp.types';
import { WHATSAPP_RECOVERY_COOLDOWN_MS } from './whatsapp.constants';

/**
 * Gerencia os clientes do WhatsApp (um por tenant) com LocalAuth.
 *
 * Responsabilidades:
 *  - Criar/recriar clientes com sessão persistida por tenant.
 *  - Reconectar automaticamente após quedas de rede.
 *  - Exibir o QR Code no terminal e persistir o status da sessão no banco.
 *  - Roteamento de mensagens de grupos para o CommandRouter.
 *
 * Multi-tenant: a chave do mapa é o `tenantId`; os dados de sessão são
 * persistidos em `WhatsAppSession` (clientId único).
 */
@Injectable()
export class WhatsAppClientManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppClientManager.name);

  /** tenantId -> Client */
  private readonly clients = new Map<string, Client>();

  /** tenantId -> último QR Code gerado (para o painel renderizar) */
  private readonly latestQr = new Map<string, string>();

  /** tenantId -> timestamp da última recuperação (evita loops) */
  private readonly lastRecoveryAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly router: CommandRouter,
    private readonly engine: AuctionEngine,
  ) {}

  async onModuleInit(): Promise<void> {
    // O motor anuncia avisos e encerramentos; o manager envia pelo WhatsApp.
    this.engine.subscribe((tenantId, groupId, text, mediaPath) =>
      this.sendToGroup(tenantId, groupId, text, mediaPath),
    );

    // Recupera sessões conectadas/conectando para reconectar automaticamente.
    const sessions = await this.prisma.whatsAppSession.findMany({
      where: { status: { in: [SessionStatus.CONNECTED, SessionStatus.CONNECTING] } },
    });

    for (const session of sessions) {
      this.logger.log(`Reconectando sessão do tenant ${session.tenantId}...`);
      this.createClient(session.tenantId, session.clientId);
    }
  }

  onModuleDestroy(): void {
    for (const [, client] of this.clients) {
      client.destroy().catch(() => undefined);
    }
    this.clients.clear();
  }

  /**
   * Conecta (ou reconecta) o WhatsApp de um tenant.
   * O QR Code é exibido no terminal do processo.
   */
  async connect(tenantId: string): Promise<{ status: SessionStatus }> {
    if (this.clients.has(tenantId)) {
      return this.sessionStatus(tenantId);
    }

    const session = await this.prisma.whatsAppSession.upsert({
      where: { clientId: `tenant-${tenantId}` },
      update: {},
      create: {
        tenantId,
        clientId: `tenant-${tenantId}`,
        status: SessionStatus.CONNECTING,
      },
    });

    this.createClient(tenantId, session.clientId);
    return { status: SessionStatus.CONNECTING };
  }

  async disconnect(tenantId: string): Promise<void> {
    const client = this.clients.get(tenantId);
    if (client) {
      await client.destroy().catch(() => undefined);
      this.clients.delete(tenantId);
    }
    await this.prisma.whatsAppSession.updateMany({
      where: { tenantId },
      data: { status: SessionStatus.DISCONNECTED, lastError: null },
    });
  }

  getClient(tenantId: string): Client | undefined {
    return this.clients.get(tenantId);
  }

  getLatestQr(tenantId: string): string | null {
    return this.latestQr.get(tenantId) ?? null;
  }

  clearQr(tenantId: string): void {
    this.latestQr.delete(tenantId);
  }

  async sessionStatus(tenantId: string): Promise<{ status: SessionStatus }> {
    const session = await this.prisma.whatsAppSession.findUnique({
      where: { clientId: `tenant-${tenantId}` },
    });
    return { status: session?.status ?? SessionStatus.DISCONNECTED };
  }

  /**
   * Envia uma mensagem para um grupo do tenant. Quando `mediaPath` aponta para
   * um arquivo de imagem local, envia a imagem com a mensagem como legenda.
   *
   * Falhas transitórias (ex.: "detached Frame", página do WhatsApp Web que
   * recarregou) são tratadas com tentativas e, se persistirem, com a
   * recriação do cliente (a sessão LocalAuth é preservada).
   */
  async sendToGroup(
    tenantId: string,
    groupId: string,
    text: string,
    mediaPath?: string,
  ): Promise<void> {
    const maxAttempts = 3;
    let lastError: unknown = null;
    const media = mediaPath && existsSync(mediaPath) ? MessageMedia.fromFilePath(mediaPath) : null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const client = this.clients.get(tenantId);
      if (!client) {
        this.logger.warn(
          `Cliente inexistente para o tenant ${tenantId}. Mensagem não enviada ao grupo ${groupId}.`,
        );
        return;
      }

      try {
        const chat = await client.getChatById(groupId);
        if (!chat) {
          this.logger.warn(`Chat não encontrado para o grupo ${groupId}.`);
          return;
        }
        if (media) {
          await chat.sendMessage(media, { caption: text });
          this.logger.log(
            `Imagem enviada ao grupo ${groupId}: "${text.slice(0, 60)}"`,
          );
        } else {
          await chat.sendMessage(text);
          this.logger.log(`Mensagem enviada ao grupo ${groupId}: "${text.slice(0, 60)}"`);
        }
        return;
      } catch (error) {
        lastError = error;
        this.logger.error(
          `Tentativa ${attempt}/${maxAttempts} ao enviar ao grupo ${groupId}: ${(error as Error).message}`,
        );
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
        }
      }
    }

    await this.recoverClient(tenantId);
    throw new Error(
      `Não foi possível enviar ao grupo ${groupId}: ${(lastError as Error)?.message ?? 'erro desconhecido'}`,
    );
  }

  /**
   * Recria o cliente WhatsApp do tenant (sessão LocalAuth preservada).
   * Usado quando o browser/página fica em estado inválido (ex.: detached frame).
   */
  private async recoverClient(tenantId: string): Promise<void> {
    const now = Date.now();
    const last = this.lastRecoveryAt.get(tenantId) ?? 0;
    if (now - last < WHATSAPP_RECOVERY_COOLDOWN_MS) {
      this.logger.warn(
        `Recuperação do tenant ${tenantId} ignorada (dentro do cooldown).`,
      );
      return;
    }
    this.lastRecoveryAt.set(tenantId, now);

    this.logger.warn(`Recriando cliente do WhatsApp para o tenant ${tenantId}...`);
    const existing = this.clients.get(tenantId);
    if (existing) {
      this.clients.delete(tenantId);
      await existing.destroy().catch(() => undefined);
    }
    this.latestQr.delete(tenantId);
    await this.persistSession(tenantId, { status: SessionStatus.CONNECTING });

    const session = await this.prisma.whatsAppSession.findUnique({
      where: { clientId: `tenant-${tenantId}` },
    });
    this.createClient(tenantId, session?.clientId ?? `tenant-${tenantId}`);
  }

  private createClient(tenantId: string, clientId: string): void {
    const browserPath = process.env.WHATSAPP_BROWSER_PATH;
    const client = new Client({
      authStrategy: new LocalAuth({ clientId }),
      puppeteer: {
        headless: true,
        ...(browserPath ? { executablePath: browserPath } : {}),
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage',
        ],
      },
      qrMaxRetries: 10,
    });

    this.clients.set(tenantId, client);

    client.on('qr', (qr) => {
      qrcode.generate(qr, { small: true });
      this.latestQr.set(tenantId, qr);
      void this.persistSession(tenantId, {
        status: SessionStatus.CONNECTING,
        lastQrAt: new Date(),
      });
    });

    client.on('authenticated', () => {
      this.logger.log(`Tenant ${tenantId} autenticado no WhatsApp.`);
    });

    client.on('ready', async () => {
      this.logger.log(`WhatsApp conectado para o tenant ${tenantId}.`);
      await this.persistSession(tenantId, {
        status: SessionStatus.CONNECTED,
        lastConnectedAt: new Date(),
        lastError: null,
      });
    });

    client.on('auth_failure', (message) => {
      this.logger.error(`Falha de autenticação (tenant ${tenantId}): ${message}`);
      void this.persistSession(tenantId, {
        status: SessionStatus.ERROR,
        lastError: `auth_failure: ${message}`,
      });
    });

    client.on('disconnected', async (reason) => {
      this.logger.warn(`WhatsApp desconectado (tenant ${tenantId}): ${reason}`);
      await this.persistSession(tenantId, {
        status: SessionStatus.DISCONNECTED,
        lastError: `disconnected: ${reason}`,
      });

      // Qualquer desconexão (incluindo "Max qrcode retries reached") invalida o
      // cliente atual. Remover do mapa permite que um novo connect() gere um QR
      // novo (com a sessão LocalAuth persistida, o QR é pulado se já conectou).
      this.clients.delete(tenantId);
      this.latestQr.delete(tenantId);
    });

    client.on('message', (message) => {
      this.handleIncomingMessage(tenantId, message).catch((error) => {
        this.logger.error(
          `Falha no fluxo de mensagem: ${(error as Error).message}`,
          (error as Error).stack,
        );
      });
    });

    client.initialize().catch((error) => {
      this.logger.error(
        `Falha ao inicializar WhatsApp do tenant ${tenantId}: ${(error as Error).message}`,
      );
      void this.persistSession(tenantId, {
        status: SessionStatus.ERROR,
        lastError: (error as Error).message,
      });
    });
  }

  private async handleIncomingMessage(tenantId: string, message: Message): Promise<void> {
    try {
      if (message.fromMe) {
        this.logger.log(
          `[DIAG] Ignorada mensagem própria (fromMe) de ${message.from}: ${(message.body ?? '').slice(0, 80)}`,
        );
        return;
      }

      this.logger.log(
        `[DIAG] Mensagem de ${message.from} (author=${message.author ?? 'n/d'}): ${(message.body ?? '').slice(0, 80)}`,
      );

      const chat = await message.getChat();
      if (!chat.isGroup) return;

      const group = chat as GroupChat;
      const senderId = message.author ?? message.from;
      const contact = await message.getContact().catch(() => null);
      const isAdmin = this.isSenderAdmin(group, senderId, message.from, contact);

      const context: WhatsAppGroupContext = {
        tenantId,
        groupId: group.id._serialized,
        groupName: group.name,
        senderId,
        senderName: contact?.pushname ?? null,
        isAdmin,
        chat: group,
      };

      await this.router.route(context, message);
    } catch (error) {
      // Um erro em uma mensagem não deve derrubar o processo nem o bot.
      this.logger.error(
        `Erro ao processar mensagem do grupo: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * Verifica se o remetente é administrador do grupo.
   *
   * O WhatsApp (jul/2026) passou a identificar usuários por LID (`@lid`) em vez
   * do telefone (`@c.us`), e a estrutura do id mudou (`$1`/`_serialized`). A
   * comparação considera o usuário/número (parte antes do @) e vários formatos.
   */
  private isSenderAdmin(
    group: GroupChat,
    senderId: string,
    from: string | undefined,
    contact: Contact | null,
  ): boolean {
    const userOf = (value: string | undefined): string => (value ?? '').split('@')[0];

    const candidateIds = new Set<string>();
    const targetUsers = new Set<string>();

    const addId = (id: string | undefined): void => {
      if (!id) return;
      candidateIds.add(id);
      targetUsers.add(userOf(id));
    };

    addId(senderId);
    addId(from);

    if (contact?.number) {
      targetUsers.add(contact.number);
      targetUsers.add(userOf(contact.number));
    }
    if (contact?.id?._serialized) addId(contact.id._serialized as string);

    const participant = group.participants.find((p) => {
      const id = p.id as unknown as { _serialized?: string; $1?: string };
      const raw = (id?._serialized ?? id?.$1 ?? p.id?.toString?.() ?? '') as string;
      return targetUsers.has(userOf(raw)) || candidateIds.has(raw);
    });

    if (!participant) {
      const sample = group.participants
        .slice(0, 5)
        .map((p) => {
          const id = p.id as unknown as { _serialized?: string; $1?: string };
          return id?._serialized ?? id?.$1 ?? '?';
        })
        .join(', ');
      this.logger.warn(
        `Remetente ${senderId} (from=${from ?? '-'}) não encontrado entre ${group.participants.length} participantes do grupo ${group.id._serialized}. Amostra de IDs: [${sample}].`,
      );
    }

    return participant?.isAdmin === true || participant?.isSuperAdmin === true;
  }

  private async persistSession(
    tenantId: string,
    data: {
      status: SessionStatus;
      lastQrAt?: Date;
      lastConnectedAt?: Date;
      lastError?: string | null;
    },
  ): Promise<void> {
    await this.prisma.whatsAppSession.updateMany({
      where: { clientId: `tenant-${tenantId}` },
      data: {
        status: data.status,
        ...(data.lastQrAt ? { lastQrAt: data.lastQrAt } : {}),
        ...(data.lastConnectedAt ? { lastConnectedAt: data.lastConnectedAt } : {}),
        ...(data.lastError !== undefined ? { lastError: data.lastError } : {}),
      },
    });
  }
}
