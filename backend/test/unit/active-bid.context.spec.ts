import {
  ActiveBidContextStore,
  ActiveBidContextInput,
} from '../../src/modules/whatsapp/active-bid.context';
import { ACTIVE_BID_CONTEXT_TTL_MS } from '../../src/modules/whatsapp/whatsapp.constants';

function input(overrides: Partial<ActiveBidContextInput> = {}): ActiveBidContextInput {
  return {
    tenantId: 'tenant-1',
    groupId: 'group-1',
    auctionId: 'auction-1',
    itemId: 'item-1',
    itemNumber: 1,
    itemName: 'Bolo de goma',
    lastBidId: 'bid-1',
    lastBidAmount: 160,
    lastBidUserId: '5511999999999@c.us',
    lastBidAt: Date.now(),
    lastBidMessageId: 'msg-1',
    ...overrides,
  };
}

describe('ActiveBidContextStore — contexto de disputa ativa', () => {
  let store: ActiveBidContextStore;

  beforeEach(() => {
    store = new ActiveBidContextStore();
  });

  it('cria e lê o contexto de um item', () => {
    store.record(input());
    const context = store.get('tenant-1', 'group-1', 'auction-1', 'item-1');
    expect(context).not.toBeNull();
    expect(context?.itemNumber).toBe(1);
    expect(context?.lastBidAmount).toBe(160);
    expect(context?.status).toBe('active');
  });

  it('isola por tenant + grupo + leilão + item', () => {
    store.record(input());

    expect(store.get('tenant-1', 'group-1', 'auction-1', 'item-1')).not.toBeNull();
    // outro grupo
    expect(store.get('tenant-1', 'group-2', 'auction-1', 'item-1')).toBeNull();
    // outro tenant
    expect(store.get('tenant-2', 'group-1', 'auction-1', 'item-1')).toBeNull();
    // outro leilão / outro item
    expect(store.get('tenant-1', 'group-1', 'auction-9', 'item-1')).toBeNull();
    expect(store.get('tenant-1', 'group-1', 'auction-1', 'item-9')).toBeNull();

    expect(store.list('tenant-1', 'group-2')).toHaveLength(0);
    expect(store.list('tenant-2', 'group-1')).toHaveLength(0);
    expect(store.list('tenant-1', 'group-1')).toHaveLength(1);
  });

  it('mantém disputas independentes por item', () => {
    store.record(input({ auctionId: 'auction-1', itemId: 'item-1', lastBidAmount: 160 }));
    store.record(
      input({
        auctionId: 'auction-2',
        itemId: 'item-2',
        itemNumber: 2,
        itemName: 'Capão 01',
        lastBidAmount: 150,
      }),
    );

    const contexts = store.list('tenant-1', 'group-1');
    expect(contexts.map((c) => c.lastBidAmount).sort((a, b) => a - b)).toEqual([150, 160]);
    expect(store.get('tenant-1', 'group-1', 'auction-2', 'item-2')?.lastBidAmount).toBe(150);
  });

  it('o segundo lance do MESMO item atualiza o contexto', () => {
    store.record(input());
    store.record(input({ lastBidAmount: 165, lastBidUserId: '55222@c.us', lastBidId: 'bid-2' }));

    const context = store.get('tenant-1', 'group-1', 'auction-1', 'item-1');
    expect(context?.lastBidAmount).toBe(165);
    expect(context?.lastBidUserId).toBe('55222@c.us');
    expect(context?.lastBidId).toBe('bid-2');
    expect(context?.createdAt).toBeLessThanOrEqual(Date.now());
  });

  it('escrita atrasada não sobrescreve o último lance registrado (concorrência)', () => {
    const now = Date.now();
    store.record(input({ lastBidAt: now, lastBidAmount: 170 }));

    // lance que terminou a transação antes chega atrasado ao contexto
    const late = store.record(input({ lastBidAt: now - 5000, lastBidAmount: 165 }));

    expect(late.lastBidAmount).toBe(170);
    expect(store.get('tenant-1', 'group-1', 'auction-1', 'item-1')?.lastBidAmount).toBe(170);
  });

  it('contexto expira após o TTL e some das listagens', () => {
    const realNow = Date.now();
    store.record(input({ lastBidAt: realNow }));

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(realNow + ACTIVE_BID_CONTEXT_TTL_MS + 1);
    try {
      expect(store.get('tenant-1', 'group-1', 'auction-1', 'item-1')).toBeNull();
      expect(store.list('tenant-1', 'group-1')).toHaveLength(0);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('renova o TTL a cada novo lance registrado', () => {
    const realNow = Date.now();
    store.record(input({ lastBidAt: realNow }));

    const half = realNow + ACTIVE_BID_CONTEXT_TTL_MS / 2;
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(half);
    try {
      store.record(input({ lastBidAt: half, lastBidAmount: 165 }));
    } finally {
      nowSpy.mockRestore();
    }

    const lateSpy = jest.spyOn(Date, 'now').mockReturnValue(realNow + ACTIVE_BID_CONTEXT_TTL_MS + 10);
    try {
      // o TTL foi renovado pelo novo lance: ainda dentro da janela
      expect(store.get('tenant-1', 'group-1', 'auction-1', 'item-1')).not.toBeNull();
    } finally {
      lateSpy.mockRestore();
    }
  });

  it('markClosed tira o item de disputa sem apagar o histórico', () => {
    store.record(input());
    const closed = store.markClosed('tenant-1', 'group-1', 'auction-1', 'item-1');

    expect(closed).toBe(1);
    expect(store.get('tenant-1', 'group-1', 'auction-1', 'item-1')).toBeNull();
    expect(store.list('tenant-1', 'group-1')).toHaveLength(0);

    // volta a ser usado apenas com um novo lance registrado
    store.record(input({ lastBidAmount: 170 }));
    expect(store.get('tenant-1', 'group-1', 'auction-1', 'item-1')?.status).toBe('active');
  });

  it('markClosed sem item encerra todos os itens do leilão', () => {
    store.record(input());
    store.record(
      input({ auctionId: 'auction-2', itemId: 'item-2', itemNumber: 2, itemName: 'Capão 01' }),
    );

    const closed = store.markClosed('tenant-1', 'group-1', 'auction-1');
    expect(closed).toBe(1);
    expect(store.list('tenant-1', 'group-1')).toHaveLength(1);
  });

  it('delete e clear limpam o estado', () => {
    store.record(input());
    expect(store.delete('tenant-1', 'group-1', 'auction-1', 'item-1')).toBe(true);
    expect(store.get('tenant-1', 'group-1', 'auction-1', 'item-1')).toBeNull();

    store.record(input());
    store.clear();
    expect(store.size).toBe(0);
    expect(store.getAllKeys()).toHaveLength(0);
  });
});
