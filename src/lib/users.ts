import { createThrowawayClient, emailForUsername, supabase } from './supabase'
import type { Profile, Role } from './types'

const USERNAME_RE = /^[a-z0-9._-]{2,32}$/

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase()
}

export interface CreateUserResult {
  error: string | null
}

function translateSignUpError(err: Error): string {
  const m = err.message.toLowerCase()
  if (m.includes('already registered') || m.includes('already been registered')) {
    return 'Пользователь с таким логином уже существует.'
  }
  if (m.includes('password')) {
    return 'Пароль должен быть не короче 6 символов.'
  }
  return err.message
}

/** Создаёт пользователя (аккаунт) от имени администратора. */
export async function adminCreateUser(params: {
  username: string
  password: string
  fullName: string
  role: Role
}): Promise<CreateUserResult> {
  const username = normalizeUsername(params.username)
  if (!USERNAME_RE.test(username)) {
    return {
      error:
        'Логин: 2–32 символа, только латиница, цифры, точка, дефис, подчёркивание.',
    }
  }
  if (params.password.length < 6) {
    return { error: 'Пароль должен быть не короче 6 символов.' }
  }

  // Отдельный клиент без сессии — чтобы админ остался в системе.
  const throwaway = createThrowawayClient()
  const { data, error } = await throwaway.auth.signUp({
    email: emailForUsername(username),
    password: params.password,
    options: { data: { full_name: params.fullName.trim(), username } },
  })
  if (error) return { error: translateSignUpError(error) }

  const userId = data.user?.id
  if (!userId) {
    return {
      error:
        'Не удалось создать пользователя. Убедитесь, что в Supabase отключено подтверждение email.',
    }
  }

  // Устанавливаем роль через админскую политику RLS.
  const { error: roleErr } = await supabase
    .from('profiles')
    .update({ role: params.role, full_name: params.fullName.trim(), username })
    .eq('id', userId)
  if (roleErr) return { error: roleErr.message }

  return { error: null }
}

export async function updateUserRole(
  userId: string,
  role: Role,
): Promise<CreateUserResult> {
  const { error } = await supabase
    .from('profiles')
    .update({ role })
    .eq('id', userId)
  return { error: error ? error.message : null }
}

export async function listUsers(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data as Profile[]) ?? []
}
