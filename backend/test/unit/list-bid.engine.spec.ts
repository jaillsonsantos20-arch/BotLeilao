import { AuctionStatus } from '@prisma/client';
import { Message } from 'whatsapp-web.js';
import { AuctionEngine } from '../../src/modules/whatsapp/auction.engine';
import { pendingBidContextStore } from '../../src/modules/whatsapp/pending-bid.context';
import { ActiveListMemory, ReplyContext, WhatsAppGroupContext } from '../../src/modules/whatsapp/whatsapp.types';

function snapshotRow(
  id: string,
  itemId: string,
  productName: string,
  order: number,
  status: AuctionStatus = AuctionStatus.OPEN,
) {
  return {
    id,
    itemId,
    productName,
    status,
    initialValue: 10,
    endsAt: new Date(Date.now() + 3600_000),
    durationSeconds: 0,
    item: { order, initialValue: 10, imageUrl: null },
    bids: [],
    _count: { bids: 0 },
  };
}

const rows = [
  snapshotRow('auction-1', 'item-1', 'Bolo de goma', 1),
  snapshotRow('auction-2', 'item-2', 'Capão 01', 2),
  snapshotRow('auction-3', 'item-3', 'Capão 02', 3),
  snapshotRow('auction-4', 'item-4', 'Garrafa térmica 2.5lt', 4),
  snapshotRow('auction-5', 'item-5', 'Garrafa plástica 1lt', 5),
];

function buildEngine() {
  const prisma = {
    auction: { findMany: jest.fn().mockResolvedValue(rows) },
    group: { findFirst: jest.fn() },
  } as never;

  const placeBid = jest.fn().mockResolvedValue({ bid: {}, auction: {} });
  const auctionsService = { placeBid } as never;

  const engine = new AuctionEngine(prisma, auctionsService, {} as never);
  return { engine, placeBid };
}

function buildContext(): WhatsAppGroupContext {
  return {
    tenantId: 'tenant-1',
    groupId: 'group-1',
    groupName: 'Grupo Teste',
    senderId: '5511999999999@c.us',
    senderName: 'João',
    isAdmin: false,
    chat: {} as WhatsAppGroupContext['chat'],
  };
}

const list: ActiveListMemory = {
  tenantId: 'tenant-1',
  groupId: 'group-1',
  internalGroupId: 'internal-1',
  eventId: 'event-1',
  eventName: 'Lista Teste',
  periodicStatusMinutes: 0,
  lastStatusAt: 0,
  warnedThreeByAuction: new Map(),
  warnedEventEndsAt: null,
};

function msg(body: string): Message {
  return { body } as Message;
}

function collectMessages(engine: AuctionEngine) {
  const messages: string[] = [];
  engine.subscribe(async (_tenantId, _groupId, text) => {
    messages.push(text);
  });
  return messages;
}

describe('AuctionEngine — lances no modo lista (interpretador)', () => {
  beforeEach(() => {
    pendingBidContextStore.deleteContext('tenant-1', 'group-1', '5511999999999@c.us');
  });

  it('registra lance "01 300" direto no item 1', async () => {
    const { engine, placeBid } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });

    await engine.handleChatInput(buildContext(), msg('01 300'));

    expect(placeBid).toHaveBeenCalledWith('tenant-1', {
      auctionId: 'auction-1',
      amount: 300,
      participantPhone: '5511999999999',
      participantName: 'João',
    });
  });

  it('registra lance por nome único ("bolo 25")', async () => {
    const { engine, placeBid } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });

    await engine.handleChatInput(buildContext(), msg('bolo 25'));

    expect(placeBid).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ auctionId: 'auction-1', amount: 25 }),
    );
  });

  it('"25 no capão" é ambíguo: pergunta e NÃO registra lance', async () => {
    const { engine, placeBid } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });
    const messages = collectMessages(engine);

    await engine.handleChatInput(buildContext(), msg('25 no capão'));

    expect(placeBid).not.toHaveBeenCalled();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('Qual item?');
    expect(messages[0]).toContain('Capão 01');
    expect(messages[0]).toContain('Capão 02');
  });

  it('resolve o contexto pendente com a resposta "02"', async () => {
    const { engine, placeBid } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });
    collectMessages(engine);

    await engine.handleChatInput(buildContext(), msg('25 no capão')); // cria contexto
    await engine.handleChatInput(buildContext(), msg('02')); // responde o Nº

    expect(placeBid).toHaveBeenCalledTimes(1);
    expect(placeBid).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ auctionId: 'auction-2', amount: 25 }),
    );
    // Contexto consumido — nova mensagem não reutiliza o valor antigo
    expect(
      pendingBidContextStore.hasActiveContext('tenant-1', 'group-1', '5511999999999@c.us'),
    ).toBe(false);
  });

  it('valor puro ("300") pergunta qual item em vez de chutar', async () => {
    const { engine, placeBid } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });
    const messages = collectMessages(engine);

    await engine.handleChatInput(buildContext(), msg('300'));

    expect(placeBid).not.toHaveBeenCalled();
    expect(messages[0]).toContain('Qual item?');
  });

  it('Nº inexistente ("99 300") orienta o usuário', async () => {
    const { engine, placeBid } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });
    const messages = collectMessages(engine);

    await engine.handleChatInput(buildContext(), msg('99 300'));

    expect(placeBid).not.toHaveBeenCalled();
    expect(messages[0]).toContain('99');
    expect(messages[0]).toContain('não encontrado');
  });

  it('conversa comum é ignorada em silêncio', async () => {
    const { engine, placeBid } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });
    const messages = collectMessages(engine);

    await engine.handleChatInput(buildContext(), msg('bom dia a todos'));

    expect(placeBid).not.toHaveBeenCalled();
    expect(messages).toHaveLength(0);
  });
});

describe('AuctionEngine — regra 36 (lance via "Responder")', () => {
  beforeEach(() => {
    pendingBidContextStore.deleteContext('tenant-1', 'group-1', '5511999999999@c.us');
  });

  it('registra lance de valor puro quando responde mensagem do bot com o item', async () => {
    const { engine, placeBid } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });

    const replyContext: ReplyContext = {
      auctionId: 'auction-4',
      itemId: 'item-4',
      itemName: 'Garrafa térmica 2.5lt',
    };
    await engine.handleChatInput(buildContext(), msg('46'), replyContext);

    expect(placeBid).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ auctionId: 'auction-4', amount: 46 }),
    );
  });

  it('não registra lance em reply quando o item já foi encerrado', async () => {
    const { engine, placeBid } = buildEngine();
    engine['listGroups'].set('group-1', {
      ...list,
    });
    // Simula item encerrado no snapshot (forma mapeada de ListAuctionEntry)
    engine['listAuctionSnapshot'] = jest.fn().mockResolvedValue([
      {
        number: 4,
        auctionId: 'auction-4',
        itemId: 'item-4',
        name: 'Garrafa térmica 2.5lt',
        status: AuctionStatus.CLOSED,
        initialValue: 10,
        currentAmount: 40,
        leader: null,
        bidCount: 0,
        imageUrl: null,
        endsAt: new Date(Date.now() + 3600_000),
        durationSeconds: 0,
      },
    ]);
    const messages = collectMessages(engine);

    const replyContext: ReplyContext = {
      auctionId: 'auction-4',
      itemId: 'item-4',
      itemName: 'Garrafa térmica 2.5lt',
    };
    await engine.handleChatInput(buildContext(), msg('46'), replyContext);

    expect(placeBid).not.toHaveBeenCalled();
    expect(messages[0]).toContain('encerrado');
  });

  it('registra e recupera o contexto de item ao emitir mensagem do bot', async () => {
    const { engine } = buildEngine();
    engine.subscribe(async () => 'message-id-123');

    const context: ReplyContext = {
      auctionId: 'auction-4',
      itemId: 'item-4',
      itemName: 'Garrafa térmica 2.5lt',
    };
    await engine['emit']('tenant-1', 'group-1', '⏰ QUEM DÁ MAIS?', undefined, context);

    expect(engine.getReplyContext('message-id-123')).toEqual(context);
    expect(engine.getReplyContext('outra-mensagem')).toBeUndefined();
  });
});
