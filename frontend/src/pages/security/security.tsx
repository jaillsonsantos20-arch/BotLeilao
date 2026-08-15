import { useState, type FormEvent } from 'react';
import { Loader2, ShieldCheck, Smartphone } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '@/stores/auth';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface MfaSetup {
  secret: string;
  otpauthUrl: string;
  backupCodes: string[];
}

export function SecurityPage() {
  const { user } = useAuth();
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function startSetup(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const response = await api.post('/auth/mfa/setup');
      setSetup(response.data.data as MfaSetup);
      setInfo(null);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(false);
    }
  }

  async function enableMfa(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!setup) return;
    setError(null);
    setBusy(true);
    try {
      await api.post('/auth/mfa/enable', { code });
      setSetup(null);
      setCode('');
      setInfo('Autenticação em duas etapas ativada.');
      window.location.reload();
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(false);
    }
  }

  async function disableMfa(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post('/auth/mfa/disable', { password, code: disableCode });
      setPassword('');
      setDisableCode('');
      setInfo('Autenticação em duas etapas desativada.');
      window.location.reload();
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Segurança</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Proteja sua conta com autenticação em duas etapas (2FA).
        </p>
      </div>

      {info && (
        <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600">
          {info}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" />
            Autenticação em duas etapas
          </CardTitle>
          <CardDescription>
            {user?.totpEnabled
              ? 'Ativada: ao entrar, você precisará digitar um código do app autenticador.'
              : 'Desativada: recomendamos ativar para proteger sua conta.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!user?.totpEnabled && !setup && (
            <Button onClick={() => void startSetup()} disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              Ativar 2FA
            </Button>
          )}

          {user?.totpEnabled && (
            <form onSubmit={(event) => void disableMfa(event)} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="mfa-password">Senha atual</Label>
                  <Input
                    id="mfa-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mfa-code">Código TOTP ou de recuperação</Label>
                  <Input
                    id="mfa-code"
                    inputMode="numeric"
                    value={disableCode}
                    onChange={(event) => setDisableCode(event.target.value)}
                    required
                  />
                </div>
              </div>

              {error && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button type="submit" variant="destructive" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                Desativar 2FA
              </Button>
            </form>
          )}

          {setup && (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-4 rounded-xl border bg-muted/30 p-6 sm:flex-row sm:items-start">
                <div className="rounded-lg bg-white p-3">
                  <QRCodeSVG value={setup.otpauthUrl} size={160} />
                </div>
                <div className="space-y-3 text-center sm:text-left">
                  <div>
                    <p className="text-sm font-medium">1. Escaneie o QR code</p>
                    <p className="text-xs text-muted-foreground">
                      Use o Google Authenticator, Authy ou outro app compatível com TOTP.
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">2. Ou digite a chave manualmente</p>
                    <code className="break-all rounded bg-muted px-2 py-1 text-xs">
                      {setup.secret}
                    </code>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <p className="text-sm font-medium">Códigos de recuperação</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Guarde estes códigos em um local seguro. Cada um só pode ser usado uma vez
                  e permitem o acesso caso você perca o app autenticador.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {setup.backupCodes.map((item) => (
                    <div
                      key={item}
                      className="rounded-md bg-muted/50 px-2 py-1.5 text-center font-mono text-xs"
                    >
                      {item}
                    </div>
                  ))}
                </div>
              </div>

              <form onSubmit={(event) => void enableMfa(event)} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="enable-code">
                    Digite o código gerado pelo app autenticador
                  </Label>
                  <Input
                    id="enable-code"
                    inputMode="numeric"
                    placeholder="000000"
                    className={cn('max-w-xs')}
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    required
                  />
                </div>

                {error && (
                  <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={busy}>
                    {busy && <Loader2 className="animate-spin" />}
                    Confirmar e ativar
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setSetup(null);
                      setCode('');
                      setError(null);
                    }}
                  >
                    Cancelar
                  </Button>
                </div>
              </form>
            </div>
          )}

          {!user?.totpEnabled && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Smartphone className="size-4" />
              Requer um aplicativo autenticador instalado no seu celular.
            </p>
          )}
        </CardContent>
      </Card>

      {user?.totpEnabled && (
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-emerald-600">
            2FA ativa
          </Badge>
        </div>
      )}
    </div>
  );
}

function extractError(error: unknown): string {
  const err = error as { response?: { data?: { message?: string | string[] } } };
  const message = err.response?.data?.message;
  if (Array.isArray(message)) return message[0] ?? 'Falha na operação.';
  return message ?? 'Falha na operação.';
}