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

## Deploy Manual no Render (Opcional)

Se preferir não usar o Blueprint, configure os serviços manualmente seguindo estas regras:

### 1. API (Web Service) e Worker (Background Worker)
- **Root Directory**: `.`
- **Build Command**: `npm install && npx prisma generate --schema=apps/api/prisma/schema.prisma && npm run build --workspace api` (troque `api` por `worker` no worker).
- **Start Command**: `npm run start --workspace api` (troque `api` por `worker` no worker).

### 2. Frontend (Web Service)
- **Root Directory**: `.`
- **Build Command**: `npm install && npm run build --workspace web`
- **Start Command**: `npm run start --workspace web` (O script já está configurado para ouvir em 0.0.0.0).


### Checklist de Aceite - Etapa 0

- [x] Web abre em http://localhost:3000
- [x] API responde GET http://localhost:3001/health (200)
- [x] API responde GET http://localhost:3001/db/ping (db ok)
- [x] POST http://localhost:3001/queue/test enfileira job
- [x] Worker processa job “teste” e loga sucesso
- [x] Redis conectado (log)
- [x] Postgres conectado (log)

---

## ETAPA 1 - Identidade SaaS (Login, Tenant e Isolamento)

A etapa 1 adiciona o sistema de contas, a estrutura multi-tenant (múltiplas organizações) e a segurança baseada em JWT Cookies via Fastify.

### Novas Variáveis de Ambiente Necessárias
Adicione ao seu `.env` na pasta `apps/api`:
* `JWT_SECRET=super_secret_jwt_key_here` (Obrigatório! No Render, preencha com um hash forte).
* `COOKIE_DOMAIN=seu-dominio.com` (Opcional, usado em produção para compartilhar cookies).
* `COOKIE_SECURE=true` (Recomendado no Render/Prod).

### Como testar o fluxo da Etapa 1
1. **Signup:** Acesse `http://localhost:3000/signup`. Crie uma conta com seu email, senha e nome do seu primeiro Tenant (Organização).
2. **Login Automático:** Após criar a conta, você será redirecionado automaticamente para a área logada `/app`.
3. **Área Protegida:** Se tentar acessar `/app` sem estar logado, será redirecionado para `/login`.
4. **Gerenciar Tenants:** Clique no menu lateral "Tenants" para listar suas organizações atuais e criar novas.
5. **Alternar Tenants:** Crie um novo Tenant. Você verá que o "Tenant Atual" (no topo) permanece o original até que você clique em "Acessar" na nova organização, emitindo um novo token restrito àquele tenant.
6. **Validar via API (`/auth/me`):** Essa rota certifica que o backend e o frontend estão interpretando os mesmos cookies e mantendo as informações da sessão seguras e atualizadas.
*(Opcional: use o arquivo `apps/api/src/http/examples.http` e uma extensão como REST Client no VSCode para testar diretamente na API).*

### Checklist de Aceite - Etapa 1

- [x] Signup cria usuário e tenant (ou tenant default) e autentica
- [x] Login autentica e retorna sessão válida
- [x] `/auth/me` retorna usuário + tenant atual + role
- [x] `/tenants` lista apenas tenants do usuário
- [x] `/tenants/select` só permite tenant pertencente ao usuário (senão 403/404)
- [x] Isolamento por tenant aplicado em rotas tenant-scoped
- [x] Audit log grava signup/login/logout/create_tenant/select_tenant
- [x] Front possui `/login` `/signup` `/app` com navegação e proteção de rota
- [x] ETAPA 0 continua funcionando (web, /health, worker job)

---

## ETAPA 2 - Modelo de Dados Canônico (Pedidos/Devoluções)

A Etapa 2 estabelece o schema do banco de dados para suportar a operação principal: `customers`, `orders`, `returns`, etc. Todos sob a arquitetura multilocatário construída na Etapa 1.
- Para validar: repare que o retorno agora trará os campos que mapeamos (`external_id`, `status`, `refund_amount_cents`). Tente acessar outro tenant e confirme que a listagem de pedidos desse outro não mistura os dados.

---

## Etapa 3: Ingestão de Dados CSV (Pipeline & Worker)

Esta etapa consolida o suporte para onboarding rápido (Fallback) via importação de planilhas.

1. **Upload no Front-End:** Acesse a plataforma em `/app/import`.
2. **Histórico:** Você será redirecionado para os detalhes após enviar, onde poderá testar o Polling simulado pelas apurações da API. Também há uma página de listagem em `/app/imports`.
3. **Upload via cURL (Backend Auth Required):**
   ```bash
   curl -X POST http://localhost:3001/imports/csv \
     -H "Cookie: token=SEU_TOKEN_AQUI" \
     -F "entityType=orders" \
     -F "file=@./samples/csv/orders.sample.csv"
   ```

**Testando Validadores e Idempotência:**
- O worker realiza leitura assíncrona. 
- Suba o arquivo `samples/csv/orders.sample.csv`.
- Você observará um pedido falso e uma linha vazia (causando um erro na validação de dependências). No fim, a listagem mostrará 1 sucesso e 1 erro justificado.

---

## Etapa 4: Engenharia de Features (Sinais Anti-Fraude Core)

Esta etapa calcula determinicamente e materializa os alertas cruciais em torno de cada Devolução, rodando via Background Worker (BullMQ) e consumindo no banco de dados via _FeaturesSnapshot_.

### Como Validar 100% no Render (Sem Localhost)

Como sua stack agora é gerenciada majoritariamente no Render, siga este roteiro simplificado para validar sem depender de ferramentas locais:

**A) Descubra suas URLs Púbicas no Render Dashboard**
- `API_BASE_URL` = (Ex: https://api-antifraude-123.onrender.com)
- `WEB_BASE_URL` = (Ex: https://web-antifraude-123.onrender.com)

**B) Processo Automático pela Interface Web (Recomendado)**
1. Acesse o seu `WEB_BASE_URL` e faça o Login.
2. Navegue até **Importações CSV** no menu lateral.
3. Suba um CSV válido de **Pedidos (Orders)** e depois um de **Devoluções (Returns)** (você pode usar os do repositório em `samples/csv/`).
4. Navegue até **Devoluções** pela barra lateral.
5. Clique em **Ver Alertas** numa devolução recente.
6. A página mostrará os alertas ("Sinais não computados").
7. Clique em **Recalcular Sinais**. O Frontend acionará a API, enfileirará o Worker e fará "polling" até atualizar a tela com os sinais calculados!

**C) Validando pelo cURL via Terminal**
*(Substitua `API_BASE_URL`, `TOKEN` e `ID_DA_DEVOLUCAO`)*
```bash
# 1. Enfileirar o re-cálculo de sinais (Apenas para Owner/Admin)
curl -X POST \
  https://API_BASE_URL/returns/ID_DA_DEVOLUCAO/compute-features \
  -H "Cookie: token=SEU_TOKEN_AQUI"

# 2. Resgatar Detalhes e Sinais
curl -X GET \
  https://API_BASE_URL/returns/ID_DA_DEVOLUCAO/details \
  -H "Cookie: token=SEU_TOKEN_AQUI"
```

**D) Verificando os Logs do Worker**
Dentro do dashboard do Render, acesse o serviço do **Worker**:
- Procure por `[Worker] Started compute_features_for_return for Return...`
- Procure por `[Worker] snapshot saved for returnId...`

Isso valida todo o ciclo assíncrono entre banco, worker e front-end!

---

## Etapa 5: Motor de Risco (IA MVP) e Explicabilidade

Nesta etapa acoplamos ao pipeline de features o nosso **Motor de Risco** que determina uma nota de fraude real (0 a 100) baseada nos dados do *FeaturesSnapshot*.

### Como Validar o fluxo de Explicabilidade no Render
1. Acesse o seu `WEB_BASE_URL` (Painel Web no Render) e faça Login.
2. Certifique-se de que já importou um CSV de Pedidos e Devoluções (Etapa 3) para ter dados no banco.
3. Abra o Menu **Devoluções** (`/app/returns`). Ali, você notará as novas colunas: **Score IA** e **Tags (Motivos)**. Inicialmente dirão _"Sem score"_ ou _"—"_.
4. Entre em uma Devolução (Clique em *Ver Alertas*).
5. Se as _Features_ ainda não constarem como calculadas ali, clique para **Recalcular Sinais**.
6. Agora, atente-se ao Card "Risco (IA MVP)". Se disser "Indisponível", clique em **Recalcular Score**.
7. O front emitirá um Job para a fila, o Worker o processará e gerará as pontuações. A página se atualizará automaticamente!
8. **Analise o resultado final:** 
   - A nota central indicará um Score entre 0 e 100 e uma % de Confiança (Se bater `80` a cor do badge vai pra vermelho).
   - O painel lateral explicará o "Por Quê?" detalhando *Reasons* (ex: "Devolução na primeira semana"), a *Severidade* e as **Evidências matemáticas**.

**Dica de Logs:** Volte ao painel do Render > Worker. Você deve ver o log: `[Worker] fraud_score inserted for returnId...`

### Endpoint Oculto de Re-Cálculo de Fraude (Testes via cURL)
```bash
POST https://API_BASE_URL/returns/SEU_ID/compute-score
Cookie: token=SEU_TOKEN
```

---

## Etapa 6: Workflow Antifraude (Fila de Casos)

A etapa final do núcleo operacional amarra o Score de Risco à tomada de decisão humana, auditando todos os vereditos num funil focado.

### Como Validar o fluxo de Operações no Render
1. Acesse o seu `WEB_BASE_URL` (Painel Web no Render) e faça Login como **Owner** ou **Admin**.
2. Certifique-se de ter importado um CSV (Etapa 3) e gerado sinais/scores (Etapa 4/5) em algumas mercadorias.
3. No Menu Lateral, perceba a aba nova **Fila de Casos**. Clique nela.
4. A lista exibirá *somente devoluções abertas* ordenadas pelas piores notas de Fraude e Valores mais altos. (Você não verá as decisões já resolvidas aqui).
5. Clique em **Abrir Caso** numa das linhas com Score vermelho/alto.
6. A tela carrega todos os motivos apontados pela IA na esquerda e na direita o novo widget **Decisão Operacional**.
7. Teste a Restrição RBAC (se puder logar como Analyst depois, este painel só permite "Leitura").
8. Selecione **Negar** (Fraude identificada) ou **Pedir Evidência**. Preencha no mínimo 5 caracteres na Nota de Auditoria Obrigatória e clique em **Gravar Decisão (Auditoria Ativa)**.
9. O sistema disparará um Toast de Sucesso e lhe encaminhará devolta para a `/app/cases`.
10. Confirme que o caso que você testou **não aparece mais na fila de pendientes!**

**Testando a Trilha de Auditoria (Logs):**
- A API (não o Worker, dessa vez a API bloqueia síncronamente) vai carimbar no banco a sua ação: `[API] decision criadas...`
- Toda ação ali escreve silenciosamente na Database nativa `AuditLog` o payload de `{ returnId, decision, noteLength, scoreAtDecision }` protegendo quem negou o que e o porquê.

### Endpoint Direto de Casos (Testes via cURL)
Listagem direta das pendências:
```bash
GET https://API_BASE_URL/cases
Cookie: token=SEU_TOKEN
```

Aprovar/Negar Case:
```bash
POST https://API_BASE_URL/cases/SEU_ID/decision
Cookie: token=SEU_TOKEN
Content-Type: application/json

{ "decision": "reject", "note": "Recusado confome regras" }
```

---

## Etapa 7: Relatório Financeiro (ROI)

Nesta etapa exibimos o valor do sistema antifraude através de Dashboards e Rankings focados em Perda Estimada vs. Fraude Evitada.

### Como Validar o ROI no Render
1. Faça login no seu `WEB_BASE_URL` (Painel Web no Render).
2. Garanta que existam devoluções com Score gerado (Etapa 5) e casos operados/decididos (Etapa 6).
3. No menu lateral, acesse **Dashboard ROI** (`/app/dashboard`).
   - Verifique os cards: Perda Estimada (R$), Fraudes Evitadas (R$), Volume de Risco e Casos Pendentes.
   - Troque o período (7d, 30d, 90d) para atestar os filtros.
   - Valide se os Top Motivos de Alerta e Top Clientes com Risco estão listados abaixo.
4. Acesse o menu **Relatórios** (`/app/reports`).
   - Use os inputs de data `De/Ate` para selecionar um período e clique em **Aplicar Filtro**.
   - Veja a tabela de Top 50 Sinais e a tabela de Top 50 Clientes detalhando devoluções aprovadas, pendentes e rejeitadas.
5. Validação via HTTP direta na API:
   - `GET` para `https://API_BASE_URL/metrics/top-reasons?range=30d&limit=10`.
   - Tudo formatado e Tenant-Scoped baseado no Authentication Token!

---

## Etapa 8: Conector Shopify (Integração Automática)

Nesta etapa, o sistema passa a permitir a sincronização automatizada de Pedidos e Devoluções (via Refunds) direto da loja Shopify do Tenant através de autenticação OAuth e Background Jobs.

### Como Validar o fluxo de Conectores no Render (Sem Localhost)

1. **Configuração de Variáveis (Render - API Service)**:
   Garanta que seu serviço da API no Render contenha as seguintes variáveis de ambiente:
   - `SHOPIFY_API_KEY`: A chave pública do seu App Customizado no Shopify Partners.
   - `SHOPIFY_API_SECRET`: O Client Secret do app.
   - `SHOPIFY_SCOPES`: `read_orders,read_customers,read_returns`
   - `APP_BASE_URL`: `https://SEU_DOMINIO_WEB.onrender.com` (Opcional para redirect).
   - `SHOPIFY_OAUTH_CALLBACK_URL`: `https://SEU_DOMINIO_API.onrender.com/connectors/shopify/callback`
   - `ENCRYPTION_KEY_BASE64`: Uma chave simétrica base64 de exatos 32 bytes (utilizada para criptografia de repouso segura do Token `AES-256-GCM`).

2. **Configuração no Shopify Partners**:
   - Entre no painel do seu App Shopify.
   - Na seção "Allowed redirect URLs", insira EXATAMENTE o valor do seu `SHOPIFY_OAUTH_CALLBACK_URL` configurado no Render.
   - Na "App URL", insira o seu `APP_BASE_URL`.

3. **Iniciando Onboarding no Front-End**:
   - Faça Login no Painel Web (`/app`).
   - Navegue pelo Menu Lateral até **Conectores**.
   - Você verá o botão para *Conectar Shopify*.
   - Digite o domínio da sua loja de teste (ex: `dev-loja.myshopify.com`) e clique.

4. **Autorização OAuth**:
   - Você será levado à tela da Shopify para aprovação.
   - Após consentir as permissões, o Shopify redirecionará de volta à nossa API e logo em seguida para a tela Web de Conectores exibindo status verde de **Conectado**.

5. **Sincronização Incremental (Worker)**:
   - Na tela raiz de Conectores, clique no botão rotativo **Sincronizar agora**.
   - O Worker BullMQ receberá o Job `shopify_sync`.
   - Via paginação GraphQL, o Worker extrairá os últimos pedidos e *Refunds*, convertendo-os em nossa modelagem Canônica Universal (Customers, Orders, Returns, OrderItems).
   - Simultaneamente, ao encerrar o upsert e a normalização de cada *Return*, o worker dispara uma reação em cadeia chamando `compute_features` e encadeando `compute_risk_score`.

6. **Validação Final**:
   - Cheque a aba **Devoluções**. As importações recentes do Shopify constarão lá.
   - Cheque a aba **Fila de Casos**. As mercadorias sincronizadas cuja Inteligência Artificial julgou fraude de alto-risco já aparecerão sozinhas ali para análise humana!
   - Navegue pro **Dashboard ROI**. Novas importações atualizam os rankings de forma fluida.

**Notas de Segurança:** Os Tokens de Acesso à Shopify não ficam expostos em tela e são gravados no banco de dados duplamente bloqueados (AES-256 GCM) com Initialization Vector aleatório e Authentication Tag verificadora.

### Como testar o fluxo da Etapa 2
1. **Migrations**: Rode a migração `prisma migrate dev` para criar as 11 novas tabelas base.
2. **Setup Fake Data**: Popule o banco para isolamento rodando:
   ```bash
   npm run seed:canonical --workspace api
   ```
   *(Este script cria 2 usuários proprietários distintos `ownerA@seed.com` e `ownerB@seed.com`, além de criar pedidos e devoluções que pertencem exclusivamente a cada tenant.)*
3. **Validar via REST Client (VSCode)**:
   - Abra o arquivo `apps/api/src/http/examples.http`.
   - Use o Snippet de *Login* com as credenciais `ownerA@seed.com` (senha: `password123`).
   - Use o Snippet de *Get Orders*. Você só poderá enxergar "ext-order-A1".
   - Inverta o Login para `ownerB@seed.com` e rode novamente. Só verá o B1 aprovando a separação e o isolamento seguro.

### Checklist de Aceite - Etapa 2
- [x] Multi-tenant isolamento rígido em `orders` e `returns` API usando `req.auth.tenantId`.
- [x] Todas as novas 11 tabelas adicionadas ao `schema.prisma` com `tenant_id` e PKs UUID exclusivas.
- [x] Script `seed_canonical.ts` funcional e idempotente testando dois tenants separados.
- [x] GET `/orders` e `/returns` retornam dados limpos, paginados e sem vazar informações.
- [x] Não vazou lógicas/telas do Front além do acesso contínuo às rotas e sessão existentes.

