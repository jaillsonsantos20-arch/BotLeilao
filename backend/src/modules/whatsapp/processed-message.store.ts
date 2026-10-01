import { WHATSAPP_PROCESSED_MESSAGE_MAX, WHATSAPP_PROCESSED_MESSAGE_TTL_MS } from './whatsapp.constants';

/**
 * Idempotência das mensagens recebidas.
 *
 * O WhatsApp (e o web.js) podem reentregar o mesmo evento — ex.: após um
 * reconect, quando o webhook/QR volta, ou em rajadas de rede. Sem esta store a
 * mesma mensagem geraria dois lances, duas respostas e duas auditorias.
 *
 * Marca-antes-de-processar: se a mensagem já foi vista, o roteador ignora.
 * A store é volátil (em memória, TTL de minutos) — nunca vira migration.
 */
export class ProcessedMessageStore {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly ttlMs: number = WHATSAPP_PROCESSED_MESSAGE_TTL_MS,
    private readonly max: number = WHATSAPP_PROCESSED_MESSAGE_MAX,
  ) {}

  /**
   * Marca a mensagem como processada.
   * @returns true se deve ser processada (primeira vez); false se já foi.
   */
  mark(messageId: string | null | undefined): boolean {
    if (!messageId) return true; // sem id não há como deduplicar
    this.cleanup();
    if (this.seen.has(messageId)) return false;
    this.seen.set(messageId, Date.now());
    this.enforceMax();
    return true;
  }

  has(messageId: string | null | undefined): boolean {
    if (!messageId) return false;
    this.cleanup();
    return this.seen.has(messageId);
  }

  clear(): void {
    this.seen.clear();
  }

  get size(): number {
    return this.seen.size;
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [key, at] of this.seen) {
      if (at < cutoff) this.seen.delete(key);
    }
  }

  private enforceMax(): void {
    if (this.seen.size <= this.max) return;
    const entries = Array.from(this.seen.entries()).sort((a, b) => a[1] - b[1]);
    const excess = this.seen.size - this.max;
    for (let i = 0; i < excess; i++) {
      this.seen.delete(entries[i][0]);
    }
  }
}
