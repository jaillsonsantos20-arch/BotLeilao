import { Controller, Post, Patch, Body, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { AuctionsService } from '../auctions/auctions.service';
import { PlaceBidDto, UpdateBidDto } from '../auctions/dto/auction.dto';

@ApiTags('bids')
@ApiBearerAuth()
@Controller()
export class BidsController {
  constructor(private readonly auctionsService: AuctionsService) {}

  @Post('auctions/:auctionId/bids')
  @ApiOperation({ summary: 'Registra um lance em um leilão aberto' })
  placeBid(
    @CurrentUser() user: RequestUser,
    @Param('auctionId') auctionId: string,
    @Body() dto: PlaceBidDto,
  ) {
    return this.auctionsService.placeBid(user.tenantId, {
      auctionId,
      amount: dto.amount,
      participantName: dto.participantName,
      participantPhone: user.email,
    });
  }

  @Patch('bids/:bidId')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Edita o valor ou informações de um lance' })
  updateBid(
    @CurrentUser() user: RequestUser,
    @Param('bidId') bidId: string,
    @Body() dto: UpdateBidDto,
  ) {
    return this.auctionsService.updateBid(user.tenantId, bidId, dto);
  }
}
