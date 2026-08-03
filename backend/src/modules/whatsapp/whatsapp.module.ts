import { Module } from '@nestjs/common';
import { AuctionsModule } from '../auctions/auctions.module';
import { GroupsModule } from '../groups/groups.module';
import { AuctionEngine } from './auction.engine';
import { CommandRouter } from './command-handler';
import { WhatsAppClientManager } from './whatsapp-client.manager';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';

@Module({
  imports: [AuctionsModule, GroupsModule],
  controllers: [WhatsAppController],
  providers: [AuctionEngine, CommandRouter, WhatsAppClientManager, WhatsAppService],
  exports: [WhatsAppService, WhatsAppClientManager, AuctionEngine],
})
export class WhatsappModule {}
