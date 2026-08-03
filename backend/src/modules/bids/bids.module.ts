import { Module } from '@nestjs/common';
import { AuctionsModule } from '../auctions/auctions.module';
import { BidsController } from './bids.controller';

@Module({
  imports: [AuctionsModule],
  controllers: [BidsController],
})
export class BidsModule {}
