# Resumo do Sistema — LanceZap

> Resumo técnico e comercial para pesquisa de mercado.

## O que é

SaaS de **leilões em grupos do WhatsApp**: um bot lê os lances enviados como
mensagens e encerra o leilão automaticamente, enquanto um painel web administra
grupos, leilões, usuários e relatórios.

## Público-alvo

- Vendedores/leiloeiros que já vendem por WhatsApp (grupos)
- Empresas que querem automatizar lances sem app próprio
- Nichos: consignados, usados, agro, colecionáveis

## Funcionalidades principais

- **Bot de lances:** participantes digitam o valor no chat; cronômetro se estende
  a cada lance; avisos "DOU-LHE UMA/DUAS" (60s/30s) e encerramento automático.
- **Comandos no grupo** (`!vincular`, `!iniciar`, `!status`, `!encerrar`,
  `!historico`) restritos a admins do grupo.
- **Painel web:** dashboard com indicadores, gestão de grupos/leilões/itens/
  clientes, conexão do WhatsApp por QR Code.
- **Relatórios e exportação CSV** por período.
- **Multi-tenant** (uma sessão WhatsApp por cliente) com RBAC (Super Admin /
  Admin / User).

## Diferenciais

- Zero app para o comprador — basta digitar o número no grupo.
- Automação total do ciclo: lance → cronômetro → fechamento → vencedor → relatório.
- QR Code faz conexão fácil e sessão persistida (reconexão automática).
- Modelo SaaS com planos e assinaturas, multi-tenant por cliente.

## Modelo de negócio

SaaS com cadastro (tenant) + planos, preparado para cobrança recorrente
(módulos `plans`/`subscriptions`).

## Stack técnica

- Backend: NestJS 11, Prisma 6, PostgreSQL 16, Redis 7, JWT, whatsapp-web.js
- Frontend: React 18, Vite, TypeScript, Tailwind, TanStack Query, Recharts
- Infra: Docker Compose, Nginx, GitHub Actions (CI)
- Qualidade: 21 testes unitários + 12 testes e2e

## Pontos a validar na pesquisa de mercado

- Concorrência direta (bots de leilão WhatsApp existentes) e preços praticados.
- Fit do "lances por mensagem" vs. apps de leilão dedicados.
- Barreira: dependência da API não-oficial do WhatsApp (risco de bloqueio de número).