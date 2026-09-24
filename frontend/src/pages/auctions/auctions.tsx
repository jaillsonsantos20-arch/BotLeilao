import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronUp,
  CircleStop,
  Clock,
  FileText,
  FolderPlus,
  Gavel,
  ImagePlus,
  ListChecks,
  Loader2,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/format';
import type {
  ApiEnvelope,
  Auction,
  AuctionEvent,
  AuctionEventStatus,
  AuctionStatus,
  Group,
  Item,
  ItemStatus,
  Subscription,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/layout/page-header';
import { useAuth } from '@/stores/auth';

// E-mail com itens por lista ilimitados, independente do plano.
const UNLIMITED_ITEMS_EMAIL = 'admin@botleilao.com.br';

const ITEM_STATUS: Record<ItemStatus, { label: string; variant: 'success' | 'warning' | 'secondary' }> = {
  AVAILABLE: { label: 'Disponível', variant: 'success' },
  ON_AUCTION: { label: 'Em leilão', variant: 'warning' },
  SOLD: { label: 'Vendido', variant: 'secondary' },
};

const EVENT_STATUS: Record<AuctionEventStatus, { label: string; variant: 'warning' | 'secondary' }> = {
  OPEN: { label: 'Em andamento', variant: 'warning' },
  CLOSED: { label: 'Encerrado', variant: 'secondary' },
};

const AUCTION_STATUS: Record<AuctionStatus, { label: string; variant: 'success' | 'warning' | 'destructive' }> = {
  OPEN: { label: 'Em andamento', variant: 'warning' },
  CLOSED: { label: 'Encerrado', variant: 'success' },
  CANCELLED: { label: 'Cancelado', variant: 'destructive' },
};

const DEFAULT_ITEM_DURATION_MINUTES = 2;

function formatItemDuration(durationSeconds: number): string {
  if (durationSeconds <= 0) return 'Sem tempo';
  return durationSeconds % 60 === 0 ? `${durationSeconds / 60} min` : `${durationSeconds}s`;
}

function toTimeValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function nextOccurrenceOfTime(hours: number, minutes: number): Date {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target;
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  PIX: 'Pix',
  CASH: 'Dinheiro',
  CARD: 'Cartão',
};

const PAYMENT_METHOD_STORAGE_KEY = 'auction-payment-methods';

function loadPaymentMethods(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(PAYMENT_METHOD_STORAGE_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function useEvents() {
  return useQuery({
    queryKey: ['auction-events'],
    queryFn: async () => {
      const response = await api.get<ApiEnvelope<AuctionEvent[]>>('/auction-events');
      return response.data.data;
    },
  });
}

function useEventItems(eventId: string | null) {
  return useQuery({
    queryKey: ['auction-events', eventId, 'items'],
    enabled: !!eventId,
    queryFn: async () => {
      const response = await api.get<ApiEnvelope<Item[]>>(`/auction-events/${eventId}/items`);
      return response.data.data;
    },
  });
}

function useGroups() {
  return useQuery({
    queryKey: ['groups'],
    queryFn: async () => {
      const response = await api.get<ApiEnvelope<Group[]>>('/groups?limit=100');
      return response.data.data;
    },
  });
}

function useAuctions() {
  return useQuery({
    queryKey: ['auctions'],
    queryFn: async () => {
      const response = await api.get<ApiEnvelope<Auction[]>>('/auctions?limit=50');
      return response.data.data;
    },
  });
}

function useAllItems() {
  return useQuery({
    queryKey: ['all-items'],
    queryFn: async () => {
      const pageSize = 100;
      const items: Item[] = [];
      let page = 1;
      let totalPages = 1;
      while (page <= totalPages) {
        const response = await api.get<ApiEnvelope<Item[]>>(`/items?page=${page}&limit=${pageSize}`);
        items.push(...(response.data.data ?? []));
        totalPages = response.data.meta?.totalPages ?? 1;
        page += 1;
      }
      return items;
    },
  });
}

function useAllAuctions() {
  return useQuery({
    queryKey: ['all-auctions'],
    queryFn: async () => {
      const pageSize = 100;
      const auctions: Auction[] = [];
      let page = 1;
      let totalPages = 1;
      while (page <= totalPages) {
        const response = await api.get<ApiEnvelope<Auction[]>>(`/auctions?page=${page}&limit=${pageSize}`);
        auctions.push(...(response.data.data ?? []));
        totalPages = response.data.meta?.totalPages ?? 1;
        page += 1;
      }
      return auctions;
    },
  });
}

function useSubscription() {
  return useQuery({
    queryKey: ['subscription-current'],
    queryFn: async () => {
      const response = await api.get<ApiEnvelope<Subscription | null>>('/subscriptions/current');
      return response.data.data;
    },
  });
}

function useAuctionBids(auctionId: string | null) {
  return useQuery({
    queryKey: ['auction-bids', auctionId],
    enabled: !!auctionId,
    queryFn: async () => {
      const response = await api.get<ApiEnvelope<any[]>>(`/auctions/${auctionId}/bids`);
      return response.data.data;
    },
  });
}

function extractError(error: unknown, fallback: string): string {
  const err = error as { response?: { data?: { message?: string | string[] } } };
  const message = err.response?.data?.message;
  if (Array.isArray(message)) return message[0] ?? fallback;
  return message ?? fallback;
}

function ItemThumb({ item }: { item: Item }) {
  return item.imageUrl ? (
    <img
      src={item.imageUrl}
      alt={item.name}
      className="size-10 shrink-0 rounded-md border object-cover"
    />
  ) : (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted">
      <Package className="size-5 text-muted-foreground" />
    </div>
  );
}

export function AuctionsPage() {
  const queryClient = useQueryClient();
  const events = useEvents();
  const groups = useGroups();
  const auctions = useAuctions();
  const subscription = useSubscription();
  const { user } = useAuth();

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const eventItems = useEventItems(selectedEventId);

  // Teto de itens por lista conforme o plano (lista com 'listas_ilimitadas' é ilimitada).
  // O e-mail UNLIMITED_ITEMS_EMAIL é sempre ilimitado, independente do plano.
  const isUnlimitedUser =
    user?.email?.trim().toLowerCase() === UNLIMITED_ITEMS_EMAIL;
  const listLimit = useMemo(() => {
    if (isUnlimitedUser) return null;
    const features = subscription.data?.plan.features ?? [];
    return features.includes('listas_ilimitadas') ? null : 5;
  }, [subscription.data, isUnlimitedUser]);
  const listItemCount = eventItems.data?.length ?? 0;
  const listFull = listLimit !== null && listItemCount >= listLimit;

  const [creatingEvent, setCreatingEvent] = useState(false);
  const [eventName, setEventName] = useState('');
  const [eventDescription, setEventDescription] = useState('');
  const [eventGroupId, setEventGroupId] = useState('');
  const [eventStatusInterval, setEventStatusInterval] = useState('');
  const [eventScheduledStart, setEventScheduledStart] = useState('');
  const [eventScheduledEnd, setEventScheduledEnd] = useState('');
  const [eventMinBidStep, setEventMinBidStep] = useState('');
  const [eventFormError, setEventFormError] = useState<string | null>(null);

  const [eventError, setEventError] = useState<string | null>(null);

  const [itemName, setItemName] = useState('');
  const [itemDescription, setItemDescription] = useState('');
  const [itemValue, setItemValue] = useState('');
  const [itemDuration, setItemDuration] = useState('');
  const [itemFormError, setItemFormError] = useState<string | null>(null);

  const [listGroupId, setListGroupId] = useState('');
  const [listError, setListError] = useState<string | null>(null);

  const [scheduleTarget, setScheduleTarget] = useState<{ item: Item; auction: Auction } | null>(null);
  const [scheduleEndAt, setScheduleEndAt] = useState('');
  const [scheduleEndError, setScheduleEndError] = useState<string | null>(null);

  const [editTarget, setEditTarget] = useState<Auction | null>(null);
  const [editProductName, setEditProductName] = useState('');
  const [editInitialValue, setEditInitialValue] = useState('');
  const [editDuration, setEditDuration] = useState('');
  const [editMinBidStep, setEditMinBidStep] = useState('');
  const [editAuctionError, setEditAuctionError] = useState<string | null>(null);

  const [viewBidsTarget, setViewBidsTarget] = useState<Auction | null>(null);
  const auctionBids = useAuctionBids(viewBidsTarget?.id ?? null);

  const [editEventTarget, setEditEventTarget] = useState<any | null>(null);
  const [editEventName, setEditEventName] = useState('');
  const [editEventDescription, setEditEventDescription] = useState('');
  const [editEventMinBidStep, setEditEventMinBidStep] = useState('');
  const [editEventScheduledStart, setEditEventScheduledStart] = useState('');
  const [editEventScheduledEnd, setEditEventScheduledEnd] = useState('');
  const [editEventStatus, setEditEventStatus] = useState<'OPEN' | 'CLOSED'>('OPEN');
  const [editEventError, setEditEventError] = useState<string | null>(null);

  const [editBidTarget, setEditBidTarget] = useState<any | null>(null);
  const [editBidAmount, setEditBidAmount] = useState('');
  const [editBidName, setEditBidName] = useState('');
  const [editBidPhone, setEditBidPhone] = useState('');
  const [editBidError, setEditBidError] = useState<string | null>(null);

  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItemName, setEditingItemName] = useState('');

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['auction-events'] });
    void queryClient.invalidateQueries({ queryKey: ['groups'] });
    void queryClient.invalidateQueries({ queryKey: ['auctions'] });
    void queryClient.invalidateQueries({ queryKey: ['all-items'] });
    void queryClient.invalidateQueries({ queryKey: ['all-auctions'] });
  };

  const selectedEvent = useMemo(
    () => events.data?.find((event) => event.id === selectedEventId) ?? null,
    [events.data, selectedEventId],
  );

  const listStarted = (selectedEvent?.auctionCount ?? 0) > 0;

  const createEvent = useMutation({
    mutationFn: async () => {
      const response = await api.post<ApiEnvelope<AuctionEvent>>('/auction-events', {
        name: eventName,
        description: eventDescription || undefined,
        groupId: eventGroupId || undefined,
        periodicStatusMinutes: eventStatusInterval
          ? Math.max(0, parseInt(eventStatusInterval, 10))
          : 0,
        scheduledStartAt: eventScheduledStart
          ? new Date(eventScheduledStart).toISOString()
          : undefined,
        scheduledEndAt: eventScheduledEnd ? new Date(eventScheduledEnd).toISOString() : undefined,
        minBidStep: eventMinBidStep.trim()
          ? Math.max(0, parseFloat(eventMinBidStep.replace(',', '.')))
          : undefined,
      });
      return response.data.data;
    },
    onSuccess: (event) => {
      invalidate();
      setCreatingEvent(false);
      setEventName('');
      setEventDescription('');
      setEventGroupId('');
      setEventStatusInterval('');
      setEventScheduledStart('');
      setEventScheduledEnd('');
      setEventMinBidStep('');
      setEventFormError(null);
      setSelectedEventId(event.id);
      setListGroupId(event.groupId ?? '');
    },
    onError: (err) => setEventFormError(extractError(err, 'Falha ao criar o leilão.')),
  });

  const closeEvent = useMutation({
    mutationFn: async (eventId: string) => {
      await api.post(`/auction-events/${eventId}/close`);
    },
    onSuccess: () => invalidate(),
    onError: (err) => setEventError(extractError(err, 'Falha ao encerrar o leilão.')),
  });

  const startList = useMutation({
    mutationFn: async (params: { eventId: string; groupId: string }) => {
      const response = await api.post<ApiEnvelope<{ itemCount: number }>>(
        `/auction-events/${params.eventId}/start`,
        { groupId: params.groupId },
      );
      return response.data.data;
    },
    onSuccess: () => {
      invalidate();
      setListError(null);
    },
    onError: (err) => setListError(extractError(err, 'Falha ao iniciar a lista no grupo.')),
  });

  const closeListItem = useMutation({
    mutationFn: async (params: { eventId: string; auctionId: string }) => {
      const response = await api.post<ApiEnvelope<{ itemName: string }>>(
        `/auction-events/${params.eventId}/items/${params.auctionId}/close`,
      );
      return response.data.data;
    },
    onSuccess: () => invalidate(),
    onError: (err) =>
      setListError(extractError(err, 'Falha ao encerrar o item.')),
  });

  const scheduleItemEnd = useMutation({
    mutationFn: async (params: { eventId: string; auctionId: string; endsAt: string | null }) => {
      const response = await api.post<ApiEnvelope<{ itemName: string }>>(
        `/auction-events/${params.eventId}/items/${params.auctionId}/schedule-end`,
        { endsAt: params.endsAt },
      );
      return response.data.data;
    },
    onSuccess: () => {
      invalidate();
      setScheduleTarget(null);
      setScheduleEndAt('');
      setScheduleEndError(null);
    },
    onError: (err) =>
      setScheduleEndError(extractError(err, 'Falha ao agendar o encerramento.')),
  });

  const removeEvent = useMutation({
    mutationFn: async (eventId: string) => {
      await api.delete(`/auction-events/${eventId}`);
    },
    onSuccess: () => {
      setSelectedEventId(null);
      invalidate();
    },
    onError: (err) => setEventError(extractError(err, 'Falha ao excluir o leilão.')),
  });

  const createItem = useMutation({
    mutationFn: async () => {
      if (!selectedEventId) throw new Error('Selecione um leilão.');
      const response = await api.post<ApiEnvelope<Item>>('/items', {
        auctionEventId: selectedEventId,
        name: itemName,
        description: itemDescription || undefined,
        initialValue: parseFloat(itemValue),
        durationMinutes: itemDuration.trim()
          ? Math.max(1, parseInt(itemDuration, 10) || DEFAULT_ITEM_DURATION_MINUTES)
          : undefined,
      });
      return response.data.data;
    },
    onSuccess: () => {
      invalidate();
      setItemName('');
      setItemDescription('');
      setItemValue('');
      setItemDuration('');
      setItemFormError(null);
    },
    onError: (err) => setItemFormError(extractError(err, 'Falha ao cadastrar o item.')),
  });

  const removeItem = useMutation({
    mutationFn: async (itemId: string) => {
      await api.delete(`/items/${itemId}`);
    },
    onSuccess: () => invalidate(),
    onError: (err) => setItemFormError(extractError(err, 'Falha ao excluir o item.')),
  });

  const clearHistory = useMutation({
    mutationFn: async () => {
      await api.delete('/auctions');
    },
    onSuccess: () => invalidate(),
  });

  const updatePaymentStatus = useMutation({
    mutationFn: async ({
      auctionId,
      status,
    }: {
      auctionId: string;
      status: 'PENDING' | 'PAID';
    }) => {
      await api.patch(`/auctions/${auctionId}/payment-status`, { status });
    },
    onSuccess: () => invalidate(),
    onError: (err) =>
      setEventError(extractError(err, 'Falha ao atualizar o status de pagamento.')),
  });

  const updateAuction = useMutation({
    mutationFn: async () => {
      if (!editTarget) throw new Error('Selecione um leilão para editar.');
      const data: Record<string, unknown> = {};
      if (editProductName.trim()) data.productName = editProductName.trim();
      if (editInitialValue.trim()) data.initialValue = parseFloat(editInitialValue.replace(',', '.'));
      if (editDuration.trim() && parseInt(editDuration, 10) > 0) data.durationSeconds = parseInt(editDuration, 10) * 60;
      if (editMinBidStep.trim()) data.minBidStep = parseFloat(editMinBidStep.replace(',', '.'));
      await api.patch(`/auctions/${editTarget.id}`, data);
    },
    onSuccess: () => {
      invalidate();
      setEditTarget(null);
      setEditAuctionError(null);
    },
    onError: (err) => setEditAuctionError(extractError(err, 'Falha ao atualizar o leilão.')),
  });

  const updateBid = useMutation({
    mutationFn: async () => {
      if (!editBidTarget) throw new Error('Selecione um lance para editar.');
      const data: Record<string, unknown> = { amount: parseFloat(editBidAmount.replace(',', '.')) };
      if (editBidName.trim()) data.participantName = editBidName.trim();
      if (editBidPhone.trim()) data.participantPhone = editBidPhone.trim();
      await api.patch(`/bids/${editBidTarget.id}`, data);
    },
    onSuccess: () => {
      invalidate();
      setEditBidTarget(null);
      setEditBidError(null);
    },
    onError: (err) => setEditBidError(extractError(err, 'Falha ao atualizar o lance.')),
  });

  const updateEvent = useMutation({
    mutationFn: async () => {
      if (!editEventTarget) throw new Error('Selecione um leilão para editar.');
      const data: Record<string, unknown> = {};
      if (editEventName.trim()) data.name = editEventName.trim();
      if (editEventDescription.trim()) data.description = editEventDescription.trim();
      if (editEventMinBidStep.trim()) data.minBidStep = parseFloat(editEventMinBidStep.replace(',', '.'));
      else data.minBidStep = null;
      data.scheduledStartAt = editEventScheduledStart || null;
      data.scheduledEndAt = editEventScheduledEnd || null;
      data.status = editEventStatus;
      await api.patch(`/auction-events/${editEventTarget.id}`, data);
    },
    onSuccess: () => {
      invalidate();
      setEditEventTarget(null);
      setEditEventError(null);
    },
    onError: (err) => setEditEventError(extractError(err, 'Falha ao atualizar o leilão.')),
  });

  const updateItem = useMutation({
    mutationFn: async (params: { itemId: string; name: string }) => {
      await api.patch(`/items/${params.itemId}`, { name: params.name });
    },
    onSuccess: () => invalidate(),
  });

  const removeBid = useMutation({
    mutationFn: async (bidId: string) => {
      await api.delete(`/bids/${bidId}`);
    },
    onSuccess: () => {
      invalidate();
      if (viewBidsTarget) {
        void queryClient.invalidateQueries({ queryKey: ['auction-bids', viewBidsTarget.id] });
      }
    },
  });

  function handleCreateEvent(event: FormEvent): void {
    event.preventDefault();
    createEvent.mutate();
  }

  function handleCreateItem(event: FormEvent): void {
    event.preventDefault();
    createItem.mutate();
  }

  const canLeilao = groups.data && groups.data.length > 0;

  const allItems = useAllItems();
  const allAuctions = useAllAuctions();

  const itemResultByItem = useMemo(() => {
    const map = new Map<string, Auction>();
    for (const auction of allAuctions.data ?? []) {
      if (auction.itemId && auction.status === 'CLOSED' && auction.winnerBid) {
        const current = map.get(auction.itemId);
        if (!current || new Date(auction.startedAt) > new Date(current.startedAt)) {
          map.set(auction.itemId, auction);
        }
      }
    }
    return map;
  }, [allAuctions.data]);

  const openAuctionByItem = useMemo(() => {
    const map = new Map<string, Auction>();
    for (const auction of allAuctions.data ?? []) {
      if (auction.status === 'OPEN' && auction.itemId && auction.auctionEventId === selectedEventId) {
        map.set(auction.itemId, auction);
      }
    }
    return map;
  }, [allAuctions.data, selectedEventId]);

  const selectedEventGroup = useMemo(
    () => (selectedEvent ? groups.data?.find((g) => g.id === selectedEvent.groupId) ?? null : null),
    [selectedEvent, groups.data],
  );

  const [reportOpen, setReportOpen] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [reportGenerated, setReportGenerated] = useState(false);
  const [reportPaymentFilter, setReportPaymentFilter] = useState<'ALL' | 'PENDING' | 'PAID'>('ALL');

  const [paymentMethods, setPaymentMethods] = useState<Record<string, string>>(loadPaymentMethods);

  const setPaymentMethod = (auctionId: string, method: string) => {
    setPaymentMethods((prev) => {
      const next = { ...prev, [auctionId]: method };
      localStorage.setItem(PAYMENT_METHOD_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const openReport = () => {
    setSelectedItemIds([]);
    setReportGenerated(false);
    setReportPaymentFilter('ALL');
    setReportOpen(true);
  };

  const closeReport = () => {
    setReportOpen(false);
    setSelectedItemIds([]);
    setReportGenerated(false);
    setReportPaymentFilter('ALL');
  };

  const toggleItem = (itemId: string, checked: boolean) => {
    setSelectedItemIds((prev) =>
      checked ? [...prev, itemId] : prev.filter((id) => id !== itemId),
    );
  };

  const toggleEventItems = (eventId: string, checked: boolean) => {
    const ids = (allItems.data ?? [])
      .filter((item) => item.auctionEventId === eventId)
      .map((item) => item.id);
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (checked) ids.forEach((id) => next.add(id));
      else ids.forEach((id) => next.delete(id));
      return Array.from(next);
    });
  };

  const selectAllReport = (checked: boolean) => {
    setSelectedItemIds(checked ? (allItems.data ?? []).map((item) => item.id) : []);
  };

  const selectedItems = useMemo(
    () => (allItems.data ?? []).filter((item) => selectedItemIds.includes(item.id)),
    [allItems.data, selectedItemIds],
  );

  const reportRows = useMemo(
    () =>
      selectedItems.map((item) => ({
        item,
        auction: itemResultByItem.get(item.id) ?? null,
      })),
    [selectedItems, itemResultByItem],
  );

  const filteredReportRows = useMemo(
    () =>
      reportPaymentFilter === 'ALL'
        ? reportRows
        : reportRows.filter((row) => row.auction?.paymentStatus === reportPaymentFilter),
    [reportRows, reportPaymentFilter],
  );

  const filteredReportTotal = useMemo(
    () =>
      filteredReportRows.reduce(
        (sum, row) => sum + (row.auction ? Number(row.auction.winnerBid?.amount ?? 0) : 0),
        0,
      ),
    [filteredReportRows],
  );

  const [historyStatus, setHistoryStatus] = useState<AuctionStatus | 'ALL'>('ALL');
  const [historyFrom, setHistoryFrom] = useState('');
  const [historyTo, setHistoryTo] = useState('');

  const filteredAuctions = useMemo(() => {
    const from = historyFrom ? new Date(`${historyFrom}T00:00:00`) : null;
    const to = historyTo ? new Date(`${historyTo}T23:59:59`) : null;
    return (auctions.data ?? []).filter((auction) => {
      if (historyStatus !== 'ALL' && auction.status !== historyStatus) return false;
      const startedAt = new Date(auction.startedAt);
      if (from && startedAt < from) return false;
      if (to && startedAt > to) return false;
      return true;
    });
  }, [auctions.data, historyStatus, historyFrom, historyTo]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leilões"
        description={'Crie um leilão (ex.: "Leilão da Igreja"), cadastre os itens e inicie no WhatsApp.'}
        actions={
          <>
            <Button variant="outline" onClick={openReport}>
              <FileText className="size-4" />
              Relatório
            </Button>
            <Button data-tour-target="new-event" onClick={() => setCreatingEvent((prev) => !prev)}>
              {creatingEvent ? <X className="size-4" /> : <Plus className="size-4" />}
              {creatingEvent ? 'Cancelar' : 'Criar novo leilão'}
            </Button>
          </>
        }
      />

      {creatingEvent && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderPlus className="size-5" />
              Criar leilão
            </CardTitle>
            <CardDescription>
              Um leilão agrupa os itens de um evento, por exemplo "Leilão da Igreja".
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateEvent} className="grid gap-4">
              <div className="space-y-2">
                <Label htmlFor="event-name">Nome do leilão</Label>
                <Input
                  id="event-name"
                  value={eventName}
                  onChange={(event) => setEventName(event.target.value)}
                  placeholder="Ex.: Leilão da Igreja"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="event-description">Descrição (opcional)</Label>
                <Textarea
                  id="event-description"
                  value={eventDescription}
                  onChange={(event) => setEventDescription(event.target.value)}
                  placeholder="Renda para a festa de São João"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="event-group">Grupo do WhatsApp</Label>
                  <select
                    id="event-group"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={eventGroupId}
                    onChange={(event) => setEventGroupId(event.target.value)}
                  >
                    <option value="">Definir depois</option>
                    {groups.data?.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                        {group.openAuction ? ' (com leilão ativo)' : ''}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Grupo onde o bot abrirá a lista de itens quando você iniciar.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="event-interval">Status automático (minutos)</Label>
                  <Input
                    id="event-interval"
                    type="number"
                    min="0"
                    step="1"
                    value={eventStatusInterval}
                    onChange={(event) => setEventStatusInterval(event.target.value)}
                    placeholder="0 = só via !status"
                  />
                  <p className="text-xs text-muted-foreground">
                    O bot reenvia a lista de itens a cada X minutos. Deixe 0 para
                    enviar somente quando pedirem *!status*.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="event-min-bid-step">Incremento mínimo de lance (R$)</Label>
                  <Input
                    id="event-min-bid-step"
                    type="number"
                    min="0"
                    step="0.01"
                    value={eventMinBidStep}
                    onChange={(event) => setEventMinBidStep(event.target.value)}
                    placeholder="Ex.: 1,00"
                  />
                  <p className="text-xs text-muted-foreground">
                    Valor mínimo de acréscimo por lance. Ex.: lance atual R$ 50,00
                    com incremento de R$ 1,00 — o próximo lance precisa ser no
                    mínimo R$ 51,00 (50,50 não é aceito). Deixe vazio para aceitar
                    qualquer lance maior.
                  </p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="event-scheduled-start">Início automático (opcional)</Label>
                  <Input
                    id="event-scheduled-start"
                    type="datetime-local"
                    value={eventScheduledStart}
                    onChange={(event) => setEventScheduledStart(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Neste horário o bot abre a lista de itens no grupo
                    automaticamente.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="event-scheduled-end">Término automático (opcional)</Label>
                  <Input
                    id="event-scheduled-end"
                    type="datetime-local"
                    value={eventScheduledEnd}
                    onChange={(event) => setEventScheduledEnd(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Neste horário o leilão é encerrado automaticamente (3 min
                    antes o bot avisa no grupo).
                  </p>
                </div>
              </div>
              <div>
                <Button type="submit" disabled={createEvent.isPending}>
                  {createEvent.isPending && <Loader2 className="animate-spin" />}
                  Criar leilão
                </Button>
              </div>
            </form>
            {eventFormError && (
              <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {eventFormError}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <div>
        <h3 className="mb-3 text-lg font-semibold">Meus leilões</h3>
        {events.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : events.data && events.data.length > 0 ? (
          <div className="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Leilão</TableHead>
                  <TableHead className="text-center">Itens</TableHead>
                  <TableHead className="text-center">Leilões realizados</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.data.map((event) => {
                  const status = EVENT_STATUS[event.status];
                  const expanded = event.id === selectedEventId;
                  return (
                    <TableRow
                      key={event.id}
                      className={expanded ? 'bg-accent/40' : ''}
                    >
                      <TableCell>
                        <div className="font-medium">{event.name}</div>
                        {event.description && (
                          <div className="max-w-xs truncate text-xs text-muted-foreground">
                            {event.description}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground">
                        {event.itemCount}
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground">
                        {event.auctionCount}
                      </TableCell>
                      <TableCell>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant={expanded ? 'secondary' : 'outline'}
                            onClick={() => {
                              if (expanded) {
                                setSelectedEventId(null);
                              } else {
                                setSelectedEventId(event.id);
                                setListGroupId(event.groupId ?? '');
                                setListError(null);
                              }
                            }}
                          >
                            {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                            {expanded ? 'Fechar' : 'Abrir'}
                          </Button>
                          {event.status === 'OPEN' && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={closeEvent.isPending}
                              onClick={() => {
                                if (window.confirm(`Encerrar o leilão "${event.name}"?`)) {
                                  closeEvent.mutate(event.id);
                                }
                              }}
                            >
                              Encerrar
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={removeEvent.isPending}
                            title="Excluir leilão"
                            onClick={() => {
                              if (window.confirm(`Excluir o leilão "${event.name}"?`)) {
                                removeEvent.mutate(event.id);
                              }
                            }}
                          >
                            {removeEvent.isPending ? (
                              <Loader2 className="size-4 animate-spin text-destructive" />
                            ) : (
                              <Trash2 className="size-4 text-destructive" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Nenhum leilão criado ainda. Use "Criar novo leilão" para começar.
            </CardContent>
          </Card>
        )}
        {eventError && (
          <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {eventError}
          </p>
        )}
      </div>

      {selectedEvent && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Gavel className="size-5" />
                  {selectedEvent.name}
                  <Badge variant={EVENT_STATUS[selectedEvent.status].variant}>
                    {EVENT_STATUS[selectedEvent.status].label}
                  </Badge>
                </CardTitle>
                {selectedEvent.description && (
                  <CardDescription>{selectedEvent.description}</CardDescription>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditEventTarget(selectedEvent);
                    setEditEventName(selectedEvent.name);
                    setEditEventDescription(selectedEvent.description ?? '');
                    setEditEventMinBidStep(selectedEvent.minBidStep ? String(Number(selectedEvent.minBidStep)) : '');
                    setEditEventScheduledStart(selectedEvent.scheduledStartAt ?? '');
                    setEditEventScheduledEnd(selectedEvent.scheduledEndAt ?? '');
                    setEditEventStatus(selectedEvent.status);
                    setEditEventError(null);
                  }}
                >
                  Editar
                </Button>
                <Button variant="outline" size="sm" onClick={() => setSelectedEventId(null)}>
                  Fechar
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-md border p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="flex items-center gap-2 font-medium">
                    <ListChecks className="size-4" />
                    {listStarted ? 'Atualizar lista no grupo' : 'Iniciar lista no grupo'}
                  </h4>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {listStarted
                      ? 'A lista já está em andamento no WhatsApp. Cadastre novos itens e clique em "Atualizar Lista" para reenviar a lista atualizada — os lances já feitos são mantidos.'
                      : 'Abre um leilão simultâneo por item. Os participantes dão lances como 01 - 22,00. Se um status periódico foi definido, o bot reenvia a lista automaticamente.'}
                  </p>
                </div>
                {selectedEvent.periodicStatusMinutes ? (
                  <Badge variant="outline">
                    Status a cada {selectedEvent.periodicStatusMinutes} min
                  </Badge>
                ) : (
                  <Badge variant="outline">Status sob demanda (!status)</Badge>
                )}
                {selectedEvent.minBidStep && (
                  <Badge variant="outline">
                    Incremento: {formatCurrency(selectedEvent.minBidStep)}
                  </Badge>
                )}
                {selectedEvent.scheduledStartAt && (
                  <Badge variant="outline">
                    Início: {formatDate(selectedEvent.scheduledStartAt)}
                  </Badge>
                )}
                {selectedEvent.scheduledEndAt && (
                  <Badge variant="outline">
                    Término: {formatDate(selectedEvent.scheduledEndAt)}
                  </Badge>
                )}
              </div>
              {!canLeilao ? (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  Nenhum grupo vinculado. Vá em Grupos e vincule um grupo do WhatsApp
                  antes de iniciar uma lista.
                </p>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!selectedEventId) return;
                    if (!listStarted && !listGroupId) {
                      setListError('Selecione um grupo para abrir a lista.');
                      return;
                    }
                    startList.mutate({
                      eventId: selectedEventId,
                      groupId: listStarted
                        ? listGroupId || selectedEvent.groupId || ''
                        : listGroupId,
                    });
                  }}
                  className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end"
                >
                  <div className="space-y-2">
                    <Label htmlFor="list-group">Grupo do WhatsApp</Label>
                    <select
                      id="list-group"
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                      value={listGroupId}
                      onChange={(event) => setListGroupId(event.target.value)}
                      disabled={listStarted}
                    >
                      <option value="" disabled>
                        Selecione um grupo
                      </option>
                      {groups.data?.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                          {group.openAuction ? ' (com leilão ativo)' : ''}
                        </option>
                      ))}
                    </select>
                    {listStarted && (
                      <p className="text-xs text-muted-foreground">
                        A lista já está vinculada a um grupo do WhatsApp.
                      </p>
                    )}
                  </div>
                  <Button
                    data-tour-target="start-list"
                    type="submit"
                    disabled={
                      startList.isPending ||
                      selectedEvent.status === 'CLOSED' ||
                      (selectedEvent.itemCount ?? 0) === 0 ||
                      (!listStarted &&
                        !!listGroupId &&
                        !groups.data?.some((g) => g.id === listGroupId && !g.openAuction))
                    }
                  >
                    {startList.isPending ? (
                      <Loader2 className="animate-spin" />
                    ) : listStarted ? (
                      <RefreshCw className="size-4" />
                    ) : (
                      <ListChecks className="size-4" />
                    )}
                    {startList.isPending
                      ? listStarted
                        ? 'Atualizando...'
                        : 'Abrindo...'
                      : listStarted
                        ? 'Atualizar Lista'
                        : 'Iniciar lista'}
                  </Button>
                </form>
              )}
              {selectedEventGroup && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Grupo configurado neste leilão: <strong>{selectedEventGroup.name}</strong>
                  {selectedEventGroup.openAuction ? ' (com leilão ativo)' : ''}
                </p>
              )}
              {listError && (
                <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {listError}
                </p>
              )}
            </div>

            <div className="rounded-md border p-4" data-tour-target="new-item">
              <h4 className="mb-3 flex items-center gap-2 font-medium">
                <ImagePlus className="size-4" />
                Cadastrar item neste leilão
                {listLimit !== null && (
                  <Badge variant={listFull ? 'warning' : 'secondary'}>
                    {listItemCount}/{listLimit} no seu plano
                  </Badge>
                )}
              </h4>
              {listFull && (
                <p className="mb-3 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
                  Limite do seu plano: máximo {listLimit} itens por lista. Exclua um item
                  ou faça upgrade de plano para listas ilimitadas.
                </p>
              )}
              <form onSubmit={handleCreateItem} className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="item-name">Nome do item</Label>
                  <Input
                    id="item-name"
                    value={itemName}
                    onChange={(event) => setItemName(event.target.value)}
                    placeholder="Ex.: Frango assado"
                    required
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="item-description">Descrição (opcional)</Label>
                  <Textarea
                    id="item-description"
                    value={itemDescription}
                    onChange={(event) => setItemDescription(event.target.value)}
                    placeholder="Detalhes do produto"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="item-value">Valor inicial (R$)</Label>
                  <Input
                    id="item-value"
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={itemValue}
                    onChange={(event) => setItemValue(event.target.value)}
                    placeholder="100"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="item-duration">Duração do item (minutos)</Label>
                  <Input
                    id="item-duration"
                    type="number"
                    min="1"
                    max="1440"
                    step="1"
                    value={itemDuration}
                    onChange={(event) => setItemDuration(event.target.value)}
                    placeholder="2"
                  />
                  <p className="text-xs text-muted-foreground">
                    Opcional. Tempo de cada item na lista, em minutos. O bot
                    encerra o item quando o tempo esgota e avisa no grupo 3
                    minutos antes (se a duração for maior que 3 minutos).
                    Deixe vazio para o item ficar aberto até encerrar
                    manualmente pelo painel.
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <Button type="submit" disabled={createItem.isPending || listFull}>
                    {createItem.isPending && <Loader2 className="animate-spin" />}
                    Salvar item
                  </Button>
                </div>
              </form>
              {itemFormError && (
                <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {itemFormError}
                </p>
              )}
            </div>

            <div>
              <h4 className="mb-3 font-medium">Itens deste leilão</h4>
              {eventItems.isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 2 }).map((_, index) => (
                    <Skeleton key={index} className="h-12 w-full" />
                  ))}
                </div>
              ) : eventItems.data && eventItems.data.length > 0 ? (
                <div className="overflow-hidden rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Valor inicial</TableHead>
                        <TableHead className="text-right">Duração</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {eventItems.data.map((item) => {
                        const status = ITEM_STATUS[item.status];
                        return (
                          <TableRow key={item.id}>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <ItemThumb item={item} />
                                <div>
                                  {editingItemId === item.id ? (
                                    <div className="flex items-center gap-1">
                                      <Input
                                        className="h-7 w-48 text-sm"
                                        value={editingItemName}
                                        onChange={(e) => setEditingItemName(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' && editingItemName.trim()) {
                                            updateItem.mutate({ itemId: item.id, name: editingItemName.trim() });
                                            setEditingItemId(null);
                                          }
                                          if (e.key === 'Escape') setEditingItemId(null);
                                        }}
                                        autoFocus
                                      />
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 px-2"
                                        onClick={() => {
                                          if (editingItemName.trim()) {
                                            updateItem.mutate({ itemId: item.id, name: editingItemName.trim() });
                                            setEditingItemId(null);
                                          }
                                        }}
                                      >
                                        OK
                                      </Button>
                                    </div>
                                  ) : (
                                    <div
                                      className="group flex cursor-pointer items-center gap-1"
                                      onClick={() => {
                                        setEditingItemId(item.id);
                                        setEditingItemName(item.name);
                                      }}
                                    >
                                      <span className="font-medium">{item.name}</span>
                                      <Pencil className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                                    </div>
                                  )}
                                  {item.description && (
                                    <div className="max-w-xs truncate text-xs text-muted-foreground">
                                      {item.description}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {formatCurrency(item.initialValue)}
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground">
                              <div>
                                {formatItemDuration(item.durationSeconds)}
                                {openAuctionByItem.get(item.id)?.scheduledEndAt && (
                                  <div className="text-xs text-amber-600">
                                    Encerra {formatDate(openAuctionByItem.get(item.id)!.scheduledEndAt)}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant={status.variant}>{status.label}</Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={
                                    !openAuctionByItem.get(item.id) ||
                                    selectedEvent.status === 'CLOSED' ||
                                    closeListItem.isPending
                                  }
                                  onClick={() => {
                                    const auction = openAuctionByItem.get(item.id);
                                    if (
                                      auction &&
                                      window.confirm(
                                        `Encerrar o item "${item.name}" e fixar o vencedor?`,
                                      )
                                    ) {
                                      closeListItem.mutate({
                                        eventId: selectedEventId!,
                                        auctionId: auction.id,
                                      });
                                    }
                                  }}
                                  title={
                                    openAuctionByItem.get(item.id)
                                      ? 'Encerra apenas este item da lista'
                                      : 'Este item ainda não está em leilão'
                                  }
                                >
                                  <CircleStop className="size-4" />
                                  Encerrar
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={
                                    !openAuctionByItem.get(item.id) ||
                                    selectedEvent.status === 'CLOSED' ||
                                    scheduleItemEnd.isPending
                                  }
                                  onClick={() => {
                                    const auction = openAuctionByItem.get(item.id);
                                    if (!auction) return;
                                    setScheduleEndAt(
                                      auction.scheduledEndAt
                                        ? toTimeValue(new Date(auction.scheduledEndAt))
                                        : '',
                                    );
                                    setScheduleEndError(null);
                                    setScheduleTarget({ item, auction });
                                  }}
                                  title={
                                    openAuctionByItem.get(item.id)
                                      ? 'Agenda o horário em que este item será encerrado e avisa no grupo'
                                      : 'Este item ainda não está em leilão'
                                  }
                                >
                                  <Clock className="size-4" />
                                  {openAuctionByItem.get(item.id)?.scheduledEndAt ? 'Reagendar' : 'Agendar fim'}
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  disabled={removeItem.isPending}
                                  onClick={() => {
                                    if (window.confirm(`Excluir o item "${item.name}"?`)) {
                                      removeItem.mutate(item.id);
                                    }
                                  }}
                                >
                                  {removeItem.isPending ? (
                                    <Loader2 className="size-4 animate-spin text-destructive" />
                                  ) : (
                                    <Trash2 className="size-4 text-destructive" />
                                  )}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
                  Nenhum item cadastrado neste leilão ainda.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Histórico de leilões</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Filtrar por status"
                className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={historyStatus}
                onChange={(event) => setHistoryStatus(event.target.value as AuctionStatus | 'ALL')}
              >
                <option value="ALL">Todos os status</option>
                <option value="OPEN">Em andamento</option>
                <option value="CLOSED">Encerrado</option>
                <option value="CANCELLED">Cancelado</option>
              </select>
              <input
                aria-label="Data inicial"
                type="date"
                value={historyFrom}
                onChange={(event) => setHistoryFrom(event.target.value)}
                className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <input
                aria-label="Data final"
                type="date"
                value={historyTo}
                onChange={(event) => setHistoryTo(event.target.value)}
                className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              {(historyFrom || historyTo || historyStatus !== 'ALL') && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setHistoryFrom('');
                    setHistoryTo('');
                    setHistoryStatus('ALL');
                  }}
                >
                  Limpar
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={clearHistory.isPending || (auctions.data?.length ?? 0) === 0}
                title="Remove todos os leilões do histórico"
                onClick={() => {
                  if (window.confirm('Limpar todo o histórico de leilões? Essa ação não pode ser desfeita.')) {
                    clearHistory.mutate();
                  }
                }}
              >
                {clearHistory.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                Limpar histórico
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {auctions.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredAuctions.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Leilão</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead>Grupo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Pagamento</TableHead>
                  <TableHead>Método de pagamento</TableHead>
                  <TableHead>Vencedor</TableHead>
                  <TableHead className="text-right">Valor final</TableHead>
                  <TableHead className="text-right">Lances</TableHead>
                  <TableHead className="text-right">Início</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAuctions.map((auction) => {
                  const status = AUCTION_STATUS[auction.status];
                  return (
                    <TableRow key={auction.id}>
                      <TableCell className="text-muted-foreground">
                        {auction.auctionEvent?.name ?? '—'}
                      </TableCell>
                      <TableCell className="font-medium">{auction.productName}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {auction.group?.name ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <select
                          aria-label={`Pagamento de ${auction.productName}`}
                          className="flex h-8 rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                          value={auction.paymentStatus}
                          disabled={auction.status !== 'CLOSED' || !auction.winnerBid}
                          onChange={(event) =>
                            updatePaymentStatus.mutate({
                              auctionId: auction.id,
                              status: event.target.value as 'PENDING' | 'PAID',
                            })
                          }
                        >
                          <option value="PENDING">Pendente</option>
                          <option value="PAID">Pago</option>
                        </select>
                      </TableCell>
                      <TableCell>
                        <select
                          aria-label={`Método de pagamento de ${auction.productName}`}
                          className="flex h-8 rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                          value={paymentMethods[auction.id] ?? ''}
                          disabled={auction.status !== 'CLOSED' || !auction.winnerBid}
                          onChange={(event) => setPaymentMethod(auction.id, event.target.value)}
                        >
                          <option value="" disabled>
                            Selecionar
                          </option>
                          <option value="PIX">Pix</option>
                          <option value="CASH">Dinheiro</option>
                          <option value="CARD">Cartão</option>
                        </select>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {auction.winnerBid?.participantName || '—'}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {auction.winnerBid ? formatCurrency(auction.winnerBid.amount) : '—'}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {auction._count?.bids ?? 0}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatDate(auction.startedAt)}
                      </TableCell>
                      <TableCell>
                        {(auction._count?.bids ?? 0) > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setViewBidsTarget(auction)}
                          >
                            Lances ({auction._count?.bids ?? 0})
                          </Button>
                        )}
                        {auction.status === 'OPEN' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditTarget(auction);
                              setEditProductName(auction.productName);
                              setEditInitialValue(String(Number(auction.initialValue)));
                              setEditDuration(String(Math.round((auction.durationSeconds ?? 120) / 60)));
                              setEditMinBidStep(auction.minBidStep ? String(Number(auction.minBidStep)) : '');
                              setEditAuctionError(null);
                            }}
                          >
                            Editar
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Nenhum leilão realizado ainda.
            </div>
          )}
        </CardContent>
      </Card>

      {reportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border bg-background shadow-lg">
            <div className="flex items-start justify-between gap-2 border-b p-4">
              <div>
                <h3 className="flex items-center gap-2 text-lg font-semibold">
                  <FileText className="size-5" />
                  Relatório de leilões
                </h3>
                <p className="text-sm text-muted-foreground">
                  {reportGenerated
                    ? 'Relatório gerado com os itens selecionados.'
                    : 'Selecione quais leilões (e seus itens) devem aparecer no relatório.'}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={closeReport} aria-label="Fechar">
                <X className="size-4" />
              </Button>
            </div>

            {reportGenerated ? (
              <div className="flex-1 overflow-auto p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    Filtro de pagamento
                    <select
                      aria-label="Filtrar relatório por pagamento"
                      className="h-8 rounded-md border border-input bg-transparent px-2 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={reportPaymentFilter}
                      onChange={(event) =>
                        setReportPaymentFilter(event.target.value as 'ALL' | 'PENDING' | 'PAID')
                      }
                    >
                      <option value="ALL">Todos</option>
                      <option value="PENDING">Pendentes</option>
                      <option value="PAID">Pagos</option>
                    </select>
                  </label>
                  {filteredReportTotal > 0 && (
                    <div className="text-sm text-muted-foreground">
                      <span>Total arrecadado: </span>
                      <span className="text-lg font-semibold">{formatCurrency(filteredReportTotal)}</span>
                    </div>
                  )}
                </div>
                {filteredReportTotal > 0 ? (
                  <Card className="mb-4">
                    <CardContent className="flex items-center justify-between p-4">
                      <div className="text-sm text-muted-foreground">
                        {filteredReportRows.length}{' '}
                        {filteredReportRows.length === 1 ? 'item selecionado' : 'itens selecionados'}
                      </div>
                      <div>
                        <span className="text-sm text-muted-foreground">Total arrecadado: </span>
                        <span className="text-lg font-semibold">{formatCurrency(filteredReportTotal)}</span>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <p className="mb-4 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
                    {filteredReportRows.length === 0
                      ? 'Nenhum item selecionado.'
                      : reportPaymentFilter === 'ALL'
                        ? 'Nenhum item selecionado com lance vencedor.'
                        : `Nenhum item está ${reportPaymentFilter === 'PAID' ? 'pago' : 'pendente'} agora.`}
                  </p>
                )}
                <div className="overflow-hidden rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead>Leilão</TableHead>
                        <TableHead>Grupo</TableHead>
                        <TableHead>Vencedor</TableHead>
                        <TableHead>Método de pagamento</TableHead>
                        <TableHead className="text-right">Valor final</TableHead>
                        <TableHead className="text-right">Data</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredReportRows.length > 0 ? (
                        filteredReportRows.map((row) => {
                          const event = events.data?.find((e) => e.id === row.item.auctionEventId);
                          return (
                            <TableRow key={row.item.id}>
                              <TableCell className="font-medium">{row.item.name}</TableCell>
                              <TableCell className="text-muted-foreground">
                                {event?.name ?? '—'}
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {row.auction?.group?.name ?? '—'}
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {row.auction?.winnerBid?.participantName || '—'}
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {row.auction ? PAYMENT_METHOD_LABELS[paymentMethods[row.auction.id] ?? ''] ?? '—' : '—'}
                              </TableCell>
                              <TableCell className="text-right font-medium">
                                {row.auction?.winnerBid
                                  ? formatCurrency(row.auction.winnerBid.amount)
                                  : '—'}
                              </TableCell>
                              <TableCell className="text-right text-muted-foreground">
                                {row.auction ? formatDate(row.auction.startedAt) : '—'}
                              </TableCell>
                            </TableRow>
                          );
                        })
                      ) : (
                        <TableRow>
                          <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                            Nenhum item selecionado.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>

                <div id="print-report">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, borderBottom: '2px solid #000', paddingBottom: 12 }}>
                    <div>
                      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Relatório de Leilões</h1>
                      <p style={{ fontSize: 12, color: '#555', margin: '4px 0 0' }}>LanceZap — {formatDate(new Date().toISOString())}</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: 12, margin: 0, fontWeight: 600 }}>
                        {filteredReportRows.length} {filteredReportRows.length === 1 ? 'item' : 'itens'}
                      </p>
                      <p style={{ fontSize: 16, margin: '4px 0 0', fontWeight: 700 }}>
                        Total: {formatCurrency(filteredReportTotal)}
                      </p>
                    </div>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f0f0f0' }}>
                        <th style={{ border: '1px solid #999', padding: '6px 8px', textAlign: 'left', fontWeight: 700 }}>Item</th>
                        <th style={{ border: '1px solid #999', padding: '6px 8px', textAlign: 'left', fontWeight: 700 }}>Leilão</th>
                        <th style={{ border: '1px solid #999', padding: '6px 8px', textAlign: 'left', fontWeight: 700 }}>Grupo</th>
                        <th style={{ border: '1px solid #999', padding: '6px 8px', textAlign: 'left', fontWeight: 700 }}>Vencedor</th>
                        <th style={{ border: '1px solid #999', padding: '6px 8px', textAlign: 'left', fontWeight: 700 }}>Pagamento</th>
                        <th style={{ border: '1px solid #999', padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>Valor final</th>
                        <th style={{ border: '1px solid #999', padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>Data</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredReportRows.map((row, index) => {
                        const event = events.data?.find((e) => e.id === row.item.auctionEventId);
                        return (
                          <tr key={row.item.id} style={{ backgroundColor: index % 2 === 0 ? '#fff' : '#fafafa' }}>
                            <td style={{ border: '1px solid #ccc', padding: '5px 8px' }}>{row.item.name}</td>
                            <td style={{ border: '1px solid #ccc', padding: '5px 8px' }}>{event?.name ?? '—'}</td>
                            <td style={{ border: '1px solid #ccc', padding: '5px 8px' }}>
                              {row.auction?.group?.name ?? '—'}
                            </td>
                            <td style={{ border: '1px solid #ccc', padding: '5px 8px' }}>
                              {row.auction?.winnerBid?.participantName || '—'}
                            </td>
                            <td style={{ border: '1px solid #ccc', padding: '5px 8px' }}>
                              {row.auction ? PAYMENT_METHOD_LABELS[paymentMethods[row.auction.id] ?? ''] ?? '—' : '—'}
                            </td>
                            <td style={{ border: '1px solid #ccc', padding: '5px 8px', textAlign: 'right', fontWeight: 600 }}>
                              {row.auction?.winnerBid ? formatCurrency(row.auction.winnerBid.amount) : '—'}
                            </td>
                            <td style={{ border: '1px solid #ccc', padding: '5px 8px', textAlign: 'right' }}>
                              {row.auction ? formatDate(row.auction.startedAt) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '2px solid #000', fontWeight: 700 }}>
                        <td colSpan={5} style={{ padding: '6px 8px', textAlign: 'right' }}>Total arrecadado:</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontSize: 13 }}>{formatCurrency(filteredReportTotal)}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            ) : allItems.isLoading || events.isLoading ? (
              <div className="flex-1 space-y-2 p-4">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-10 w-full" />
                ))}
              </div>
            ) : (events.data ?? []).length === 0 ? (
              <div className="flex-1 p-8 text-center text-sm text-muted-foreground">
                Nenhum leilão criado para gerar relatório.
              </div>
            ) : (
              <div className="flex-1 overflow-auto p-4">
                <label className="mb-2 flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={
                      (allItems.data?.length ?? 0) > 0 &&
                      selectedItemIds.length === allItems.data?.length
                    }
                    onChange={(event) => selectAllReport(event.target.checked)}
                  />
                  Selecionar todos os itens
                </label>
                <div className="space-y-3">
                  {events.data?.map((event) => {
                    const items = (allItems.data ?? []).filter(
                      (item) => item.auctionEventId === event.id,
                    );
                    const allChecked = items.length > 0 && items.every((i) => selectedItemIds.includes(i.id));
                    return (
                      <div key={event.id} className="overflow-hidden rounded-md border">
                        <div className="flex items-center gap-3 border-b bg-muted/40 px-3 py-2">
                          <input
                            type="checkbox"
                            checked={allChecked}
                            onChange={(event2) => toggleEventItems(event.id, event2.target.checked)}
                          />
                          <span className="font-medium">{event.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {items.length} {items.length === 1 ? 'item' : 'itens'}
                          </span>
                        </div>
                        {items.length > 0 ? (
                          <div className="divide-y">
                            {items.map((item) => (
                              <label
                                key={item.id}
                                className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedItemIds.includes(item.id)}
                                  onChange={(event2) => toggleItem(item.id, event2.target.checked)}
                                />
                                <span className="flex-1">{item.name}</span>
                                <span className="text-xs text-muted-foreground">
                                  {ITEM_STATUS[item.status].label}
                                </span>
                              </label>
                            ))}
                          </div>
                        ) : (
                          <div className="px-3 py-2 text-sm text-muted-foreground">
                            Nenhum item neste leilão.
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 border-t p-4">
              {reportGenerated ? (
                <>
                  <Button variant="outline" onClick={() => window.print()}>
                    <FileText className="size-4" />
                    Gerar PDF
                  </Button>
                  <Button variant="outline" onClick={() => setReportGenerated(false)}>
                    Voltar
                  </Button>
                  <Button onClick={closeReport}>Fechar</Button>
                </>
              ) : (
                <>
                  <Button variant="outline" onClick={closeReport}>
                    Cancelar
                  </Button>
                  <Button
                    onClick={() => setReportGenerated(true)}
                    disabled={selectedItemIds.length === 0}
                  >
                    Gerar relatório
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {scheduleTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex w-full max-w-md flex-col rounded-lg border bg-background shadow-lg">
            <div className="flex items-start justify-between gap-2 border-b p-4">
              <div>
                <h3 className="flex items-center gap-2 text-lg font-semibold">
                  <Clock className="size-5" />
                  Agendar encerramento
                </h3>
                <p className="text-sm text-muted-foreground">{scheduleTarget.item.name}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Fechar"
                onClick={() => setScheduleTarget(null)}
              >
                <X className="size-4" />
              </Button>
            </div>
            <div className="space-y-4 p-4">
              <div className="space-y-2">
                <Label htmlFor="schedule-end">Encerrar às</Label>
                <Input
                  id="schedule-end"
                  type="time"
                  value={scheduleEndAt}
                  onChange={(event) => setScheduleEndAt(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Só o horário: o item encerra hoje neste horário. Se o horário já
                  passou, o encerramento fica agendado para amanhã. Neste horário o
                  bot encerra o item no grupo, mesmo com o leilão já em andamento,
                  e avisa os participantes com antecedência. Lances não estendem o
                  prazo agendado.
                </p>
              </div>
              {scheduleEndError && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {scheduleEndError}
                </p>
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t p-4">
              {scheduleTarget.auction.scheduledEndAt && (
                <Button
                  variant="outline"
                  disabled={scheduleItemEnd.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Remover o agendamento de encerramento do item "${scheduleTarget.item.name}"?`,
                      )
                    ) {
                      scheduleItemEnd.mutate({
                        eventId: selectedEventId!,
                        auctionId: scheduleTarget.auction.id,
                        endsAt: null,
                      });
                    }
                  }}
                >
                  Remover agendamento
                </Button>
              )}
              <Button variant="outline" onClick={() => setScheduleTarget(null)}>
                Cancelar
              </Button>
              <Button
                disabled={!scheduleEndAt || scheduleItemEnd.isPending}
                onClick={() => {
                  const [hours, minutes] = scheduleEndAt.split(':').map(Number);
                  scheduleItemEnd.mutate({
                    eventId: selectedEventId!,
                    auctionId: scheduleTarget.auction.id,
                    endsAt: nextOccurrenceOfTime(hours, minutes).toISOString(),
                  });
                }}
              >
                {scheduleItemEnd.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Clock className="size-4" />
                )}
                {scheduleTarget.auction.scheduledEndAt ? 'Reagendar' : 'Agendar'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-lg border bg-background shadow-lg">
            <div className="flex items-start justify-between gap-2 border-b p-4">
              <div>
                <h3 className="text-lg font-semibold">Editar Leilão</h3>
                <p className="text-sm text-muted-foreground">
                  Altere as informações do leilão em andamento.
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setEditTarget(null)}>
                ✕
              </Button>
            </div>
            <div className="space-y-4 p-4">
              <div>
                <Label htmlFor="edit-product-name">Produto</Label>
                <Input
                  id="edit-product-name"
                  value={editProductName}
                  onChange={(e) => setEditProductName(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="edit-initial-value">Valor inicial (R$)</Label>
                  <Input
                    id="edit-initial-value"
                    type="number"
                    step="0.01"
                    value={editInitialValue}
                    onChange={(e) => setEditInitialValue(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="edit-duration">Duração (min)</Label>
                  <Input
                    id="edit-duration"
                    type="number"
                    min="1"
                    value={editDuration}
                    onChange={(e) => setEditDuration(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="edit-min-bid-step">Incremento mínimo (R$)</Label>
                <Input
                  id="edit-min-bid-step"
                  type="number"
                  step="0.01"
                  value={editMinBidStep}
                  onChange={(e) => setEditMinBidStep(e.target.value)}
                />
              </div>
              {editAuctionError && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {editAuctionError}
                </p>
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t p-4">
              <Button variant="outline" onClick={() => setEditTarget(null)}>
                Cancelar
              </Button>
              <Button disabled={updateAuction.isPending} onClick={() => updateAuction.mutate()}>
                {updateAuction.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                Salvar
              </Button>
            </div>
          </div>
        </div>
      )}

      {editBidTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-lg border bg-background shadow-lg">
            <div className="flex items-start justify-between gap-2 border-b p-4">
              <div>
                <h3 className="text-lg font-semibold">Editar Lance</h3>
                <p className="text-sm text-muted-foreground">
                  Altere o valor ou informações do lance.
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setEditBidTarget(null)}>
                ✕
              </Button>
            </div>
            <div className="space-y-4 p-4">
              <div>
                <Label htmlFor="edit-bid-amount">Valor (R$)</Label>
                <Input
                  id="edit-bid-amount"
                  type="number"
                  step="0.01"
                  value={editBidAmount}
                  onChange={(e) => setEditBidAmount(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="edit-bid-name">Nome do participante</Label>
                <Input
                  id="edit-bid-name"
                  value={editBidName}
                  onChange={(e) => setEditBidName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="edit-bid-phone">Telefone</Label>
                <Input
                  id="edit-bid-phone"
                  value={editBidPhone}
                  onChange={(e) => setEditBidPhone(e.target.value)}
                />
              </div>
              {editBidError && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {editBidError}
                </p>
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t p-4">
              <Button variant="outline" onClick={() => setEditBidTarget(null)}>
                Cancelar
              </Button>
              <Button disabled={updateBid.isPending} onClick={() => updateBid.mutate()}>
                {updateBid.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                Salvar
              </Button>
            </div>
          </div>
        </div>
      )}

      {viewBidsTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border bg-background shadow-lg">
            <div className="flex items-start justify-between gap-2 border-b p-4">
              <div>
                <h3 className="text-lg font-semibold">Lances — {viewBidsTarget.productName}</h3>
                <p className="text-sm text-muted-foreground">
                  {auctionBids.data?.length ?? 0} lance(s) registrado(s).
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setViewBidsTarget(null)}>
                ✕
              </Button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {auctionBids.isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : (auctionBids.data?.length ?? 0) > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Participante</TableHead>
                      <TableHead>Telefone</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auctionBids.data!.map((bid: any) => (
                      <TableRow key={bid.id}>
                        <TableCell>{bid.participantName || '—'}</TableCell>
                        <TableCell className="text-muted-foreground">{bid.participantPhone || '—'}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(bid.amount)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditBidTarget(bid);
                                setEditBidAmount(String(Number(bid.amount)));
                                setEditBidName(bid.participantName ?? '');
                                setEditBidPhone(bid.participantPhone ?? '');
                                setEditBidError(null);
                              }}
                            >
                              Editar
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              disabled={removeBid.isPending}
                              onClick={() => {
                                if (window.confirm(`Excluir o lance de ${formatCurrency(bid.amount)} de "${bid.participantName ?? 'Desconhecido'}"? O lance vencedor será recalculado automaticamente.`)) {
                                  removeBid.mutate(bid.id);
                                }
                              }}
                            >
                              Excluir
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground text-center">Nenhum lance registrado.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {editEventTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-lg border bg-background shadow-lg">
            <div className="flex items-start justify-between gap-2 border-b p-4">
              <div>
                <h3 className="text-lg font-semibold">Editar Leilão</h3>
                <p className="text-sm text-muted-foreground">
                  Altere as configurações do leilão.
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setEditEventTarget(null)}>
                ✕
              </Button>
            </div>
            <div className="space-y-4 p-4">
              <div>
                <Label htmlFor="edit-event-name">Nome</Label>
                <Input
                  id="edit-event-name"
                  value={editEventName}
                  onChange={(e) => setEditEventName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="edit-event-desc">Descrição</Label>
                <Textarea
                  id="edit-event-desc"
                  value={editEventDescription}
                  onChange={(e) => setEditEventDescription(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="edit-event-min-bid-step">Incremento mínimo (R$)</Label>
                  <Input
                    id="edit-event-min-bid-step"
                    type="number"
                    step="0.01"
                    value={editEventMinBidStep}
                    onChange={(e) => setEditEventMinBidStep(e.target.value)}
                    placeholder="0 = sem mínimo"
                  />
                </div>
                <div>
                  <Label htmlFor="edit-event-status">Status</Label>
                  <select
                    id="edit-event-status"
                    className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                    value={editEventStatus}
                    onChange={(e) => setEditEventStatus(e.target.value as 'OPEN' | 'CLOSED')}
                  >
                    <option value="OPEN">Em andamento</option>
                    <option value="CLOSED">Encerrado</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="edit-event-start">Início agendado</Label>
                  <Input
                    id="edit-event-start"
                    type="datetime-local"
                    value={editEventScheduledStart ? editEventScheduledStart.slice(0, 16) : ''}
                    onChange={(e) => setEditEventScheduledStart(e.target.value ? new Date(e.target.value).toISOString() : '')}
                  />
                </div>
                <div>
                  <Label htmlFor="edit-event-end">Término agendado</Label>
                  <Input
                    id="edit-event-end"
                    type="datetime-local"
                    value={editEventScheduledEnd ? editEventScheduledEnd.slice(0, 16) : ''}
                    onChange={(e) => setEditEventScheduledEnd(e.target.value ? new Date(e.target.value).toISOString() : '')}
                  />
                </div>
              </div>
              {editEventError && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {editEventError}
                </p>
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t p-4">
              <Button variant="outline" onClick={() => setEditEventTarget(null)}>
                Cancelar
              </Button>
              <Button disabled={updateEvent.isPending} onClick={() => updateEvent.mutate()}>
                {updateEvent.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                Salvar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
