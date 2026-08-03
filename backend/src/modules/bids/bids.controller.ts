import { Controller, Post, Body, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { AuctionsService } from '../auctions/auctions.service';
import { PlaceBidDto } from '../auctions/dto/auction.dto';

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
}
