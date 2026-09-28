import { AuctionEngine } from '../../src/modules/whatsapp/auction.engine';
import { ActiveListMemory } from '../../src/modules/whatsapp/whatsapp.types';

const EVENT_OPEN = { id: 'event-1', status: 'OPEN', minBidStep: null };

const ITEM_NEW: {
  id: string;
  name: string;
  status: string;
  durationSeconds: number | null;
  initialValue: number;
} = {
  id: 'item-3',
  name: 'Frango caipira',
  status: 'AVAILABLE',
  durationSeconds: 600,
  initialValue: 70,
};

interface AuctionState {
  id: string;
  cardSentAt: Date | null;
  status: string;
}

interface BuildOptions {
  event?: Partial<typeof EVENT_OPEN> | null;
  item?: Partial<typeof ITEM_NEW> | null;
  existingAuction?: AuctionState | null;
  failSend?: boolean;
  listStarted?: boolean;
}

function buildEngine(options: BuildOptions = {}) {
  const event = 'event' in options ? options.event : EVENT_OPEN;
  const item = 'item' in options ? options.item : ITEM_NEW;
  const listStarted = options.listStarted ?? true;
  const failSend = options.failSend ?? false;

  let auctionState: AuctionState | null = options.existingAuction ?? null;
  let createdData: Record<string, unknown> | null = null;

  const prisma = {
    auctionEvent: {
      findFirst: jest.fn().mockResolvedValue(event),
    },
    item: {
      findFirst: jest.fn().mockResolvedValue(item),
      update: jest.fn().mockResolvedValue({}),
    },
    auction: {
      findFirst: jest
        .fn()
        .mockImplementation((args: { where: Record<string, unknown> }) => {
          const keys = Object.keys(args.where);
          // { id } => leitura de confirmação (cardSentAt) pós-envio.
          if (keys.length === 1 && keys[0] === 'id') {
            return Promise.resolve({ cardSentAt: auctionState?.cardSentAt ?? null });
          }
          // { tenantId, auctionEventId, itemId } => leilão do item.
          if (args.where.itemId !== undefined) {
            return Promise.resolve(auctionState);
          }
          return Promise.resolve(null);
        }),
      findMany: jest.fn().mockImplementation(() =>
        Promise.resolve(
          auctionState
            ? [
                {
                  id: auctionState.id,
                  itemId: item?.id ?? null,
                  productName: item?.name ?? '',
                  status: auctionState.status,
                  initialValue: item?.initialValue ?? 0,
                  endsAt:
                    item?.durationSeconds != null && item.durationSeconds > 0
                      ? new Date(Date.now() + item.durationSeconds * 1000)
                      : new Date(),
                  durationSeconds: item?.durationSeconds ?? 0,
                  cardSentAt: auctionState.cardSentAt,
                  item: {
                    order: 3,
                    initialValue: item?.initialValue ?? 0,
                    imageUrl: '/api/uploads/items/frango.jpg',
                    number: 3,
                    description: 'Caipira de capoeira',
                  },
                  bids: [],
                  _count: { bids: 0 },
                },
              ]
            : [],
        ),
      ),
      update: jest.fn().mockImplementation((args: { where: { id: string }; data: { cardSentAt?: Date } }) => {
        if (args.data.cardSentAt && auctionState) {
          auctionState.cardSentAt = args.data.cardSentAt;
        }
        return Promise.resolve({ id: args.where.id, ...args.data });
      }),
      create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
        createdData = args.data;
        auctionState = { id: 'auc-new', cardSentAt: null, status: 'OPEN' };
        return Promise.resolve({ ...auctionState });
      }),
    },
  };

  const engine = new AuctionEngine(prisma as never, {} as never, {} as never);

  if (listStarted) {
    const memory: ActiveListMemory = {
      tenantId: 'tenant-1',
      groupId: '123@g.us',
      internalGroupId: 'group-internal',
      eventId: 'event-1',
      eventName: 'Leilão Teste',
      periodicStatusMinutes: 0,
      lastStatusAt: Date.now(),
      scheduledStartAt: null,
      scheduledEndAt: null,
      warnedThreeByAuction: new Map(),
      warnedEventEndsAt: null,
    };
    (engine as unknown as { listGroups: Map<string, ActiveListMemory> }).listGroups.set(
      '123@g.us',
      memory,
    );
  }

  const sent: Array<{ text: string; mediaPath?: string }> = [];
  let msgSeq = 0;
  engine.subscribe(async (_tenantId, _groupId, text, mediaPath) => {
    msgSeq += 1;
    sent.push({ text, mediaPath });
    if (failSend) throw new Error('whatsapp offline');
    return `msg-${msgSeq}`;
  });

  return {
    engine,
    prisma,
    sent,
    getCreatedData: () => createdData,
    getAuctionState: () => auctionState,
  };
}

describe('AuctionEngine.publishItemToList — item adicionado com a lista em andamento', () => {
  it('cria o leilão do item e envia SOMENTE o card dele, vinculado ao item', async () => {
    const { engine, prisma, sent, getCreatedData } = buildEngine();

    const result = await engine.publishItemToList('tenant-1', 'event-1', 'item-3');

    expect(result).toEqual({ published: true, auctionId: 'auc-new' });
    expect(prisma.auction.create).toHaveBeenCalledTimes(1);
    expect(getCreatedData()).toEqual(
      expect.objectContaining({
        tenantId: 'tenant-1',
        auctionEventId: 'event-1',
        itemId: 'item-3',
        status: 'OPEN',
        durationSeconds: 600,
        endsAt: expect.any(Date),
      }),
    );
    expect(prisma.item.update).toHaveBeenCalledWith({
      where: { id: 'item-3' },
      data: { status: 'ON_AUCTION' },
    });

    // Apenas UM card (não reenvia a lista inteira nem fotos de outros itens).
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('Frango caipira');
    expect(sent[0].text).toContain('Caipira de capoeira');
    expect(sent[0].mediaPath).toContain('frango.jpg');

    // Message ID -> Tenant -> Group -> Auction -> Item (lance via "Responder").
    expect(engine.getReplyContext('msg-1')).toEqual({
      auctionId: 'auc-new',
      itemId: 'item-3',
      itemName: 'Frango caipira',
    });

    // Publicação confirmada somente após envio bem-sucedido.
    expect(prisma.auction.update).toHaveBeenCalledWith({
      where: { id: 'auc-new' },
      data: { cardSentAt: expect.any(Date) },
    });
  });

  it('duração NULL cria leilão sem timer individual (endsAt null, sem linha de tempo)', async () => {
    const { engine, sent, getCreatedData } = buildEngine({
      item: { ...ITEM_NEW, durationSeconds: null },
    });

    const result = await engine.publishItemToList('tenant-1', 'event-1', 'item-3');

    expect(result.published).toBe(true);
    expect(getCreatedData()).toEqual(
      expect.objectContaining({ durationSeconds: 0, endsAt: null }),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].text).not.toContain('⏱️ Tempo');
  });

  it('lista ainda não iniciada: apenas persiste (skipped not_started, sem envio)', async () => {
    const { engine, prisma, sent } = buildEngine({ listStarted: false });

    const result = await engine.publishItemToList('tenant-1', 'event-1', 'item-3');

    expect(result).toEqual({ published: false, skipped: 'not_started' });
    expect(prisma.auction.create).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it('evento não aberto: não publica (event_not_open)', async () => {
    const { engine, prisma, sent } = buildEngine({ event: null });

    const result = await engine.publishItemToList('tenant-1', 'event-1', 'item-3');

    expect(result).toEqual({ published: false, skipped: 'event_not_open' });
    expect(prisma.auction.create).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it('item que não pertence ao leilão: não publica (not_eligible)', async () => {
    const { engine, prisma, sent } = buildEngine({ item: null });

    const result = await engine.publishItemToList('tenant-1', 'event-1', 'item-3');

    expect(result).toEqual({ published: false, skipped: 'not_eligible' });
    expect(prisma.auction.create).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it('item sem leilão mas não disponível (SOLD): não publica (not_eligible)', async () => {
    const { engine, prisma, sent } = buildEngine({
      item: { ...ITEM_NEW, status: 'SOLD' },
    });

    const result = await engine.publishItemToList('tenant-1', 'event-1', 'item-3');

    expect(result).toEqual({ published: false, skipped: 'not_eligible' });
    expect(prisma.auction.create).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it('idempotência: card já confirmado não é reenviado (already_published)', async () => {
    const { engine, prisma, sent } = buildEngine({
      existingAuction: { id: 'auc-old', cardSentAt: new Date(), status: 'OPEN' },
    });

    const result = await engine.publishItemToList('tenant-1', 'event-1', 'item-3');

    expect(result).toEqual({ published: false, skipped: 'already_published' });
    expect(prisma.auction.create).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it('retry após falha: reenvia o card SEM criar segundo leilão', async () => {
    const { engine, prisma, sent, getAuctionState } = buildEngine({
      existingAuction: { id: 'auc-old', cardSentAt: null, status: 'OPEN' },
    });

    const result = await engine.publishItemToList('tenant-1', 'event-1', 'item-3');

    expect(result).toEqual({ published: true, auctionId: 'auc-old' });
    expect(prisma.auction.create).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(engine.getReplyContext('msg-1')).toEqual(
      expect.objectContaining({ auctionId: 'auc-old', itemId: 'item-3' }),
    );
    expect(getAuctionState()?.cardSentAt).toBeInstanceOf(Date);
  });

  it('falha no envio: item/leilão persistem, erro sobe, sem vínculo falso de Message ID', async () => {
    const { engine, prisma, sent, getAuctionState } = buildEngine({ failSend: true });

    await expect(
      engine.publishItemToList('tenant-1', 'event-1', 'item-3'),
    ).rejects.toThrow('Falha ao publicar o item');

    // Leilão criado (item salvo permanece), mas publicação NÃO confirmada.
    expect(prisma.auction.create).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1); // tentativa registra o envio
    expect(engine.getReplyContext('msg-1')).toBeUndefined(); // sem vínculo falso
    expect(prisma.auction.update).not.toHaveBeenCalled(); // cardSentAt não marcado
    expect(getAuctionState()?.cardSentAt).toBeNull(); // segue pendente de reenvio
  });

  it('concorrência: duas publicações simultâneas criam e enviam uma única vez', async () => {
    const { engine, prisma, sent } = buildEngine();

    const [first, second] = await Promise.all([
      engine.publishItemToList('tenant-1', 'event-1', 'item-3'),
      engine.publishItemToList('tenant-1', 'event-1', 'item-3'),
    ]);

    const publishedCount = [first, second].filter((r) => r.published).length;
    expect(publishedCount).toBe(1);
    expect(
      [first, second].some((r) => r.skipped === 'already_published'),
    ).toBe(true);
    expect(prisma.auction.create).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
  });

  it('item já encerrado sem card publicado: não anuncia atrasado (not_eligible)', async () => {
    const { engine, sent } = buildEngine({
      existingAuction: { id: 'auc-old', cardSentAt: null, status: 'CLOSED' },
      item: { ...ITEM_NEW, status: 'SOLD' },
    });

    const result = await engine.publishItemToList('tenant-1', 'event-1', 'item-3');

    expect(result).toEqual({ published: false, skipped: 'not_eligible' });
    expect(sent).toHaveLength(0);
  });
});
