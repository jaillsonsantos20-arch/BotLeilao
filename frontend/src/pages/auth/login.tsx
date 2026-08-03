import { useState, type FormEvent } from 'react';
import { Gavel, Loader2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/stores/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Gavel className="size-6" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">BotLeilão</h1>
          <p className="text-sm text-muted-foreground">Leilões direto no WhatsApp</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Entrar</CardTitle>
            <CardDescription>Acesse o seu painel de leilões.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>

              {error && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting && <Loader2 className="animate-spin" />}
                Entrar
              </Button>
            </form>

            <p className="mt-4 text-center text-sm text-muted-foreground">
              Ainda não tem conta?{' '}
              <Link to="/registro" className="font-medium text-primary hover:underline">
                Criar conta
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
  if (Array.isArray(message)) return message[0] ?? 'Falha ao entrar.';
  return message ?? 'Falha ao entrar. Verifique suas credenciais.';
}
