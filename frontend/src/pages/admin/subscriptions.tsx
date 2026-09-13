import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Loader2, Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency, formatDate, toDateInputValue } from '@/lib/format';
import type {
  AdminPlan,
  AdminSubscription,
  AdminSubscriptionDetail,
  AdminSubscriptionSummary,
  ApiEnvelope,
  PaginationMeta,
} from '@/types/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';

const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Ativa' },
  { value: 'TRIAL', label: 'Trial' },
  { value: 'EXPIRED', label: 'Expirada' },
  { value: 'CANCELED', label: 'Cancelada' },
] as const;

function statusBadge(status: AdminSubscription['status']) {
  switch (status) {
    case 'ACTIVE':
      return <Badge variant="success">Ativa</Badge>;
    case 'TRIAL':
      return <Badge variant="warning">Trial</Badge>;
    case 'EXPIRED':
      return <Badge variant="destructive">Expirada</Badge>;
    case 'CANCELED':
      return <Badge variant="secondary">Cancelada</Badge>;
  }
}

function paymentStatusBadge(status: NonNullable<AdminSubscription['latestPayment']>['status']) {
  switch (status) {
    case 'PAID':
      return <Badge variant="success">Pago</Badge>;
    case 'PENDING':
      return <Badge variant="warning">Pendente</Badge>;
    case 'FAILED':
      return <Badge variant="destructive">Falhou</Badge>;
    case 'REFUNDED':
      return <Badge variant="secondary">Estornado</Badge>;
  }
}

interface Filters {
  search: string;
  status: string;
}

export function AdminSubscriptionsPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<Filters>({ search: '', status: '' });
  const [applied, setApplied] = useState<Filters>({ search: '', status: '' });
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [limit] = useState(20);

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  if (applied.search) params.set('search', applied.search);
  if (applied.status) params.set('status', applied.status);

  const { data: list, isLoading } = useQuery({
    queryKey: ['admin-subscriptions', applied, page],
    queryFn: async () => {
      const response = await api.get<ApiEnvelope<AdminSubscription[]>>(
        `/admin/subscriptions?${params.toString()}`,
      );
      return response.data;
    },
  });

  const { data: summary } = useQuery({
    queryKey: ['admin-subscriptions-summary'],
    queryFn: async () => {
      const response = await api.get<ApiEnvelope<AdminSubscriptionSummary>>(
        '/admin/subscriptions/summary',
      );
      return response.data.data;
    },
  });

  const { data: plans } = useQuery({
    queryKey: ['admin-plans'],
    queryFn: async () => {
      const response = await api.get<ApiEnvelope<AdminPlan[]>>('/admin/plans');
      return response.data.data;
    },
  });

  function applyFilters(event: FormEvent): void {
    event.preventDefault();
    setApplied(filters);
    setPage(1);
    setSelectedId(null);
  }

  function clearFilters(): void {
    setFilters({ search: '', status: '' });
    setApplied({ search: '', status: '' });
    setPage(1);
  }

  const meta: PaginationMeta | undefined = list?.meta;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assinaturas"
        description="Gestão da plataforma: acompanhe e ajuste as assinaturas dos tenants."
      />

      {summary && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <SummaryCard label="Assinaturas ativas" value={String(summary.byStatus.ACTIVE)} accent="success" />
          <SummaryCard label="Em trial" value={String(summary.byStatus.TRIAL)} accent="warning" />
          <SummaryCard label="Expiradas / canceladas" value={String(summary.byStatus.EXPIRED + summary.byStatus.CANCELED)} accent="muted" />
          <SummaryCard label="Receita (pagos)" value={formatCurrency(summary.paidRevenue)} accent="default" />
          <SummaryCard label="MRR ativo" value={formatCurrency(summary.activeMrr)} accent="default" />
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={applyFilters} className="grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="search-tenant">Buscar tenant</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="search-tenant"
                  value={filters.search}
                  onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
                  placeholder="Nome ou e-mail"
                  className="pl-9"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="status-filter">Status</Label>
              <select
                id="status-filter"
                value={filters.status}
                onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">Todos</option>
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <Button type="submit">
                <Search className="size-4" />
                Filtrar
              </Button>
              {(applied.search || applied.status) && (
                <Button type="button" variant="ghost" onClick={clearFilters}>
                  <X className="size-4" />
                  Limpar
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          ) : list && list.data.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Vigência</TableHead>
                  <TableHead>Último pagamento</TableHead>
                  <TableHead className="text-right">Criada em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.map((subscription) => (
                  <TableRow
                    key={subscription.id}
                    className="cursor-pointer"
                    onClick={() =>
                      setSelectedId(selectedId === subscription.id ? null : subscription.id)
                    }
                  >
                    <TableCell>
                      <div className="font-medium">{subscription.tenant.name}</div>
                      <div className="text-xs text-muted-foreground">{subscription.tenant.email}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{subscription.plan.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatCurrency(subscription.plan.price)}
                      </div>
                    </TableCell>
                    <TableCell>{statusBadge(subscription.status)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {subscription.status === 'TRIAL' ? (
                        <>Trial até {formatDate(subscription.trialEndsAt)}</>
                      ) : (
                        <>Vence em {formatDate(subscription.currentPeriodEnd)}</>
                      )}
                    </TableCell>
                    <TableCell>
                      {subscription.latestPayment ? (
                        <div className="flex items-center gap-2">
                          {paymentStatusBadge(subscription.latestPayment.status)}
                          <span className="text-xs text-muted-foreground">
                            {formatCurrency(subscription.latestPayment.amount)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatDate(subscription.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Nenhuma assinatura encontrada.
            </div>
          )}
        </CardContent>
      </Card>

      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Página {meta.page} de {meta.totalPages} · {meta.total} assinaturas
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            >
              <ChevronLeft className="size-4" />
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= meta.totalPages}
              onClick={() => setPage((prev) => prev + 1)}
            >
              Próxima
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {selectedId && (
        <SubscriptionDetail
          subscriptionId={selectedId}
          plans={plans ?? []}
          onClose={() => setSelectedId(null)}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: ['admin-subscriptions'] });
            void queryClient.invalidateQueries({ queryKey: ['admin-subscriptions-summary'] });
          }}
        />
      )}
    </div>
  );
}

interface SummaryCardProps {
  label: string;
  value: string;
  accent: 'default' | 'success' | 'warning' | 'muted';
}

function SummaryCard({ label, value, accent }: SummaryCardProps) {
  const accentClass = {
    default: 'text-foreground',
    success: 'text-emerald-600',
    warning: 'text-amber-600',
    muted: 'text-muted-foreground',
  }[accent];

  return (
    <Card>
      <CardHeader className="p-4">
        <CardTitle className={`text-2xl font-bold tracking-tight ${accentClass}`}>{value}</CardTitle>
        <CardDescription className="text-xs">{label}</CardDescription>
      </CardHeader>
    </Card>
  );
}

interface SubscriptionDetailProps {
  subscriptionId: string;
  plans: AdminPlan[];
  onClose: () => void;
  onSaved: () => void;
}

function SubscriptionDetail({ subscriptionId, plans, onClose, onSaved }: SubscriptionDetailProps) {
  const { data: detail, isLoading } = useQuery({
    queryKey: ['admin-subscription', subscriptionId],
    queryFn: async () => {
      const response = await api.get<ApiEnvelope<AdminSubscriptionDetail>>(
        `/admin/subscriptions/${subscriptionId}`,
      );
      return response.data.data;
    },
  });

  const [status, setStatus] = useState<AdminSubscriptionDetail['status'] | ''>('');
  const [planId, setPlanId] = useState('');
  const [trialEndsAt, setTrialEndsAt] = useState('');
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const updateMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, string> = {};
      if (status) payload.status = status;
      if (planId) payload.planId = planId;
      if (trialEndsAt) payload.trialEndsAt = new Date(`${trialEndsAt}T00:00:00`).toISOString();
      if (currentPeriodEnd) {
        payload.currentPeriodEnd = new Date(`${currentPeriodEnd}T00:00:00`).toISOString();
      }
      const response = await api.patch<ApiEnvelope<AdminSubscriptionDetail>>(
        `/admin/subscriptions/${subscriptionId}`,
        payload,
      );
      return response.data.data;
    },
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    },
    onError: (err) => setError(extractError(err)),
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="space-y-2 p-6">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!detail) return null;

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    setError(null);
    updateMutation.mutate();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            {detail.tenant.name}
            {statusBadge(detail.status)}
          </CardTitle>
          <CardDescription>
            {detail.tenant.email} · {detail.plan.name} ·{' '}
            {formatCurrency(detail.plan.price)}/mês
          </CardDescription>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar detalhes">
          <X className="size-4" />
        </Button>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <DetailItem label="Trial termina" value={formatDate(detail.trialEndsAt)} />
          <DetailItem label="Período atual vence" value={formatDate(detail.currentPeriodEnd)} />
          <DetailItem label="Cancelada em" value={formatDate(detail.canceledAt)} />
        </div>

        <form onSubmit={handleSubmit} className="grid gap-4 rounded-xl border bg-muted/30 p-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
          <div className="space-y-2">
            <Label htmlFor="detail-status">Status</Label>
            <select
              id="detail-status"
              value={status || detail.status}
              onChange={(event) => setStatus(event.target.value as AdminSubscriptionDetail['status'])}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="detail-plan">Plano</Label>
            <select
              id="detail-plan"
              value={planId || detail.planId}
              onChange={(event) => setPlanId(event.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name} · {formatCurrency(plan.price)} {plan.status === 'INACTIVE' ? '(inativo)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="detail-trial">Trial termina</Label>
            <Input
              id="detail-trial"
              type="date"
              value={trialEndsAt || toDateInputValue(detail.trialEndsAt)}
              onChange={(event) => setTrialEndsAt(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="detail-period">Período vence</Label>
            <Input
              id="detail-period"
              type="date"
              value={currentPeriodEnd || toDateInputValue(detail.currentPeriodEnd)}
              onChange={(event) => setCurrentPeriodEnd(event.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 lg:col-span-4">
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending && <Loader2 className="animate-spin" />}
              Salvar ajustes
            </Button>
            {saved && <span className="text-sm text-emerald-600">Ajustes salvos</span>}
            {error && (
              <span className="text-sm text-destructive">{error}</span>
            )}
          </div>
        </form>

        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Histórico de pagamentos
          </h3>
          {detail.payments.length > 0 ? (
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Método</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.payments.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell className="text-muted-foreground">{formatDate(payment.createdAt)}</TableCell>
                      <TableCell className="font-medium">{formatCurrency(payment.amount)}</TableCell>
                      <TableCell>{payment.method}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            payment.status === 'PAID'
                              ? 'success'
                              : payment.status === 'PENDING'
                                ? 'warning'
                                : payment.status === 'REFUNDED'
                                  ? 'secondary'
                                  : 'destructive'
                          }
                        >
                          {payment.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum pagamento registrado.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface DetailItemProps {
  label: string;
  value: string;
}

function DetailItem({ label, value }: DetailItemProps) {
  return (
    <div className="rounded-lg border bg-card/60 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function extractError(error: unknown): string {
  const err = error as { response?: { data?: { message?: string | string[] } } };
  const message = err.response?.data?.message;
  if (Array.isArray(message)) return message[0] ?? 'Falha ao salvar os ajustes.';
  return message ?? 'Falha ao salvar os ajustes.';
}