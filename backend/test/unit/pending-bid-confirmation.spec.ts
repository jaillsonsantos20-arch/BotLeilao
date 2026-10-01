import { BID_CONFIRMATION_TTL_MS } from '../../src/modules/whatsapp/whatsapp.constants';
import {
  confirmationQuestion,
  parseConfirmationResponse,
  PendingBidConfirmationStore,
  pendingBidConfirmationStore,
} from '../../src/modules/whatsapp/pending-bid-confirmation';
import { pendingBidContextStore } from '../../src/modules/whatsapp/pending-bid.context';

const base = {
  tenantId: 'tenant-1',
  groupId: 'group-1',
  userId: '5511999999999@c.us',
  auctionId: 'auction-1',
  itemId: 'item-1',
  itemName: 'Bolo de goma',
  itemNumber: 1,
  amount: 50,
  matchedBy: 'item_name_partial' as const,
  source: 'TEXT' as const,
};

describe('parseConfirmationResponse', () => {
  it.each([
    'sim',
    'SIM',
    'Sim.',
    's',
    '1',
    'isso',
    'confirmo',
    'pode registrar',
  ])('"%s" confirma', (text) => {
    expect(parseConfirmationResponse(text)).toEqual({ kind: 'confirm' });
  });

  it.each(['não', 'nao', 'N', '2', 'cancela', 'cancelar'])('"%s" cancela', (text) => {
    expect(parseConfirmationResponse(text)).toEqual({ kind: 'reject' });
  });

  it('rejeição com valor corrige o lance ("não, era 180")', () => {
    expect(parseConfirmationResponse('não, era 180')).toEqual({
      kind: 'correction',
      amount: 180,
    });
    expect(parseConfirmationResponse('nao 180')).toEqual({
      kind: 'correction',
      amount: 180,
    });
  });

  it('aceita valor com milhar na correção ("era 1.500")', () => {
    expect(parseConfirmationResponse('era 1.500')).toEqual({
      kind: 'correction',
      amount: 1500,
    });
  });

  it('converte número por extenso vindo do áudio ("não, era cento e oitenta")', () => {
    expect(parseConfirmationResponse('não, era cento e oitenta')).toEqual({
      kind: 'correction',
      amount: 180,
    });
  });

  it('rejeição sem valor apenas cancela', () => {
    expect(parseConfirmationResponse('não, quero pensar')).toEqual({ kind: 'reject' });
  });

  it('mensagem que não é resposta volta para o fluxo normal', () => {
    expect(parseConfirmationResponse('bolo 30')).toBeNull();
    expect(parseConfirmationResponse('')).toBeNull();
    expect(parseConfirmationResponse('bom dia')).toBeNull();
  });
});

describe('confirmationQuestion', () => {
  it('mostra valor e item para o participante confirmar', () => {
    const text = confirmationQuestion({ amount: 50, itemName: 'Bolo de goma', itemNumber: 1 });
    expect(text).toContain('50,00');
    expect(text).toContain('Bolo de goma');
    expect(text).toContain('Confirma?');
  });
});

describe('PendingBidConfirmationStore', () => {
  it('cria, lê e consome uma confirmação', () => {
    const store = new PendingBidConfirmationStore();
    const created = store.create(base);

    const peek = store.peek(base.tenantId, base.groupId, base.userId);
    expect(peek.state).toBe('pending');
    expect(store.hasActive(base.tenantId, base.groupId, base.userId)).toBe(true);

    const taken = store.take(base.tenantId, base.groupId, base.userId);
    expect(taken?.id).toBe(created.id);
    expect(store.hasActive(base.tenantId, base.groupId, base.userId)).toBe(false);
  });

  it('isola usuários e grupos (a chave é tenant:grupo:usuário)', () => {
    const store = new PendingBidConfirmationStore();
    store.create(base);

    expect(store.hasActive(base.tenantId, base.groupId, '5511888888888@c.us')).toBe(false);
    expect(store.hasActive(base.tenantId, 'group-2', base.userId)).toBe(false);
    expect(store.hasActive('tenant-2', base.groupId, base.userId)).toBe(false);
  });

  it('expira após o TTL e reporta "expired" (não registra mais)', () => {
    const store = new PendingBidConfirmationStore();
    store.create(base);

    const realNow = Date.now();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(realNow + BID_CONFIRMATION_TTL_MS + 1000);
    try {
      const peek = store.peek(base.tenantId, base.groupId, base.userId);
      expect(peek.state).toBe('expired');
      // take() em confirmação expirada não devolve nada (nunca registra)
      expect(store.take(base.tenantId, base.groupId, base.userId)).toBeNull();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('substitui a confirmação anterior (um participante = um lance pendente)', () => {
    const store = new PendingBidConfirmationStore();
    const first = store.create(base);
    const second = store.create({ ...base, amount: 90 });

    expect(second.id).not.toBe(first.id);
    const peek = store.peek(base.tenantId, base.groupId, base.userId);
    expect(peek.state === 'pending' && peek.confirmation.amount).toBe(90);
  });

  it('criar confirmação apaga o "qual item?" pendente (exclusão mútua)', () => {
    const store = new PendingBidConfirmationStore();
    pendingBidContextStore.createContext(
      base.tenantId,
      base.groupId,
      base.userId,
      25,
      [{ itemNumber: 1, itemName: 'Bolo', normalizedName: 'bolo' }],
    );
    expect(
      pendingBidContextStore.hasActiveContext(base.tenantId, base.groupId, base.userId),
    ).toBe(true);

    store.create(base);

    expect(
      pendingBidContextStore.hasActiveContext(base.tenantId, base.groupId, base.userId),
    ).toBe(false);
    expect(store.hasActive(base.tenantId, base.groupId, base.userId)).toBe(true);
  });

  it('singleton começa vazio', () => {
    pendingBidConfirmationStore.clear();
    expect(pendingBidConfirmationStore.getAllKeys()).toHaveLength(0);
  });
});
