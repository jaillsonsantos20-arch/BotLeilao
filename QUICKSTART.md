# BotLeilão — Início rápido (rodar tudo na sua máquina)

Este modo sobe o **produto completo** localmente em poucos passos: banco de dados
(PostgreSQL), cache (Redis), API + bot do WhatsApp e o painel web (tudo em Docker).
Ao final você tem login pronto e pode se conectar ao WhatsApp para testar.

## Requisitos

- **Docker** e **Docker Compose** instalados.
  - Windows/macOS: instale o *Docker Desktop*.
  - Linux: `sudo apt install docker.io docker-compose-plugin`
- Um **número de WhatsApp** dedicado (a sessão do bot fica logada nela).

## Passo 1 — Prepare as configurações

Copie o arquivo de exemplo:

```bash
cp .env.example .env
```

Em produção/VPS, **troque** em `.env`:
- `SEED_ADMIN_PASSWORD` (senha do administrador, padrão `Admin@12345`)
- `JWT_SECRET` e `JWT_REFRESH_SECRET` (segredos longos e aleatórios)
- `WHATSAPP_BROWSER_PATH=/usr/bin/chromium` (Chromium do container)

> O `docker-compose.yml` já define o `DATABASE_URL`, `REDIS_HOST` etc. para os
> serviços internos: você **não precisa** editar essas linhas.

## Passo 2 — Subir tudo

```bash
docker compose up -d --build
```

Na **primeira** subida, o backend é construído, aplica as migrações do banco e
**cria automaticamente o administrador** (não precisa rodar nenhum comando).

## Passo 3 — Acessar

Abra no navegador: **http://localhost**

Entre com o administrador (campos vêm do seu `.env`):

- E-mail: `admin@botleilao.com.br`
- Senha: `SEED_ADMIN_PASSWORD` (padrão `Admin@12345`)

## Passo 4 — Conectar o WhatsApp (botão)

1. No painel, vá em **WhatsApp**.
2. Clique em **Conectar**.
3. Escaneie o QR com o WhatsApp do número dedicado.
4. Status da sessão deverá ficar **Conectado**. A sessão é preservada em disco,
   então ela reconecta automaticamente em reinícios.

## Testar um leilão de verdade

1. Crie um grupo no WhatsApp e adicione o número do bot como **admin**.
2. Em **Grupos**, cadastre o grupo (via link/participante).
3. Em **Leilões → Criar novo leilão**, cadastre itens e **inicie** no grupo.
4. Os participantes enviam lances por mensagem; o botão captura o lance vencedor
   e o fechamento; o pagamento aparece no **Relatório**.

## Comandos úteis

```bash
docker compose ps                 # estado dos serviços
docker compose logs -f backend    # logs do API e do bot
docker compose restart backend    # reinicia o API/bot
docker compose down               # Derubar (mantém os dados)
```

## Princípio primeiro acesso (segurança)

Troque a senha do admin no painel após o primeiro login e use segredos JWT fortes
antes de colocar em produção. Para um servidor público/Https, siga o `DEPLOYMENT.md`.