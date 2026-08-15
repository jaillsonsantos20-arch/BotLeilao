import { SetMetadata } from '@nestjs/common';

export const BYPASS_TENANT_ACCESS_KEY = 'bypassTenantAccess';

/**
 * Permite que uma rota autenticada seja acessada mesmo por tenants sem
 * assinatura válida. Usado apenas por rotas de paywall (ex.: status da
 * assinatura e criação de cobrança), para que o cliente bloqueado ainda
 * consiga ver a tela de pagamento.
 */
export const BypassTenantAccess = () => SetMetadata(BYPASS_TENANT_ACCESS_KEY, true);
