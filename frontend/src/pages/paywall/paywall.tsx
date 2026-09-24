import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Loader2, RefreshCw } from 'lucide-react';
import { Logo } from '@/components/ui/logo';
import { api } from '@/lib/api';
import type { ApiEnvelope, PaymentRecord, PixPayment, Subscription } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

function formatPrice(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

interface PaywallPageProps {
  subscription: Subscription | null;
  onPaid: () => void;
}

/**
 * Tela de cobrança exibida quando o trial expira e a assinatura ainda não está ativa.
 * Gera um PIX via Mercado Pago, exibe o QR e aguarda a confirmação do pagamento.
 */
export function PaywallPage({ subscription, onPaid }: PaywallPageProps) {
  const [pix, setPix] = useState<PixPayment | null>(null);
  const [generating, setGenerating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const plan = subscription?.plan;
  const price = plan?.price ?? 0;

  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
      if (syncRef.current) {
        clearInterval(syncRef.current);
      }
    };
  }, []);

  async function generatePix(): Promise<void> {
    setGenerating(true);
    setError(null);
    try {
      const response = await api.post<ApiEnvelope<PixPayment>>('/payments/pix', {});
      setPix(response.data.data);
      startPolling();
    } catch (err) {
      setError(extractError(err));
    } finally {
      setGenerating(false);
    }
  }

  function startPolling(): void {
    if (pollRef.current) return;
    // Leitura barata no banco local a cada 5s (webhook já teria marcado PAID).
    pollRef.current = setInterval(() => {
      api
        .get<ApiEnvelope<PaymentRecord[]>>('/payments/status')
        .then((response) => {
          const hasPaid = response.data.data.some((payment) => payment.status === 'PAID');
          if (hasPaid) {
            stopPolling();
            onPaid();
          }
        })
        .catch(() => undefined);
    }, 5000);

    // Reconciliação ativa no Mercado Pago a cada 15s (fallback quando o
    // webhook não chega — ex.: notification_url ausente ou localhost).
    if (syncRef.current) return;
    syncRef.current = setInterval(() => {
      void syncPayments(false);
    }, 15000);
  }

  function stopPolling(): void {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    if (syncRef.current) clearInterval(syncRef.current);
    syncRef.current = null;
  }

  async function syncPayments(manual: boolean): Promise<void> {
    if (manual) {
      setChecking(true);
      setError(null);
      setInfo(null);
    }
    try {
      const response = await api.post<
        ApiEnvelope<{ activated: boolean; checked: number; payments: PaymentRecord[] }>
      >('/payments/sync', {});
      const { activated, checked, payments } = response.data.data;
      const hasPaid = activated || payments.some((payment) => payment.status === 'PAID');
      if (hasPaid) {
        stopPolling();
        onPaid();
        return;
      }
      if (manual) {
        setInfo(
          checked > 0
            ? 'Pagamento ainda não confirmado no Mercado Pago. Aguarde alguns segundos e tente de novo.'
            : 'Nenhuma cobrança pendente encontrada. Gere um PIX primeiro.',
        );
      }
    } catch (err) {
      if (manual) setError(extractError(err));
    } finally {
      if (manual) setChecking(false);
    }
  }

  async function copyCode(): Promise<void> {
    if (!pix?.transactionData.qrCode) return;
    await navigator.clipboard.writeText(pix.transactionData.qrCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto">
              <Logo size={48} />
            </div>
            <CardTitle className="text-lg">Sua assinatura precisa ser renovada</CardTitle>
            <CardDescription>
              O período de teste expirou. Para continuar usando o painel, escolha a forma de
              pagamento abaixo.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border bg-muted/40 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Plano {plan?.name ?? 'Básico'}</span>
                <span className="text-lg font-bold tracking-tight">{formatPrice(price)}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Pagamento único mensal via PIX</p>
            </div>

            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
            )}

            {info && (
              <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{info}</p>
            )}

            {pix ? (
              <div className="space-y-4">
                <div className="mx-auto w-fit rounded-2xl border p-3">
                  <img
                    src={`data:image/png;base64,${pix.transactionData.qrCodeBase64}`}
                    alt="QR Code PIX"
                    className="size-52"
                  />
                </div>
                <p className="text-center text-sm text-muted-foreground">
                  Escaneie o QR com o seu banco ou copie o código abaixo.
                </p>
                <div className="flex items-center gap-2 rounded-lg border p-3">
                  <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {pix.transactionData.qrCode}
                  </code>
                  <Button variant="outline" size="sm" onClick={() => void copyCode()}>
                    {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
                    {copied ? 'Copiado' : 'Copiar'}
                  </Button>
                </div>
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => void syncPayments(true)}
                  disabled={checking}
                >
                  {checking && <Loader2 className="animate-spin" />}
                  Já fiz o pagamento — verificar
                </Button>
                <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                  <RefreshCw className="size-3 animate-spin" />
                  Aguardando confirmação do pagamento...
                </p>
              </div>
            ) : (
              <Button className="w-full" onClick={() => void generatePix()} disabled={generating}>
                {generating && <Loader2 className="animate-spin" />}
                Gerar PIX agora
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function extractError(error: unknown): string {
  const err = error as { response?: { data?: { message?: string | string[] } } };
  const message = err.response?.data?.message;
  if (Array.isArray(message)) return message[0] ?? 'Não foi possível gerar o PIX.';
  return message ?? 'Não foi possível gerar o PIX. Tente novamente.';
}