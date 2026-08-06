import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, MessageCircle, RefreshCcw, Unplug } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '@/lib/api';
import type { ApiEnvelope, WhatsAppStatus } from '@/types/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageHeader } from '@/components/layout/page-header';

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

const STATUS_CONFIG: Record<
  WhatsAppStatus['status'],
  { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }
> = {
  CONNECTED: { label: 'Conectado', variant: 'success' },
  CONNECTING: { label: 'Conectando…', variant: 'warning' },
  DISCONNECTED: { label: 'Desconectado', variant: 'secondary' },
  ERROR: { label: 'Erro', variant: 'destructive' },
};

/**
 * Configuração da sessão do WhatsApp (QR Code exibido aqui no painel).
 */
export function WhatsAppPage() {
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
    <div className="space-y-6">
      <PageHeader
        title="WhatsApp"
        description="Conecte o bot ao WhatsApp para responder aos grupos."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="size-5" />
            Sessão do bot
          </CardTitle>
          <CardDescription>
            Escaneie o QR Code com o WhatsApp do número que fará os leilões.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            {isLoading ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : (
              <Badge variant={config.variant}>{config.label}</Badge>
            )}
          </div>

          {status === 'CONNECTING' && qr ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border bg-white p-6">
              <QRCodeSVG value={qr} size={256} />
              <p className="text-center text-sm text-muted-foreground">
                Abra o WhatsApp no celular → <strong>Aparelhos conectados</strong> →{' '}
                <strong>Conectar um aparelho</strong> → escaneie este código.
              </p>
            </div>
          ) : status === 'CONNECTING' && !qr ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Aguardando o QR Code ser gerado…
            </div>
          ) : null}

          {status === 'DISCONNECTED' || status === 'ERROR' ? (
            <Button onClick={() => connect.mutate()} disabled={connect.isPending}>
              {connect.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RefreshCcw className="size-4" />
              )}
              Conectar WhatsApp
            </Button>
          ) : (
            <Button variant="destructive" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
              {disconnect.isPending ? <Loader2 className="animate-spin" /> : <Unplug className="size-4" />}
              Desconectar
            </Button>
          )}

          <div className="rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Como conectar</p>
            <ol className="mt-2 list-inside list-decimal space-y-1">
              <li>Clique em "Conectar WhatsApp".</li>
              <li>Escaneie o QR Code com o WhatsApp do número leiloeiro.</li>
              <li>Após conectado, o bot responde aos comandos nos grupos vinculados.</li>
            </ol>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
