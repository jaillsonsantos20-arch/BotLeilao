import { useEffect, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { Logo } from '@/components/ui/logo';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>(() => (token ? 'loading' : 'error'));

  useEffect(() => {
    if (!token) {
      return;
    }
    api
      .post('/auth/verify-email', { token })
      .then(() => setStatus('success'))
      .catch(() => setStatus('error'));
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm">
<div className="mb-6 flex flex-col items-center gap-2">
            <Logo size={48} />
            <h1 className="text-xl font-semibold tracking-tight">LanceZap</h1>
          </div>

        <Card>
          <CardHeader>
            <CardTitle>Confirmação de e-mail</CardTitle>
            <CardDescription>Verificando seu e-mail...</CardDescription>
          </CardHeader>
          <CardContent>
            {status === 'loading' && (
              <div className="flex flex-col items-center gap-3 py-6">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Confirmando seu e-mail...</p>
              </div>
            )}

            {status === 'success' && (
              <div className="space-y-4">
                <div className="flex flex-col items-center gap-2 py-4">
                  <div className="flex size-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                    <Check className="size-5" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    E-mail confirmado com sucesso!
                  </p>
                </div>
                <Button type="button" className="w-full" asChild>
                  <Link to="/login">Ir para o login</Link>
                </Button>
              </div>
            )}

            {status === 'error' && (
              <div className="space-y-4">
                <div className="flex flex-col items-center gap-2 py-4">
                  <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                    <X className="size-5" />
                  </div>
                  <p className="text-center text-sm text-muted-foreground">
                    Não foi possível confirmar o e-mail. O link pode ter expirado ou ser inválido.
                  </p>
                </div>
                <Button type="button" className="w-full" asChild variant="outline">
                  <Link to="/login">Ir para o login</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}