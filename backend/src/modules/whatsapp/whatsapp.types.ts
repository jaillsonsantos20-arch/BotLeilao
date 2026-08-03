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
  endsAt: Date;
  warnedFirst: boolean;
  warnedSecond: boolean;
  closed: boolean;
}
