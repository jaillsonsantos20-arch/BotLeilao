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
- Interpretações de lance são gravadas em `Log`
  (`context='bid-interpretation'`, `AuditService` não participa): decisão, confiança,
  `matchedBy`, origem (texto/áudio) e `messageId`. Mensagens ignoradas (conversa
  comum) não geram registro para não poluir a tabela.

## 7. Interpretação de lance (texto, áudio e confirmação)

Um único caminho do texto ao banco:
`WhatsAppClientManager` → `CommandHandler` → `AuctionEngine.handleChatInput` →
`ListBidParser` → `Confidence Engine` → `AuctionsService.placeBid`.
Não existe segundo interpretador nem segundo serviço de lance.

1. **Idempotência**: a mensagem é marcada antes de processar
   (`ProcessedMessageStore`, TTL de minutos) — a reentrega do WhatsApp não
   duplica lance.
2. **Áudio**: `ptt`/`audio` é baixado (`downloadMedia`), limitado por
   `SPEECH_TO_TEXT_MAX_AUDIO_MB` / `MAX_DURATION_SECONDS` e transcrito pelo
   `SpeechToTextService` (provedor OpenAI-compatible). Sem chave de API o bot
   explica e pede para digitar. Falha de provedor/timeout vira mensagem
   amigável — nunca lança exceção nem loga o binário do áudio.
3. **Números falados**: `spokenNumbersToDigits` converte "cinquenta" → 50
   **somente** em transcrições (`source=AUDIO`); texto digitado passa intacto.
4. **Interpretador**: `ListBidParser` devolve `matchedBy`
   (`item_number`, `item_name_exact`, `item_name_partial`, `item_name_fuzzy`,
   `item_alias`, `reply_context`, `active_bid_context`, `none`) e `matchCoverage` (0..1 da cobertura do nome).
5. **Confidence Engine** (função pura `evaluateBidConfidence`):
   - `register` — alta confiança (Nº explícito, nome exato/único, resposta a card);
   - `confirm` — mostra "Entendi R$ X no item Y. Confirma?" e guarda em
     `PendingBidConfirmation` (TTL 2 min, chave `tenant:grupo:usuário`,
     exclusão mútua com o "qual item?"). `sim` registra, `não` cancela,
     `não, era 180` refaz a pergunta com o valor novo; expirou → nada registra;
   - `clarify` — pergunta o `Nº` (nunca escolhe item sozinho);
   - `orient_number` / `orient_format` — orienta o participante;
   - `ignore` — conversa comum, silêncio absoluto (sem registro em `Log`).
   Áudio usa os **mesmos** limites do texto: só a qualidade da transcrição muda,
   e qualidade < 0,7 rebaixa `register` para `confirm`
   (`applyTranscriptionQuality`).
6. **Responder (reply)**: valor sozinho respondendo a um card do bot herda o item
   da mensagem citada (`ReplyContext`), com prioridade sobre o texto digitado.

## 8. Contexto automático de disputa

Lance composto só com o valor (ex.: "165"), sem reply e sem repetir o nome do item,
pode herdar o item de uma disputa recente. Mesmo interpretador, mesmo Confidence
Engine, mesmo `placeBid` — apenas um sinal a mais na avaliação.

1. **Modelo**: `ActiveBidContext` em memória (`activeBidContextStore`), chave
   `tenant:grupo:leilão:item`, com `lastBidId`, `lastBidAmount`, `lastBidUserId`,
   `lastBidAt`, `lastBidMessageId`, `status` (`active`/`closed`), `createdAt`,
   `expiresAt`. É state por processo (como `PendingBidContext` e
   `PendingBidConfirmation`); em multi-réplica cada instância mantém o seu.
2. **Quando nasce**: apenas após `placeBid` bem-sucedido — gravado em
   `placeBidEntry`, o único ponto de registro de todos os caminhos (texto, áudio,
   reply, confirmação). Mensagem recebida e publicação de card **nunca** criam
   contexto. Falha do Bid Service também não cria nem atualiza.
3. **TTL = 300s (5 min)**: maior que a duração de um lance (120s) e que o
   `PendingBidConfirmation` (2 min), para não perder uma sequência de lances;
   curto o bastante para não herdar o valor de um item parado. Expiração é lazy
   (calculada em cada leitura) e há teto de 2000 entradas por processo.
4. **Hierarquia de contexto** (do mais forte ao mais fraco):
   1. item explícito no texto (`02 180`, `180 no bolo`);
   2. reply/citação de um card (`ReplyContext`);
   3. pending context ("Qual item?" → "02");
   4. contexto de disputa ativa (este item);
   5. nenhum → pergunta o `Nº` como sempre.
   Confirmação pendente é resolvida **antes** do parser (ex.: `sim`, `não, era 180`),
   e o reply rápido (`handleChatInput` com `ReplyContext`) roda antes do `handleListBid`.
   Nunca substitui 1–3.
5. **Plausibilidade**: o contexto só vale se `valor > max(lance atual do leilão,
   lastBidAmount)`. Abaixo disso o sinal é descartado e o bot pede o item.
6. **Mais de um item em disputa**: 0 candidatos → `clarify` genérico; ≥2 →
   `clarify` listando **apenas** os candidatos ativos (e cria pending context
   com esses itens); 1 candidato com outro item bloqueado pelo valor → `confirm`.
   O bot **nunca** escolhe sozinho.
7. **Confiança**: base 0,88; +0,04 se o último lance tem ≤60s, +0,02 se ≤120s;
   +0,02 se é o único item em disputa; teto 0,95. ≥0,90 → `register`,
   ≥0,80 → `confirm` (forçado quando há bloqueio por valor).
8. **Isolamento**: contexto é por tenant, grupo, leilão e item — um grupo/tenant
   nunca herda a disputa do outro. Item `CLOSED` ou leilão fora da lista é
   marcado como fechado na leitura (auto-cura) e deixa de valer.
9. **Corridas**: `record()` é monotônico — ignora escrita com `lastBidAt` menor
   que o atual; a ordem final continua vindo do banco (transação/`FOR UPDATE`).
10. **Auditoria**: em `Log` (`bid-interpretation`) aparece
    `matchedBy='active_bid_context'`, `confidence`, `result`, `lastContextBidId`
    (lance anterior do contexto), `source` (TEXT/AUDIO) e `messageId`.
11. **Limitação conhecida**: o contexto só existe **depois** que o item tem um
    lance registrado — o primeiro lance de um item continua exigindo item
    explícito, reply ou o passo "Qual item?".

## 9. Variações dos itens (sinônimos)

O administrador cadastra no painel outros nomes para o item ("Garrote" → boi,
gado, novilho). O participante manda "150 no boi" e o bot resolve para o item
01. **Mesmo interpretador, mesmo Confidence Engine, mesmo `placeBid`** — a
variação é apenas mais uma evidência do `matchedBy`.

1. **Modelo**: `ItemAlias` (`tenantId`, `itemId`, `value`, `normalizedValue`,
   `active`), unicidade `(itemId, normalizedValue)` e índice em
   `(tenantId, normalizedValue)`. A variação pertence ao item (e ao tenant do
   item): nunca cria item novo, nunca circula entre tenants.
2. **Cadastro**: `POST/PATCH/DELETE /items/:id/aliases(/:aliasId)` e o campo
   `aliases` do `POST /items`. Normalização **única** (`normalizeMessage`):
   minúsculas, sem acentos, espaços colapsados e pontuação só nas bordas
   ("Bói!" → "boi") — a mesma que o parser usa para casar. Rejeita: texto
   repetido no mesmo item, variação só numérica (competiria com o Nº), vazio
   ou só pontuação, >60 caracteres e mais de 30 por item.
3. **Interpretação**: o snapshot do leilão manda só as variações **ativas** —
   desativar tira da interpretação na hora, sem apagar (o painel lista todas,
   inclusive inativas, para reativar). A variação é considerada **antes** da
   comparação por nome e devolve `matchedBy='item_alias'`, `matchedText` (a
   variação usada) e `matchCoverage=1`.
4. **Confiança**: `item_alias` = 0,96 (`register`), atrás só de reply (0,97) e
   Nº (0,97), acima de nome exato (0,95). Motivo do §9:
   `Correspondência exata com variação cadastrada para o item ("boi").`
5. **Nunca chuta** (§27): mesma variação em 2 itens → `clarify` com os dois
   candidatos; variação x nome forte (≥0,85) de outro item → `clarify`;
   variação + Nº explícito/solto de outro item → `clarify` (o Nº não é
   ignorado); reply do item A + variação do item B → `clarify` (a mensagem
   citada vence). Duas variações do **mesmo** item não são conflito.
6. **Prioridades preservadas**: item explícito > variação; variação > nome
   fraco; e o contexto de disputa ativa nunca vence (item resolvido desliga o
   sinal). Sem valor na mensagem não há lance: variação sozinha nunca
   registra.
7. **Auditoria**: `Log.bid-interpretation` grava `matchedBy='item_alias'`,
   `matchedText`, `originalMessage`, `normalizedMessage` e o motivo.
8. **Limitação**: não existe plural/stemming — "bois" não casa "boi"
   (decisão §13; o fuzzy do nome cobre erro de digitação).
