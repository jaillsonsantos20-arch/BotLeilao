import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronUp,
  CircleStop,
  FileText,
  FolderPlus,
  Gavel,
  ImagePlus,
  ListChecks,
  Loader2,
  Package,
  Plus,
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

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const DEFAULT_ITEM_DURATION_SECONDS = 120;

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

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const eventItems = useEventItems(selectedEventId);

  const [creatingEvent, setCreatingEvent] = useState(false);
  const [eventName, setEventName] = useState('');
  const [eventDescription, setEventDescription] = useState('');
  const [eventGroupId, setEventGroupId] = useState('');
  const [eventStatusInterval, setEventStatusInterval] = useState('');
  const [eventFormError, setEventFormError] = useState<string | null>(null);

  const [eventError, setEventError] = useState<string | null>(null);

  const [itemName, setItemName] = useState('');
  const [itemDescription, setItemDescription] = useState('');
  const [itemValue, setItemValue] = useState('');
  const [itemImageUrl, setItemImageUrl] = useState<string | null>(null);
  const [itemFormError, setItemFormError] = useState<string | null>(null);

  const [listGroupId, setListGroupId] = useState('');
  const [listError, setListError] = useState<string | null>(null);

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

  const createEvent = useMutation({
    mutationFn: async () => {
      const response = await api.post<ApiEnvelope<AuctionEvent>>('/auction-events', {
        name: eventName,
        description: eventDescription || undefined,
        groupId: eventGroupId || undefined,
        periodicStatusMinutes: eventStatusInterval
          ? Math.max(0, parseInt(eventStatusInterval, 10))
          : 0,
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

  const uploadImage = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const response = await api.post<ApiEnvelope<{ url: string }>>('/items/upload-image', formData, {
        headers: { 'Content-Type': null },
      });
      return response.data.data.url;
    },
    onError: (err) => setItemFormError(extractError(err, 'Falha ao enviar a foto.')),
  });

  const createItem = useMutation({
    mutationFn: async () => {
      if (!selectedEventId) throw new Error('Selecione um leilão.');
      const response = await api.post<ApiEnvelope<Item>>('/items', {
        auctionEventId: selectedEventId,
        name: itemName,
        description: itemDescription || undefined,
        imageUrl: itemImageUrl ?? undefined,
        initialValue: parseFloat(itemValue),
        durationSeconds: DEFAULT_ITEM_DURATION_SECONDS,
      });
      return response.data.data;
    },
    onSuccess: () => {
      invalidate();
      setItemName('');
      setItemDescription('');
      setItemValue('');
      setItemImageUrl(null);
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

  function handleCreateEvent(event: FormEvent): void {
    event.preventDefault();
    createEvent.mutate();
  }

  function handleCreateItem(event: FormEvent): void {
    event.preventDefault();
    createItem.mutate();
  }

  function handleFileSelected(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setItemFormError('Formato de imagem inválido. Use JPEG, PNG, WebP ou GIF.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setItemFormError('A imagem deve ter no máximo 5MB.');
      return;
    }

    setItemFormError(null);
    uploadImage.mutate(file, {
      onSuccess: (url) => setItemImageUrl(url),
    });
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Leilões</h2>
          <p className="text-sm text-muted-foreground">
            Crie um leilão (ex.: "Leilão da Igreja"), cadastre os itens e inicie no WhatsApp.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={openReport}>
            <FileText className="size-4" />
            Relatório
          </Button>
          <Button onClick={() => setCreatingEvent((prev) => !prev)}>
            {creatingEvent ? <X className="size-4" /> : <Plus className="size-4" />}
            {creatingEvent ? 'Cancelar' : 'Criar novo leilão'}
          </Button>
        </div>
      </div>

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
              <div className="grid gap-4 sm:grid-cols-2">
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
              <Button variant="outline" size="sm" onClick={() => setSelectedEventId(null)}>
                Fechar
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-md border p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="flex items-center gap-2 font-medium">
                    <ListChecks className="size-4" />
                    Iniciar lista no grupo
                  </h4>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Abre um leilão simultâneo por item. Os participantes dão lances
                    como <em>01 - 22,00</em>. Se um status periódico foi definido,
                    o bot reenvia a lista automaticamente.
                  </p>
                </div>
                {selectedEvent.periodicStatusMinutes ? (
                  <Badge variant="outline">
                    Status a cada {selectedEvent.periodicStatusMinutes} min
                  </Badge>
                ) : (
                  <Badge variant="outline">Status sob demanda (!status)</Badge>
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
                    if (!listGroupId) {
                      setListError('Selecione um grupo para abrir a lista.');
                      return;
                    }
                    startList.mutate({ eventId: selectedEventId, groupId: listGroupId });
                  }}
                  className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end"
                >
                  <div className="space-y-2">
                    <Label htmlFor="list-group">Grupo do WhatsApp</Label>
                    <select
                      id="list-group"
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={listGroupId}
                      onChange={(event) => setListGroupId(event.target.value)}
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
                  </div>
                  <Button
                    type="submit"
                    disabled={
                      startList.isPending ||
                      selectedEvent.status === 'CLOSED' ||
                      (selectedEvent.itemCount ?? 0) === 0 ||
                      (!!listGroupId &&
                        !groups.data?.some((g) => g.id === listGroupId && !g.openAuction))
                    }
                  >
                    {startList.isPending ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <ListChecks className="size-4" />
                    )}
                    {startList.isPending ? 'Abrindo...' : 'Iniciar lista'}
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

            <div className="rounded-md border p-4">
              <h4 className="mb-3 flex items-center gap-2 font-medium">
                <ImagePlus className="size-4" />
                Cadastrar item neste leilão
              </h4>
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
                <div className="space-y-2">
                  <Label>Foto do item</Label>
                  <div className="flex items-center gap-3">
                    {itemImageUrl ? (
                      <div className="relative">
                        <img
                          src={itemImageUrl}
                          alt="Pré-visualização"
                          className="size-14 rounded-md border object-cover"
                        />
                        <button
                          type="button"
                          aria-label="Remover foto"
                          className="absolute -right-2 -top-2 rounded-full bg-background p-0.5 text-muted-foreground shadow"
                          onClick={() => setItemImageUrl(null)}
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex size-14 items-center justify-center rounded-md border bg-muted">
                        <ImagePlus className="size-6 text-muted-foreground" />
                      </div>
                    )}
                    <label
                      className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors hover:bg-accent ${uploadImage.isPending ? 'pointer-events-none opacity-60' : ''}`}
                    >
                      {uploadImage.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <ImagePlus className="size-4" />
                      )}
                      {uploadImage.isPending ? 'Enviando...' : 'Enviar foto'}
                      <input
                        type="file"
                        accept={ACCEPTED_IMAGE_TYPES.join(',')}
                        className="hidden"
                        onChange={handleFileSelected}
                        disabled={uploadImage.isPending}
                      />
                    </label>
                  </div>
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
                <div className="sm:col-span-2">
                  <Button type="submit" disabled={createItem.isPending}>
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
                                  <div className="font-medium">{item.name}</div>
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
                              {item.durationSeconds}s
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
                  <TableHead>Vencedor</TableHead>
                  <TableHead className="text-right">Valor final</TableHead>
                  <TableHead className="text-right">Lances</TableHead>
                  <TableHead className="text-right">Início</TableHead>
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
                  <p className="mb-4 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
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
                          <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                            Nenhum item selecionado.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>

                <div id="print-report">
                  <h2 className="mb-1 text-xl font-bold">Relatório de leilões</h2>
                  <p className="mb-4 text-sm">{formatDate(new Date().toISOString())}</p>
                  <p className="mb-4 text-sm">
                    {filteredReportRows.length}{' '}
                    {filteredReportRows.length === 1 ? 'item selecionado' : 'itens selecionados'} ·{' '}
                    Total arrecadado: {formatCurrency(filteredReportTotal)}
                  </p>
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th className="border border-black px-2 py-1 text-left text-xs">Item</th>
                        <th className="border border-black px-2 py-1 text-left text-xs">Leilão</th>
                        <th className="border border-black px-2 py-1 text-left text-xs">Grupo</th>
                        <th className="border border-black px-2 py-1 text-left text-xs">Vencedor</th>
                        <th className="border border-black px-2 py-1 text-right text-xs">Valor final</th>
                        <th className="border border-black px-2 py-1 text-right text-xs">Data</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredReportRows.map((row) => {
                        const event = events.data?.find((e) => e.id === row.item.auctionEventId);
                        return (
                          <tr key={row.item.id}>
                            <td className="border border-black px-2 py-1 text-sm">{row.item.name}</td>
                            <td className="border border-black px-2 py-1 text-sm">{event?.name ?? '—'}</td>
                            <td className="border border-black px-2 py-1 text-sm">
                              {row.auction?.group?.name ?? '—'}
                            </td>
                            <td className="border border-black px-2 py-1 text-sm">
                              {row.auction?.winnerBid?.participantName || '—'}
                            </td>
                            <td className="border border-black px-2 py-1 text-right text-sm">
                              {row.auction?.winnerBid ? formatCurrency(row.auction.winnerBid.amount) : '—'}
                            </td>
                            <td className="border border-black px-2 py-1 text-right text-sm">
                              {row.auction ? formatDate(row.auction.startedAt) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
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
    </div>
  );
}
