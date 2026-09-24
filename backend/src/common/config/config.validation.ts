/**
 * Validação manual das variáveis de ambiente no bootstrap.
 *
 * Falhas impedem a aplicação de subir — falhar cedo evita erros obscuros em produção.
 */
const REQUIRED_VARS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
] as const;

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  for (const key of REQUIRED_VARS) {
    if (!config[key]) {
      throw new Error(
        `Variável de ambiente obrigatória ausente: ${key}. Consulte .env.example.`,
      );
    }
  }

  if (String(config.JWT_SECRET).length < 16) {
    throw new Error('JWT_SECRET deve ter no mínimo 16 caracteres.');
  }
  if (String(config.JWT_REFRESH_SECRET).length < 16) {
    throw new Error('JWT_REFRESH_SECRET deve ter no mínimo 16 caracteres.');
  }

  // Em produção o gateway precisa estar completo, senão o paywall nunca
  // libera sozinho (webhook + reconciliação dependem dessas vars).
  if (String(config.NODE_ENV).toLowerCase() === 'production') {
    const missingMp = [
      'MERCADOPAGO_ACCESS_TOKEN',
      'MERCADOPAGO_NOTIFICATION_URL',
      'MERCADOPAGO_WEBHOOK_SECRET',
    ].filter((key) => !config[key]);
    if (missingMp.length > 0) {
      throw new Error(
        `Mercado Pago incompleto em produção — ausentes: ${missingMp.join(', ')}. ` +
          `Configure no .env (notification_url deve ser https://.../api/payments/webhook).`,
      );
    }
  }

  return config;
}
