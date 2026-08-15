import { Controller, Delete, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { WhatsAppService, WhatsAppStatus } from './whatsapp.service';

@ApiTags('whatsapp')
@ApiBearerAuth()
@Controller('whatsapp')
export class WhatsAppController {
  constructor(private readonly whatsappService: WhatsAppService) {}

  @Post('connect')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Conecta o WhatsApp do tenant (QR no terminal)' })
  connect(@CurrentUser() user: RequestUser): Promise<WhatsAppStatus> {
    return this.whatsappService.connect(user.tenantId);
  }

  @Get('status')
  @ApiOperation({ summary: 'Status da sessão do WhatsApp' })
  status(@CurrentUser() user: RequestUser): Promise<WhatsAppStatus> {
    return this.whatsappService.status(user.tenantId);
  }

  @Delete('disconnect')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Desconecta a sessão do WhatsApp' })
  async disconnect(@CurrentUser() user: RequestUser): Promise<{ success: true }> {
    await this.whatsappService.disconnect(user.tenantId);
    return { success: true };
  }
}
