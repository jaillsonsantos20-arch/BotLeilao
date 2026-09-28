import { BadRequestException } from '@nestjs/common';
import { SessionStatus } from '@prisma/client';
import { ItemsService } from '../../src/modules/items/items.service';

function buildService() {
  const baseItem = {
    id: 'item-1',
    tenantId: 'tenant-1',
    auctionEventId: null as string | null,
    name: 'Bolo',
    initialValue: 50,
    durationSeconds: null as number | null,
    status: 'AVAILABLE',
  };

  const prisma = {
    item: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(baseItem),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockImplementation((args: { data: unknown }) => Promise.resolve(args.data)),
    },
    group: { findFirst: jest.fn() },
  };

  const auctionEventsService = { ensureOpen: jest.fn().mockResolvedValue({}) };
  const auctionsService = { startAuction: jest.fn(), placeBid: jest.fn() };
  const whatsappManager = { sessionStatus: jest.fn() };
  const engine = { launchAuction: jest.fn() };
  const planLimits = { assertCanAddItemToEvent: jest.fn().mockResolvedValue(undefined) };

  const service = new ItemsService(
    prisma as never,
    auctionsService as never,
    auctionEventsService as never,
    whatsappManager as never,
    engine as never,
    planLimits as never,
  );

  return { service, prisma, auctionEventsService, planLimits, whatsappManager, auctionsService, baseItem };
}

describe('ItemsService.create — duração opcional (NULL = sem tempo)', () => {
  it('grava durationSeconds NULL quando a duração não é informada', async () => {
    const { service, prisma } = buildService();

    await service.create('tenant-1', {
      name: 'Bolo',
      initialValue: 50,
      auctionEventId: 'event-1',
    });

    expect(prisma.item.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        durationSeconds: null,
        number: 1,
        order: 1,
      }),
    });
  });

  it('converte durationMinutes em segundos quando informado', async () => {
    const { service, prisma } = buildService();

    await service.create('tenant-1', {
      name: 'Bolo',
      initialValue: 50,
      auctionEventId: 'event-1',
      durationMinutes: 3,
    });

    expect(prisma.item.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ durationSeconds: 180 }),
    });
  });

  it('aceita durationMinutes null (trata como ausente, sem 400)', async () => {
    const { service, prisma } = buildService();

    await service.create('tenant-1', {
      name: 'Bolo',
      initialValue: 50,
      auctionEventId: 'event-1',
      durationMinutes: null,
    });

    expect(prisma.item.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ durationSeconds: null }),
    });
  });

  it('rejeita duração informada menor que 1 minuto', async () => {
    const { service } = buildService();

    await expect(
      service.create('tenant-1', {
        name: 'Bolo',
        initialValue: 50,
        auctionEventId: 'event-1',
        durationMinutes: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ItemsService.create — número do item', () => {
  it('atribui o próximo número livre e preenche números legados (backfill)', async () => {
    const { service, prisma } = buildService();
    prisma.item.findMany.mockResolvedValue([
      { id: 'i1', number: 1, order: 1 },
      { id: 'i2', number: null, order: 2 },
      { id: 'i3', number: null, order: 3 },
    ]);

    await service.create('tenant-1', {
      name: 'Novo',
      initialValue: 10,
      auctionEventId: 'event-1',
    });

    // i2 e i3 (legados sem número) receberam 2 e 3
    expect(prisma.item.update).toHaveBeenCalledWith({
      where: { id: 'i2' },
      data: { number: 2 },
    });
    expect(prisma.item.update).toHaveBeenCalledWith({
      where: { id: 'i3' },
      data: { number: 3 },
    });
    expect(prisma.item.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ number: 4, order: 4 }),
    });
  });

  it('aceita número explícito quando está livre', async () => {
    const { service, prisma } = buildService();
    prisma.item.findMany.mockResolvedValue([{ id: 'i1', number: 1, order: 1 }]);

    await service.create('tenant-1', {
      name: 'Novo',
      initialValue: 10,
      auctionEventId: 'event-1',
      number: 7,
    });

    expect(prisma.item.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ number: 7 }),
    });
  });

  it('rejeita número já usado no mesmo leilão', async () => {
    const { service, prisma } = buildService();
    prisma.item.findMany.mockResolvedValue([{ id: 'i1', number: 2, order: 1 }]);

    await expect(
      service.create('tenant-1', {
        name: 'Novo',
        initialValue: 10,
        auctionEventId: 'event-1',
        number: 2,
      }),
    ).rejects.toThrow('Já existe um item com o Nº 2');
  });

  it('sem evento (item avulso) não consulta os irmãos nem atribui número automático', async () => {
    const { service, prisma } = buildService();

    await service.create('tenant-1', { name: 'Avulso', initialValue: 10 });

    expect(prisma.item.findMany).not.toHaveBeenCalled();
    const createdData = prisma.item.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createdData.data).toEqual(
      expect.objectContaining({ number: null, durationSeconds: null }),
    );
    expect('order' in createdData.data).toBe(false);
  });
});

describe('ItemsService.update — duração e número', () => {
  it('durationMinutes null limpa a duração (NULL)', async () => {
    const { service, prisma } = buildService();

    await service.update('tenant-1', 'item-1', { durationMinutes: null });

    expect(prisma.item.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: expect.objectContaining({ durationSeconds: null }),
    });
  });

  it('durationMinutes 0 também limpa a duração (sem gravar 0)', async () => {
    const { service, prisma } = buildService();

    await service.update('tenant-1', 'item-1', { durationMinutes: 0 });

    expect(prisma.item.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: expect.objectContaining({ durationSeconds: null }),
    });
  });

  it('durationMinutes positivo vira segundos', async () => {
    const { service, prisma } = buildService();

    await service.update('tenant-1', 'item-1', { durationMinutes: 5 });

    expect(prisma.item.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: expect.objectContaining({ durationSeconds: 300 }),
    });
  });

  it('limpar o número de item de lista atribui o próximo livre (não grava null)', async () => {
    const { service, prisma } = buildService();
    prisma.item.findFirst.mockImplementation((args: { where: { number?: unknown } }) =>
      args?.where?.number !== undefined ? null : baseItemWithEvent(),
    );
    prisma.item.findMany.mockResolvedValue([
      { number: 1 },
      { number: 2 },
    ]);

    await service.update('tenant-1', 'item-1', { number: null });

    expect(prisma.item.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: expect.objectContaining({ number: 3 }),
    });
  });

  it('rejeita número duplicado na edição', async () => {
    const { service, prisma } = buildService();
    prisma.item.findFirst.mockImplementation((args: { where: { number?: unknown } }) =>
      args?.where?.number !== undefined ? { id: 'other-item' } : baseItemWithEvent(),
    );

    await expect(
      service.update('tenant-1', 'item-1', { number: 5 }),
    ).rejects.toThrow('Já existe um item com o Nº 5');
  });
});

function baseItemWithEvent() {
  return {
    id: 'item-1',
    tenantId: 'tenant-1',
    auctionEventId: 'event-1',
    name: 'Bolo',
    initialValue: 50,
    durationSeconds: null,
    status: 'AVAILABLE',
  };
}

describe('ItemsService.startAuctionOnWhatsApp — item sem duração', () => {
  it('bloqueia leilão individual quando o item não tem duração e nenhuma foi informada', async () => {
    const { service, prisma, whatsappManager, auctionsService } = buildService();
    prisma.group.findFirst.mockResolvedValue({
      id: 'group-1',
      tenantId: 'tenant-1',
      isActive: true,
      whatsappGroupId: '123@g.us',
    });
    whatsappManager.sessionStatus.mockResolvedValue({ status: SessionStatus.CONNECTED });

    await expect(
      service.startAuctionOnWhatsApp('tenant-1', 'item-1', { groupId: 'group-1' }),
    ).rejects.toThrow('não tem duração definida');
    expect(auctionsService.startAuction).not.toHaveBeenCalled();
  });

  it('aceita quando a duração é informada no start', async () => {
    const { service, prisma, whatsappManager, auctionsService } = buildService();
    prisma.group.findFirst.mockResolvedValue({
      id: 'group-1',
      tenantId: 'tenant-1',
      isActive: true,
      whatsappGroupId: '123@g.us',
    });
    whatsappManager.sessionStatus.mockResolvedValue({ status: SessionStatus.CONNECTED });
    auctionsService.startAuction.mockResolvedValue({
      id: 'auc-1',
      productName: 'Bolo',
      initialValue: 50,
      itemId: 'item-1',
      durationSeconds: 120,
      endsAt: new Date(),
    });

    await service.startAuctionOnWhatsApp('tenant-1', 'item-1', {
      groupId: 'group-1',
      durationMinutes: 2,
    });

    expect(auctionsService.startAuction).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ durationSeconds: 120 }),
    );
  });
});
