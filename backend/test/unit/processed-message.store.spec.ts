import { ProcessedMessageStore } from '../../src/modules/whatsapp/processed-message.store';

describe('ProcessedMessageStore', () => {
  it('processa a primeira vez e ignora a reentrega', () => {
    const store = new ProcessedMessageStore();
    expect(store.mark('msg-1')).toBe(true);
    expect(store.mark('msg-1')).toBe(false);
    expect(store.has('msg-1')).toBe(true);
  });

  it('sem id não há como deduplicar: segue o fluxo', () => {
    const store = new ProcessedMessageStore();
    expect(store.mark(undefined)).toBe(true);
    expect(store.mark(null)).toBe(true);
    expect(store.has(undefined)).toBe(false);
  });

  it('mensagens diferentes não interferem umas nas outras', () => {
    const store = new ProcessedMessageStore();
    expect(store.mark('msg-1')).toBe(true);
    expect(store.mark('msg-2')).toBe(true);
    expect(store.size).toBe(2);
  });

  it('registros antigos expiram (TTL) e podem ser processados de novo', () => {
    const store = new ProcessedMessageStore(1000, 100);
    expect(store.mark('msg-1')).toBe(true);

    const realNow = Date.now();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(realNow + 5000);
    try {
      expect(store.has('msg-1')).toBe(false); // já venceu o TTL
      expect(store.mark('msg-1')).toBe(true);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('respeita o teto de registros (evita crescimento sem limite)', () => {
    const store = new ProcessedMessageStore(60_000, 3);
    for (const id of ['a', 'b', 'c', 'd']) expect(store.mark(id)).toBe(true);
    expect(store.size).toBe(3);
    // o mais antigo saiu do teto → pode ser processado de novo
    expect(store.mark('a')).toBe(true);
  });

  it('clear zera o estado', () => {
    const store = new ProcessedMessageStore();
    store.mark('msg-1');
    store.clear();
    expect(store.size).toBe(0);
    expect(store.mark('msg-1')).toBe(true);
  });
});
