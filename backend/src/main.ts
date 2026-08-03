import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { join } from 'path';
import { AppModule } from './app.module';
import { AppConfig } from './common/config/configuration';
import { ensureStartupSeed } from './seed/startup.seed';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  const config = app.get(ConfigService<AppConfig>);
  const apiPrefix = config.get('apiPrefix', { infer: true })!;
  const nodeEnv = config.get('nodeEnv', { infer: true })!;
  const port = config.get('port', { infer: true })!;

  app.useLogger(nodeEnv === 'production' ? ['error', 'warn', 'log'] : ['error', 'warn', 'log', 'debug', 'verbose']);

  app.setGlobalPrefix(apiPrefix);
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: `/${apiPrefix}/uploads` });
  app.enableCors({
    origin: true,
    credentials: true,
  });
  app.use(helmet());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('BotLeilão API')
    .setDescription(
      'SaaS de leilões via WhatsApp — autenticação JWT, multi-tenant, bot integrado.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .addTag('auth', 'Autenticação e registro')
    .addTag('users', 'Usuários do tenant')
    .addTag('groups', 'Grupos do WhatsApp')
    .addTag('auction-events', 'Leilões (eventos) e itens cadastrados')
    .addTag('items', 'Itens cadastrados para leilão')
    .addTag('auctions', 'Leilões e regras de negócio')
    .addTag('bids', 'Lances')
    .addTag('dashboard', 'Métricas e gráficos')
    .addTag('reports', 'Relatórios e exportação')
    .addTag('whatsapp', 'Sessão do bot WhatsApp')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${apiPrefix}/docs`, app, document);

  await ensureStartupSeed();

  await app.listen(port, '0.0.0.0');

  new Logger('Bootstrap').log(
    `API rodando em http://localhost:${port}/${apiPrefix} — Swagger em http://localhost:${port}/${apiPrefix}/docs`,
  );
}

// Erros fora do fluxo HTTP (ex.: eventos do bot WhatsApp) não devem derrubar a
// aplicação. Registrar e seguir mantém a API disponível.
process.on('unhandledRejection', (reason) => {
  new Logger('Process').error(`Unhandled Rejection: ${String(reason)}`);
});
process.on('uncaughtException', (error) => {
  new Logger('Process').error(`Uncaught Exception: ${error.stack ?? String(error)}`);
});

void bootstrap();
