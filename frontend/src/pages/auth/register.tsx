import { useEffect, useState, type FormEvent } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { Logo } from '@/components/ui/logo';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/stores/auth';
import { api } from '@/lib/api';
import type { ApiEnvelope, Plan } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

function formatPrice(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    companyName: '',
  });
  const [planId, setPlanId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api
      .get<ApiEnvelope<Plan[]>>('/plans')
      .then((response) => {
        setPlans(response.data.data);
        if (response.data.data.length > 0) {
          setPlanId(response.data.data[0].id);
        }
      })
      .catch(() => setPlans([]));
  }, []);

  function update(field: keyof typeof form): (event: React.ChangeEvent<HTMLInputElement>) => void {
    return (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await register({ ...form, planId: planId || undefined });
      navigate('/painel');
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-muted/40 p-4">
      <div className="w-full max-w-2xl">
<div className="mb-6 mt-6 flex flex-col items-center gap-2">
            <Logo size={48} />
            <h1 className="text-xl font-semibold tracking-tight">Criar conta</h1>
            <p className="text-sm text-muted-foreground">
              Escolha o plano e comece a leiloar — teste grátis por 24 horas.
            </p>
          </div>

        <Card>
          <CardHeader>
            <CardTitle>Escolha o plano</CardTitle>
            <CardDescription>
              Sem cobrança imediata: você experimenta por 24h e só paga depois.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(event) => void handleSubmit(event)} className="space-y-6">
              <div className="grid gap-3 sm:grid-cols-2">
                {plans.map((plan) => (
                  <button
                    key={plan.id}
                    type="button"
                    onClick={() => setPlanId(plan.id)}
                    className={cn(
                      'relative rounded-xl border p-4 text-left transition-colors',
                      planId === plan.id
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-border hover:border-primary/50',
                    )}
                  >
                    {planId === plan.id && (
                      <span className="absolute right-3 top-3 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="size-3" />
                      </span>
                    )}
                    <span className="block text-sm font-semibold">{plan.name}</span>
                    <span className="mt-1 block text-2xl font-bold tracking-tight">
                      {formatPrice(plan.price)}
                      <span className="text-xs font-normal text-muted-foreground">/mês</span>
                    </span>
                    <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                      <li>Até {plan.maxGroups} grupos</li>
                      <li>Até {plan.maxUsers} usuário(s)</li>
                      {plan.maxAuctions !== null && <li>Até {plan.maxAuctions} leilões</li>}
                      {plan.features.includes('whatsapp') && <li>Bot de WhatsApp incluso</li>}
                    </ul>
                  </button>
                ))}
              </div>

              <div className="h-px bg-border" />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Seu nome</Label>
                  <Input id="name" value={form.name} onChange={update('name')} required minLength={2} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="companyName">Nome da empresa</Label>
                  <Input
                    id="companyName"
                    value={form.companyName}
                    onChange={update('companyName')}
                    required
                    minLength={2}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">E-mail</Label>
                  <Input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={update('email')}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Senha</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    value={form.password}
                    onChange={update('password')}
                    required
                    minLength={8}
                  />
                </div>
              </div>

              {error && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={submitting || plans.length === 0}>
                {submitting && <Loader2 className="animate-spin" />}
                Começar teste grátis
              </Button>
            </form>

            <p className="mt-4 text-center text-sm text-muted-foreground">
              Já tem conta?{' '}
              <Link to="/login" className="font-medium text-primary hover:underline">
                Entrar
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function extractError(error: unknown): string {
  const err = error as { response?: { data?: { message?: string | string[] } } };
  const message = err.response?.data?.message;
  if (Array.isArray(message)) return message[0] ?? 'Falha ao criar conta.';
  return message ?? 'Falha ao criar conta.';
}