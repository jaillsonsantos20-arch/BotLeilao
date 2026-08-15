import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import type { ApiEnvelope, Subscription } from '@/types/api';
import { PaywallPage } from '@/pages/paywall/paywall';

/**
 * Verifica a assinatura do tenant e troca o conteúdo do painel pelo paywall
 * quando o trial venceu / a assinatura não está ativa. SUPER_ADMIN (operador
 * da plataforma) nunca é bloqueado.
 */
export function SubscriptionGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const response = await api.get<ApiEnvelope<Subscription | null>>('/subscriptions/current');
      setSubscription(response.data.data);
    } catch {
      setSubscription(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function load(): Promise<void> {
      try {
        const response = await api.get<ApiEnvelope<Subscription | null>>('/subscriptions/current');
        if (active) {
          setSubscription(response.data.data);
        }
      } catch {
        if (active) {
          setSubscription(null);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  if (user?.role === 'SUPER_ADMIN') {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!subscription || subscription.paymentRequired) {
    return <PaywallPage subscription={subscription} onPaid={() => void refresh()} />;
  }

  return <>{children}</>;
}