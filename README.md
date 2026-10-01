# LanceZap

SaaS de **leilões em grupos do WhatsApp**: um bot lê os lances e encerra o leilão automaticamente, enquanto o painel web (admin) gerencia grupos, leilões, usuários, dashboard e relatórios.

## Arquitetura

| Camada   | Stack                                                                   |
| -------- | ----------------------------------------------------------------------- |
| Backend  | NestJS 11, Prisma 6, PostgreSQL 16, Redis 7, JWT (access + refresh)     |
| Bot      | whatsapp-web.js (sessão local por tenant, QR Code no terminal)          |
| Frontend | React 18, Vite 6, TypeScript, Tailwind v4, TanStack Query 5, Recharts   |
| Infra    | Docker Compose, Nginx (estático + proxy `/api`), GitHub Actions (CI)    |

Estrutura:

```
backend/   API REST + bot WhatsApp (módulos: auth, users, groups, auctions, bids,
           dashboard, reports, whatsapp)
frontend/  SPA de administração (login, registro, dashboard, grupos, leilões, WhatsApp)
docs/      Documentação de fluxos e operação
```

## Pré-requisitos

- Node.js 22+
- Docker + Docker Compose
- npm

> O `docker-compose.yml` publica o PostgreSQL do projeto na porta **5433** para não
> conflitar com um PostgreSQL nativo na 5432. Ajuste `DATABASE_URL` se necessário.

## Configuração

```bash
cp .env.example .env
```

Edite `.env` com segredos fortes (`JWT_SECRET`, `JWT_REFRESH_SECRET`).

## Subindo com Docker (produção local)

```bash
docker compose up --build
```

- Frontend: http://localhost (Nginx serve o build e faz proxy de `/api`)
- API: http://localhost:3000/api
- Swagger: http://localhost:3000/api/docs
- PostgreSQL: `localhost:5433` · Redis: `localhost:6379`

A primeira subida aplica as migrações automaticamente. O seed não roda em produção;
para desenvolvimento:

```bash
cd backend && npm run prisma:seed
```

## Desenvolvimento

**Banco + cache:**

```bash
docker compose up -d postgres redis
```

**Backend** (porta 3000):

```bash
cd backend
npm ci
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run start:dev
```

**Frontend** (porta 5173, proxy `/api` → 3000):

```bash
cd frontend
npm ci
npm run dev
```

Acesso padrão (seed): `admin@botleilao.com.br` / `Admin@12345`.

## Comandos do bot no WhatsApp

Em um grupo vinculado, os participantes digitam lances apenas com números.
Os comandos são restritos a administradores do grupo (WhatsApp):

| Comando      | Ação                                                   |
| ------------ | ------------------------------------------------------ |
| `!vincular`  | Vincula o grupo ao painel usando o código gerado (admin) |
| `!iniciar`   | Inicia o leilão do produto corrente do grupo           |
| `!status`    | Mostra valor atual, vencedor e tempo restante          |
| `!encerrar`  | Encerra o leilão antes do tempo (só admin do grupo)    |
| `!historico` | Últimos lances do leilão atual                         |
| `!ajuda`     | Lista de comandos                                      |

Regras de lance: valor numérico maior que o atual; cada novo lance reinicia o
cronômetro de encerramento (`endsAt = lance + duração`). Avisos "DOU-LHE UMA"
(60s) e "DOU-LHE DUAS" (30s) antecedem o fim.

### Linguagem natural, resposta e áudio

O participante não precisa decorar formato: `25 no capão`, `bolo 25`,
`R$ 300 no item 01`, responder a um card com `46` ou mandar um **áudio** são
todos interpretados pelo mesmo interpretador (`ListBidParser`) e registrados
pelo mesmo serviço (`placeBid`). Números por extenso ("cinquenta") são
convertidos **apenas em transcrições de áudio**; texto digitado passa intacto.

Confiança em três níveis (o bot nunca escolhe o item por conta própria):

- **Alta** (`01 300`, nome exato/único, variação cadastrada, resposta a um card)
  → registra na hora;
- **Intermediária** (nome parecido com erro de digitação/transcrição) → mostra o
  que entendeu e pede `sim`/`não` (expira em 2 minutos, só quem perguntou
  responde; `não, era 180` corrige o valor);
- **Ambiguidade** (`25 no capão` com dois capões) → pergunta o `Nº` do item.

Na disputa, um lance que vem **só com o valor** (`165`, `170`, um áudio "cento e
sessenta e cinco") herda o item da disputa recente (contexto automático de
disputa, válido por 5 minutos por leilão/item). Se dois itens estiverem em
disputa, o bot pergunta o `Nº`; o contexto nunca substitui item explícito,
resposta a card nem o passo "Qual item?", e só é gravado depois que um lance
é registrado com sucesso.

O painel também aceita **variações (sinônimos) por item** — em "Garrote" você
cadastra `boi`, `gado`, `novilho` e o participante pode mandar `150 no boi`,
`180 gado` ou um áudio "cento e oitenta no boi". A variação é evidência forte
(registra direto, confiança 0,96), mas nunca chuta: mesma variação em dois
itens, conflito com o `Nº` ou com a mensagem citada → o bot pergunta qual item.
Só variação ativa vale, ela não cria item novo e não substitui item explícito.

Para ativar o áudio, configure no `.env` (sem chave o bot ignora áudio e pede
para digitar):

```bash
SPEECH_TO_TEXT_PROVIDER=openai-compatible
SPEECH_TO_TEXT_API_KEY=sk-...
SPEECH_TO_TEXT_BASE_URL=https://api.openai.com/v1
SPEECH_TO_TEXT_MODEL=whisper-1
```

## Qualidade

```bash
cd backend
npm run typecheck      # tsc
npm run lint           # eslint (flat config: eslint.config.mjs)
npm test               # 291 testes unitários
npm run test:e2e       # 12 testes e2e (requer Postgres do compose)

cd frontend
npm run typecheck      # tsc
npm run build          # tsc + vite build
```

## CI

`.github/workflows/ci.yml` executa lint, typecheck, testes unitários, build e e2e
do backend (com PostgreSQL via service container) e typecheck + build do frontend.

## Documentação

- `docs/fluxos.md` — fluxos de negócio e operação (leilão, conexão WhatsApp, auth).
- Swagger interativo: `/api/docs` com a API rodando.
