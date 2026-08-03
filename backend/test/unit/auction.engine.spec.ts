import { AuctionEngine } from '../../src/modules/whatsapp/auction.engine';
import { WHATSAPP_WARNING_FIRST_SECONDS, WHATSAPP_WARNING_SECOND_SECONDS } from '../../src/modules/whatsapp/whatsapp.constants';

function buildEngine(overrides: {
  activeAuction?: Record<string, unknown>;
  closeResult?: Record<string, unknown>;
} = {}) {
  const activeAuction = {
    id: 'auction-1',
    tenantId: 'tenant-1',
    groupId: 'group-1',
    productName: 'Produto Teste',
    endsAt: new Date(Date.now() + 100000),
    ...(overrides.activeAuction ?? {}),
  };

  const prisma = {
    auction: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: activeAuction.id,
          tenantId: activeAuction.tenantId,
          groupId: activeAuction.groupId,
          productName: activeAuction.productName,
          endsAt: activeAuction.endsAt,
          group: { whatsappGroupId: activeAuction.groupId },
        },
      ]),
    },
    group: { findFirst: jest.fn() },
  } as never;

  const closeResult = {
    id: activeAuction.id,
    initialValue: '100',
    ...(overrides.closeResult ?? {}),
  };

  const auctionsService = {
    closeAuction: jest.fn().mockResolvedValue(closeResult),
    getBids: jest.fn().mockResolvedValue({
      data: [
        {
          amount: { toString: () => '250' },
          participantName: 'Vencedor',
          participantPhone: '5511999999999',
        },
      ],
    }),
    findById: jest.fn(),
    getActiveByGroup: jest.fn(),
  } as never;

  const groupsService = {
    consumeLinkCode: jest.fn(),
  } as never;

  return { engine: new AuctionEngine(prisma, auctionsService, groupsService), activeAuction };
}

function collectMessages(engine: AuctionEngine) {
  const messages: Array<{ tenantId: string; groupId: string; text: string }> = [];
  engine.subscribe(async (tenantId, groupId, text) => {
    messages.push({ tenantId, groupId, text });
  });
  return messages;
}

describe('AuctionEngine — contagem regressiva', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('dispara DOU-LHE UMA ao cruzar 60s', async () => {
    const { engine } = buildEngine();
    const messages = collectMessages(engine);
    await engine['loadActiveAuctions']();

    const active = engine['active'].get('group-1')!;
    active.endsAt = new Date(Date.now() + (WHATSAPP_WARNING_FIRST_SECONDS - 1) * 1000);
    await engine['tick']();

    expect(messages.some((m) => m.text.includes('DOU-LHE UMA'))).toBe(true);
  });

  it('dispara DOU-LHE DUAS ao cruzar 30s', async () => {
    const { engine } = buildEngine();
    const messages = collectMessages(engine);
    await engine['loadActiveAuctions']();

    const active = engine['active'].get('group-1')!;
    active.endsAt = new Date(Date.now() + (WHATSAPP_WARNING_SECOND_SECONDS - 1) * 1000);
    await engine['tick']();

    expect(messages.some((m) => m.text.includes('DOU-LHE DUAS'))).toBe(true);
  });

  it('não repete avisos já emitidos', async () => {
    const { engine } = buildEngine();
    const messages = collectMessages(engine);
    await engine['loadActiveAuctions']();

    const active = engine['active'].get('group-1')!;
    active.endsAt = new Date(Date.now() + (WHATSAPP_WARNING_FIRST_SECONDS - 1) * 1000);
    await engine['tick']();
    await engine['tick']();

    const warnings = messages.filter((m) => m.text.includes('DOU-LHE'));
    expect(warnings).toHaveLength(1);
  });

  it('encerra o leilão quando o tempo chega a zero e anuncia o vencedor', async () => {
    const { engine } = buildEngine();
    const messages = collectMessages(engine);
    await engine['loadActiveAuctions']();

    const active = engine['active'].get('group-1')!;
    active.endsAt = new Date(Date.now() - 1000);
    await engine['tick']();

    const endMessage = messages.find((m) => m.text.includes('LEILÃO ENCERRADO'));
    expect(endMessage).toBeDefined();
    expect(endMessage!.text).toContain('Vencedor');
    expect(endMessage!.text).toContain('250');
    expect(engine['active'].has('group-1')).toBe(false);
  });

  it('recupera leilão aberto no boot (fim do prazo preservado)', async () => {
    const endsAt = new Date(Date.now() + 45000);
    const { engine } = buildEngine({
      activeAuction: { endsAt },
    });

    await engine['loadActiveAuctions']();
    const active = engine['active'].get('group-1');
    expect(active).toBeDefined();
    expect(active!.endsAt.getTime()).toBe(endsAt.getTime());
    // 45s restantes => aviso de 60s já foi consumido (não repetir), 30s ainda pendente
    expect(active!.warnedFirst).toBe(true);
    expect(active!.warnedSecond).toBe(false);
  });
});
