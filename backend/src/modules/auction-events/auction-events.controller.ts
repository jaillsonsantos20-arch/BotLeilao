import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { AuctionEngine } from '../whatsapp/auction.engine';
import { AuctionEventsService } from './auction-events.service';
import {
  CreateAuctionEventDto,
  ScheduleListItemEndDto,
  UpdateAuctionEventDto,
} from './dto/auction-event.dto';

@ApiTags('auction-events')
@ApiBearerAuth()
@Controller('auction-events')
export class AuctionEventsController {
  constructor(
    private readonly auctionEventsService: AuctionEventsService,
    private readonly auctionEngine: AuctionEngine,
  ) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Cria um novo leilão (evento) para agrupar itens' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateAuctionEventDto) {
    return this.auctionEventsService.create(user.tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lista os leilões (eventos) do tenant' })
  list(@CurrentUser() user: RequestUser) {
    return this.auctionEventsService.list(user.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Busca um leilão (evento) pelo id' })
  findById(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.auctionEventsService.findById(user.tenantId, id);
  }

  @Get(':id/items')
  @ApiOperation({ summary: 'Lista os itens cadastrados dentro de um leilão' })
  items(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.auctionEventsService.items(user.tenantId, id);
  }

  @Get(':id/summary')
  @ApiOperation({ summary: 'Estado atual da lista (item, valor e líder no momento)' })
  summary(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.auctionEventsService.listSummary(user.tenantId, id);
  }

  @Post(':id/start')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Abre a lista do leilão em um grupo (um leilão por item) ou reenvia a lista atualizada' })
  async start(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body('groupId') groupId: string,
  ) {
    return this.auctionEngine.openListFromPanel(user.tenantId, id, groupId);
  }

  @Post(':id/items/:auctionId/close')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Encerra um item específico da lista' })
  closeItem(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('auctionId') auctionId: string,
  ) {
    return this.auctionEngine.closeListItemFromPanel(user.tenantId, id, auctionId);
  }

  @Post(':id/items/:auctionId/schedule-end')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Agenda (ou remove) o encerramento de um item da lista' })
  scheduleItemEnd(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('auctionId') auctionId: string,
    @Body() dto: ScheduleListItemEndDto,
  ) {
    return this.auctionEngine.scheduleListItemEndFromPanel(
      user.tenantId,
      id,
      auctionId,
      dto.endsAt ?? null,
    );
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Atualiza o nome, descrição, grupo ou intervalo do status' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateAuctionEventDto,
  ) {
    return this.auctionEventsService.update(user.tenantId, id, dto);
  }

  @Post(':id/close')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Encerra a lista (fecha todos os itens abertos)' })
  close(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.auctionEngine.closeEventGroups(user.tenantId, id);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Remove um leilão (evento) sem leilões realizados' })
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.auctionEventsService.remove(user.tenantId, id);
    return { success: true };
  }
}
