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
  corsOrigins: string[];
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
  mail: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
  };
  frontendUrl: string;
  subscription: {
    trialDays: number;
  };
  mercadopago: {
    accessToken: string;
    notificationUrl: string;
    webhookSecret: string;
  };
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api',
  apiHost: process.env.API_HOST ?? 'http://localhost:3000',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost,http://localhost:5173,http://127.0.0.1,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
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
  mail: {
    host: process.env.SMTP_HOST ?? '',
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? 'LanceZap <no-reply@botleilao.com>',
  },
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost',
  subscription: {
    trialDays: parseInt(process.env.TRIAL_DAYS ?? '1', 10),
  },
  mercadopago: {
    accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN ?? '',
    notificationUrl: process.env.MERCADOPAGO_NOTIFICATION_URL ?? '',
    webhookSecret: process.env.MERCADOPAGO_WEBHOOK_SECRET ?? '',
  },
});
