import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { BypassTenantAccess } from '../../common/decorators/bypass-tenant-access.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PlansService } from './plans.service';

@ApiTags('admin-plans')
@ApiBearerAuth()
@Controller('admin/plans')
@Roles(Role.SUPER_ADMIN)
@BypassTenantAccess()
export class AdminPlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  @ApiOperation({ summary: 'Lista todos os planos (ativos e inativos) para a gestão' })
  list() {
    return this.plansService.listAll();
  }
}