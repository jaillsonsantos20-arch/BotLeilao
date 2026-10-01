import {
  ACTIVE_BID_CONTEXT_MAX,
  ACTIVE_BID_CONTEXT_TTL_MS,
} from './whatsapp.constants';

/**
 * Contexto de disputa ativa de UM item.
 *
 * Guarda "em que ponto está a briga" por um item dentro de um grupo para que um
 * lance novo que venha APENAS COM O VALOR ("165") possa ser interpretado sem o
 * participante repetir o nome do item e sem depender de "Responder".
 *
 * Isolamento total: a chave é `tenantId:groupId:auctionId:itemId`. O contexto de
 * um item nunca vaza para outro grupo, outro leilão ou outro item.
 *
 * REGRAS:
 * - nasce APENAS depois que um lance foi efetivamente registrado (nunca porque
 *   uma mensagem foi recebida);
 * - é atualizado apenas pelo caminho de registro (`placeBidEntry`);
 * - expira após {@link ACTIVE_BID_CONTEXT_TTL_SECONDS};
 * - item/leilão encerrado → `status: 'closed'` (nunca serve de contexto).
 */
export interface ActiveBidContext {
  tenantId: string;
  groupId: string;
  auctionId: string;
  itemId: string | null;
  /** Nº exibido do item (mesmo valor do card). */
  itemNumber: number;
  itemName: string;
  /** Lance que originou/atualizou este contexto (auditoria). */
  lastBidId: string | null;
  lastBidAmount: number;
  lastBidUserId: string;
  lastBidAt: number;
  lastBidMessageId: string | null;
  status: 'active' | 'closed';
  createdAt: number;
  expiresAt: number;
}

/** Entrada para criar/atualizar um contexto de disputa. */
export interface ActiveBidContextInput {
  tenantId: string;
  groupId: string;
  auctionId: string;
  itemId: string | null;
  itemNumber: number;
  itemName: string;
  lastBidId?: string | null;
  lastBidAmount: number;
  lastBidUserId: string;
  lastBidAt: number;
  lastBidMessageId?: string | null;
}

class ActiveBidContextStore {
  private readonly contexts = new Map<string, ActiveBidContext>();

  private makeKey(
    tenantId: string,
    groupId: string,
    auctionId: string,
    itemId: string | null,
  ): string {
    return `${tenantId}:${groupId}:${auctionId}:${itemId ?? '-'}`;
  }

  /**
   * Registra/atualiza o contexto depois de um lance CONFIRMADO no banco.
   *
   * Proteção contra corrida: o banco decide a ordem válida dos lances; aqui
   * só aceitamos a escrita quando ela não é mais antiga que a atual, então um
   * lance que terminou a transação antes não sobrescreve o último registrado.
   */
  record(input: ActiveBidContextInput): ActiveBidContext {
    const key = this.makeKey(
      input.tenantId,
      input.groupId,
      input.auctionId,
      input.itemId,
    );
    const existing = this.contexts.get(key);
    if (existing && existing.lastBidAt > input.lastBidAt) {
      return existing; // escrita atrasada: o contexto atual é mais novo
    }

    const now = Date.now();
    const context: ActiveBidContext = {
      tenantId: input.tenantId,
      groupId: input.groupId,
      auctionId: input.auctionId,
      itemId: input.itemId,
      itemNumber: input.itemNumber,
      itemName: input.itemName,
      lastBidId: input.lastBidId ?? null,
      lastBidAmount: input.lastBidAmount,
      lastBidUserId: input.lastBidUserId,
      lastBidAt: input.lastBidAt,
      lastBidMessageId: input.lastBidMessageId ?? null,
      status: 'active',
      createdAt: existing?.createdAt ?? now,
      expiresAt: now + ACTIVE_BID_CONTEXT_TTL_MS,
    };

    this.contexts.set(key, context);
    this.cleanupExpired();
    this.enforceMax();
    return context;
  }

  /** Contexto pontual (não expirado) de um item, ou null. */
  get(
    tenantId: string,
    groupId: string,
    auctionId: string,
    itemId: string | null,
  ): ActiveBidContext | null {
    const key = this.makeKey(tenantId, groupId, auctionId, itemId);
    const context = this.contexts.get(key);
    if (!context) return null;
    if (Date.now() > context.expiresAt) {
      this.contexts.delete(key);
      return null;
    }
    return context.status === 'active' ? context : null;
  }

  /** Todos os contextos vivos de um grupo (tenant isolado). */
  list(tenantId: string, groupId: string): ActiveBidContext[] {
    this.cleanupExpired();
    const prefix = `${tenantId}:${groupId}:`;
    const result: ActiveBidContext[] = [];
    for (const [key, context] of this.contexts) {
      if (!key.startsWith(prefix)) continue;
      if (context.status !== 'active') continue;
      result.push(context);
    }
    return result;
  }

  /**
   * Marca o contexto de um item como encerrado (leilão/item fora de disputa).
   * Chamado de forma lazy quando a leitura do contexto vê o item já fechado.
   */
  markClosed(
    tenantId: string,
    groupId: string,
    auctionId: string,
    itemId: string | null = null,
  ): number {
    const key = this.makeKey(tenantId, groupId, auctionId, itemId);
    if (itemId !== null) {
      const context = this.contexts.get(key);
      if (!context) return 0;
      context.status = 'closed';
      return 1;
    }

    let count = 0;
    const prefix = `${tenantId}:${groupId}:${auctionId}:`;
    for (const [k, context] of this.contexts) {
      if (k.startsWith(prefix) && context.status === 'active') {
        context.status = 'closed';
        count++;
      }
    }
    return count;
  }

  delete(
    tenantId: string,
    groupId: string,
    auctionId: string,
    itemId: string | null,
  ): boolean {
    return this.contexts.delete(this.makeKey(tenantId, groupId, auctionId, itemId));
  }

  clear(): void {
    this.contexts.clear();
  }

  getAllKeys(): string[] {
    return Array.from(this.contexts.keys());
  }

  get size(): number {
    return this.contexts.size;
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, context] of this.contexts) {
      if (now > context.expiresAt) this.contexts.delete(key);
    }
  }

  /** Teto rígido: a store é volátil de propósito e não pode crescer sem limite. */
  private enforceMax(): void {
    if (this.contexts.size <= ACTIVE_BID_CONTEXT_MAX) return;
    const entries = Array.from(this.contexts.entries()).sort(
      (a, b) => a[1].lastBidAt - b[1].lastBidAt,
    );
    const excess = this.contexts.size - ACTIVE_BID_CONTEXT_MAX;
    for (let i = 0; i < excess; i++) {
      this.contexts.delete(entries[i][0]);
    }
  }
}

export const activeBidContextStore = new ActiveBidContextStore();

export { ActiveBidContextStore };
