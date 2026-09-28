/**
 * Contexto temporário de lance pendente.
 * 
 * Utilizado quando o interpretador identifica o valor do lance, mas o item está
 * ambiguo (múltiplos itens correspondentes). O contexto permite que o usuário
 * esclareça qual item desejado dentro de um prazo curto.
 * 
 * A chave isola por tenant + grupo + usuário, impedindo que um usuário resolva
 * o lance pendente de outro.
 */
export interface PendingBidContext {
  tenantId: string;
  groupId: string;
  senderId: string; // ID do usuário no WhatsApp (parte antes do @)
  amount: number; // valor do lance em reais (mesma unidade de parseAmount/placeBid)
  candidates: Array<{
    itemNumber: number;
    itemName: string;
    normalizedName: string;
  }>;
  createdAt: number; // timestamp ms
  expiresAt: number; // timestamp ms (createdAt + interval)
}

/**
 * Armazenador temporário de contextos de lance pendente.
 * 
 * Usa Map em memória, seguindo o padrão existente do AuctionEngine (setups, active, listGroups).
 * Não utiliza Redis nem banco de dados para este dado transitório.
 * 
 * A chave é composta por: `${tenantId}:${groupId}:${senderId}`
 * Isso garante isolamento total:
 * - Dois grupos diferentes têm contexts distintos, mesmo mesmo tenant
 * - Dois usuários diferentes no mesmo grupo têm contexts distintos
 */
class PendingBidContextStore {
  private readonly contexts = new Map<string, PendingBidContext>();
  private readonly defaultExpiryMs = 2 * 60 * 1000; // 2 minutos

  /**
   * Gera a chave única para o contexto.
   * Formato: tenantId:groupId:senderId
   */
  private makeKey(tenantId: string, groupId: string, senderId: string): string {
    return `${tenantId}:${groupId}:${senderId}`;
  }

  /**
   * Cria um novo contexto de lance pendente.
   * Substitui qualquer contexto existente para o mesmo usuário/grupo/tenant.
   */
  createContext(
    tenantId: string,
    groupId: string,
    senderId: string,
    amount: number,
    candidates: Array<{
      itemNumber: number;
      itemName: string;
      normalizedName: string;
    }>,
  ): PendingBidContext {
    const context: PendingBidContext = {
      tenantId,
      groupId,
      senderId,
      amount,
      candidates,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.defaultExpiryMs,
    };

    const key = this.makeKey(tenantId, groupId, senderId);
    this.contexts.set(key, context);

    this.cleanupExpired();

    return context;
  }

  /**
   * Recupera o contexto pendente para um usuário em um grupo.
   * Retorna null se não houver contexto ou se ele já tiver expirado.
   */
  getContext(tenantId: string, groupId: string, senderId: string): PendingBidContext | null {
    const key = this.makeKey(tenantId, groupId, senderId);
    const context = this.contexts.get(key);

    if (!context) return null;
    if (Date.now() > context.expiresAt) {
      // Contexto expirado
      this.contexts.delete(key);
      return null;
    }

    return context;
  }

  /**
   * Remove o contexto após a resolução bem-sucedida.
   */
  deleteContext(tenantId: string, groupId: string, senderId: string): boolean {
    const key = this.makeKey(tenantId, groupId, senderId);
    const deleted = this.contexts.delete(key);
    return deleted;
  }

  /**
   * Limpa todos os contextos expirados.
   * Pode ser chamado periodicamente.
   */
  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, context] of this.contexts) {
      if (now > context.expiresAt) {
        this.contexts.delete(key);
      }
    }
  }

  /**
   * Obtém todos os keys atuais (para depuração/coleta de lixo).
   */
  getAllKeys(): string[] {
    return Array.from(this.contexts.keys());
  }

  /**
   * Verifica se existe contexto ativo e não expirado para o usuário.
   */
  hasActiveContext(tenantId: string, groupId: string, senderId: string): boolean {
    return this.getContext(tenantId, groupId, senderId) !== null;
  }

  /**
   * Obtém o amount do contexto ativo, ou null se não houver.
   */
  getActiveAmount(tenantId: string, groupId: string, senderId: string): number | null {
    const context = this.getContext(tenantId, groupId, senderId);
    return context ? context.amount : null;
  }

  /**
   * Obtém os candidates do contexto ativo, ou vazio se não houver.
   */
  getActiveCandidates(tenantId: string, groupId: string, senderId: string): Array<{
    itemNumber: number;
    itemName: string;
    normalizedName: string;
  }> {
    const context = this.getContext(tenantId, groupId, senderId);
    return context ? context.candidates : [];
  }
}

// Exporta uma instância singleton para uso pelo módulo
export const pendingBidContextStore = new PendingBidContextStore();

export { PendingBidContextStore };