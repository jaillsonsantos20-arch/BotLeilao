import { GroupChat } from 'whatsapp-web.js';

/**
 * Contexto de uma mensagem recebida em um grupo do WhatsApp,
 * já resolvido para o tenant e com metadados do participante.
 */
export interface WhatsAppGroupContext {
  tenantId: string;
  groupId: string;
  groupName: string;
  senderId: string;
  senderName: string | null;
  isAdmin: boolean;
  chat: GroupChat;
}

/**
 * Estado do fluxo de criação de leilão via chat (!iniciar).
 * O fluxo pergunta, em sequência: produto, valor inicial e tempo.
 */
export interface AuctionSetupState {
  tenantId: string;
  groupId: string;
  step: 'product' | 'value' | 'duration';
  productName?: string;
  initialValue?: number;
}

export interface ActiveAuctionMemory {
  auctionId: string;
  tenantId: string;
  groupId: string;
  productName: string;
  itemId: string | null;
  durationSeconds: number;
  endsAt: Date;
  warnedThree: boolean;
  warnedFirst: boolean;
  warnedSecond: boolean;
  closed: boolean;
}

/**
 * Estado de uma lista (evento) aberta em um grupo — vários itens simultâneos.
 */
export interface ActiveListMemory {
  tenantId: string;
  groupId: string; // whatsappGroupId
  internalGroupId: string;
  eventId: string;
  eventName: string;
  periodicStatusMinutes: number;
  lastStatusAt: number;
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
  /** auctionId -> endsAt no momento do último alerta "3 min" (re-alerta se o lance reiniciar o cronômetro). */
  warnedThreeByAuction: Map<string, Date>;
  /** scheduledEndAt no momento do último alerta "leilão terminando em 3 min". */
  warnedEventEndsAt: Date | null;
}

/**
 * Evento com início/término agendados que ainda não virou lista ativa.
 * Guarda apenas o suficiente para os alertas de fim (emitidos uma única vez).
 */
export interface ScheduledEventMemory {
  eventId: string;
  tenantId: string;
  whatsappGroupId: string | null;
  warnedEventEndsAt: Date | null;
  autoOpenedStartAt: Date | null;
}

/**
 * Linha do status de uma lista (um item em leilão).
 */
export interface ListAuctionEntry {
  number: number;
  auctionId: string;
  itemId: string | null;
  name: string;
  description: string | null;
  status: any;
  initialValue: any;
  currentAmount: any;
  leader: string | null;
  bidCount: number;
  imageUrl: string | null;
  endsAt: Date;
  durationSeconds: number;
  cardSentAt: Date | null;
  /**
   * Variações ATIVAS do item (normalizadas), cadastradas pelo administrador.
   * Alimenta o interpretador ("150 no boi" → item "Garrote"). Opcional para
   * não quebrar fixtures antigas que montam a linha à mão.
   */
  aliases?: string[];
}

/**
 * Contexto de item associado a uma mensagem enviada pelo bot.
 *
 * Quando o participante usa o "Responder" do WhatsApp numa mensagem do bot que
 * menciona um item (ex.: alerta "QUEM DÁ MAIS?"), o motor recupera este
 * contexto pelo messageId e interpreta o lance como sendo daquele item.
 */
export interface ReplyContext {
  auctionId: string;
  itemId: string | null;
  itemName: string;
}

/**
 * Origem da interpretação de lance.
 *
 * TEXT  — mensagem digitada (comportamento original, inalterado).
 * AUDIO — mensagem de áudio transcrita para texto antes de entrar no
 *         MESMO pipeline (nunca registra lance direto do áudio).
 */
export type BidSource = 'TEXT' | 'AUDIO';

/**
 * Entrada normalizada enviada ao pipeline único de interpretação.
 *
 * Todo tipo de entrada (texto, áudio, reply) converge para aqui: o
 * `AuctionEngine.handleChatInput` continua sendo o único ponto de entrada e
 * `AuctionsService.placeBid` continua sendo o único registrador de lances.
 */
export interface BidMessageInput {
  /** Texto já transcrito (áudio) ou o corpo digitado. */
  text: string;
  source: BidSource;
  /** Transcrição original do áudio (quando source = AUDIO). */
  transcription?: string;
  /** WhatsApp Message ID da mensagem de origem (rastreabilidade/idempotência). */
  messageId?: string;
  /** Qualidade 0..1 informada pelo provedor de transcrição (quando existir). */
  transcriptionQuality?: number | null;
}
