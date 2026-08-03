import { Injectable } from '@nestjs/common';
import { AuctionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';

export interface DashboardSummary {
  activeAuctions: number;
  closedAuctions: number;
  cancelledAuctions: number;
  revenue: string;
  highestBid: string | null;
  totalProducts: number;
  totalParticipants: number;
  totalBids: number;
  totalGroups: number;
  totalUsers: number;
  totalClients: number;
}

export interface DashboardFilters {
  from?: string;
  to?: string;
  groupId?: string;
}

export interface TimeSeriesPoint {
  date: string;
  value: number;
}

/**
 * Métricas agregadas do tenant para o painel.
 * Todas as consultas são escopadas por `tenantId` (multi-tenant).
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(tenantId: string, filters: DashboardFilters = {}): Promise<DashboardSummary> {
    const whereAuction = this.buildAuctionWhere(tenantId, filters);

    const [
      activeAuctions,
      closedAuctions,
      cancelledAuctions,
      revenueAgg,
      highestBidAgg,
      totalBids,
      totalGroups,
      totalUsers,
      totalClients,
    ] = await this.prisma.$transaction([
      this.prisma.auction.count({ where: { ...whereAuction, status: AuctionStatus.OPEN } }),
      this.prisma.auction.count({ where: { ...whereAuction, status: AuctionStatus.CLOSED } }),
      this.prisma.auction.count({
        where: { ...whereAuction, status: AuctionStatus.CANCELLED },
      }),
      this.prisma.bid.aggregate({
        where: {
          tenantId,
          auction: {
            ...(filters.groupId ? { groupId: filters.groupId } : {}),
            status: AuctionStatus.CLOSED,
            ...(filters.from || filters.to
              ? { closedAt: this.dateRange(filters) }
              : {}),
          },
          isCurrentLeader: true,
        },
        _sum: { amount: true },
      }),
      this.prisma.bid.aggregate({
        where: { tenantId, isCurrentLeader: true },
        _max: { amount: true },
      }),
      this.prisma.bid.count({ where: { tenantId } }),
      this.prisma.group.count({ where: { tenantId, isActive: true } }),
      this.prisma.user.count({ where: { tenantId, isActive: true } }),
      this.prisma.user.count({ where: { tenantId } }),
    ]);

    const totalProducts = await this.prisma.auction.count({
      where: { tenantId, status: AuctionStatus.CLOSED },
    });

    const participantsAgg = await this.prisma.bid.findMany({
      where: { tenantId },
      select: { participantPhone: true },
      distinct: ['participantPhone'],
    });

    return {
      activeAuctions,
      closedAuctions,
      cancelledAuctions,
      revenue: revenueAgg._sum.amount?.toString() ?? '0',
      highestBid: highestBidAgg._max.amount?.toString() ?? null,
      totalProducts,
      totalParticipants: participantsAgg.length,
      totalBids,
      totalGroups,
      totalUsers,
      totalClients,
    };
  }

  /**
   * Leilões encerrados por dia (últimos N dias).
   */
  async auctionsOverTime(tenantId: string, days = 30): Promise<TimeSeriesPoint[]> {
    const since = new Date(Date.now() - days * 86400000);

    const result = await this.prisma.auction.groupBy({
      by: ['closedAt'],
      where: { tenantId, status: AuctionStatus.CLOSED, closedAt: { gte: since } },
      _count: { _all: true },
    });
    const rows = result as Array<{ closedAt: Date | null; _count: { _all: number } }>;

    return this.fillDateSeries(since, days, rows, (row) => {
      return row.closedAt ? this.dayKey(row.closedAt) : '';
    });
  }

  /**
   * Lances por dia (últimos N dias).
   */
  async bidsOverTime(tenantId: string, days = 30): Promise<TimeSeriesPoint[]> {
    const since = new Date(Date.now() - days * 86400000);

    const result = await this.prisma.bid.groupBy({
      by: ['createdAt'],
      where: { tenantId, createdAt: { gte: since } },
      _count: { _all: true },
    });
    const rows = result as Array<{ createdAt: Date; _count: { _all: number } }>;

    return this.fillDateSeries(since, days, rows, (row) => this.dayKey(row.createdAt));
  }

  /**
   * Top produtos por receita (valor do lance vencedor).
   */
  async topProducts(tenantId: string, limit = 5) {
    const closedAuctions = await this.prisma.auction.findMany({
      where: { tenantId, status: AuctionStatus.CLOSED, winnerBidId: { not: null } },
      include: { winnerBid: { select: { amount: true } } },
      orderBy: { closedAt: 'desc' },
      take: 1000,
    });

    const byProduct = new Map<
      string,
      { productName: string; total: Prisma.Decimal; count: number }
    >();

    for (const auction of closedAuctions) {
      if (!auction.winnerBid) continue;
      const entry =
        byProduct.get(auction.productName) ??
        { productName: auction.productName, total: new Prisma.Decimal(0), count: 0 };
      entry.total = entry.total.plus(auction.winnerBid.amount);
      entry.count += 1;
      byProduct.set(auction.productName, entry);
    }

    return Array.from(byProduct.values())
      .sort((a, b) => (b.total.gt(a.total) ? 1 : -1))
      .slice(0, limit)
      .map((entry) => ({
        productName: entry.productName,
        total: entry.total.toString(),
        count: entry.count,
      }));
  }

  private buildAuctionWhere(
    tenantId: string,
    filters: DashboardFilters,
  ): Prisma.AuctionWhereInput {
    return {
      tenantId,
      ...(filters.groupId ? { groupId: filters.groupId } : {}),
      ...(filters.from || filters.to
        ? { startedAt: this.dateRange(filters) }
        : {}),
    };
  }

  private dateRange(filters: DashboardFilters): Prisma.DateTimeFilter {
    const range: Prisma.DateTimeFilter = {};
    if (filters.from) {
      range.gte = new Date(filters.from);
    }
    if (filters.to) {
      range.lte = new Date(filters.to);
    }
    return range;
  }

  private dayKey(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private fillDateSeries<T extends { _count: { _all: number } }>(
    since: Date,
    days: number,
    rows: T[],
    keyOf: (row: T) => string,
  ): TimeSeriesPoint[] {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = keyOf(row);
      counts.set(key, (counts.get(key) ?? 0) + row._count._all);
    }

    const result: TimeSeriesPoint[] = [];
    for (let i = 0; i < days; i++) {
      const day = new Date(since.getTime() + i * 86400000);
      const key = this.dayKey(day);
      result.push({ date: key, value: counts.get(key) ?? 0 });
    }
    return result;
  }
}
