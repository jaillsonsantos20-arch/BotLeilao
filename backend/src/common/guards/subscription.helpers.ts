import { SubscriptionStatus } from '@prisma/client';

/**
 * Estado mínimo da assinatura necessário para decidir o acesso do tenant.
 */
export interface SubscriptionLike {
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
}

/**
 * Define se um tenant tem direito de usar o painel.
 *  - ACTIVE: sempre possui acesso.
 *  - TRIAL: acesso enquanto o prazo não expirar (sem prazo define conta demo/legada = acesso).
 *  - Demais status: sem acesso.
 */
export function isTenantAccessAllowed(subscription: SubscriptionLike | null): boolean {
  if (!subscription) {
    return false;
  }

  if (subscription.status === SubscriptionStatus.ACTIVE) {
    return true;
  }

  if (subscription.status === SubscriptionStatus.TRIAL) {
    if (!subscription.trialEndsAt) {
      return true; // trial sem prazo definido (conta demo/legada)
    }
    return subscription.trialEndsAt.getTime() > Date.now();
  }

  return false;
}