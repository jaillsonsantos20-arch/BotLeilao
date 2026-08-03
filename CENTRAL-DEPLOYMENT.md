# BotLeilão — Deploy Centralizado (SaaS multi-tenant)

Modelo escolhido: **1 plataforma central** que todos os clientes usam. Cada cliente
é um **tenant**, criado automaticamente no cadastro (`POST /api/auth/register`).
É a forma mais segura e escalável de comercializar.

## Arquitetura

```
 Cliente (WhatsApp + navegador)
      │
      ├─> Painel web ──────> Vercel (SPA estático)
      │                            │  /api ─────────┐
      │                                          │
      └─> Bot no grupo ←─ WhatsApp Web <── Backend (always-on)  <───┘
                                                    │
                                                Supabase (Postgres)
```

- **Vercel** → frontend (React/Vite).
- **Supabase** → banco PostgreSQL (multi-tenant).
- **Backend + bot** → um serviço **always-on** (nunca dorme) — Railway ou Render pago.
  É onde roda o Chromium/bot e se mantêm as sessões de WhatsApp.

## Por que "always-on" (importante)

O bot precisa ficar **conectado 24/7**. No Render, o **plano grátis dorme após ~15 min
ocioso** e derruba o bot. Use:

- **Railway** (serviço Docker permanece ativo) — recomendado; ou
- Render **plano pago (always-on)**; ou um **VPS** simples.

## Passo 1 — Supabase (banco)

1. Crie um projeto no Supabase.
2. Em **Project Settings → Database → Connection string** (modo `URI`).
3. Use no backend a variável `DATABASE_URL` com SSL:

   `postgresql://postgres.<projeto>:<senha>@aws-0-<regiao>.pooler.supabase.com:6543/postgres?sslmode=require`

> As migrações Prisma aplicam no boot (`prisma migrate deploy`). Se o Supabase
> barrar algum DDL, rode `npx prisma db push` uma vez.

## Passo 2 — Backend + bot (Railway ou Render)

Rode a partir do **Dockerfile** de `backend/` (já instala Chromium, aplica migrações
e sobe o bot). Variáveis de ambiente:

```env
NODE_ENV=production
PORT=3000
API_PREFIX=api
API_HOST=https://botleilao-api.onrender.com     # URL pública do backend
DATABASE_URL=<string do Supabase com sslmode=require>
JWT_SECRET=<64+ caracteres aleatórios>
JWT_REFRESH_SECRET=<64+ caracteres aleatórios>
SEED_ADMIN_EMAIL=admin@botleilao.com.br
SEED_ADMIN_PASSWORD=<senha forte do admin>
WHATSAPP_BROWSER_PATH=/usr/bin/chromium
```

**Disco persistente:** anexe um volume montado em `/app/.wwebjs_auth`
(sessões do WhatsApp) e outro em `/app/uploads` (imagens dos itens). Sem
esses volumes, a sessão se perde a cada redeploy.

## Passo 3 — Vercel (frontend)

1. Importe a pasta `frontend/` na Vercel (framework Vite).
2. Defina a variável de build:
   `VITE_API_BASE_URL=https://<backend>/api` (ex.: `https://botu-api.onrender.com/api`)
3. Deploy. O front chama a API pela URL pública (CORS já está aberto `origin: true`).

> Para **mesma origem** (sem CORS), dê, no `vercel.json`, um `rewrite` de `/api/*`
> para o backend e use `VITE_API_BASE_URL=/api`.

## Passo 4 — Onboarding dos clientes (já funciona)

- O cliente acessa o painel → **Cadastrar** (`/register`).
- Isso cria o `tenant` + conta admin. Clientes **não** usam seu login de admin.
- No painel, cada cliente conecta o **próprio número de WhatsApp** (botão WhatsApp → QR).
  A sessão fica isolada por tenant (`WhatsAppSession` é por `clientId`).

## Passo 5 — Segurança e backup

- **Backup do Supabase** (nativo/diário) — habilite point-in-time.
- **Backup do volume `wwebjs_auth`** — sem ele, os clientes reescaneiam o QR.
- **Segredos JWT fortes**; troque a senha do admin após o 1º login.
- **HTTPS sempre** (Vercel e Railway/Render emitem certificado automaticamente).

## Custos estimados

| Recurso | Serviço | ~custo |
|---|---|---|
| Banco multi-tenant | Supabase | US$ 0 (free/Pro) |
| Frontend | Vercel | US$ 0 |
| Backend + bots always-on | Railway/Render pago ou VPS | US$ 5–20 |

Com muitos tenants ativos, a memória é o limitador (vários Chromium); suba o plano
conforme necessário.

## Checklist final

- [ ] Supabase criado e `DATABASE_URL` com `sslmode=require`.
- [ ] Backend ativo (nunca dorme) com volumes em `wwebjs_auth` e `uploads`.
- [ ] Vercel com `VITE_API_BASE_URL` apontando para o backend.
- [ ] Cadastrar um cliente → entrar → conectar o WhatsApp dele → testar um leilão.
- [ ] Backup do banco e da sessão agendado.