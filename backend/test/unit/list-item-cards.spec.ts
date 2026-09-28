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

function snapshotRow(item: TestItem, auctionId: string, index: number) {
  return {
    id: auctionId,
    itemId: item.id,
    productName: item.name,
    status: 'OPEN',
    initialValue: item.initialValue,
    endsAt: item.durationSeconds ? new Date(Date.now() + item.durationSeconds * 1000) : null,
    durationSeconds: item.durationSeconds ?? 0,
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

function buildEngine(options?: { items?: TestItem[]; allAuctioned?: boolean }) {
  const items = options?.items ?? ITEMS;
  let auctionSeq = 0;
  const existingAuctions = (options?.allAuctioned ? items : []).map((item) => ({
    itemId: item.id,
  }));
  const snapshotRows = items.map((item, index) => snapshotRow(item, `auc-${index + 1}`, index));

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
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockImplementation((args: { select?: Record<string, unknown> }) => {
        // syncNewItems consulta apenas { itemId: true }; o snapshot tem select completo.
        const keys = args?.select ? Object.keys(args.select) : [];
        const isSyncQuery = keys.length === 1 && keys[0] === 'itemId';
        return Promise.resolve(isSyncQuery ? existingAuctions : snapshotRows);
      }),
      create: jest.fn().mockImplementation(() => {
        auctionSeq += 1;
        return Promise.resolve({ id: `auc-${auctionSeq}` });
      }),
    },
    item: {
      findMany: jest.fn().mockResolvedValue(items),
      update: jest.fn().mockResolvedValue({}),
    },
  };

  const engine = new AuctionEngine(prisma as never, {} as never, {} as never);

  const sent: Array<{ text: string; mediaPath?: string }> = [];
  let msgSeq = 0;
  engine.subscribe(async (_tenantId, _groupId, text, mediaPath) => {
    msgSeq += 1;
    sent.push({ text, mediaPath });
    return `msg-${msgSeq}`;
  });

  return { engine, prisma, sent };
}

describe('AuctionEngine — cards de item ao abrir a lista', () => {
  it('envia um card por item (foto/legenda) e cria leilões com duração opcional', async () => {
    const { engine, prisma, sent } = buildEngine();

    const result = await engine.openListFromPanel('tenant-1', 'event-1', 'group-internal');

    expect(result.created).toBe(2);
    expect(result.itemCount).toBe(2);

    // 2 cards + 1 lista textual (status) = 3 mensagens
    expect(sent).toHaveLength(3);

    const [card1, card2, listText] = sent;
    // Card 1: com foto (mediaPath resolvido da URL de upload)
    expect(card1.text).toContain('*01* • Bolo de goma');
    expect(card1.text).toContain('Com cobertura de chocolate');
    expect(card1.text).toContain('Valor inicial');
    expect(card1.text).toContain('Tempo');
    expect(card1.mediaPath).toContain('bolo.jpg');

    // Card 2: sem foto e SEM linha de tempo (duração não configurada)
    expect(card2.text).toContain('*02* • Refrigerante');
    expect(card2.text).toContain('Valor inicial');
    expect(card2.text).not.toContain('⏱️ Tempo');
    expect(card2.mediaPath).toBeUndefined();

    // O status continua sendo lista textual (sem fotos)
    expect(listText.mediaPath).toBeUndefined();
    expect(listText.text).toContain('EM ANDAMENTO');

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
    expect(engine.getReplyContext('msg-2')).toEqual({
      auctionId: 'auc-2',
      itemId: 'item-2',
      itemName: 'Refrigerante',
    });
    // A lista textual não fica vinculada a item algum
    expect(engine.getReplyContext('msg-3')).toBeUndefined();
  });

  it('ao atualizar a lista, envia cards apenas para itens novos', async () => {
    const { engine, sent } = buildEngine({ allAuctioned: true });

    const result = await engine.openListFromPanel('tenant-1', 'event-1', 'group-internal');

    expect(result.created).toBe(0);
    expect(result.itemCount).toBe(2);
    // Só a lista textual — nenhum card reenviado
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('EM ANDAMENTO');
    expect(sent[0].mediaPath).toBeUndefined();
  });

  it('usa o número registrado do item no card (fallback para a posição)', async () => {
    const items: TestItem[] = [
      { ...ITEMS[0], id: 'item-x', number: 7, name: 'Item Sete' },
      { ...ITEMS[1], id: 'item-y', number: null, name: 'Item Sem Nº' },
    ];
    const { engine, sent } = buildEngine({ items });

    await engine.openListFromPanel('tenant-1', 'event-1', 'group-internal');

    expect(sent[0].text).toContain('*07* • Item Sete');
    // number null => posição (índice 1 + 1 = 2)
    expect(sent[1].text).toContain('*02* • Item Sem Nº');
  });
});
