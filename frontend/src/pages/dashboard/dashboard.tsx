import { useQuery } from '@tanstack/react-query';
import {
  Award,
  Banknote,
  Package,
  Scale,
  Timer,
  Users,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/format';
import type { ApiEnvelope, DashboardSummary, TimeSeriesPoint, TopProduct } from '@/types/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/dashboard/stat-card';
import { WhatsAppCard } from '@/components/dashboard/whatsapp-card';

function useSummary() {
  return useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: async () => {
      const response = await api.get<ApiEnvelope<DashboardSummary>>('/dashboard/summary');
      return response.data.data;
    },
  });
}

function useTimeSeries(path: 'auctions-over-time' | 'bids-over-time', days = 30) {
  return useQuery({
    queryKey: ['dashboard', path, days],
    queryFn: async () => {
      const response = await api.get<ApiEnvelope<TimeSeriesPoint[]>>(`/dashboard/${path}?days=${days}`);
      return response.data.data;
    },
  });
}

function useTopProducts() {
  return useQuery({
    queryKey: ['dashboard', 'top-products'],
    queryFn: async () => {
      const response = await api.get<ApiEnvelope<TopProduct[]>>('/dashboard/top-products?limit=5');
      return response.data.data;
    },
  });
}

/**
 * Dashboard principal com cards, gráficos e ranking de produtos.
 */
export function DashboardPage() {
  const summary = useSummary();
  const auctions = useTimeSeries('auctions-over-time');
  const bids = useTimeSeries('bids-over-time');
  const topProducts = useTopProducts();

  const loading = summary.isLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Visão geral"
        description="Acompanhe o desempenho dos seus leilões em tempo real."
      />

      <WhatsAppCard />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        <StatCard
          title="Leilões ativos"
          value={String(summary.data?.activeAuctions ?? 0)}
          icon={Timer}
          tone="indigo"
          loading={loading}
        />
        <StatCard
          title="Leilões encerrados"
          value={String(summary.data?.closedAuctions ?? 0)}
          icon={Award}
          tone="sky"
          loading={loading}
        />
        <StatCard
          title="Receita"
          value={formatCurrency(summary.data?.revenue ?? '0')}
          icon={Banknote}
          tone="emerald"
          loading={loading}
        />
        <StatCard
          title="Maior lance"
          value={summary.data?.highestBid ? formatCurrency(summary.data.highestBid) : '—'}
          icon={Scale}
          tone="amber"
          loading={loading}
        />
        <StatCard
          title="Produtos"
          value={String(summary.data?.totalProducts ?? 0)}
          icon={Package}
          tone="violet"
          loading={loading}
        />
        <StatCard
          title="Participantes"
          value={String(summary.data?.totalParticipants ?? 0)}
          icon={Users}
          tone="sky"
          loading={loading}
        />
        <StatCard
          title="Grupos"
          value={String(summary.data?.totalGroups ?? 0)}
          icon={Users}
          tone="indigo"
          loading={loading}
        />
        <StatCard
          title="Lances"
          value={String(summary.data?.totalBids ?? 0)}
          icon={Scale}
          tone="rose"
          loading={loading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Leilões encerrados (30 dias)</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={auctions.data ?? []}>
                <defs>
                  <linearGradient id="colorAuctions" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="value"
                  name="Leilões"
                  stroke="var(--chart-1)"
                  fill="url(#colorAuctions)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lances (30 dias)</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bids.data ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <Tooltip />
                <Bar dataKey="value" name="Lances" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Produtos com maior receita</CardTitle>
        </CardHeader>
        <CardContent>
          {topProducts.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-8 w-full" />
              ))}
            </div>
          ) : topProducts.data?.length ? (
            <div className="space-y-3">
              {topProducts.data.map((product, index) => (
                <div key={product.productName} className="flex items-center gap-4">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-semibold text-white">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{product.productName}</p>
                    <p className="text-xs text-muted-foreground">{product.count} leilão(ões)</p>
                  </div>
                  <p className="text-sm font-semibold">{formatCurrency(product.total)}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum leilão encerrado ainda.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
