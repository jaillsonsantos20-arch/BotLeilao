# BotLeilão — Guia de Deploy (Produção)

Este guia descreve como colocar o BotLeilão em produção a partir do
`docker-compose.yml` existente neste repositório.

## Visão geral da arquitetura

```
 cliente ── HTTPS ──> [Caddy / reverse proxy] ── porta 80
                              │
                ┌─────────────┴─────────────┐
                │                           │
        frontend (nginx:80)          backend (rede interna)
        serve o SPA                      │
        proxya /api ─────────────────> backend:3000
                                   postgres + redis
                      volumes: wwebjs_auth · uploads
```

- O frontend (nginx) já faz `proxy_pass http://backend:3000` para todas as rotas `/api/*`.
- O backend executa `prisma migrate deploy` no boot e sobe o bot do WhatsApp.
- A sessão do bot fica no volume **`wwebjs_auth`** (imprescindível persistir e fazer backup).

## Requisitos do servidor

- VPS/cloud com **Docker + Docker Compose** (Ubuntu 22+ / Debian 12 sugerido).
- **2 GB de RAM** mínimo (o Chromium do bot consome memória).
- Um domínio apontado para o servidor (para HTTPS).
- Um número de WhatsApp dedicado para a sessão do bot.

## Passo 1 — Variáveis de ambiente (.env na raiz)

Copie `.env.example` para `.env` e ajuste. **Em produção, `WHATSAPP_BROWSER_PATH`
deve ser `/usr/bin/chromium` (Chromium do container) ou vazio** — nunca o caminho de
um navegador Windows.

```env
# --- PostgreSQL ------------------------------------------------------------
POSTGRES_USER=botleilao
POSTGRES_PASSWORD=troque-por-uma-senha-forte
POSTGRES_DB=botleilao
# dentro do container, o host é "postgres" e a porta é 5432 (ver compose)
DATABASE_URL=postgresql://botleilao:SUA_SENHA@postgres:5432/botleilao?schema=public

# --- Redis -----------------------------------------------------------------
REDIS_HOST=redis
REDIS_PORT=6379

# --- Backend API ------------------------------------------------------------
NODE_ENV=production
PORT=3000
API_PREFIX=api
API_HOST=https://seu-dominio.com.br

# --- JWT (use segredos longos e aleatórios) ---------------------------------
JWT_SECRET=cole-64-caracteres-aleatorios-aqui
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=cole-outros-64-caracteres-aleatorios-aqui
JWT_REFRESH_EXPIRES_IN=7d

# --- Seed (primeiro acesso) -------------------------------------------------
SEED_ADMIN_EMAIL=admin@botleilao.com.br
SEED_ADMIN_PASSWORD=troque-esta-senha-do-admin

# --- WhatsApp ---------------------------------------------------------------
WHATSAPP_BROWSER_PATH=/usr/bin/chromium
```

## Passo 2 — Subir a aplicação

```bash
docker compose up -d --build
```

O backend aplica as migrações e **cria automaticamente o administrador no primeiro
boot** (não é preciso rodar seed manualmente). Contas criadas a partir de
`SEED_ADMIN_*`:

- **Super Admin:** `admin@botleilao.com.br`
- **Admin demo:** `demo@botleilao.com.br` (senha = `SEED_ADMIN_PASSWORD`)

Troque a senha pelo painel após o primeiro acesso.

## Passo 3 — HTTPS + domínio

O compose expõe a web na **porta 80** (frontend/nginx). Para HTTPS, use um Caddy
na frente (renova certificado automaticamente):

```nginx
seu-dominio.com.br {
    reverse_proxy 127.0.0.1:80
}
```

O frontend serve o SPA e o `/api` na **mesma origem** (`seu-dominio.com.br`), então
não há necessidade de configurar CORS separadamente.

## Passo 4 — Primeira conexão do WhatsApp

1. Acesse `https://seu-dominio.com.br` e faça login com o admin.
2. Vá em **WhatsApp** e clique em **Conectar**.
3. Escaneie o QR com o celular dedicado ao bot.
4. Confirme que o status fica **Conectado**. A sessão fica no volume `wwebjs_auth`.

> Se, após reiniciar o container, o bot não subir e aparecer "browser is already
> running", pode haver um Chromium órfão segurando a pasta da sessão. Com o container
> parado, remova `DevToolsActivePort`/arquivos `*lock` dentro desse volume e reinicie:
> `docker compose restart backend`.

## Comandos úteis

```bash
docker compose logs -f backend      # logs do API e do bot
docker compose ps                   # estado dos serviços
docker compose restart backend      # reinicia API/bot
docker compose down                 # derruba (mantém os volumes)
```

## Considerações de segurança

- Sua senha/admin padrão do seed.
- Use segredos JWT de **64+ caracteres** gerados aleatoriamente.
- Restrição que o container `backend` **não** precisa ficar público (apenas `frontend:80`).
- Se for manter o Swagger público em produção, restrinja no proxy ou desative o
  Swagger em `NODE_ENV=production`.

## Checklist pós-deploy

- [ ] Front acessível em `https://seu-dominio.com.br` (login funciona).
- [ ] WhatsApp com status **Conectado**.
- [ ] Criado um grupo, cadastrado no painel e leilão iniciado com lance real.
- [ ] Backups agendados do banco e do volume `wwebjs_auth`.