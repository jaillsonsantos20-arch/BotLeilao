import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BypassTenantAccess } from '../../common/decorators/bypass-tenant-access.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { CreatePixPaymentDto } from './dto/payment.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @ApiBearerAuth()
  @BypassTenantAccess()
  @Post('pix')
  @ApiOperation({ summary: 'Gera um PIX para pagamento da assinatura' })
  createPix(@CurrentUser() user: RequestUser, @Body() dto: CreatePixPaymentDto) {
    return this.paymentsService.createPixPayment(user.tenantId, user.email, dto.planId);
  }

  @ApiBearerAuth()
  @BypassTenantAccess()
  @Get('status')
  @ApiOperation({ summary: 'Últimos pagamentos do tenant' })
  status(@CurrentUser() user: RequestUser) {
    return this.paymentsService.lastPayments(user.tenantId);
  }

  @Public()
  @Post('webhook')
  @ApiOperation({ summary: 'Webhook do Mercado Pago (confirmação de pagamento)' })
  webhook(
    @Headers() headers: Record<string, string | undefined>,
    @Body() body: MercadoPagoWebhookBody,
  ) {
    return this.paymentsService.handleWebhook(body, headers);
  }

  @Public()
  @Get('webhook/health')
  @ApiOperation({ summary: 'Prova de vida do webhook (healthcheck)' })
  health() {
    return { ok: true };
  }
}

interface MercadoPagoWebhookBody {
  type?: string;
  action?: string;
  data?: { id: string | number };
  id?: string | number;
}
