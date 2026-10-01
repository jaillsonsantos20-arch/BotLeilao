import { randomUUID } from 'crypto';
import { BID_CONFIRMATION_MAX, BID_CONFIRMATION_TTL_MS } from './whatsapp.constants';
import { BidSource } from './whatsapp.types';
import { BidMatchedBy } from './list-bid.parser';
import { formatCurrency, parseAmount } from './whatsapp.utils';
import { pendingBidContextStore } from './pending-bid.context';
import { spokenNumbersToDigits } from './spoken-numbers';

/**
 * Confirmação de lance pendente (confiança intermediária).
 *
 * Quando o Confidence Engine decide `confirm`, o bot mostra exatamente o que
 * entendeu ("Entendi: R$ 50 no Bolo de Goma. Confirma?") e guarda o lance aqui.
 * Só quem perguntou responde: a chave isola por tenant + grupo + usuário.
 *
 * Expira em 2 minutos — passou do prazo, não registra nada.
 */
export interface PendingBidConfirmation {
  id: string;
  tenantId: string;
  groupId: string;
  userId: string;
  auctionId: string;
  itemId: string | null;
  itemName: string;
  itemNumber: number | null;
  amount: number;
  /** Como o item foi identificado (auditoria). */
  matchedBy: BidMatchedBy;
  /** Origem da mensagem que gerou a confirmação (texto digitado x áudio). */
  source: BidSource;
  /** Transcrição original do áudio, quando a origem é áudio. */
  transcription: string | null;
  /** Message ID da mensagem interpretada (rastreabilidade). */
  messageId: string | null;
  createdAt: number;
  expiresAt: number;
}

/** Resposta do participante à pergunta de confirmação. */
export type ConfirmationResponse =
  | { kind: 'confirm' }
  | { kind: 'reject' }
  | { kind: 'correction'; amount: number }
  | null;

/** Resultado do `peek` na store. */
export type ConfirmationPeek =
  | { state: 'none' }
  | { state: 'pending'; confirmation: PendingBidConfirmation }
  | { state: 'expired'; confirmation: PendingBidConfirmation };

const CONFIRM_WORDS = new Set([
  'sim',
  's',
  '1',
  'sim sim',
  'isso',
  'isso mesmo',
  'confirmo',
  'confirma',
  'pode registrar',
  'pode',
  'pode sim',
]);

const REJECT_WORDS = new Set([
  'nao',
  'n',
  '2',
  'cancela',
  'cancelar',
  'nao obrigado',
  'esquece',
  'esqueca',
]);

function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.!?;,]+$/g, '')
    .trim();
}

/** Extrai um valor monetário do texto ("180", "r$ 180", "1.500,00", "cento e oitenta"). */
function extractAmount(raw: string): number | null {
  const direct = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/.exec(raw);
  if (direct) {
    const value = parseAmount(direct[1]);
    if (value !== null && value > 0) return value;
  }
  // Números por extenso vindos do Speech-to-Text ("não, era cento e oitenta")
  const spelled = spokenNumbersToDigits(raw, { force: true });
  const digits = /(\d+)/.exec(spelled);
  if (digits) {
    const value = parseAmount(digits[1]);
    if (value !== null && value > 0) return value;
  }
  return null;
}

/**
 * Interpreta a resposta do participante à pergunta "Confirma?".
 *
 * - `sim` / `1` / `confirmo` ... → registra
 * - `não` / `2` / `cancela` ...  → cancela
 * - rejeição + valor ("não, era 180") → corrige e pede confirmação de novo
 * - qualquer outra coisa → null (não é resposta: segue o fluxo normal)
 */
export function parseConfirmationResponse(raw: string): ConfirmationResponse {
  if (!raw) return null;
  const text = normalize(raw);
  if (!text) return null;

  if (CONFIRM_WORDS.has(text)) return { kind: 'confirm' };
  if (REJECT_WORDS.has(text)) return { kind: 'reject' };

  // Correção: "não, era 180" / "nao 180" / "era 180"
  const startsWithRejection = /^(nao|n|desculpa)\b/.test(text);
  const looksLikeCorrection = /^(era|eram|valor|estava|deve ser|que era)\b/.test(text);
  if (startsWithRejection || looksLikeCorrection) {
    const amount = extractAmount(text);
    if (amount !== null) return { kind: 'correction', amount };
    if (startsWithRejection) return { kind: 'reject' };
  }

  return null;
}

/** Pergunta de confirmação mostrada ao participante. */
export function confirmationQuestion(confirmation: {
  amount: number;
  itemName: string;
  itemNumber?: number | null;
}): string {
  const label = confirmation.itemNumber
    ? `${String(confirmation.itemNumber).padStart(2, '0')} • ${confirmation.itemName}`
    : confirmation.itemName;
  return [
    `💵 Entendi: *${formatCurrency(confirmation.amount)}* no item *${label}*.`,
    '',
    'Confirma? Responda *sim* ou *não*.',
    `(expira em ${Math.round(BID_CONFIRMATION_TTL_MS / 60000)} min)`,
  ].join('\n');
}

interface CreateConfirmationInput {
  tenantId: string;
  groupId: string;
  userId: string;
  auctionId: string;
  itemId: string | null;
  itemName: string;
  itemNumber: number | null;
  amount: number;
  matchedBy: BidMatchedBy;
  source: BidSource;
  transcription?: string | null;
  messageId?: string | null;
}

/**
 * Armazenador em memória das confirmações pendentes.
 *
 * Mesmo padrão do `PendingBidContextStore`: Map em memória, chave
 * `tenantId:groupId:userId`, TTL curto, sem migration e sem Redis.
 *
 * Exclusão mútua: nunca há "qual item?" e "confirma?" ao mesmo tempo para o
 * mesmo participante — criar uma pergunta apaga a outra.
 */
class PendingBidConfirmationStore {
  private readonly confirmations = new Map<string, PendingBidConfirmation>();

  private makeKey(tenantId: string, groupId: string, userId: string): string {
    return `${tenantId}:${groupId}:${userId}`;
  }

  /** Cria (ou substitui) a confirmação pendente do participante. */
  create(input: CreateConfirmationInput): PendingBidConfirmation {
    const now = Date.now();
    const confirmation: PendingBidConfirmation = {
      id: randomUUID(),
      tenantId: input.tenantId,
      groupId: input.groupId,
      userId: input.userId,
      auctionId: input.auctionId,
      itemId: input.itemId,
      itemName: input.itemName,
      itemNumber: input.itemNumber,
      amount: input.amount,
      matchedBy: input.matchedBy,
      source: input.source,
      transcription: input.transcription ?? null,
      messageId: input.messageId ?? null,
      createdAt: now,
      expiresAt: now + BID_CONFIRMATION_TTL_MS,
    };

    const key = this.makeKey(input.tenantId, input.groupId, input.userId);
    this.confirmations.set(key, confirmation);

    // Exclusão mútua com o fluxo "qual item?".
    pendingBidContextStore.deleteContext(input.tenantId, input.groupId, input.userId);

    this.cleanupExpired();
    this.enforceMax();

    return confirmation;
  }

  /** Lê a confirmação sem consumir. Expired é reportado à parte. */
  peek(tenantId: string, groupId: string, userId: string): ConfirmationPeek {
    const key = this.makeKey(tenantId, groupId, userId);
    const confirmation = this.confirmations.get(key);
    if (!confirmation) return { state: 'none' };
    if (Date.now() > confirmation.expiresAt) {
      return { state: 'expired', confirmation };
    }
    return { state: 'pending', confirmation };
  }

  /** Consome a confirmação pendente (remove da store). */
  take(tenantId: string, groupId: string, userId: string): PendingBidConfirmation | null {
    const key = this.makeKey(tenantId, groupId, userId);
    const confirmation = this.confirmations.get(key);
    if (!confirmation) return null;
    this.confirmations.delete(key);
    if (Date.now() > confirmation.expiresAt) return null;
    return confirmation;
  }

  /** Remove a confirmação sem consumir (cancelamento/expirada). */
  delete(tenantId: string, groupId: string, userId: string): boolean {
    return this.confirmations.delete(this.makeKey(tenantId, groupId, userId));
  }

  hasActive(tenantId: string, groupId: string, userId: string): boolean {
    return this.peek(tenantId, groupId, userId).state === 'pending';
  }

  getAllKeys(): string[] {
    return Array.from(this.confirmations.keys());
  }

  clear(): void {
    this.confirmations.clear();
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, confirmation] of this.confirmations) {
      if (now > confirmation.expiresAt) this.confirmations.delete(key);
    }
  }

  /** Teto rígido: nunca cresce sem limite (a store é volátil de propósito). */
  private enforceMax(): void {
    if (this.confirmations.size <= BID_CONFIRMATION_MAX) return;
    const entries = Array.from(this.confirmations.entries()).sort(
      (a, b) => a[1].createdAt - b[1].createdAt,
    );
    const excess = this.confirmations.size - BID_CONFIRMATION_MAX;
    for (let i = 0; i < excess; i++) {
      this.confirmations.delete(entries[i][0]);
    }
  }
}

// Exporta uma instância singleton para uso pelo módulo
export const pendingBidConfirmationStore = new PendingBidConfirmationStore();

export { PendingBidConfirmationStore };
