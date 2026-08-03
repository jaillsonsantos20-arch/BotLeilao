import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AuctionStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AuctionsService } from '../../src/modules/auctions/auctions.service';

function openAuction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'auction-1',
    tenantId: 'tenant-1',
    groupId: 'group-1',
    productName: 'Produto Teste',
    initialValue: new Decimal(1000),
    durationSeconds: 120,
    status: AuctionStatus.OPEN,
    startedAt: new Date(),
    endsAt: new Date(Date.now() + 120000),
    closedAt: null,
    winnerBidId: null,
    group: { tenantId: 'tenant-1' },
    ...overrides,
  };
}

function buildService(overrides: { auction?: unknown; maxBid?: Decimal | null } = {}) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'auction-1' }]),
    auction: {
      findUnique: jest.fn().mockResolvedValue(overrides.auction ?? openAuction()),
      update: jest.fn().mockImplementation(({ data }) => openAuction({ ...data, endsAt: data.endsAt ?? undefined })),
    },
    bid: {
      aggregate: jest.fn().mockResolvedValue({ _max: { amount: overrides.maxBid ?? null } }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockImplementation(({ data }) => ({
        id: 'bid-1',
        auctionId: data.auctionId,
        amount: data.amount,
        participantPhone: data.participantPhone,
        participantName: data.participantName,
        isCurrentLeader: true,
        createdAt: new Date(),
      })),
    },
  };

  const prisma = {
    $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)),
  } as never;

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as never;

  return { service: new AuctionsService(prisma, audit), tx };
}

describe('AuctionsService.placeBid', () => {
  it('registra o primeiro lance quando >= valor inicial', async () => {
    const { service, tx } = buildService({});
    const result = await service.placeBid('tenant-1', {
      auctionId: 'auction-1',
      amount: 1200,
      participantPhone: '5511999999999',
    });

    expect(result.bid.amount.toString()).toBe('1200');
    expect(tx.bid.create).toHaveBeenCalled();
    expect(tx.auction.update).toHaveBeenCalled();
  });

  it('rejeita o primeiro lance abaixo do valor inicial', async () => {
    const { service } = buildService({});
    await expect(
      service.placeBid('tenant-1', {
        auctionId: 'auction-1',
        amount: 900,
        participantPhone: '5511999999999',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita lance menor ou igual ao lance atual', async () => {
    const { service } = buildService({ maxBid: new Decimal(1500) });
    await expect(
      service.placeBid('tenant-1', {
        auctionId: 'auction-1',
        amount: 1500,
        participantPhone: '5511999999999',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('aceita lance maior que o lance atual', async () => {
    const { service } = buildService({ maxBid: new Decimal(1500) });
    const result = await service.placeBid('tenant-1', {
      auctionId: 'auction-1',
      amount: 1600,
      participantPhone: '5511999999999',
    });
    expect(result.bid.amount.toString()).toBe('1600');
  });

  it('rejeita lance em leilão encerrado', async () => {
    const { service } = buildService({
      auction: openAuction({ status: AuctionStatus.CLOSED }),
    });
    await expect(
      service.placeBid('tenant-1', {
        auctionId: 'auction-1',
        amount: 1600,
        participantPhone: '5511999999999',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lança NotFoundException quando o leilão pertence a outro tenant', async () => {
    const { service } = buildService({
      auction: openAuction({ group: { tenantId: 'tenant-2' } }),
    });
    await expect(
      service.placeBid('tenant-1', {
        auctionId: 'auction-1',
        amount: 1600,
        participantPhone: '5511999999999',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AuctionsService.startAuction', () => {
  it('rejeita valor inicial zero', async () => {
    const prisma = {} as never;
    const audit = { record: jest.fn() } as never;
    const service = new AuctionsService(prisma, audit);

    await expect(
      service.startAuction('tenant-1', {
        groupId: 'group-1',
        productName: 'Produto',
        initialValue: 0,
        durationSeconds: 120,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita duração abaixo do mínimo', async () => {
    const prisma = {} as never;
    const audit = { record: jest.fn() } as never;
    const service = new AuctionsService(prisma, audit);

    await expect(
      service.startAuction('tenant-1', {
        groupId: 'group-1',
        productName: 'Produto',
        initialValue: 100,
        durationSeconds: 5,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
