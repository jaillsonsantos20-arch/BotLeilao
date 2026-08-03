# Fluxos de negócio e operação

## 1. Autenticação e sessão

- **Registro** (`POST /api/auth/register`): cria o tenant, o usuário `ADMIN` (primeiro
  usuário) e um plano padrão. Retorna access + refresh token.
- **Login** (`POST /api/auth/login`): valida credenciais, retorna access (15min) + refresh (7d).
- **Refresh** (`POST /api/auth/refresh`): rotação — cada uso emite um novo par e revoga o
  refresh anterior (armazenado apenas como hash SHA-256 no banco).
- **Logout** (`POST /api/auth/logout`): revoga o refresh token.
- Frontend: axios injeta `Authorization: Bearer`; em 401 o interceptor renova uma única
  vez e repete a requisição; falha na renovação limpa a sessão e redireciona ao login.
- RBAC: `SUPER_ADMIN` (plataforma), `ADMIN` (tenant) e `USER`. Guardas globais
  `JwtAuthGuard` + `RolesGuard` protegem as rotas por padrão.

## 2. Vinculação de grupo do WhatsApp

Há duas formas:

1. **Manual (painel)**: cadastre o grupo informando o **ID do WhatsApp** (ex.: `120363000000000000@g.us`).
2. **Por código (recomendado)**: em **Grupos → Vincular por código**, o painel gera um código
   curto (6 caracteres, válido por 10 min, uso único). No grupo, um **administrador do WhatsApp**
   envia `!vincular CODIGO`; o bot valida o código e cria o grupo no painel automaticamente
   (usando o nome e o id do grupo), respondendo a confirmação no chat.

Restrição por regra de negócio: um grupo com leilão `OPEN` não inicia outro.

## 3. Conexão do bot WhatsApp

1. Em **WhatsApp** no painel, clique em *Conectar WhatsApp*.
2. O QR Code aparece no **terminal do servidor** (o painel indica o estado CONNECTING).
3. Escaneie com o WhatsApp do número que será o "leiloeiro".
4. Estado vira `CONNECTED`; a sessão é persistida localmente (`.wwebjs_auth`, volume
   `wwebjs_auth` no compose) e reutilizada em reinícios.
5. Para trocar de número, use *Desconectar* e conecte novamente.

Implementação: multi-tenant — um `Client` (whatsapp-web.js) por tenant
(`WhatsAppClientManager`). Mensagens fluem para `CommandHandler` → `AuctionEngine`.

## 4. Ciclo de vida do leilão

Estado: `OPEN` → `CLOSED` ou `CANCELLED`.

1. **Início**: comando `!iniciar` (admin do grupo). Cria o leilão `OPEN` com valor
   inicial e duração padrão (120s). O índice único parcial
   `Auction_one_open_per_group` impede mais de um leilão aberto por grupo.
2. **Lances**: mensagens numéricas no grupo. Regras:
   - valor deve ser **maior** que o lance atual (ou valor inicial);
   - participante é identificado pelo número do WhatsApp (criado/atualizado automaticamente);
   - cada lance aceito redefine `endsAt = now + durationSeconds` (cronômetro estendido).
   - Registro usa transação com `SELECT ... FOR UPDATE` para evitar corridas.
3. **Motor de leilão** (`AuctionEngine`): tick a cada 1s. Avisa "DOU-LHE UMA" (60s) e
   "DOU-LHE DUAS" (30s) antes do fim; ao estourar o prazo, encerra (`CLOSED`) e anuncia
   o vencedor no grupo. A cada 30s varre o banco para recuperar leilões que expiraram
   durante indisponibilidade (estado recalculado do banco no boot).
4. **Encerramento manual**: `!encerrar` (admin do grupo) ou API
   `POST /api/auctions/:id/close` → `CLOSED`.
5. **Cancelamento**: apenas via API (`POST /api/auctions/:id/cancel`) → `CANCELLED`,
   permitido somente para leilões `OPEN`.

O `AuctionEngine` é agnóstico de transporte: expõe `subscribe(sender)` e emite eventos;
`WhatsAppClientManager` se registra como assinante (evita dependência circular).

## 5. Dashboard e relatórios

- `GET /api/dashboard/summary` — indicadores (leilões ativos/encerrados/cancelados,
  receita, maior lance, participantes, lances, grupos, usuários, clientes).
- `GET /api/dashboard/auctions-over-time` / `bids-over-time` — séries para gráficos.
- `GET /api/dashboard/top-products` — ranking por valor total.
- `GET /api/reports/auctions` e `GET /api/reports/auctions/export` (CSV), `.../participants`,
  `.../groups` — relatórios e exportação por período.
- Tudo é **scoped por tenant**: listas e agregações filtram pelo `tenantId` do token.

## 6. Auditoria

- Ações relevantes (login, registro, leilão iniciado/encerrado, conexão WhatsApp etc.)
  são gravadas em `AuditLog` pelo `AuditService`. Consulte no banco para trilha de auditoria.
