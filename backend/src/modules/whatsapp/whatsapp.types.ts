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
  name: string;
  status: any;
  initialValue: any;
  currentAmount: any;
  leader: string | null;
  bidCount: number;
  imageUrl: string | null;
  endsAt: Date;
  durationSeconds: number;
}
