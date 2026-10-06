-- ============================================================================
--  Миграция 002: вход по логину (username) + управление пользователями.
--  Выполнить в Supabase: SQL Editor → New query → вставить и Run.
--  (Для уже существующей базы, где выполнен schema.sql.)
-- ============================================================================

-- 1) Колонка «логин» в профилях
alter table public.profiles
  add column if not exists username text;

-- Заполнить логин из email (часть до '@')
update public.profiles p
set username = split_part(u.email, '@', 1)
from auth.users u
where u.id = p.id
  and (p.username is null or p.username = '');

-- Уникальность логинов
create unique index if not exists profiles_username_uniq
  on public.profiles (username)
  where username is not null and username <> '';

-- 2) Функция проверки «текущий пользователь — админ»
--    (security definer — без рекурсии RLS)
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

-- 3) Триггер регистрации: роль всегда «исполнитель» (нельзя самому стать
--    админом), логин берём из метаданных или из email.
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

-- 4) Политики профилей:
--    - свой профиль можно создать только с ролью «исполнитель»
--    - менять роли/профили может только админ
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check (auth.uid() = id and role = 'executor');

drop policy if exists "profiles_update_own" on public.profiles;

drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update" on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================================
--  Важно: назначьте себя администратором.
--  Замените 'ВАШ_ЛОГИН' на свой логин (или email целиком) и выполните:
-- ============================================================================
-- update public.profiles p
-- set role = 'admin'
-- from auth.users u
-- where u.id = p.id
--   and split_part(u.email, '@', 1) = 'ВАШ_ЛОГИН';
