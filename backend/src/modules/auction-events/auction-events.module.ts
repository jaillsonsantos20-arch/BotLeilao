import { Module } from '@nestjs/common';
import { AuctionEventsController } from './auction-events.controller';
import { AuctionEventsService } from './auction-events.service';

@Module({
  controllers: [AuctionEventsController],
  providers: [AuctionEventsService],
  exports: [AuctionEventsService],
})
export class AuctionEventsModule {}
