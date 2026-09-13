import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { BypassTenantAccess } from '../../common/decorators/bypass-tenant-access.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminSubscriptionsService } from './admin-subscriptions.service';
import {
  ListAdminSubscriptionsQueryDto,
  UpdateAdminSubscriptionDto,
} from './dto/admin-subscription.dto';

@ApiTags('admin-subscriptions')
@ApiBearerAuth()
@Controller('admin/subscriptions')
@Roles(Role.SUPER_ADMIN)
@BypassTenantAccess()
export class AdminSubscriptionsController {
  constructor(private readonly service: AdminSubscriptionsService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Resumo geral das assinaturas da plataforma' })
  summary() {
    return this.service.summary();
  }

  @Get()
  @ApiOperation({ summary: 'Lista todas as assinaturas (paginação + filtros)' })
  list(@Query() query: ListAdminSubscriptionsQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe de uma assinatura com histórico de pagamentos' })
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Ajusta manualmente uma assinatura (status, plano, datas)' })
  update(@Param('id') id: string, @Body() dto: UpdateAdminSubscriptionDto) {
    return this.service.update(id, dto);
  }
}