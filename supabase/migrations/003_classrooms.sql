-- ============================================================================
--  Миграция 003: аудитории и компьютеры у задач.
--  Выполнить в Supabase: SQL Editor → New query → вставить и Run.
-- ============================================================================

alter table public.tasks
  add column if not exists classroom text;

alter table public.tasks
  add column if not exists computer text;
