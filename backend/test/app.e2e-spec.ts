import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * Teste de integração do fluxo completo:
 * register -> login -> refresh -> grupos -> leilão -> lances -> regras.
 * Requer o PostgreSQL do docker-compose em execução.
 */
describe('BotLeilão API (e2e)', () => {
  let app: INestApplication;
  const unique = Date.now();
  const email = `e2e-${unique}@test.com.br`;

  let accessToken: string;
  let refreshToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('auth', () => {
    it('registra um novo cliente (tenant + usuário admin)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          name: 'Cliente E2E',
          email,
          password: 'Senha@12345',
          companyName: 'Empresa E2E',
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.accessToken).toBeDefined();
      expect(response.body.data.refreshToken).toBeDefined();
    });

    it('rejeita registro com e-mail duplicado', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          name: 'Cliente E2E',
          email,
          password: 'Senha@12345',
          companyName: 'Empresa E2E',
        })
        .expect(409);
    });

    it('autentica com as credenciais', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: 'Senha@12345' })
        .expect(201);

      accessToken = response.body.data.accessToken;
      refreshToken = response.body.data.refreshToken;
      expect(accessToken).toBeDefined();
    });

    it('rotaciona o refresh token', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(201);

      expect(response.body.data.accessToken).toBeDefined();
      expect(response.body.data.refreshToken).not.toBe(refreshToken);
    });

    it('bloqueia requisições sem token', async () => {
      await request(app.getHttpServer()).get('/api/dashboard/summary').expect(401);
    });
  });

  describe('leilões', () => {
    let groupId: string;
    let auctionId: string;

    const api = (method: 'get' | 'post', url: string) =>
      request(app.getHttpServer())[method](url).set(
        'Authorization',
        `Bearer ${accessToken}`,
      );

    it('cria um grupo vinculado ao WhatsApp', async () => {
      const response = await api('post', '/api/groups')
        .send({
          name: 'Grupo E2E',
          whatsappGroupId: `120363${unique}@g.us`,
        })
        .expect(201);

      groupId = response.body.data.id;
      expect(groupId).toBeDefined();
    });

    it('inicia um leilão', async () => {
      const response = await api('post', '/api/auctions')
        .send({
          groupId,
          productName: 'Console E2E',
          initialValue: 500,
          durationSeconds: 300,
        })
        .expect(201);

      auctionId = response.body.data.id;
      expect(response.body.data.status).toBe('OPEN');
    });

    it('rejeita um segundo leilão aberto no mesmo grupo', async () => {
      await api('post', '/api/auctions')
        .send({
          groupId,
          productName: 'Outro',
          initialValue: 10,
          durationSeconds: 60,
        })
        .expect(409);
    });

    it('registra lances e aplica a regra de lance crescente', async () => {
      await api('post', `/api/auctions/${auctionId}/bids`)
        .send({ amount: 700, participantName: 'Ana' })
        .expect(201);

      await api('post', `/api/auctions/${auctionId}/bids`)
        .send({ amount: 900, participantName: 'Bruno' })
        .expect(201);

      await api('post', `/api/auctions/${auctionId}/bids`)
        .send({ amount: 800, participantName: 'Carla' })
        .expect(400);
    });

    it('encerra o leilão com o maior lance como vencedor', async () => {
      const response = await api('post', `/api/auctions/${auctionId}/close`).expect(201);

      expect(response.body.data.status).toBe('CLOSED');
      expect(response.body.data.winnerBidId).toBeDefined();
    });

    it('exibe o vencedor no histórico', async () => {
      const response = await api(
        'get',
        `/api/auctions?status=CLOSED&groupId=${groupId}`,
      ).expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data[0].winnerBid.amount).toBe('900');
    });

    it('retorna métricas no dashboard', async () => {
      const response = await api('get', '/api/dashboard/summary').expect(200);

      expect(response.body.data.closedAuctions).toBeGreaterThan(0);
      expect(response.body.data.revenue).toBe('900');
    });
  });
});
