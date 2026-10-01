import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuctionStatus } from '@prisma/client';
import { Message } from 'whatsapp-web.js';
import { ItemsService } from '../../src/modules/items/items.service';
import { activeBidContextStore } from '../../src/modules/whatsapp/active-bid.context';
import { AuctionEngine } from '../../src/modules/whatsapp/auction.engine';
import {
  ConfidenceAssessment,
  ConfidenceInput,
  evaluateBidConfidence,
} from '../../src/modules/whatsapp/confidence.engine';
import {
  createParser,
  isValueOnlyAfterFillers,
  ListBidParser,
  normalizeMessage,
} from '../../src/modules/whatsapp/list-bid.parser';
import { pendingBidContextStore } from '../../src/modules/whatsapp/pending-bid.context';
import { pendingBidConfirmationStore } from '../../src/modules/whatsapp/pending-bid-confirmation';
import {
  ActiveListMemory,
  ReplyContext,
  WhatsAppGroupContext,
} from '../../src/modules/whatsapp/whatsapp.types';

/**
 * Variações/sinônimos dos itens (§27): administrador cadastra "boi" para o item
 * "Garrote" e o participante pode mandar "150 no boi".
 *
 * Princípios verificados aqui:
 *  - variação cadastrada = evidência forte (register), mas nunca chuta;
 *  - variação ambígua (2 itens) = pergunta, nunca escolhe;
 *  - item explícito (Nº/nome) e mensagem citada vencem a variação;
 *  - variação nunca cria item novo, nunca ignora o Confidence Engine;
 *  - só variação ATIVA vale (o snapshot só manda ativas);
 *  - normalização ÚNICA entre cadastro e interpretação (§5);
 *  - isolamento por item/tenant no CRUD (§16/§20).
 */

const JOAO = '5511999999999@c.us';
const MARIA = '5588888888888@c.us';

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const baseItems = [
  { id: 'a1', name: 'Garrote', order: 1, aliases: ['boi', 'gado', 'novilho'] },
  { id: 'a2', name: 'Capão 01', order: 2 },
  { id: 'a3', name: 'Bolo de goma', order: 3 },
  { id: 'a4', name: 'Garrafa térmica 2.5lt', order: 4, aliases: ['garrafa'] },
  { id: 'a5', name: 'Garrafa plástica 1lt', order: 5 },
];

function parser(items = baseItems): ListBidParser {
  return createParser(items.map((i) => ({ ...i })));
}

describe('Variações — parser resolve o item (evidência forte)', () => {
  it('"150 no boi" aponta para o item "Garrote" como item_alias', () => {
    const r = parser().parseMessage('150 no boi');
    expect(r.amount).toBe(150);
    expect(r.itemId).toBe('a1');
    expect(r.itemNumber).toBe(1);
    expect(r.itemName).toBe('Garrote');
    expect(r.matchedBy).toBe('item_alias');
    expect(r.matchedText).toBe('boi');
    expect(r.ambiguous).toBe(false);
    expect(r.needsUserInput).toBe(false);
    expect(r.candidates).toHaveLength(1);
    expect(r.matchCoverage).toBe(1);
  });

  it('o motivo do resultado cita a variação usada', () => {
    const r = parser().parseMessage('150 no gado');
    expect(r.reason).toContain('variação "gado"');
    expect(r.itemId).toBe('a1');
  });

  it('caixa e acento não atrapalham ("150 NO Bói")', () => {
    const r = parser().parseMessage('150 NO Bói');
    expect(r.itemId).toBe('a1');
    expect(r.matchedBy).toBe('item_alias');
    expect(r.ambiguous).toBe(false);
  });

  it('pontuação na borda não atrapalha ("150 no boi!")', () => {
    const r = parser().parseMessage('150 no boi!');
    expect(r.itemId).toBe('a1');
    expect(r.matchedBy).toBe('item_alias');
  });

  it('variação dentro da frase natural ("eu dou 180 naquele boi")', () => {
    const r = parser().parseMessage('eu dou 180 naquele boi');
    expect(r.amount).toBe(180);
    expect(r.itemId).toBe('a1');
    expect(r.matchedBy).toBe('item_alias');
    expect(r.matchedText).toBe('boi');
    expect(r.ambiguous).toBe(false);
  });

  it('variação multi-palavra casa como sequência contígua', () => {
    const items = [{ id: 'g1', name: 'Lote Garrote Pesado', order: 1, aliases: ['lote garrote'] }];
    const r = parser(items).parseMessage('250 lote garrote');
    expect(r.itemId).toBe('g1');
    expect(r.matchedBy).toBe('item_alias');
    expect(r.matchedText).toBe('lote garrote');
  });

  it('só a variação, sem valor, NÃO gera item (nunca lance sem valor)', () => {
    const r = parser().parseMessage('boi');
    expect(r.amount).toBeNull();
    expect(r.itemId).toBeNull();
    expect(r.matchedBy).toBe('none');
    expect(r.ambiguous).toBe(false);
  });

  it('variação desconhecida cai no caminho normal de nomes', () => {
    const r = parser().parseMessage('150 no hipopotamo');
    expect(r.itemId).toBeNull();
    expect(r.ambiguous).toBe(true);
  });

  it('sem variação cadastrada o comportamento antigo continua (item_name_exact)', () => {
    const r = parser().parseMessage('150 no capão 01');
    expect(r.itemId).toBe('a2');
    expect(r.matchedBy).toBe('item_name_exact');
    expect(r.matchedText ?? null).toBeNull();
    expect(r.ambiguous).toBe(false);
  });
});

describe('Variações — nunca escolhe entre dois itens', () => {
  it('mesma variação em 2 itens → ambíguo com os dois candidatos', () => {
    const items = [
      { id: 'b1', name: 'Garrote', order: 1, aliases: ['boi'] },
      { id: 'b2', name: 'Novilho especial', order: 2, aliases: ['boi'] },
    ];
    const r = parser(items).parseMessage('150 boi');
    expect(r.ambiguous).toBe(true);
    expect(r.itemId).toBeNull();
    expect(r.matchedBy).toBe('item_alias');
    expect(r.needsUserInput).toBe(true);
    expect(r.candidates.map((c) => c.itemNumber).sort()).toEqual([1, 2]);
  });

  it('variação x nome forte de OUTRO item → ambíguo (nunca escolhe)', () => {
    const items = [
      { id: 'c1', name: 'Garrote', order: 1, aliases: ['boi'] },
      { id: 'c2', name: 'Boi para reprodução', order: 2 },
    ];
    const r = parser(items).parseMessage('150 boi');
    expect(r.ambiguous).toBe(true);
    expect(r.itemId).toBeNull();
    expect(r.needsUserInput).toBe(true);
    expect(r.candidates.map((c) => c.itemNumber).sort()).toEqual([1, 2]);
  });

  it('variação vence nome FRACO de outro item (não é conflito)', () => {
    const items = [
      { id: 'd1', name: 'Garrote', order: 1, aliases: ['boi'] },
      { id: 'd2', name: 'Vaca leiteira', order: 2 },
    ];
    const r = parser(items).parseMessage('150 boi');
    expect(r.ambiguous).toBe(false);
    expect(r.itemId).toBe('d1');
    expect(r.matchedBy).toBe('item_alias');
  });

  it('Nº explícito + variação de OUTRO item → ambíguo, o Nº não é ignorado', () => {
    const r = parser().parseMessage('01 180 na garrafa');
    expect(r.amount).toBe(180);
    expect(r.itemId).toBeNull();
    expect(r.ambiguous).toBe(true);
    expect(r.matchedBy).toBe('item_alias');
    expect(r.matchedText).toBe('garrafa');
    expect(r.candidates.map((c) => c.itemNumber)).toEqual([1, 4]);
    expect(r.reason).toContain('conflita');
    expect(r.needsUserInput).toBe(true);
  });

  it('Nº explícito + variação do MESMO item segue valendo o Nº', () => {
    const r = parser().parseMessage('01 180 no boi');
    expect(r.itemId).toBe('a1');
    expect(r.matchedBy).toBe('item_number');
    expect(r.ambiguous).toBe(false);
  });

  it('variação + Nº solto de outro item na frase → ambíguo', () => {
    const r = parser().parseMessage('180 boi 02');
    expect(r.ambiguous).toBe(true);
    expect(r.itemId).toBeNull();
    expect(r.candidates.map((c) => c.itemNumber).sort()).toEqual([1, 2]);
    expect(r.needsUserInput).toBe(true);
  });

  it('"25 na garrafa" continua ambíguo mesmo com variação em uma garrafa', () => {
    const r = parser().parseMessage('25 na garrafa');
    expect(r.amount).toBe(25);
    expect(r.ambiguous).toBe(true);
    expect(r.itemId).toBeNull();
    expect(r.candidates.map((c) => c.itemNumber).sort()).toEqual([4, 5]);
  });
});

describe('Variações — normalização única (§5)', () => {
  it('normalizeMessage é a única normalização do projeto', () => {
    expect(normalizeMessage('  BOI  ')).toBe('boi');
    expect(normalizeMessage('Garçáfa Térmica')).toBe('garcafa termica');
    expect(normalizeMessage('Bói')).toBe('boi');
    expect(normalizeMessage('Novilho   especial')).toBe('novilho especial');
  });

  it('não faz plural/stemming: "bois" não vira "boi" (§13)', () => {
    expect(normalizeMessage('bois')).toBe('bois');
    const r = parser().parseMessage('150 bois');
    expect(r.matchedBy).not.toBe('item_alias');
    expect(r.itemId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Confidence Engine
// ---------------------------------------------------------------------------

function evaluate(text: string, overrides: Partial<ConfidenceInput> = {}): ConfidenceAssessment {
  const parsed = parser().parseMessage(text);
  const looksLikeBid =
    /^\s*(?:r\$|\$|[\d.,])/i.test(text) || isValueOnlyAfterFillers(text);
  return evaluateBidConfidence({
    parsed,
    source: 'TEXT',
    replyContextUsed: false,
    looksLikeBid,
    ...overrides,
  });
}

describe('Variações — Confidence Engine (item_alias é evidência forte)', () => {
  it('variação única registra direto com 0.96 e motivo do §9', () => {
    const a = evaluate('150 no boi');
    expect(a.decision).toBe('register');
    expect(a.matchedBy).toBe('item_alias');
    expect(a.confidence).toBeCloseTo(0.96, 5);
    expect(a.reason).toContain('variação cadastrada');
    expect(a.reason).toContain('boi');
  });

  it('variação ambígua pede clarificação (nunca registra)', () => {
    const items = [
      { id: 'b1', name: 'Garrote', order: 1, aliases: ['boi'] },
      { id: 'b2', name: 'Novilho especial', order: 2, aliases: ['boi'] },
    ];
    const parsed = parser(items).parseMessage('150 boi');
    const a = evaluateBidConfidence({
      parsed,
      source: 'TEXT',
      replyContextUsed: false,
      looksLikeBid: true,
    });
    expect(a.decision).toBe('clarify');
    expect(a.matchedBy).toBe('item_alias');
    expect(parsed.itemId).toBeNull();
  });

  it('Nº explícito (0.97) continua acima da variação (0.96)', () => {
    expect(evaluate('01 300').confidence).toBeCloseTo(0.97, 5);
    expect(evaluate('150 no boi').confidence).toBeCloseTo(0.96, 5);
  });

  it('reply continua sendo a evidência mais forte (0.97)', () => {
    const a = evaluate('150 no boi', { replyContextUsed: true });
    expect(a.matchedBy).toBe('reply_context');
    expect(a.confidence).toBeCloseTo(0.97, 5);
  });
});

// ---------------------------------------------------------------------------
// Motor (snapshot, reply, auditoria)
// ---------------------------------------------------------------------------

function row(
  id: string,
  itemId: string,
  productName: string,
  order: number,
  status: AuctionStatus = AuctionStatus.OPEN,
  aliases?: string[],
) {
  return {
    id,
    itemId,
    productName,
    status,
    initialValue: 10,
    endsAt: new Date(Date.now() + 3600_000),
    durationSeconds: 0,
    item: {
      order,
      number: order,
      initialValue: 10,
      imageUrl: null,
      ...(aliases
        ? { aliases: aliases.map((normalizedValue) => ({ normalizedValue })) }
        : {}),
    },
    bids: [],
    _count: { bids: 0 },
  };
}

const rows = [
  row('auction-1', 'item-1', 'Garrote', 1, AuctionStatus.OPEN, ['boi', 'gado']),
  row('auction-2', 'item-2', 'Capão 01', 2),
  row('auction-3', 'item-3', 'Bolo de goma', 3),
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
    senderId: JOAO,
    senderName: 'João',
    isAdmin: false,
    chat: {} as WhatsAppGroupContext['chat'],
    ...overrides,
  };
}

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

beforeEach(() => {
  activeBidContextStore.clear();
  pendingBidConfirmationStore.clear();
  pendingBidContextStore.deleteContext('tenant-1', 'group-1', JOAO);
  pendingBidContextStore.deleteContext('tenant-1', 'group-1', MARIA);
});

describe('Variações — motor carrega o snapshot e interpreta', () => {
  it('snapshot com variações → "150 no boi" registra no item certo', async () => {
    const { engine, placeBid } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });

    await engine.handleChatInput(buildContext(), msg('150 no boi'));

    expect(placeBid).toHaveBeenCalledTimes(1);
    expect(placeBid).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ auctionId: 'auction-1', amount: 150 }),
    );
  });

  it('sem variação no snapshot (inativa) → pergunta o item, não registra', async () => {
    const { engine, placeBid } = buildEngine(
      rows.map((r) => (r.id === 'auction-1' ? row('auction-1', 'item-1', 'Garrote', 1) : r)),
    );
    const messages = collectMessages(engine);
    engine['listGroups'].set('group-1', { ...list });

    await engine.handleChatInput(buildContext(), msg('150 no boi'));

    expect(placeBid).not.toHaveBeenCalled();
    expect(messages[0]).toContain('Qual item?');
  });

  it('variação ambígua responde "qual item?" e guarda o contexto pendente', async () => {
    const { engine, placeBid } = buildEngine([
      row('auction-1', 'item-1', 'Garrote', 1, AuctionStatus.OPEN, ['boi']),
      row('auction-2', 'item-2', 'Novilho especial', 2, AuctionStatus.OPEN, ['boi']),
    ]);
    const messages = collectMessages(engine);
    engine['listGroups'].set('group-1', { ...list });

    await engine.handleChatInput(buildContext(), msg('150 boi'));

    expect(placeBid).not.toHaveBeenCalled();
    expect(messages[0]).toContain('Qual item?');
    expect(messages[0]).toContain('Garrote');
    expect(messages[0]).toContain('Novilho especial');
    const pending = pendingBidContextStore.getContext('tenant-1', 'group-1', JOAO);
    expect(pending).not.toBeNull();
    expect(pending?.amount).toBe(150);
    expect(pending?.candidates).toHaveLength(2);
  });

  it('responder o item A e citar variação do item B → pergunta (reply vence)', async () => {
    const { engine, placeBid } = buildEngine();
    const messages = collectMessages(engine);
    engine['listGroups'].set('group-1', { ...list });
    const replyContext: ReplyContext = {
      auctionId: 'auction-4',
      itemId: 'item-4',
      itemName: 'Garrafa térmica 2.5lt',
    };

    await engine.handleChatInput(buildContext(), msg('150 no boi'), replyContext);

    expect(placeBid).not.toHaveBeenCalled();
    expect(messages[0]).toContain('Qual item?');
    expect(messages[0]).toContain('Garrote');
    expect(messages[0]).toContain('Garrafa térmica 2.5lt');
  });

  it('responder o item A e citar variação do MESMO item registra', async () => {
    const { engine, placeBid } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });
    const replyContext: ReplyContext = {
      auctionId: 'auction-1',
      itemId: 'item-1',
      itemName: 'Garrote',
    };

    await engine.handleChatInput(buildContext(), msg('150 no boi'), replyContext);

    expect(placeBid).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ auctionId: 'auction-1', amount: 150 }),
    );
  });

  it('auditoria registra a variação usada (matchedText) e a normalização', async () => {
    const { engine, prisma } = buildEngine();
    engine['listGroups'].set('group-1', { ...list });

    await engine.handleChatInput(buildContext(), msg('150 no boi'));

    const metadata = prisma.log.create.mock.calls.at(-1)?.[0]?.data?.metadata;
    expect(metadata?.matchedBy).toBe('item_alias');
    expect(metadata?.matchedText).toBe('boi');
    expect(metadata?.normalizedMessage).toContain('boi');
    expect(metadata?.originalMessage).toBe('150 no boi');
  });
});

// ---------------------------------------------------------------------------
// API de itens (CRUD de variações)
// ---------------------------------------------------------------------------

function buildService() {
  const baseItem = {
    id: 'item-1',
    tenantId: 'tenant-1',
    auctionEventId: null as string | null,
    name: 'Garrote',
    initialValue: 50,
    durationSeconds: null as number | null,
    status: 'AVAILABLE',
  };

  const prisma = {
    item: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(baseItem),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      create: jest
        .fn()
        .mockImplementation((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'item-new', ...args.data }),
        ),
    },
    itemAlias: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest
        .fn()
        .mockImplementation((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'alias-new', active: true, ...args.data }),
        ),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest
        .fn()
        .mockImplementation((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'alias-1', ...args.data }),
        ),
      delete: jest.fn().mockResolvedValue({}),
    },
    group: { findFirst: jest.fn() },
  };

  const auctionEventsService = { ensureOpen: jest.fn().mockResolvedValue({}) };
  const auctionsService = { startAuction: jest.fn(), placeBid: jest.fn() };
  const whatsappManager = { sessionStatus: jest.fn() };
  const engine = { launchAuction: jest.fn(), publishItemToList: jest.fn() };
  const planLimits = { assertCanAddItemToEvent: jest.fn().mockResolvedValue(undefined) };

  const service = new ItemsService(
    prisma as never,
    auctionsService as never,
    auctionEventsService as never,
    whatsappManager as never,
    engine as never,
    planLimits as never,
  );

  return { service, prisma };
}

describe('ItemsService — criar variação', () => {
  it('normaliza a variação (caixa, acento e espaços) e guarda o texto original', async () => {
    const { service, prisma } = buildService();

    const alias = await service.createAlias('tenant-1', 'item-1', { value: '  Bói  ' });

    expect(alias.value).toBe('Bói');
    expect(alias.normalizedValue).toBe('boi');
    expect(prisma.itemAlias.create).toHaveBeenCalledWith({
      data: { tenantId: 'tenant-1', itemId: 'item-1', value: 'Bói', normalizedValue: 'boi' },
    });
  });

  it('rejeita variação repetida no MESMO item (mesmo texto normalizado)', async () => {
    const { service, prisma } = buildService();
    prisma.itemAlias.findFirst.mockResolvedValue({ id: 'alias-x', active: true });

    await expect(service.createAlias('tenant-1', 'item-1', { value: 'BOI!' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.itemAlias.create).not.toHaveBeenCalled();
  });

  it('orienta reativar quando a variação existe mas está inativa', async () => {
    const { service, prisma } = buildService();
    prisma.itemAlias.findFirst.mockResolvedValue({ id: 'alias-x', active: false });

    await expect(service.createAlias('tenant-1', 'item-1', { value: 'boi' })).rejects.toThrow(
      /inativada/,
    );
    expect(prisma.itemAlias.create).not.toHaveBeenCalled();
  });

  it('rejeita variação só numérica (usaria o Nº do item)', async () => {
    const { service, prisma } = buildService();

    await expect(service.createAlias('tenant-1', 'item-1', { value: '150' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.itemAlias.create).not.toHaveBeenCalled();
  });

  it('rejeita variação vazia ou só com pontuação', async () => {
    const { service } = buildService();

    await expect(service.createAlias('tenant-1', 'item-1', { value: '  !!  ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejeita variação acima de 60 caracteres', async () => {
    const { service } = buildService();

    await expect(
      service.createAlias('tenant-1', 'item-1', { value: 'a'.repeat(61) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita variação de item que não existe no tenant', async () => {
    const { service, prisma } = buildService();
    prisma.item.findFirst.mockResolvedValue(null);

    await expect(service.createAlias('tenant-1', 'item-9', { value: 'boi' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('ItemsService — editar e remover variação', () => {
  it('troca o texto e a chave normalizada', async () => {
    const { service, prisma } = buildService();
    prisma.itemAlias.findFirst
      .mockResolvedValueOnce({
        id: 'alias-1',
        itemId: 'item-1',
        tenantId: 'tenant-1',
        value: 'boi',
        normalizedValue: 'boi',
        active: true,
      })
      .mockResolvedValueOnce(null); // nenhum outro item com "novilho"

    const updated = await service.updateAlias('tenant-1', 'item-1', 'alias-1', {
      value: 'Novilho!',
    });

    expect(prisma.itemAlias.update).toHaveBeenCalledWith({
      where: { id: 'alias-1' },
      data: { value: 'Novilho!', normalizedValue: 'novilho' },
    });
    expect(updated.normalizedValue).toBe('novilho');
  });

  it('não deixa trocar para um texto que já existe no mesmo item', async () => {
    const { service, prisma } = buildService();
    prisma.itemAlias.findFirst
      .mockResolvedValueOnce({
        id: 'alias-1',
        itemId: 'item-1',
        tenantId: 'tenant-1',
        value: 'boi',
        normalizedValue: 'boi',
        active: true,
      })
      .mockResolvedValueOnce({ id: 'alias-2' });

    await expect(
      service.updateAlias('tenant-1', 'item-1', 'alias-1', { value: 'GADO' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.itemAlias.update).not.toHaveBeenCalled();
  });

  it('ativa/desativa sem mexer no texto', async () => {
    const { service, prisma } = buildService();
    prisma.itemAlias.findFirst.mockResolvedValue({
      id: 'alias-1',
      itemId: 'item-1',
      tenantId: 'tenant-1',
      value: 'boi',
      normalizedValue: 'boi',
      active: true,
    });

    await service.updateAlias('tenant-1', 'item-1', 'alias-1', { active: false });

    expect(prisma.itemAlias.update).toHaveBeenCalledWith({
      where: { id: 'alias-1' },
      data: { active: false },
    });
  });

  it('remove a variação', async () => {
    const { service, prisma } = buildService();
    prisma.itemAlias.findFirst.mockResolvedValue({ id: 'alias-1', itemId: 'item-1' });

    await service.removeAlias('tenant-1', 'item-1', 'alias-1');

    expect(prisma.itemAlias.delete).toHaveBeenCalledWith({ where: { id: 'alias-1' } });
  });

  it('não alcança variação de outro item/tenant (404)', async () => {
    const { service, prisma } = buildService();
    prisma.itemAlias.findFirst.mockResolvedValue(null);

    await expect(
      service.removeAlias('tenant-1', 'item-1', 'alias-de-outro'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ItemsService — variações na criação do item', () => {
  it('normaliza todas as variações do payload', async () => {
    const { service, prisma } = buildService();

    await service.create('tenant-1', {
      name: 'Garrote',
      initialValue: 50,
      auctionEventId: 'event-1',
      aliases: ['Boi', ' gado ', 'novilho!'],
    });

    expect(prisma.itemAlias.createMany).toHaveBeenCalledWith({
      data: [
        { tenantId: 'tenant-1', itemId: 'item-new', value: 'Boi', normalizedValue: 'boi' },
        { tenantId: 'tenant-1', itemId: 'item-new', value: 'gado', normalizedValue: 'gado' },
        {
          tenantId: 'tenant-1',
          itemId: 'item-new',
          value: 'novilho!',
          normalizedValue: 'novilho',
        },
      ],
    });
  });

  it('payload com variação repetida não cria nem o item', async () => {
    const { service, prisma } = buildService();

    await expect(
      service.create('tenant-1', {
        name: 'Garrote',
        initialValue: 50,
        auctionEventId: 'event-1',
        aliases: ['boi', 'BOI'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.item.create).not.toHaveBeenCalled();
    expect(prisma.itemAlias.createMany).not.toHaveBeenCalled();
  });

  it('item sem variação não chama createMany', async () => {
    const { service, prisma } = buildService();

    await service.create('tenant-1', { name: 'Bolo', initialValue: 50, auctionEventId: 'event-1' });

    expect(prisma.itemAlias.createMany).not.toHaveBeenCalled();
  });

  it('se o createMany falhar, o item recém-criado é desfeito (sem cadastro pela metade)', async () => {
    const { service, prisma } = buildService();
    prisma.itemAlias.createMany.mockRejectedValueOnce(new Error('db down'));

    await expect(
      service.create('tenant-1', {
        name: 'Garrote',
        initialValue: 50,
        auctionEventId: 'event-1',
        aliases: ['boi'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.item.delete).toHaveBeenCalledWith({ where: { id: 'item-new' } });
  });
});
