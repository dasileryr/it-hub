import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { isConfigured } from '../lib/supabase'

function translateError(err: Error): string {
  const m = err.message.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Неверный логин или пароль.'
  if (m.includes('password should be at least')) return 'Пароль должен быть не короче 6 символов.'
  if (m.includes('email not confirmed')) return 'Аккаунт ещё не активирован.'
  if (m.includes('rate limit')) return 'Слишком много попыток. Подождите немного.'
  return 'Не удалось войти. Проверьте логин и пароль.'
}

function SetupNotice() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">
          Почти готово — нужно подключить Supabase
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          В корне проекта создайте файл <code className="rounded bg-slate-100 px-1">.env</code>{' '}
          (пример — в <code className="rounded bg-slate-100 px-1">.env.example</code>) и
          укажите ключи вашего проекта:
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
{`VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...`}
        </pre>
        <p className="mt-4 text-sm text-slate-500">
          Подробная пошаговая инструкция — в файле{' '}
          <code className="rounded bg-slate-100 px-1">README.md</code>.
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  const { session, loading, signIn } = useAuth()
  const navigate = useNavigate()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }
  if (session) return <Navigate to="/" replace />
  if (!isConfigured) return <SetupNotice />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    const res = await signIn(username.trim(), password)
    setBusy(false)
    if (res.error) {
      setError(translateError(res.error))
      return
    }
    navigate('/')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-slate-50 to-teal-50 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-7 w-7"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12l2 2 4-4m5.6-1.4A5.6 5.6 0 0121 12c0 1.1-.3 2.1-.8 3l-1.6 2.3a3 3 0 01-2.4 1.2H7.8a3 3 0 01-2.4-1.2L3.8 15A5.6 5.6 0 013 12a5.6 5.6 0 01.8-2.9L5.4 6.8A3 3 0 017.8 5.6h8.4a3 3 0 012.4 1.2l1.6 2.3z"
              />
            </svg>
          </span>
          <h1 className="text-xl font-semibold text-slate-900">ИТ-Задачи</h1>
          <p className="text-sm text-slate-500">
            Трекер задач и их решений для ИТ-отдела
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Логин
              </label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
                autoComplete="username"
                placeholder="например, ivan"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Пароль
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy && <Spinner className="h-4 w-4 border-white/40 border-t-white" />}
              Войти
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-slate-400">
          Учётные записи создаёт администратор.
        </p>
      </div>
    </div>
  )
}
