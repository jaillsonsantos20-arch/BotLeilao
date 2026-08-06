import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Loader2, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/format';
import type { ApiEnvelope, Group } from '@/types/api';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';

function useGroups() {
  return useQuery({
    queryKey: ['groups'],
    queryFn: async () => {
      const response = await api.get<ApiEnvelope<Group[]>>('/groups?limit=100');
      return response.data.data;
    },
  });
}

interface LinkCodeResult {
  code: string;
  expiresAt: string;
}

export function GroupsPage() {
  const { data, isLoading } = useGroups();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [whatsappGroupId, setWhatsappGroupId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [linkCode, setLinkCode] = useState<LinkCodeResult | null>(null);
  const [copied, setCopied] = useState(false);

  const createGroup = useMutation({
    mutationFn: async () => {
      const response = await api.post<ApiEnvelope<Group>>('/groups', { name, whatsappGroupId });
      return response.data.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['groups'] });
      setCreating(false);
      setName('');
      setWhatsappGroupId('');
      setError(null);
    },
    onError: (err) => setError(extractError(err)),
  });

  const generateLinkCode = useMutation({
    mutationFn: async () => {
      const response = await api.post<ApiEnvelope<LinkCodeResult>>('/groups/link-code');
      return response.data.data;
    },
    onSuccess: (result) => {
      setLinkCode(result);
      setCopied(false);
    },
    onError: (err) => setError(extractError(err)),
  });

  async function copyCode(): Promise<void> {
    if (!linkCode) return;
    await navigator.clipboard.writeText(linkCode.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    createGroup.mutate();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Grupos"
        description="Vincule grupos do WhatsApp para iniciar leilões."
        actions={
          <>
            <Button variant="outline" onClick={() => generateLinkCode.mutate()}>
              {generateLinkCode.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Vincular por código
            </Button>
            <Button onClick={() => setCreating((prev) => !prev)}>
              <Plus className="size-4" />
              Novo grupo
            </Button>
          </>
        }
      />

      {linkCode && (
        <Card className="border-emerald-600/40 bg-emerald-500/5">
          <CardHeader>
            <CardTitle>Código de vinculação gerado</CardTitle>
            <CardDescription>
              Envie no grupo do WhatsApp (o remetente precisa ser administrador do grupo):
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <code className="rounded-lg bg-background px-4 py-2 text-lg font-semibold tracking-widest">
                !vincular {linkCode.code}
              </code>
              <Button variant="outline" size="icon" onClick={() => void copyCode()}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              O código expira em{' '}
              {new Date(linkCode.expiresAt).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
              })}{' '}
              e é de uso único. O bot criará o grupo automaticamente no painel.
            </p>
          </CardContent>
        </Card>
      )}

      {creating && (
        <Card>
          <CardHeader>
            <CardTitle>Vincular grupo do WhatsApp</CardTitle>
            <CardDescription>
              Envie uma mensagem no grupo e copie o id (ex.: 120363000000000000@g.us).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div className="space-y-2">
                <Label htmlFor="group-name">Nome do grupo</Label>
                <Input
                  id="group-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="group-wa-id">ID no WhatsApp</Label>
                <Input
                  id="group-wa-id"
                  value={whatsappGroupId}
                  onChange={(event) => setWhatsappGroupId(event.target.value)}
                  placeholder="120363000000000000@g.us"
                  required
                />
              </div>
              <Button type="submit" disabled={createGroup.isPending}>
                {createGroup.isPending && <Loader2 className="animate-spin" />}
                Salvar
              </Button>
            </form>
            {error && (
              <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          ) : data && data.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Grupo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Leilão ativo</TableHead>
                  <TableHead className="text-right">Criado em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((group) => (
                  <TableRow key={group.id}>
                    <TableCell className="font-medium">{group.name}</TableCell>
                    <TableCell>
                      {group.isActive ? (
                        <Badge variant="success">Ativo</Badge>
                      ) : (
                        <Badge variant="secondary">Inativo</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {group.openAuction ? (
                        <Badge variant="warning">
                          {group.openAuction.productName} ·{' '}
                          {formatCurrency(group.openAuction.initialValue)}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {new Date(group.createdAt).toLocaleDateString('pt-BR')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Nenhum grupo vinculado ainda. Crie o primeiro com "Novo grupo".
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function extractError(error: unknown): string {
  const err = error as { response?: { data?: { message?: string | string[] } } };
  const message = err.response?.data?.message;
  if (Array.isArray(message)) return message[0] ?? 'Falha ao criar o grupo.';
  return message ?? 'Falha ao criar o grupo.';
}
