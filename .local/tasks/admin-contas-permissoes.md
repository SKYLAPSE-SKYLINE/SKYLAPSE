# Portal Admin — Gestão de Contas de Clientes

  ## What & Why
  O admin precisa criar e gerenciar contas de acesso para os clientes, definindo e-mail, senha e quais câmeras estarão visíveis. O cliente acessa o portal com e-mail/senha e vê apenas o que o admin configurou. O admin pode adicionar ou remover câmeras da conta do cliente a qualquer momento — na próxima vez que o cliente entrar, as mudanças já estarão lá.

  Como o Replit Auth não permite criar usuários programaticamente, os clientes terão um sistema de autenticação próprio por e-mail e senha (separado do login admin). Isso já prepara a migração futura para Supabase Auth, onde o admin também cria as contas dos usuários.

  ## Done looks like
  - Nova tabela `client_accounts` no banco com: e-mail, senha (hash bcrypt), nome, status (ativo/inativo), vinculada ao cliente (`clienteId`)
  - Nova tabela `client_camera_access` definindo quais câmeras cada conta de cliente pode ver
  - Página "Contas de Clientes" no menu admin com:
    - Lista de contas criadas com nome, e-mail, cliente vinculado, status e qtd de câmeras
    - Formulário "Nova Conta" com: nome, e-mail, senha inicial, cliente (dropdown), câmeras visíveis (checkboxes por localidade)
    - Editar conta: alterar nome, e-mail, senha, status e câmeras
    - Excluir conta
  - Ao editar as câmeras de uma conta, o cliente vê as mudanças imediatamente no próximo acesso
  - Sistema de login separado em `/login` com formulário e-mail/senha para clientes
  - Sessão de cliente com JWT ou express-session separada da sessão admin
  - Proteção: clientes autenticados só acessam as rotas `/cliente/*`, nunca `/admin/*`

  ## Out of scope
  - Portal do cliente (as telas que o cliente vê) — tarefa futura
  - Recuperação de senha por e-mail — futura
  - Login do admin alterado (continua via Replit Auth por enquanto)

  ## Tasks
  1. **Schema e banco** — Criar tabelas `client_accounts` (id, clienteId, nome, email, senhaHash, status, createdAt) e `client_camera_access` (id, clientAccountId, cameraId). Rodar db:push para aplicar.

  2. **API de autenticação de clientes** — Criar endpoint `POST /api/client/login` que valida e-mail/senha com bcrypt e retorna sessão/token. Criar middleware `isClientAuthenticated` para proteger rotas do portal do cliente.

  3. **API de gestão de contas (admin)** — Criar endpoints CRUD em `/api/admin/client-accounts`: listar, criar (com hash bcrypt da senha), editar, excluir e atualizar câmeras vinculadas à conta.

  4. **Página "Contas de Clientes" no admin** — Criar a página `/admin/contas` com tabela de contas e formulário de criação/edição. O formulário deve ter: nome, e-mail, senha, dropdown de cliente e checkboxes de câmeras agrupadas por localidade. Adicionar item no menu lateral do admin.

  ## Relevant files
  - `shared/schema.ts`
  - `shared/models/auth.ts`
  - `server/routes.ts`
  - `server/storage.ts`
  - `server/replit_integrations/auth/replitAuth.ts`
  - `client/src/App.tsx`
  - `client/src/components/app-sidebar.tsx`
  - `client/src/pages/admin/clientes.tsx`
  