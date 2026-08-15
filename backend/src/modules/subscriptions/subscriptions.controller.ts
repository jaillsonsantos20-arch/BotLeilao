import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BypassTenantAccess } from '../../common/decorators/bypass-tenant-access.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { SubscriptionsService } from './subscriptions.service';

@ApiTags('subscriptions')
@ApiBearerAuth()
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @BypassTenantAccess()
  @Get('current')
  @ApiOperation({ summary: 'Assinatura atual do tenant e status de pagamento' })
  current(@CurrentUser() user: RequestUser) {
    return this.subscriptionsService.getCurrent(user.tenantId);
  }
}