import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL ?? ''
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

// Считаем настроенным, только если заданы реальные значения (не заглушки).
export const isConfigured =
  url.length > 0 &&
  anonKey.length > 0 &&
  !url.includes('your-project') &&
  !anonKey.includes('your-anon-key')

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
})

export const STORAGE_BUCKET = 'task-images'

// Вход по логину: логин превращается в email вида "<логин>@it.local"
// (Supabase Auth требует email; реальная почта при этом не нужна).
export const USER_EMAIL_DOMAIN = 'it.local'

export function emailForUsername(username: string): string {
  return `${username.trim().toLowerCase()}@${USER_EMAIL_DOMAIN}`
}

// Отдельный клиент БЕЗ сохранения сессии — нужен, чтобы админ создавал
// аккаунты других пользователей и при этом не разлогинивался сам.
export function createThrowawayClient() {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
