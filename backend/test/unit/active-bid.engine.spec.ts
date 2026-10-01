import { AuctionStatus } from '@prisma/client';
import { Message } from 'whatsapp-web.js';
import { activeBidContextStore } from '../../src/modules/whatsapp/active-bid.context';
import { AuctionEngine } from '../../src/modules/whatsapp/auction.engine';
import { pendingBidContextStore } from '../../src/modules/whatsapp/pending-bid.context';
import { pendingBidConfirmationStore } from '../../src/modules/whatsapp/pending-bid-confirmation';
import { ACTIVE_BID_CONTEXT_TTL_MS } from '../../src/modules/whatsapp/whatsapp.constants';
import {
  ActiveListMemory,
  BidMessageInput,
  ReplyContext,
  WhatsAppGroupContext,
} from '../../src/modules/whatsapp/whatsapp.types';

/**
 * Contexto automático de disputa: um lance que vem SÓ COM O VALOR ("165"),
 * sem reply e sem repetir o nome do item, pode herdar o item de uma disputa
 * recente — desde que o contexto seja forte, único e não conflitante.
 *
 * Cenários cobertos: cadeia de lances, isolamento (grupo/tenant/item),
 * TTL, prioridade de contexto explícito/reply/pending, ambiguidade,
 * áudio, confirmação, item/leilão encerrado, concorrência e auditoria.
 */

function row(
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
    item: { order, number: order, initialValue: 10, imageUrl: null },
    bids: [],
    _count: { bids: 0 },
  };
}

const rows = [
  row('auction-1', 'item-1', 'Bolo de goma', 1),
  row('auction-2', 'item-2', 'Capão 01', 2),
  row('auction-3', 'item-3', 'Capão 02', 3),
  row('auction-4', 'item-4', 'Garrafa térmica 2.5lt', 4),
  row('auction-5', 'item-5', 'Garrafa plástica 1lt', 5),
];

function buildEngine(customRows = rows) {
  const prisma = {
    auction: { findMany: jest.fn().mockResolvedValue(customRows) },
    group: { findFirst: jest.fn() },
    whatsAppReplyBinding: {
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    log: { create: jest.fn().mockResolvedValue({}) },
  };

  const placeBid = jest.fn().mockResolvedValue({ bid: { id: 'bid-novo' }, auction: {} });
  const engine = new AuctionEngine(prisma as never, { placeBid } as never, {} as never);
  return { engine, placeBid, prisma };
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

function buildContext(overrides: Partial<WhatsAppGroupContext> = {}): WhatsAppGroupContext {
  return {
    tenantId: 'tenant-1',
    groupId: 'group-1',
    groupName: 'Grupo Teste',
    senderId: '5511999999999@c.us',
    senderName: 'João',
    isAdmin: false,
    chat: {} as WhatsAppGroupContext['chat'],
    ...overrides,
  };
}

function msg(body: string): Message {
  return { body } as Message;
}

function audio(text: string): BidMessageInput {
  return { text, source: 'AUDIO', transcription: text, messageId: 'audio-1' };
}

function collectMessages(engine: AuctionEngine) {
  const messages: string[] = [];
  engine.subscribe(async (_tenantId, _groupId, text) => {
    messages.push(text);
  });
  return messages;
}

const JOAO = '5511999999999@c.us';
const MARIA = '5588888888888@c.us';

beforeEach(() => {
  activeBidContextStore.clear();
  pendingBidContextStore.deleteContext('tenant-1', 'group-1', JOAO);
  pendingBidContextStore.deleteContext('tenant-1', 'group-1', MARIA);
  pendingBidConfirmationStore.clear();
});

describe('Contexto de disputa ativa — cadeia natural de lances', () => {
  it('1) lance explícito no Bolo cria o contexto de disputa', async () => {
    const { engine, placeBid, prisma } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });

    await engine.handleChatInput(buildContext(), msg('bolo 160'));

    expect(placeBid).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ auctionId: 'auction-1', amount: 160 }),
    );
    const context = activeBidContextStore.get('tenant-1', 'group-1', 'auction-1', 'item-1');
    expect(context).not.toBeNull();
    expect(context?.lastBidAmount).toBe(160);
    expect(context?.lastBidUserId).toBe(JOAO);
    expect(context?.lastBidId).toBe('bid-novo');

    const audit = prisma.log.create.mock.calls.at(-1)?.[0]?.data?.metadata;
    expect(audit?.result).toBe('REGISTERED');
  });

  it('2-4) "165", "170" e "180" sem reply continuam no mesmo item', async () => {
    const { engine, placeBid } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });

    await engine.handleChatInput(buildContext(), msg('bolo 160'));
    await engine.handleChatInput(buildContext(), msg('165'));
    await engine.handleChatInput(buildContext(), msg('170'));
    await engine.handleChatInput(buildContext(), msg('180'));

    expect(placeBid).toHaveBeenCalledTimes(4);
    expect(placeBid).toHaveBeenLastCalledWith(
      'tenant-1',
      expect.objectContaining({ auctionId: 'auction-1', amount: 180 }),
    );
    expect(
      activeBidContextStore.get('tenant-1', 'group-1', 'auction-1', 'item-1')?.lastBidAmount,
    ).toBe(180);
  });

  it('5) outro participante continua a disputa (contexto é do item, não do usuário)', async () => {
    const { engine, placeBid } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });

    await engine.handleChatInput(buildContext(), msg('bolo 160'));
    await engine.handleChatInput(
      buildContext({ senderId: MARIA, senderName: 'Maria' }),
      msg('165'),
    );

    expect(placeBid).toHaveBeenLastCalledWith(
      'tenant-1',
      expect.objectContaining({ auctionId: 'auction-1', amount: 165, participantPhone: '5588888888888' }),
    );
    expect(
      activeBidContextStore.get('tenant-1', 'group-1', 'auction-1', 'item-1')?.lastBidUserId,
    ).toBe(MARIA);
  });

  it('12) texto e áudio produzem o mesmo resultado no contexto', async () => {
    const { engine, placeBid, prisma } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });

    await engine.handleChatInput(buildContext(), msg('bolo 160'));
    await engine.handleChatInput(buildContext(), msg('165'));
    await engine.handleChatInput(buildContext(), msg(''), undefined, audio('cento e setenta'));

    expect(placeBid).toHaveBeenCalledTimes(3);
    expect(placeBid).toHaveBeenLastCalledWith(
      'tenant-1',
      expect.objectContaining({ auctionId: 'auction-1', amount: 170 }),
    );

    const audits = prisma.log.create.mock.calls.map((call) => call[0].data.metadata);
    const last = audits.at(-1);
    expect(last?.source).toBe('AUDIO');
    expect(last?.matchedBy).toBe('active_bid_context');
    expect(last?.messageId).toBe('audio-1');
    expect(last?.amount).toBe(170);
  });

  it('11) áudio sem reply herda o item da disputa recente', async () => {
    const { engine, placeBid } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });

    await engine.handleChatInput(buildContext(), msg(''), undefined, audio('bolo cento e sessenta'));
    expect(placeBid).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ auctionId: 'auction-1', amount: 160 }),
    );

    await engine.handleChatInput(buildContext(), msg(''), undefined, audio('cento e sessenta e cinco'));
    expect(placeBid).toHaveBeenLastCalledWith(
      'tenant-1',
      expect.objectContaining({ auctionId: 'auction-1', amount: 165 }),
    );
  });

  it('18) mensagem repetida não duplica o contexto (upsert por item)', async () => {
    const { engine, placeBid } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });

    await engine.handleChatInput(buildContext(), msg('bolo 160'));
    await engine.handleChatInput(buildContext(), msg('bolo 160'));

    expect(activeBidContextStore.list('tenant-1', 'group-1')).toHaveLength(1);
    expect(placeBid).toHaveBeenCalledTimes(2); // dedupe real é do transport (ProcesssedMessageStore)
  });
});

describe('Contexto de disputa ativa — prioridade de contextos', () => {
  it('7) item explícito no texto vence o contexto ativo', async () => {
    const { engine, placeBid } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });

    await engine.handleChatInput(buildContext(), msg('02 150')); // disputa no Capão
    expect(activeBidContextStore.get('tenant-1', 'group-1', 'auction-2', 'item-2')).not.toBeNull();

    await engine.handleChatInput(buildContext(), msg('180 no bolo'));

    expect(placeBid).toHaveBeenLastCalledWith(
      'tenant-1',
      expect.objectContaining({ auctionId: 'auction-1', amount: 180 }),
    );
    // contexto do outro item permanece intacto
    expect(
      activeBidContextStore.get('tenant-1', 'group-1', 'auction-2', 'item-2')?.lastBidAmount,
    ).toBe(150);
  });

  it('11-bis) "02 180" com contexto em outro item registra o item 02', async () => {
    const { engine, placeBid } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });

    await engine.handleChatInput(buildContext(), msg('bolo 160'));
    await engine.handleChatInput(buildContext(), msg('02 180'));

    expect(placeBid).toHaveBeenLastCalledWith(
      'tenant-1',
      expect.objectContaining({ auctionId: 'auction-2', amount: 180 }),
    );
  });

  it('8) reply para outro item vence o contexto ativo', async () => {
    const { engine, placeBid } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });

    await engine.handleChatInput(buildContext(), msg('bolo 160'));

    const replyContext: ReplyContext = {
      auctionId: 'auction-4',
      itemId: 'item-4',
      itemName: 'Garrafa térmica 2.5lt',
    };
    await engine.handleChatInput(buildContext(), msg('165'), replyContext);

    expect(placeBid).toHaveBeenLastCalledWith(
      'tenant-1',
      expect.objectContaining({ auctionId: 'auction-4', amount: 165 }),
    );
  });

  it('13) pending context ("qual item?") responde pelo número, não vira R$ 2,00', async () => {
    const { engine, placeBid } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });

    await engine.handleChatInput(buildContext(), msg('25 no capão')); // ambíguo → pergunta
    expect(placeBid).not.toHaveBeenCalled();

    await engine.handleChatInput(buildContext(), msg('02'));

    expect(placeBid).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ auctionId: 'auction-2', amount: 25 }),
    );
    expect(pendingBidContextStore.getContext('tenant-1', 'group-1', JOAO)).toBeNull();
  });

  it('13-bis) pending context responde "02" mesmo com disputa ativa em outro item', async () => {
    const { engine, placeBid } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });

    await engine.handleChatInput(buildContext(), msg('bolo 160')); // disputa ativa
    await engine.handleChatInput(buildContext(), msg('25 no capão')); // ambíguo → pergunta

    await engine.handleChatInput(buildContext(), msg('02'));

    expect(placeBid).toHaveBeenLastCalledWith(
      'tenant-1',
      expect.objectContaining({ auctionId: 'auction-2', amount: 25 }),
    );
  });
});

describe('Contexto de disputa ativa — ambiguidade e segurança', () => {
  async function seedTwoDisputes(engine: AuctionEngine) {
    await engine.handleChatInput(buildContext(), msg('bolo 160'));
    await engine.handleChatInput(buildContext(), msg('02 150'));
  }

  it('9-10) dois itens em disputa → pede o item (nunca escolhe)', async () => {
    const { engine, placeBid, prisma } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });
    const messages = collectMessages(engine);

    await seedTwoDisputes(engine);
    await engine.handleChatInput(buildContext(), msg('165'));

    expect(placeBid).toHaveBeenCalledTimes(2); // só os dois seeds
    expect(messages[0]).toContain('Qual item?');
    expect(messages[0]).toContain('Bolo de goma');
    expect(messages[0]).toContain('Capão 01');

    // o "qual item?" fica pendente com exatamente os dois candidatos
    const pending = pendingBidContextStore.getContext('tenant-1', 'group-1', JOAO);
    expect(pending?.candidates.map((c) => c.itemNumber)).toEqual([1, 2]);

    const lastAudit = prisma.log.create.mock.calls.at(-1)?.[0]?.data?.metadata;
    expect(lastAudit?.decision).toBe('clarify');
    expect(lastAudit?.matchedBy).toBe('active_bid_context');
    expect(lastAudit?.result).toBe('AMBIGUOUS');
  });

  it('14) valor que não cresce sobre nenhuma disputa não registra', async () => {
    const { engine, placeBid } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });
    const messages = collectMessages(engine);

    await engine.handleChatInput(buildContext(), msg('bolo 160'));
    await engine.handleChatInput(buildContext(), msg('150')); // <= 160

    expect(placeBid).toHaveBeenCalledTimes(1); // só o seed
    expect(messages[0]).toContain('Qual item?');
  });

  it('6) contexto expirado deixa de valer', async () => {
    const { engine, placeBid } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });

    await engine.handleChatInput(buildContext(), msg('bolo 160'));
    const messages = collectMessages(engine);

    const realNow = Date.now();
    const nowSpy = jest
      .spyOn(Date, 'now')
      .mockReturnValue(realNow + ACTIVE_BID_CONTEXT_TTL_MS + 1000);
    try {
      await engine.handleChatInput(buildContext(), msg('165'));
    } finally {
      nowSpy.mockRestore();
    }

    expect(placeBid).toHaveBeenCalledTimes(1); // só o seed
    expect(messages[0]).toContain('Qual item?');
    expect(activeBidContextStore.get('tenant-1', 'group-1', 'auction-1', 'item-1')).toBeNull();
  });

  it('15) item encerrado não serve de contexto (e é marcado como fechado)', async () => {
    const closedRows = rows.map((r) =>
      r.id === 'auction-1' ? { ...r, status: AuctionStatus.CLOSED } : r,
    );
    const { engine, placeBid } = buildEngine(closedRows);
    engine['listGroups'].set('group-1', { ...list });
    activeBidContextStore.record({
      tenantId: 'tenant-1',
      groupId: 'group-1',
      auctionId: 'auction-1',
      itemId: 'item-1',
      itemNumber: 1,
      itemName: 'Bolo de goma',
      lastBidAmount: 160,
      lastBidUserId: JOAO,
      lastBidAt: Date.now(),
    });

    const messages = collectMessages(engine);
    await engine.handleChatInput(buildContext(), msg('165'));

    expect(placeBid).not.toHaveBeenCalled();
    expect(messages[0]).toContain('Qual item?');
    expect(activeBidContextStore.get('tenant-1', 'group-1', 'auction-1', 'item-1')).toBeNull();
  });

  it('16) leilão que saiu da lista não gera contexto', async () => {
    const withoutBolo = rows.filter((r) => r.id !== 'auction-1');
    const { engine, placeBid } = buildEngine(withoutBolo);
    engine['listGroups'].set('group-1', { ...list });
    activeBidContextStore.record({
      tenantId: 'tenant-1',
      groupId: 'group-1',
      auctionId: 'auction-1',
      itemId: 'item-1',
      itemNumber: 1,
      itemName: 'Bolo de goma',
      lastBidAmount: 160,
      lastBidUserId: JOAO,
      lastBidAt: Date.now(),
    });

    await engine.handleChatInput(buildContext(), msg('165'));

    expect(placeBid).not.toHaveBeenCalled();
    expect(activeBidContextStore.list('tenant-1', 'group-1')).toHaveLength(0);
  });

  it('19) contexto de um grupo não vale para outro grupo', async () => {
    const { engine, placeBid } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });
    engine['listGroups'].set('group-2', { ...list, groupId: 'group-2' });

    await engine.handleChatInput(buildContext(), msg('bolo 160'));
    const messages = collectMessages(engine);

    await engine.handleChatInput(buildContext({ groupId: 'group-2' }), msg('165'));

    expect(placeBid).toHaveBeenCalledTimes(1); // só o seed do grupo-1
    expect(messages[0]).toContain('Qual item?');
  });

  it('20) contexto de um tenant não vale para outro tenant', async () => {
    const { engine, placeBid } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });
    engine['listGroups'].set('group-1-tenant-2', { ...list, tenantId: 'tenant-2' });

    await engine.handleChatInput(buildContext(), msg('bolo 160'));
    const messages = collectMessages(engine);

    await engine.handleChatInput(
      buildContext({ groupId: 'group-1-tenant-2', tenantId: 'tenant-2' }),
      msg('165'),
    );

    expect(placeBid).toHaveBeenCalledTimes(1);
    expect(messages[0]).toContain('Qual item?');
  });
});

describe('Contexto de disputa ativa — confirmação e falhas', () => {
  it('21) contexto com incerteza pede confirmação e registra após "sim"', async () => {
    const { engine, placeBid } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });
    const messages = collectMessages(engine);

    await engine.handleChatInput(buildContext(), msg('bolo 160')); // 160
    await engine.handleChatInput(buildContext(), msg('02 150')); // 150
    await engine.handleChatInput(buildContext(), msg('155')); // só o Capão aceita

    expect(placeBid).toHaveBeenCalledTimes(2); // seeds
    expect(messages[0]).toContain('Confirma?');
    expect(messages[0]).toContain('Capão 01');
    expect(messages[0]).toContain('155,00');

    await engine.handleChatInput(buildContext(), msg('sim'));

    expect(placeBid).toHaveBeenLastCalledWith(
      'tenant-1',
      expect.objectContaining({ auctionId: 'auction-2', amount: 155 }),
    );
  });

  it('22) contexto só é atualizado depois do lance confirmado', async () => {
    const { engine, placeBid } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });

    await engine.handleChatInput(buildContext(), msg('bolo 160'));
    await engine.handleChatInput(buildContext(), msg('02 150'));
    expect(
      activeBidContextStore.get('tenant-1', 'group-1', 'auction-2', 'item-2')?.lastBidAmount,
    ).toBe(150);

    // mensagem que só pergunta (ambígua) não contamina o contexto
    await engine.handleChatInput(buildContext(), msg('155'));
    expect(
      activeBidContextStore.get('tenant-1', 'group-1', 'auction-2', 'item-2')?.lastBidAmount,
    ).toBe(150);

    // lance em confirmação também não atualiza
    await engine.handleChatInput(buildContext(), msg('156'));
    expect(
      activeBidContextStore.get('tenant-1', 'group-1', 'auction-2', 'item-2')?.lastBidAmount,
    ).toBe(150);
    expect(pendingBidConfirmationStore.hasActive('tenant-1', 'group-1', JOAO)).toBe(true);

    await engine.handleChatInput(buildContext(), msg('sim'));
    expect(
      activeBidContextStore.get('tenant-1', 'group-1', 'auction-2', 'item-2')?.lastBidAmount,
    ).toBe(156);
    expect(placeBid).toHaveBeenLastCalledWith(
      'tenant-1',
      expect.objectContaining({ auctionId: 'auction-2', amount: 156 }),
    );
  });

  it('22-bis) "não" cancela e o contexto permanece no último lance registrado', async () => {
    const { engine, placeBid } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });

    await engine.handleChatInput(buildContext(), msg('bolo 160'));
    await engine.handleChatInput(buildContext(), msg('02 150'));
    await engine.handleChatInput(buildContext(), msg('155'));
    await engine.handleChatInput(buildContext(), msg('não'));

    expect(placeBid).toHaveBeenCalledTimes(2);
    expect(
      activeBidContextStore.get('tenant-1', 'group-1', 'auction-2', 'item-2')?.lastBidAmount,
    ).toBe(150);
  });

  it('17) lance rejeitado pelo Bid Service não atualiza o contexto', async () => {
    const { engine, placeBid } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });
    const messages = collectMessages(engine);

    placeBid.mockRejectedValueOnce(new Error('Lance menor ou igual ao atual.'));
    await engine.handleChatInput(buildContext(), msg('bolo 160'));

    expect(placeBid).toHaveBeenCalledTimes(1);
    expect(activeBidContextStore.list('tenant-1', 'group-1')).toHaveLength(0);
    expect(messages[0]).toBeDefined();

    // sem contexto, o lance seguinte continua sendo perguntado
    await engine.handleChatInput(buildContext(), msg('165'));
    expect(placeBid).toHaveBeenCalledTimes(1);
    expect(messages[1]).toContain('Qual item?');
  });
});

describe('Contexto de disputa ativa — auditoria (§24)', () => {
  it('registra matchedBy, confidence, result, lastContextBidId, source e messageId', async () => {
    const { engine, prisma } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });

    await engine.handleChatInput(buildContext(), msg('bolo 160'));
    await engine.handleChatInput(buildContext(), msg('165'));

    const audits = prisma.log.create.mock.calls.map((call) => call[0].data.metadata);
    const active = audits.find((m) => m.matchedBy === 'active_bid_context');

    expect(active).toBeDefined();
    expect(active.decision).toBe('register');
    expect(active.result).toBe('REGISTERED');
    expect(active.source).toBe('TEXT');
    expect(active.confidence).toBeGreaterThanOrEqual(0.9);
    expect(active.confidence).toBeLessThanOrEqual(0.95);
    expect(active.lastContextBidId).toBe('bid-novo');
    expect(active.amount).toBe(165);
    expect(active.itemId).toBe('auction-1');
  });
});
