import { Injectable } from '@nestjs/common';
import { AuctionStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../common/database/prisma.service';

export interface AuctionReportRow {
  id: string;
  groupName: string;
  productName: string;
  status: AuctionStatus;
  initialValue: string;
  finalAmount: string | null;
  winnerName: string | null;
  winnerPhone: string | null;
  startedAt: Date;
  closedAt: Date | null;
  bidCount: number;
}

export interface ParticipantReportRow {
  participantPhone: string;
  participantName: string | null;
  bidCount: number;
  totalSpent: string;
  auctionsWon: number;
}

export interface GroupReportRow {
  groupId: string;
  groupName: string;
  auctionCount: number;
  bidCount: number;
  revenue: string;
}

/**
 * Relatórios para exportação/impressão. Tudo escopado por tenant.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async auctionReport(
    tenantId: string,
    filters: { from?: string; to?: string; groupId?: string } = {},
  ): Promise<AuctionReportRow[]> {
    const auctions = await this.prisma.auction.findMany({
      where: {
        tenantId,
        ...(filters.groupId ? { groupId: filters.groupId } : {}),
        ...(filters.from || filters.to
          ? { startedAt: { gte: filters.from ? new Date(filters.from) : undefined, lte: filters.to ? new Date(filters.to) : undefined } }
          : {}),
      },
      include: {
        group: { select: { name: true } },
        winnerBid: { select: { amount: true, participantName: true, participantPhone: true } },
        _count: { select: { bids: true } },
      },
      orderBy: { startedAt: 'desc' },
    });

    return auctions.map((a) => ({
      id: a.id,
      groupName: a.group.name,
      productName: a.productName,
      status: a.status,
      initialValue: a.initialValue.toString(),
      finalAmount: a.winnerBid?.amount.toString() ?? null,
      winnerName: a.winnerBid?.participantName ?? null,
      winnerPhone: a.winnerBid?.participantPhone ?? null,
      startedAt: a.startedAt,
      closedAt: a.closedAt,
      bidCount: a._count.bids,
    }));
  }

  async participantReport(tenantId: string): Promise<ParticipantReportRow[]> {
    const bids = await this.prisma.bid.findMany({
      where: { tenantId },
      include: {
        auction: {
          select: {
            status: true,
            winnerBidId: true,
          },
        },
      },
    });

    const byPhone = new Map<
      string,
      { participantName: string | null; bidCount: number; total: Decimal; won: number }
    >();

    for (const bid of bids) {
      const entry =
        byPhone.get(bid.participantPhone) ??
        { participantName: bid.participantName, bidCount: 0, total: new Decimal(0), won: 0 };

      entry.bidCount += 1;
      entry.total = entry.total.plus(bid.amount);
      if (bid.auction.winnerBidId === bid.id) {
        entry.won += 1;
      }
      byPhone.set(bid.participantPhone, entry);
    }

    return Array.from(byPhone.entries()).map(([participantPhone, entry]) => ({
      participantPhone,
      participantName: entry.participantName,
      bidCount: entry.bidCount,
      totalSpent: entry.total.toString(),
      auctionsWon: entry.won,
    }));
  }

  async groupReport(tenantId: string): Promise<GroupReportRow[]> {
    const groups = await this.prisma.group.findMany({
      where: { tenantId },
      include: {
        auctions: {
          include: {
            bids: { select: { amount: true } },
            winnerBid: { select: { amount: true } },
          },
        },
      },
    });

    return groups.map((group) => {
      const closedAuctions = group.auctions.filter((a) => a.status === AuctionStatus.CLOSED);
      const revenue = closedAuctions.reduce(
        (sum, a) => (a.winnerBid ? sum.plus(a.winnerBid.amount) : sum),
        new Decimal(0),
      );
      return {
        groupId: group.id,
        groupName: group.name,
        auctionCount: group.auctions.length,
        bidCount: group.auctions.reduce((sum, a) => sum + a.bids.length, 0),
        revenue: revenue.toString(),
      };
    });
  }

  /**
   * Converte uma coleção de linhas para CSV (UTF-8 com BOM para Excel).
   */
  toCsv(headers: string[], rows: readonly unknown[]): string {
    const escape = (value: unknown): string => {
      const str = value === null || value === undefined ? '' : String(value);
      return `"${str.replace(/"/g, '""')}"`;
    };

    const headerLine = headers.map(escape).join(';');
    const bodyLines = rows.map((row) =>
      headers.map((h) => escape((row as Record<string, unknown>)[h])).join(';'),
    );

    return '\uFEFF' + [headerLine, ...bodyLines].join('\r\n');
  }
}
