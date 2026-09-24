import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auction, Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { AuctionsService } from './auctions.service';
import { ListAuctionsQueryDto, StartAuctionDto, UpdateAuctionDto, UpdatePaymentStatusDto } from './dto/auction.dto';

@ApiTags('auctions')
@ApiBearerAuth()
@Controller('auctions')
export class AuctionsController {
  constructor(private readonly auctionsService: AuctionsService) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Inicia um novo leilão em um grupo' })
  start(
    @CurrentUser() user: RequestUser,
    @Body() dto: StartAuctionDto,
  ): Promise<Auction> {
    return this.auctionsService.startAuction(user.tenantId, {
      ...dto,
      startedBy: user.id,
      actorRole: user.role,
    });
  }

  @Get()
  @ApiOperation({ summary: 'Lista leilões com filtros e paginação' })
  list(
    @CurrentUser() user: RequestUser,
    @Query() query: ListAuctionsQueryDto,
  ) {
    return this.auctionsService.list(user.tenantId, query);
  }

  @Delete()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Limpa o histórico, removendo todos os leilões' })
  clear(@CurrentUser() user: RequestUser) {
    return this.auctionsService.clearHistory(user.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Busca um leilão pelo id' })
  findById(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<Auction> {
    return this.auctionsService.findById(user.tenantId, id);
  }

  @Get(':id/bids')
  @ApiOperation({ summary: 'Lista os lances de um leilão' })
  getBids(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.auctionsService.getBids(
      user.tenantId,
      id,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Post(':id/close')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Encerra um leilão manualmente' })
  close(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<Auction> {
    return this.auctionsService.closeAuction(id, user.tenantId, 'manual');
  }

  @Post(':id/cancel')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Cancela um leilão aberto' })
  cancel(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<Auction> {
    return this.auctionsService.cancelAuction(id, user.tenantId);
  }

  @Patch(':id/payment-status')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Atualiza o status de pagamento do leilão' })
  updatePaymentStatus(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdatePaymentStatusDto,
  ): Promise<Auction> {
    return this.auctionsService.updatePaymentStatus(user.tenantId, id, dto.status);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Edita informações de um leilão em andamento' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateAuctionDto,
  ): Promise<Auction> {
    return this.auctionsService.updateAuction(user.tenantId, id, dto);
  }
}
