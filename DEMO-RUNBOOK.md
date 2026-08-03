# BotLeilão — Runbook de Demonstração (pré-VPS)

Objetivo: subir um ambiente de **demonstração estável** para apresentar o produto a
clientes **sem** ainda contratar o VPS, e rodar uma apresentação ao vivo convincente.

O app é SaaS multi-tenant: cada cliente cria a própria conta (tenant + admin) em
`/registro`. Por isso o ambiente de demo é seguro para mostrar — os clientes não veem
nem os seus dados nem o de outros tenants.

---

## 1. Escolha do ambiente de demo

| Opção | Quando usar | Prós | Contras |
|---|---|---|---|
| **Railway (Trial/Hobby)** — recomendado | Demo recorrente, link estável | US$ 5 grátis sem cartão, HTTPS automático, URL fixa, igual ao futuro VPS | ~US$ 15–30/mês se mantiver ligado após o trial |
| **Local + túnel** (Docker Compose + Cloudflare Tunnel/ngrok) | Primeira demo rápida, custo zero | Zero custo, roda do seu PC | URL temporária, PC precisa ficar ligado, menos profissional |

> Fluxo sugerido: valide tudo localmente primeiro; a seguir suba no Railway uma única
> vez e use esse link em todas as demos até fechar clientes (aí migra para o VPS).

---

## 2. Validar localmente (passo a passo rápido)

Requisitos: Docker + Docker Compose, um número de WhatsApp seu (o "leiloeiro").

```bash
# 1) subir toda a stack (Postgres, Redis, API+bot, frontend)
docker compose up -d --build

# 2) conferir
docker compose ps
docker compose logs -f backend
```

- Painel: `http://localhost`
- Login admin do seu `.env`: `admin@botleilao.com.br` / `SEED_ADMIN_PASSWORD`
  (troque a senha após o primeiro acesso).

> Se o bot não conectar e aparecer "browser is already running": `docker compose restart backend`.

## 3. Subir a demo no Railway (trial, sem cartão)

1. **Conta**: crie em railway.com e conecte o GitHub `jaillsonsantos20-arch`.
2. **Novo projeto** → *Deploy from GitHub repo* → selecione **BotLeilão**.
3. **Backend** (usa `backend/Dockerfile`):
   - **Volumes**: `/.wwebjs_auth` (sessão WhatsApp) e `/app/uploads` (imagens) — sem
     eles, a sessão cai a cada redeploy.
   - **Variáveis**: copie de `DEPLOYMENT.md` (`NODE_ENV=production`, `API_PREFIX=api`,
     JWT secrets 64+, `SEED_ADMIN_*`). `DATABASE_URL` e `REDIS_*` apontando para os plugins abaixo.
   - `WHATSAPP_BROWSER_PATH=/usr/bin/chromium`.
4. **Plugins gerenciados**: adicione **PostgreSQL** e **Redis** ao mesmo projeto e ligue
   as variáveis do backend a eles.
5. **Frontend** (usa `frontend/Dockerfile`):
   - Se der o mesmo domínio que o backend (ex.: `botleilao.up.railway.app`), use
     `VITE_API_BASE_URL=/api` → sem CORS, mesma origem.
   - Caso contrário: `VITE_API_BASE_URL=https://<backend>.up.railway.app/api`.
6. Deploy concluído → o Railway entrega HTTPS automático. Guarde o domínio
   (ex.: `https://botleilao.up.railway.app`).

## 4. Preparar os dados da demo (uma vez)

1. Acesse o link da demo → **Cadastrar** (`/registro`) com nome de exibição,
   e-mail, senha e nome da empresa — ex.: `Cliente Demonstração`,
   `demo@clientex.com.br`, `Demo@12345`, `Leilões X`.
2. **WhatsApp** → **Conectar WhatsApp** → escaneie o QR com **o seu número dedicado**
   (o bot). Aguarde o status **Conectado** (a página atualiza sozinha a cada 5s).
3. No WhatsApp (app real), crie um **grupo** e adicione o número do bot como
   **administrador**.
4. Em **Grupos** no painel: gere o **código de vinculação** e, no grupo, um admin envia
   `!vincular CODIGO`. O bot confirma no chat.
5. Em **Leilões**: cadastre 2–3 itens com fotos e **início** real.

> Deixe esse ambiente "quente" (conectado) entre demos para o QR não ter que ser
> reescaneado. O volume `/.wwebjs_auth` preserva a sessão.

## 5. Roteiro da apresentação ao cliente (~15 min)

**Abertura (3 min)**
- Mostre o login: `demo@clientex.com.br / Demo@12345` (ou o tenant criado).
- Dashboard: receita, leilões ativos/encerrados, top produtos, gráficos.

**Leilão ao vivo (7 min)**
- No grupo do WhatsApp, admin envia `!iniciar`.
- Peça aos presentes (ou você mesmo) para dar lances numéricos no grupo.
- Destaque: `!status` (valor, vencedor e tempo), avisos "DOU-LHE UMA"/"DOU-LHE DUAS",
  o cronômetro estendido a cada lance e o **anúncio automático do vencedor**.

**Valor/Operação (5 min)**
- **Relatórios**: exporte o CSV do leilão (mostra vencedor e status de pagamento).
- Comandos do grupo: `!historico`, `!encerrar`, `!ajuda`.
- Explique o modelo: cada cliente usa o **próprio número** de WhatsApp e tem dados isolados.

## 6. Checklist de sucesso

- [ ] Painel acessível pelo link HTTPS público (login + registro funcionando).
- [ ] Bot com status **Conectado** no painel.
- [ ] Grupo vinculado e leilão iniciado com **lances reais**.
- [ ] Anúncio de vencedor no grupo + relatório/CSV coerente.
- [ ] Sessão sobrevive a um redeploy (volume `/.wwebjs_auth`).

## 7. Erros comuns na demo

| Sintoma | Causa provável | Correção |
|---|---|---|
| QR não aparece / status CONNECTING eterno | Chromium sem memória | Suba o backend para 1–2 GB de RAM no Railway |
| Bot não responde no grupo | Bot sem admin no grupo | Adicione o número do bot como **admin** do grupo |
| "browser is already running" | Chromium órfão segurando a sessão | Com o serviço parado, apague `DevToolsActivePort`/`*lock` no volume e redeploy |
| Sessão perdeu após redeploy | Volume `/.wwebjs_auth` não montado | Monte o volume no serviço backend |

## 8. Depois que os clientes fecharem (migração para o VPS)

1. Siga o `DEPLOYMENT.md` no VPS (Docker Compose + domínio + Caddy/HTTPS).
2. Recrie o `.env` de produção com novos segredos.
3. Restaure banco e volume de sessão do Railway para o VPS (ou deixe os clientes
   reescanearem o QR — rápido no onboarding).
4. Mantenha o CI verde em `main` antes de cada deploy.
