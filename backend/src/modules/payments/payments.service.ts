import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentMethod, PaymentStatus, SubscriptionStatus } from '@prisma/client';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { AppConfig } from '../../common/config/configuration';
import { PrismaService } from '../../common/database/prisma.service';

const MP_API = 'https://api.mercadopago.com/v1';

export interface PixTransactionData {
  qrCode: string;
  qrCodeBase64: string;
  ticketUrl?: string;
  expiresAt?: string;
}

/**
 * Cobrança de assinatura via Mercado Pago (PIX).
 *
 * Fluxo:
 *  1. `createPixPayment` gera um PIX no MP e persiste um `Payment` PENDING.
 *  2. O cliente paga; o MP chama o webhook (`POST /payments/webhook`).
 *  3. `confirmPayment` consulta o status no MP e, se aprovado, marca a
 *     assinatura como ACTIVE.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly accessToken: string;
  private readonly notificationUrl: string;
  private readonly webhookSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<AppConfig>,
  ) {
    const mp = this.configService.get('mercadopago', { infer: true })!;
    this.accessToken = mp.accessToken;
    this.notificationUrl = mp.notificationUrl;
    this.webhookSecret = mp.webhookSecret;

    if (!this.accessToken) {
      this.logger.warn(
        'MERCADOPAGO_ACCESS_TOKEN não configurado — geração de PIX vai falhar. Configure no .env.',
      );
    }
    if (!this.notificationUrl) {
      this.logger.warn(
        'MERCADOPAGO_NOTIFICATION_URL não configurado — webhook automático desativado. ' +
          'Ativação vai depender da verificação manual (POST /payments/sync). ' +
          'Em dev use um túnel HTTPS (ex.: ngrok) apontando para /api/payments/webhook.',
      );
    }
    if (!this.webhookSecret) {
      this.logger.warn(
        'MERCADOPAGO_WEBHOOK_SECRET não configurado — webhooks serão rejeitados (fail-closed).',
      );
    }
  }

  /**
   * Cria um PIX para a assinatura vigente do tenant (ou do plano informado).
   */
  async createPixPayment(
    tenantId: string,
    payerEmail: string,
    planId?: string,
  ): Promise<{ internalId: string; externalId: string; status: string; transactionData: PixTransactionData }> {
    if (!this.accessToken) {
      throw new ServiceUnavailableException(
        'Gateway de pagamento não configurado. Contate o suporte.',
      );
    }

    const subscription = await this.resolveSubscription(tenantId, planId);
    if (!subscription) {
      throw new BadRequestException('Nenhum plano encontrado para gerar a cobrança.');
    }

    const amount = Number(subscription.plan.price);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Valor do plano inválido para gerar a cobrança.');
    }
    const externalId = randomUUID();

    const body: Record<string, unknown> = {
      transaction_amount: amount,
      description: `Assinatura LanceZap - Plano ${subscription.plan.name}`,
      payment_method_id: 'pix',
      payer: { email: payerEmail },
      external_reference: `sub_${subscription.id}_${externalId}`,
      ...(this.notificationUrl ? { notification_url: this.notificationUrl } : {}),
    };

    let mpPayment: any;
    try {
      mpPayment = await this.callMp('/payments', {
        method: 'POST',
        body,
        idempotencyKey: externalId,
      });
    } catch (error) {
      this.logger.error(`Mercado Pago rejeitou a cobrança: ${String(error)}`);
      throw new ServiceUnavailableException(
        'Não foi possível gerar o PIX no momento. Tente novamente em instantes.',
      );
    }

    const transaction = mpPayment?.point_of_interaction?.transaction_data;
    const transactionData: PixTransactionData = {
      qrCode: transaction?.qr_code ?? '',
      qrCodeBase64: transaction?.qr_code_base64 ?? '',
      ticketUrl: transaction?.ticket_url,
      expiresAt: transaction?.expiration_date,
    };

    if (!transactionData.qrCode && !transactionData.qrCodeBase64) {
      throw new ServiceUnavailableException(
        'O Mercado Pago não retornou os dados do PIX. Verifique a configuração do gateway.',
      );
    }

    const payment = await this.prisma.payment.create({
      data: {
        tenantId,
        subscriptionId: subscription.id,
        amount,
        method: PaymentMethod.PIX,
        status: PaymentStatus.PENDING,
        externalId: String(mpPayment.id),
      },
    });

    return {
      internalId: payment.id,
      externalId: String(mpPayment.id),
      status: mpPayment.status ?? 'pending',
      transactionData,
    };
  }

  /**
   * Consulta o pagamento no MP e, se aprovado, ativa a assinatura.
   *
   * Status intermediários do MP (pending/in_process/authorized/in_mediation)
   * mantêm o `Payment` como PENDING — só marcam FAILED os status finais de
   * não-pagamento (rejected/cancelled/refunded/charged_back/expired).
   * Isso permite que o frontend faça polling de reconciliação sem invalidar
   * cobranças ainda não pagas.
   */
  async confirmPayment(
    mpPaymentId: string | number,
  ): Promise<{ activated: boolean; status: string }> {
    const payment = await this.prisma.payment.findFirst({
      where: { externalId: String(mpPaymentId) },
    });

    if (!payment) {
      this.logger.warn(`Webhook recebido para pagamento desconhecido: ${mpPaymentId}`);
      return { activated: false, status: 'unknown' };
    }

    if (payment.status === PaymentStatus.PAID) {
      return { activated: false, status: 'approved' };
    }

    let mpPayment: any;
    try {
      mpPayment = await this.callMp(`/payments/${mpPaymentId}`, { method: 'GET' });
    } catch (error) {
      this.logger.error(`Falha ao consultar pagamento ${mpPaymentId}: ${String(error)}`);
      throw new ServiceUnavailableException('Falha ao consultar o pagamento no gateway.');
    }

    const mpStatus = String(mpPayment?.status ?? '').toLowerCase();

    if (mpStatus === 'approved') {
      await this.prisma.$transaction([
        this.prisma.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.PAID, paidAt: new Date() },
        }),
        this.prisma.subscription.updateMany({
          where: { id: payment.subscriptionId ?? undefined },
          data: {
            status: SubscriptionStatus.ACTIVE,
            currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            canceledAt: null,
          },
        }),
      ]);

      return { activated: true, status: mpStatus };
    }

    if (['rejected', 'cancelled', 'canceled', 'refunded', 'charged_back', 'expired'].includes(mpStatus)) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED },
      });
      return { activated: false, status: mpStatus };
    }

    // pending / authorized / in_process / in_mediation / etc: mantém PENDING.
    return { activated: false, status: mpStatus || 'pending' };
  }

  /**
   * Reconciliação manual (fallback quando o webhook não chega — ex.:
   * `notification_url` não configurada ou ambiente local sem URL pública).
   *
   * Consulta no MP os últimos pagamentos PENDING do tenant e ativa a
   * assinatura se algum tiver sido aprovado. Chamado pelo frontend via
   * `POST /payments/sync` (botão "Já paguei").
   */
  async syncPendingPayments(
    tenantId: string,
  ): Promise<{ activated: boolean; checked: number }> {
    const pendings = await this.prisma.payment.findMany({
      where: { tenantId, status: PaymentStatus.PENDING, externalId: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    let activated = false;
    for (const pending of pendings) {
      try {
        const result = await this.confirmPayment(pending.externalId as string);
        if (result.activated) {
          activated = true;
          break;
        }
      } catch (error) {
        this.logger.warn(
          `Falha ao reconciliar pagamento ${pending.id}: ${String(error)}`,
        );
      }
    }

    return { activated, checked: pendings.length };
  }

  /**
   * Histórico recente de pagamentos do tenant.
   */
  async lastPayments(tenantId: string) {
    const payments = await this.prisma.payment.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { subscription: { include: { plan: true } } },
    });

    return payments.map((payment) => ({
      id: payment.id,
      amount: Number(payment.amount),
      method: payment.method,
      status: payment.status,
      paidAt: payment.paidAt,
      createdAt: payment.createdAt,
      plan: payment.subscription?.plan?.name ?? null,
    }));
  }

  /**
   * Processa notificações do Mercado Pago.
   */
  async handleWebhook(
    body: {
      type?: string;
      action?: string;
      data?: { id: string | number };
      id?: string | number;
    },
    headers: Record<string, string | undefined>,
  ): Promise<{ received: true }> {
    this.verifyWebhookSignature(headers, body);

    const type = body?.type ?? body?.action;
    const paymentId = body?.data?.id ?? body?.id;

    // Notificações que não são de pagamento (ex.: `mp-connect`) são ignoradas.
    if (type && !/payment/i.test(String(type))) {
      return { received: true };
    }

    if (paymentId === undefined || paymentId === null) {
      this.logger.warn('Webhook sem id de pagamento.');
      return { received: true };
    }

    await this.confirmPayment(paymentId);
    return { received: true };
  }

  /**
   * Valida a assinatura HMAC-SHA256 enviada pelo Mercado Pago no webhook.
   *
   * Regras oficiais do MP: o header `x-signature` contém `ts=<timestamp>,v1=<hash>`.
   * O manifesto é `id:<paymentId>;request-id:<x-request-id>;ts:<timestamp>;`,
   * assinado com o `MERCADOPAGO_WEBHOOK_SECRET`.
   *
   * Quando o secret não está configurado, o webhook é rejeitado (fail-closed):
   * melhor não processar notificações não autenticadas do que confiar cegamente.
   */
  private verifyWebhookSignature(
    headers: Record<string, string | undefined>,
    body: {
      data?: { id: string | number };
      id?: string | number;
    },
  ): void {
    if (!this.webhookSecret) {
      this.logger.error(
        'MERCADOPAGO_WEBHOOK_SECRET não configurado — rejeitando webhook (fail-closed).',
      );
      throw new UnauthorizedException('Webhook não autenticado.');
    }

    const signatureHeader = headers['x-signature'];
    const requestId = headers['x-request-id'];
    const paymentId = body?.data?.id ?? body?.id;

    if (!signatureHeader || !requestId || paymentId === undefined || paymentId === null) {
      this.logger.warn('Webhook sem headers de assinatura completos.');
      throw new UnauthorizedException('Webhook não autenticado.');
    }

    const params = new Map(
      signatureHeader.split(',').map((pair) => {
        const [key, ...rest] = pair.trim().split('=');
        return [key, rest.join('=')];
      }),
    );
    const ts = params.get('ts');
    const v1 = params.get('v1');
    if (!ts || !v1) {
      this.logger.warn('Webhook com assinatura malformada.');
      throw new UnauthorizedException('Webhook não autenticado.');
    }

    const manifest = `id:${paymentId};request-id:${requestId};ts:${ts};`;
    const expected = createHmac('sha256', this.webhookSecret).update(manifest).digest('hex');

    const expectedBuf = Buffer.from(expected, 'hex');
    const receivedBuf = Buffer.from(v1.toLowerCase(), 'hex');

    const valid =
      expectedBuf.length === receivedBuf.length && timingSafeEqual(expectedBuf, receivedBuf);
    if (!valid) {
      this.logger.warn('Webhook com assinatura inválida.');
      throw new UnauthorizedException('Webhook não autenticado.');
    }
  }

  private async resolveSubscription(tenantId: string, planId?: string) {
    const current = await this.prisma.subscription.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });

    if (current) {
      return current;
    }

    const plan = planId
      ? await this.prisma.plan.findFirst({ where: { id: planId, status: 'ACTIVE' } })
      : await this.prisma.plan.findFirst({ where: { status: 'ACTIVE' }, orderBy: { price: 'asc' } });

    if (!plan) {
      return null;
    }

    // Sem assinatura ainda (ex.: registro legado): cria uma em TRIAL já vencido,
    // para que o paywall apareça e o pagamento possa ser associado a ela.
    return this.prisma.subscription.create({
      data: {
        tenantId,
        planId: plan.id,
        status: SubscriptionStatus.TRIAL,
        trialEndsAt: new Date(),
      },
      include: { plan: true },
    });
  }

  private async callMp(
    path: string,
    options: { method: 'GET' | 'POST'; body?: Record<string, unknown>; idempotencyKey?: string },
  ): Promise<any> {
    const response = await fetch(`${MP_API}${path}`, {
      method: options.method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...(options.idempotencyKey ? { 'X-Idempotency-Key': options.idempotencyKey } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(`MP ${response.status}: ${JSON.stringify(data)}`);
    }

    return data;
  }
}