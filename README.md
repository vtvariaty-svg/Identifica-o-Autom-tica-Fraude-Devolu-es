# Identificação Automática de Fraude em Devoluções

Este repositório contém o código-fonte da ETAPA 0 (Infraestrutura Base) do SaaS de Identificação Automática de Fraude em Devoluções.

## Estrutura do Monorepo

*   `apps/web`: Frontend em Next.js (App Router)
*   `apps/api`: Backend Fastify
*   `apps/worker`: Worker consumindo fila do Redis usando BullMQ
*   `packages/shared`: Tipos comuns
*   `infra/`: Configuração do Docker Compose

## Dependências
* Node 20+

## Como rodar localmente (Dev)

1. Crie os arquivos `.env` baseados nas variáveis listadas abaixo (em `apps/api` e `apps/worker`).
2. Suba o banco e o redis:
   ```bash
   cd infra && docker-compose up -d
   ```
3. Instale as dependências:
   ```bash
   npm install
   ```
   **Nota:** Se usar WSL/Windows, utilize preferencialmente o comando `wsl npm install` para evitar problemas de filesystem (conforme a recomendação no desenvolvimento dessa etapa).
4. No diretório `apps/api`, rode a migration inicial do Prisma:
   ```bash
   npx prisma migrate dev --name init
   ```
5. Inicie todos os serviços:
   ```bash
   npm run dev
   ```

## Variáveis de Ambiente Necessárias

**API (`apps/api/.env`):**
* `NODE_ENV=development`
* `PORT=3001`
* `DATABASE_URL=postgres://user:password@localhost:5432/fraud_db`
* `REDIS_URL=redis://localhost:6379`
* `LOG_LEVEL=info`

**Worker (`apps/worker/.env`):**
* `NODE_ENV=development`
* `DATABASE_URL=postgres://user:password@localhost:5432/fraud_db`
* `REDIS_URL=redis://localhost:6379`
* `LOG_LEVEL=info`

**WEB (`apps/web/.env.local`):**
* `NEXT_PUBLIC_API_URL=http://localhost:3001`

## Testando / Aceite

Utilize as seguintes rotas e ações para verificar se tudo subiu corretamente:

- **WEB:** Abra `http://localhost:3000` no navegador, você deverá ver a nova tela e o placeholder do dashboard em `/dashboard`.
- **API Health:** `curl http://localhost:3001/health` (deve retornar HTTP 200).
- **API DB Ping:** `curl http://localhost:3001/db/ping` (verifica a conexão com o PG).
- **Worker Job:** `curl -X POST http://localhost:3001/queue/test` para enfileirar e observe o console do `worker` processando o log de sucesso.

## Deploy no Render (Staging)

Temos um arquivo `render.yaml` na raiz para Blueprint configuration do Render.
1. No dashboard do Render, crie um novo "Blueprint" apontando para este repositório.
2. Certifique-se de preencher as variáveis secretas (DATABASE_URL e REDIS_URL) referentes aos serviços provisionados (ex. Neon e Redis Addon).
3. Após criar, os 3 serviços serão provisionados: api, web e worker. O worker e a API apontam para a estrutura em Node do monorepo, e o web faz build de Next.js.
4. Ao final da API conectar, configure `NEXT_PUBLIC_API_URL` do frontend para a url da API no ambiente Render.

Para migrar a base no Render, recomendamos utilizar o console nativo SSH após deploy da API/Worker ou adicioná-lo num _Pre-Deploy command_ (ex: `npx prisma migrate deploy`).

### Checklist de Aceite

- [x] Web abre em http://localhost:3000
- [x] API responde GET http://localhost:3001/health (200)
- [x] API responde GET http://localhost:3001/db/ping (db ok)
- [x] POST http://localhost:3001/queue/test enfileira job
- [x] Worker processa job “teste” e loga sucesso
- [x] Redis conectado (log)
- [x] Postgres conectado (log)
