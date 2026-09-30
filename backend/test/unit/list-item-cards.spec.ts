import { AuctionEngine } from '../../src/modules/whatsapp/auction.engine';

const EVENT = {
  id: 'event-1',
  tenantId: 'tenant-1',
  name: 'Leilão Teste',
  description: null,
  groupId: 'group-internal',
  periodicStatusMinutes: 0,
  scheduledStartAt: null,
  scheduledEndAt: null,
  minBidStep: null,
  status: 'OPEN',
};

const GROUP = {
  id: 'group-internal',
  tenantId: 'tenant-1',
  whatsappGroupId: '123@g.us',
  isActive: true,
};

interface TestItem {
  id: string;
  number: number | null;
  name: string;
  description: string | null;
  imageUrl: string | null;
  initialValue: number;
  durationSeconds: number | null;
  order: number;
}

const ITEMS: TestItem[] = [
  {
    id: 'item-1',
    number: 1,
    name: 'Bolo de goma',
    description: 'Com cobertura de chocolate',
    imageUrl: '/api/uploads/items/bolo.jpg',
    initialValue: 10,
    durationSeconds: 120,
    order: 1,
  },
  {
    id: 'item-2',
    number: 2,
    name: 'Refrigerante',
    description: null,
    imageUrl: null,
    initialValue: 5,
    durationSeconds: null, // sem duração
    order: 2,
  },
];

function snapshotRow(
  item: TestItem,
  auctionId: string,
  index: number,
  cardSentAt: Date | null = null,
) {
  return {
    id: auctionId,
    itemId: item.id,
    productName: item.name,
    status: 'OPEN',
    initialValue: item.initialValue,
    endsAt: item.durationSeconds ? new Date(Date.now() + item.durationSeconds * 1000) : null,
    durationSeconds: item.durationSeconds ?? 0,
    cardSentAt,
    item: {
      order: item.order,
      initialValue: item.initialValue,
      imageUrl: item.imageUrl,
      number: item.number,
      description: item.description,
    },
    bids: [],
    _count: { bids: 0 },
    __index: index,
  };
}

function buildEngine(options?: {
  items?: TestItem[];
  allAuctioned?: boolean;
  mediaFails?: boolean;
}) {
  const items = options?.items ?? ITEMS;
  let auctionSeq = 0;
  const existingAuctions = (options?.allAuctioned ? items : []).map((item) => ({
    itemId: item.id,
  }));
  // Leilões já existentes já foram publicados (cardSentAt preenchido).
  const publishedAt = options?.allAuctioned ? new Date() : null;
  const snapshotRows = items.map((item, index) =>
    snapshotRow(item, `auc-${index + 1}`, index, publishedAt),
  );
  const cardSentAtByAuction = new Map<string, Date | null>(
    snapshotRows.map((row) => [row.id, row.cardSentAt]),
  );

  const prisma = {
    auctionEvent: {
      findFirst: jest.fn().mockImplementation((args: { select?: { minBidStep?: boolean } }) =>
        args?.select?.minBidStep
          ? Promise.resolve({ minBidStep: null })
          : Promise.resolve(EVENT),
      ),
    },
    group: { findFirst: jest.fn().mockResolvedValue(GROUP) },
    auction: {
      findFirst: jest
        .fn()
        .mockImplementation((args: { where?: Record<string, unknown> }) => {
          const keys = args?.where ? Object.keys(args.where) : [];
          // Consulta { id } => leitura de cardSentAt antes do envio.
          if (args.where && keys.length === 1 && keys[0] === 'id') {
            return Promise.resolve({
              cardSentAt: cardSentAtByAuction.get(args.where.id as string) ?? null,
            });
          }
          // otherOpen (checagem de leilão ativo no grupo) => nenhum.
          return Promise.resolve(null);
        }),
      findMany: jest.fn().mockImplementation((args: { select?: Record<string, unknown> }) => {
        // syncNewItems consulta apenas { itemId: true }; o snapshot tem select completo.
        const keys = args?.select ? Object.keys(args.select) : [];
        const isSyncQuery = keys.length === 1 && keys[0] === 'itemId';
        return Promise.resolve(isSyncQuery ? existingAuctions : snapshotRows);
      }),
      update: jest.fn().mockImplementation((args: { where: { id: string }; data: { cardSentAt?: Date } }) => {
        if (args.data.cardSentAt) {
          cardSentAtByAuction.set(args.where.id, args.data.cardSentAt);
        }
        return Promise.resolve({ id: args.where.id, ...args.data });
      }),
      create: jest.fn().mockImplementation(() => {
        auctionSeq += 1;
        const id = `auc-${auctionSeq}`;
        cardSentAtByAuction.set(id, null);
        return Promise.resolve({ id, cardSentAt: null, status: 'OPEN' });
      }),
    },
    item: {
      findMany: jest.fn().mockResolvedValue(items),
      update: jest.fn().mockResolvedValue({}),
    },
    whatsAppReplyBinding: {
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };

  const engine = new AuctionEngine(prisma as never, {} as never, {} as never);

  const sent: Array<{ text: string; mediaPath?: string }> = [];
  let msgSeq = 0;
  engine.subscribe(async (_tenantId, _groupId, text, mediaPath) => {
    if (options?.mediaFails && mediaPath) {
      throw new Error('falha ao enviar a imagem');
    }
    msgSeq += 1;
    sent.push({ text, mediaPath });
    return `msg-${msgSeq}`;
  });

  return { engine, prisma, sent };
}

describe('AuctionEngine — publicação da lista pelo painel', () => {
  it('iniciar lista: envia cards apenas dos itens COM foto, sem lista textual', async () => {
    const { engine, prisma, sent } = buildEngine();

    const result = await engine.openListFromPanel('tenant-1', 'event-1', 'group-internal');

    expect(result.created).toBe(2);
    expect(result.itemCount).toBe(2);
    expect(result.cardsSent).toBe(1);
    expect(result.cardsFailed).toBe(0);
    expect(result.listSent).toBe(false);

    // Só o card do item com foto — nenhum texto de lista
    expect(sent).toHaveLength(1);

    const [card] = sent;
    expect(card.text).toContain('*01* • Bolo de goma');
    expect(card.text).toContain('Com cobertura de chocolate');
    expect(card.text).toContain('Valor inicial');
    expect(card.text).toContain('Tempo');
    expect(card.mediaPath).toContain('bolo.jpg');

    // Item sem foto fica de fora nesta etapa
    expect(sent.some((message) => message.text.includes('Refrigerante'))).toBe(false);

    // Card 1 com prazo; card 2 sem duração artificial (endsAt null)
    const createdData = prisma.auction.create.mock.calls.map(
      (call: [{ data: { durationSeconds: number; endsAt: Date | null } }]) => call[0].data,
    );
    expect(createdData[0].durationSeconds).toBe(120);
    expect(createdData[0].endsAt).toBeInstanceOf(Date);
    expect(createdData[1].durationSeconds).toBe(0);
    expect(createdData[1].endsAt).toBeNull();

    // Vínculo msg -> item para lances via "Responder" do WhatsApp
    expect(engine.getReplyContext('msg-1')).toEqual({
      auctionId: 'auc-1',
      itemId: 'item-1',
      itemName: 'Bolo de goma',
    });
    // Sem card não há vínculo (o item sem foto entra pela lista textual)
    expect(engine.getReplyContext('msg-2')).toBeUndefined();
  });

  it('atualizar lista: envia só a lista textual completa, sem reenviar cards', async () => {
    const { engine, sent } = buildEngine({ allAuctioned: true });

    // Primeira chamada: cards já publicados, nada novo a enviar
    const opening = await engine.openListFromPanel('tenant-1', 'event-1', 'group-internal');
    expect(opening.listSent).toBe(false);
    expect(opening.cardsSent).toBe(0);
    expect(sent).toHaveLength(0);

    // Segunda chamada = "Atualizar Lista"
    const result = await engine.openListFromPanel('tenant-1', 'event-1', 'group-internal');

    expect(result.created).toBe(0);
    expect(result.itemCount).toBe(2);
    expect(result.cardsSent).toBe(0);
    expect(result.cardsFailed).toBe(0);
    expect(result.listSent).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('EM ANDAMENTO');
    // O item sem foto aparece na lista textual
    expect(sent[0].text).toContain('Refrigerante');
    expect(sent[0].mediaPath).toBeUndefined();
  });

  it('usa o número registrado do item no card (fallback para a posição)', async () => {
    const items: TestItem[] = [
      { ...ITEMS[0], id: 'item-x', number: 7, name: 'Item Sete' },
      { ...ITEMS[1], id: 'item-y', number: null, name: 'Item Sem Nº' },
    ];
    const { engine, sent } = buildEngine({ items });

    await engine.openListFromPanel('tenant-1', 'event-1', 'group-internal');

    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('*07* • Item Sete');

    // Na lista textual o item sem número usa a posição (índice 1 + 1 = 2)
    sent.length = 0;
    await engine.openListFromPanel('tenant-1', 'event-1', 'group-internal');
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('*02* • Item Sem Nº');
  });

  it('sem itens com foto, iniciar lista não envia nada e não falha', async () => {
    const { engine, sent } = buildEngine({ items: [{ ...ITEMS[1], id: 'item-sf' }] });

    const result = await engine.openListFromPanel('tenant-1', 'event-1', 'group-internal');

    expect(result.listSent).toBe(false);
    expect(result.cardsSent).toBe(0);
    expect(result.cardsFailed).toBe(0);
    expect(sent).toHaveLength(0);

    // "Atualizar Lista" publica a lista textual completa
    const update = await engine.openListFromPanel('tenant-1', 'event-1', 'group-internal');
    expect(update.listSent).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('Refrigerante');
  });

  it('abertura automática (announce) envia cards de foto e a lista textual', async () => {
    const { engine, sent } = buildEngine();

    const result = await engine.openListFromPanel('tenant-1', 'event-1', 'group-internal', {
      announce: true,
    });

    expect(result.cardsSent).toBe(1);
    expect(result.listSent).toBe(true);
    expect(sent).toHaveLength(2);
    expect(sent[0].mediaPath).toContain('bolo.jpg');
    expect(sent[1].text).toContain('EM ANDAMENTO');
  });

  it('lança erro quando todos os cards de foto falham ao iniciar', async () => {
    const { engine } = buildEngine({ mediaFails: true });

    await expect(
      engine.openListFromPanel('tenant-1', 'event-1', 'group-internal'),
    ).rejects.toThrow('Nenhum card pôde ser enviado ao WhatsApp');
  });

  it('lança erro quando nada chega ao grupo (WhatsApp sem cliente conectado)', async () => {
    const { prisma } = buildEngine();
    // Sem `subscribe`: emit não tem quem envie => openListFromPanel precisa
    // falhar em vez de devolver sucesso silencioso ao painel.
    const offline = new AuctionEngine(prisma as never, {} as never, {} as never);

    await expect(
      offline.openListFromPanel('tenant-1', 'event-1', 'group-internal'),
    ).rejects.toThrow('Nenhum card pôde ser enviado ao WhatsApp');
  });
});
