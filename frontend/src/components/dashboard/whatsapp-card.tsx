import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Loader2, MessageCircle, RefreshCcw, Unplug } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '@/lib/api';
import type { ApiEnvelope, WhatsAppStatus } from '@/types/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const STATUS_CONFIG: Record<
  WhatsAppStatus['status'],
  { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }
> = {
  CONNECTED: { label: 'Conectado', variant: 'success' },
  CONNECTING: { label: 'Conectando…', variant: 'warning' },
  DISCONNECTED: { label: 'Desconectado', variant: 'secondary' },
  ERROR: { label: 'Erro', variant: 'destructive' },
};

function useStatus() {
  return useQuery({
    queryKey: ['whatsapp', 'status'],
    queryFn: async () => {
      const response = await api.get<ApiEnvelope<WhatsAppStatus>>('/whatsapp/status');
      return response.data.data;
    },
    refetchInterval: 5000,
  });
}

/**
 * Card de status da conexão WhatsApp exibido no dashboard.
 * Permite conectar/desconectar e mostra o QR Code quando disponível.
 */
export function WhatsAppCard() {
  const { data, isLoading } = useStatus();
  const queryClient = useQueryClient();
  const status = data?.status ?? 'DISCONNECTED';
  const config = STATUS_CONFIG[status];
  const qr = data?.qr ?? null;

  const connect = useMutation({
    mutationFn: async () => {
      await api.post('/whatsapp/connect');
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['whatsapp', 'status'] }),
  });

  const disconnect = useMutation({
    mutationFn: async () => {
      await api.delete('/whatsapp/disconnect');
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['whatsapp', 'status'] }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircle className="size-4" />
          WhatsApp
        </CardTitle>
        {isLoading ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : (
          <Badge variant={config.variant}>{config.label}</Badge>
        )}
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-4">
        {status === 'CONNECTING' && qr ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border bg-white p-3">
            <QRCodeSVG value={qr} size={150} />
            <p className="text-center text-xs text-muted-foreground">
              Escaneie com o WhatsApp do número leiloeiro.{' '}
              <Link to="/whatsapp" className="font-medium text-primary hover:underline">
                Ver maior
              </Link>
            </p>
          </div>
        ) : status === 'CONNECTING' ? (
          <p className="text-sm text-muted-foreground">Aguardando o QR Code…</p>
        ) : null}

        {status === 'DISCONNECTED' || status === 'ERROR' ? (
          <Button onClick={() => connect.mutate()} disabled={connect.isPending}>
            {connect.isPending ? <Loader2 className="animate-spin" /> : <RefreshCcw className="size-4" />}
            Conectar WhatsApp
          </Button>
        ) : (
          <Button variant="destructive" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
            {disconnect.isPending ? <Loader2 className="animate-spin" /> : <Unplug className="size-4" />}
            Desconectar
          </Button>
        )}

        {status !== 'CONNECTING' && (
          <Button variant="ghost" size="sm" asChild>
            <Link to="/whatsapp">Gerenciar sessão</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
