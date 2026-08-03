import { Controller, Delete, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { WhatsAppService, WhatsAppStatus } from './whatsapp.service';

@ApiTags('whatsapp')
@ApiBearerAuth()
@Controller('whatsapp')
export class WhatsAppController {
  constructor(private readonly whatsappService: WhatsAppService) {}

  @Post('connect')
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
  @ApiOperation({ summary: 'Desconecta a sessão do WhatsApp' })
  async disconnect(@CurrentUser() user: RequestUser): Promise<{ success: true }> {
    await this.whatsappService.disconnect(user.tenantId);
    return { success: true };
  }
}
