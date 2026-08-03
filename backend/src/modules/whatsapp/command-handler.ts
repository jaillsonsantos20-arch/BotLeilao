import { Injectable, Logger } from '@nestjs/common';
import { Message } from 'whatsapp-web.js';
import { AuctionEngine } from './auction.engine';
import { WhatsAppGroupContext } from './whatsapp.types';

export type CommandName = 'iniciar' | 'status' | 'encerrar' | 'historico' | 'ajuda' | 'vincular';

/**
 * Roteia mensagens de grupos do WhatsApp:
 *  - Comandos ("!"): encaminha ao AuctionEngine.
 *  - Demais mensagens: encaminha como entrada do fluxo (lance ou configuração).
 *
 * O bot NÃO exige prefixo para lances — números puros são interpretados como lances.
 */
@Injectable()
export class CommandRouter {
  private readonly logger = new Logger(CommandRouter.name);

  constructor(private readonly engine: AuctionEngine) {}

  async route(context: WhatsAppGroupContext, message: Message): Promise<void> {
    const text = (message.body ?? '').trim();

    try {
      if (text.startsWith('!')) {
        await this.handleCommand(context, text);
      } else {
        await this.engine.handleChatInput(context, text);
      }
    } catch (error) {
      this.logger.error(`Erro ao processar mensagem: ${(error as Error).message}`);
      await this.reply(
        context,
        '❌ Ocorreu um erro ao processar sua mensagem. Tente novamente.',
      );
    }
  }

  private async handleCommand(context: WhatsAppGroupContext, text: string): Promise<void> {
    const [rawCommand, ...args] = text.slice(1).split(/\s+/);
    const command = rawCommand.toLowerCase().split('@')[0] as CommandName;

    let response: string;
    switch (command) {
      case 'vincular':
        response = await this.engine.linkGroup(context, args[0] ?? '');
        break;
      case 'iniciar':
        response = await this.engine.startSetup(context);
        break;
      case 'status':
        response = await this.engine.getStatus(context);
        break;
      case 'encerrar':
        response = await this.engine.cancel(context);
        break;
      case 'historico':
        response = await this.engine.getHistory(context);
        break;
      case 'ajuda':
        response = this.engine.help();
        break;
      default:
        response = [
          `⚠️ Comando desconhecido: *${text}*`,
          '',
          'Digite *!ajuda* para ver a lista de comandos.',
        ].join('\n');
    }

    await this.reply(context, response);
  }

  private async reply(context: WhatsAppGroupContext, text: string): Promise<void> {
    try {
      await context.chat.sendMessage(text);
    } catch (error) {
      this.logger.error(`Falha ao enviar resposta: ${(error as Error).message}`);
    }
  }
}
