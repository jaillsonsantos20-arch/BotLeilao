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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { AuctionEventsService } from './auction-events.service';
import { CreateAuctionEventDto, UpdateAuctionEventDto } from './dto/auction-event.dto';

@ApiTags('auction-events')
@ApiBearerAuth()
@Controller('auction-events')
export class AuctionEventsController {
  constructor(private readonly auctionEventsService: AuctionEventsService) {}

  @Post()
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

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza o nome ou a descrição de um leilão' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateAuctionEventDto,
  ) {
    return this.auctionEventsService.update(user.tenantId, id, dto);
  }

  @Post(':id/close')
  @ApiOperation({ summary: 'Encerra um leilão (evento)' })
  close(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.auctionEventsService.close(user.tenantId, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove um leilão (evento) sem leilões realizados' })
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.auctionEventsService.remove(user.tenantId, id);
    return { success: true };
  }
}
