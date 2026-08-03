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

  return config;
}
