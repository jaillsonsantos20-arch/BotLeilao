import { useState, type FormEvent } from 'react';
import { Gavel, Loader2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/stores/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    companyName: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update(field: keyof typeof form): (event: React.ChangeEvent<HTMLInputElement>) => void {
    return (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await register(form);
      navigate('/');
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Gavel className="size-6" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">BotLeilão</h1>
          <p className="text-sm text-muted-foreground">Comece a leiloar em minutos</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Criar conta</CardTitle>
            <CardDescription>
              Crie seu tenant e o primeiro usuário administrador.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
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

              {error && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting && <Loader2 className="animate-spin" />}
                Criar conta
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
