-- ============================================================================
--  ИТ-Задачи — трекер задач для сисадмина. Схема базы данных Supabase.
--  Как применить: Supabase Dashboard → SQL Editor → New query → вставить
--  весь этот файл → Run.
--
--  Вход в систему — по ЛОГИНУ (username). Внутри логин превращается в
--  email вида "<логин>@it.local" для Supabase Auth.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Профили пользователей
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  username text,
  role text not null default 'executor'
    check (role in ('admin', 'boss', 'executor')),
  created_at timestamptz not null default now()
);

create unique index if not exists profiles_username_uniq
  on public.profiles (username)
  where username is not null and username <> '';

-- ---------------------------------------------------------------------------
-- 2. Задачи
-- ---------------------------------------------------------------------------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  status text not null default 'new'
    check (status in ('new', 'in_progress', 'waiting', 'done', 'cancelled')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  created_by uuid not null references public.profiles (id) on delete cascade,
  assigned_to uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. Записи о ходе решения (комментарии)
-- ---------------------------------------------------------------------------
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null default '',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4. Вложения (фото проблемы / решения)
-- ---------------------------------------------------------------------------
create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  comment_id uuid references public.comments (id) on delete cascade,
  storage_path text not null,
  url text not null,
  kind text not null default 'other'
    check (kind in ('problem', 'solution', 'other')),
  uploaded_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Индексы для быстрых выборок
create index if not exists tasks_created_by_idx on public.tasks (created_by);
create index if not exists tasks_assigned_to_idx on public.tasks (assigned_to);
create index if not exists tasks_updated_at_idx on public.tasks (updated_at desc);
create index if not exists comments_task_id_idx on public.comments (task_id);
create index if not exists attachments_task_id_idx on public.attachments (task_id);
create index if not exists attachments_comment_id_idx on public.attachments (comment_id);

-- ---------------------------------------------------------------------------
-- Триггеры
-- ---------------------------------------------------------------------------

-- Автосоздание профиля при регистрации. Роль всегда «исполнитель»
-- (нельзя самому себя назначить админом), логин из метаданных/email.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, username, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)),
    'executor'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Обновление updated_at при изменении задачи
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security (RLS)
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.comments enable row level security;
alter table public.attachments enable row level security;

-- Проверка «текущий пользователь — админ» (security definer, без рекурсии RLS)
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Профили: все аутентифицированные видят (нужно для имён и назначения).
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated using (true);

-- Свой профиль можно создать только с ролью «исполнитель».
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check (auth.uid() = id and role = 'executor');

-- Менять профили и роли может только администратор.
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update" on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Задачи: внутренний инструмент команды — аутентифицированные могут
-- читать все и управлять задачами. При необходимости права можно ужесточить.
drop policy if exists "tasks_select" on public.tasks;
create policy "tasks_select" on public.tasks
  for select to authenticated using (true);

drop policy if exists "tasks_insert" on public.tasks;
create policy "tasks_insert" on public.tasks
  for insert to authenticated with check (auth.uid() = created_by);

drop policy if exists "tasks_update" on public.tasks;
create policy "tasks_update" on public.tasks
  for update to authenticated using (true);

drop policy if exists "tasks_delete" on public.tasks;
create policy "tasks_delete" on public.tasks
  for delete to authenticated using (true);

-- Комментарии
drop policy if exists "comments_select" on public.comments;
create policy "comments_select" on public.comments
  for select to authenticated using (true);

drop policy if exists "comments_insert" on public.comments;
create policy "comments_insert" on public.comments
  for insert to authenticated with check (auth.uid() = author_id);

drop policy if exists "comments_update" on public.comments;
create policy "comments_update" on public.comments
  for update to authenticated using (auth.uid() = author_id);

drop policy if exists "comments_delete" on public.comments;
create policy "comments_delete" on public.comments
  for delete to authenticated using (auth.uid() = author_id);

-- Вложения
drop policy if exists "attachments_select" on public.attachments;
create policy "attachments_select" on public.attachments
  for select to authenticated using (true);

drop policy if exists "attachments_insert" on public.attachments;
create policy "attachments_insert" on public.attachments
  for insert to authenticated with check (auth.uid() = uploaded_by);

drop policy if exists "attachments_update" on public.attachments;
create policy "attachments_update" on public.attachments
  for update to authenticated using (auth.uid() = uploaded_by);

drop policy if exists "attachments_delete" on public.attachments;
create policy "attachments_delete" on public.attachments
  for delete to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Realtime (живое обновление страницы)
-- ---------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.tasks;
exception when others then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.comments;
exception when others then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.attachments;
exception when others then null;
end $$;

-- ---------------------------------------------------------------------------
-- Хранилище для фото
-- ---------------------------------------------------------------------------

-- Создаём публичный bucket (если ещё не создан)
insert into storage.buckets (id, name, public)
values ('task-images', 'task-images', true)
on conflict (id) do nothing;

-- Политики доступа к объектам хранилища
drop policy if exists "task-images public read" on storage.objects;
create policy "task-images public read" on storage.objects
  for select using (bucket_id = 'task-images');

drop policy if exists "task-images auth insert" on storage.objects;
create policy "task-images auth insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'task-images');

drop policy if exists "task-images auth update" on storage.objects;
create policy "task-images auth update" on storage.objects
  for update to authenticated using (bucket_id = 'task-images');

drop policy if exists "task-images auth delete" on storage.objects;
create policy "task-images auth delete" on storage.objects
  for delete to authenticated using (bucket_id = 'task-images');
