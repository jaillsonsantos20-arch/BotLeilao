import { Module } from '@nestjs/common';
import { AuctionsModule } from '../auctions/auctions.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AuctionEventsController } from './auction-events.controller';
import { AuctionEventsService } from './auction-events.service';

@Module({
  imports: [AuctionsModule, WhatsappModule],
  controllers: [AuctionEventsController],
  providers: [AuctionEventsService],
  exports: [AuctionEventsService],
})
export class AuctionEventsModule {}
