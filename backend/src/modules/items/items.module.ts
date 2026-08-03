import { Module } from '@nestjs/common';
import { AuctionEventsModule } from '../auction-events/auction-events.module';
import { AuctionsModule } from '../auctions/auctions.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';

@Module({
  imports: [AuctionsModule, AuctionEventsModule, WhatsappModule],
  controllers: [ItemsController],
  providers: [ItemsService],
  exports: [ItemsService],
})
export class ItemsModule {}
