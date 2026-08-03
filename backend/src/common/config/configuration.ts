/**
 * Configuração tipada da aplicação.
 *
 * Todas as variáveis de ambiente são expostas através desta função e lidas
 * exclusivamente via `ConfigService` — nunca `process.env` direto nos módulos.
 */
export interface AppConfig {
  nodeEnv: string;
  port: number;
  apiPrefix: string;
  apiHost: string;
  databaseUrl: string;
  redis: {
    host: string;
    port: number;
  };
  jwt: {
    secret: string;
    expiresIn: string;
    refreshSecret: string;
    refreshExpiresIn: string;
  };
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api',
  apiHost: process.env.API_HOST ?? 'http://localhost:3000',
  databaseUrl:
    process.env.DATABASE_URL ??
    'postgresql://botleilao:botleilao_secret@localhost:5433/botleilao?schema=public',
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  },
  jwt: {
    secret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-me',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },
});
