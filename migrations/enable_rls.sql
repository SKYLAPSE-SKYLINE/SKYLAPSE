-- =====================================================================
-- SkyLapse — Habilitar Row Level Security (RLS) em todas as tabelas
-- =====================================================================
--
-- CONTEXTO:
-- O backend (Drizzle) conecta no Supabase como usuário `postgres` (superuser),
-- que IGNORA RLS por padrão. Logo, ativar RLS NÃO afeta o app.
--
-- O QUE ISSO PROTEGE:
-- Bloqueia 100% o acesso via PostgREST (REST API automática do Supabase) usando
-- as roles `anon` e `authenticated`. Se a anon key vazar, o atacante não
-- consegue ler/escrever nada nas tabelas.
--
-- COMO RODAR:
-- 1. Abra o painel do Supabase → SQL Editor
-- 2. Cole este arquivo inteiro
-- 3. Run
-- 4. Verifique no Table Editor: cada tabela deve mostrar "RLS enabled"
--
-- REVERTER (caso necessário):
-- ALTER TABLE <nome> DISABLE ROW LEVEL SECURITY;
-- =====================================================================

ALTER TABLE clients              ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE cameras              ENABLE ROW LEVEL SECURITY;
ALTER TABLE captures             ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_accounts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_camera_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE timelapses           ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_accounts       ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- Verificação — rode este SELECT depois para confirmar.
-- Todas as 10 linhas devem mostrar `rowsecurity = true`.
-- =====================================================================
--
-- SELECT tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
-- ORDER BY tablename;
