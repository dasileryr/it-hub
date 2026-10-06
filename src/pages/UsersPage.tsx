import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Badge, btnPrimary, inputCls } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { ROLE_META } from '../lib/constants'
import { formatDate } from '../lib/helpers'
import type { Profile, Role } from '../lib/types'
import { adminCreateUser, listUsers, updateUserRole } from '../lib/users'

const ROLES: Role[] = ['executor', 'boss', 'admin']

export default function UsersPage() {
  const { user } = useAuth()
  const [users, setUsers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  // форма создания
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<Role>('executor')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    try {
      setUsers(await listUsers())
    } catch (err) {
      setMessage({ kind: 'err', text: (err as Error).message })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    setMessage(null)
    setCreating(true)
    const res = await adminCreateUser({ username, password, fullName, role })
    setCreating(false)
    if (res.error) {
      setMessage({ kind: 'err', text: res.error })
      return
    }
    setMessage({ kind: 'ok', text: `Пользователь «${username.trim().toLowerCase()}» создан.` })
    setUsername('')
    setPassword('')
    setFullName('')
    setRole('executor')
    load()
  }

  const changeRole = async (u: Profile, newRole: Role) => {
    if (newRole === u.role) return
    setMessage(null)
    const res = await updateUserRole(u.id, newRole)
    if (res.error) {
      setMessage({ kind: 'err', text: res.error })
      return
    }
    setUsers((prev) => prev.map((p) => (p.id === u.id ? { ...p, role: newRole } : p)))
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-bold tracking-tight text-slate-900">
        Пользователи
      </h1>
      <p className="mb-5 text-sm text-slate-500">
        Создание учётных записей и назначение ролей.
      </p>

      {message && (
        <div
          className={`mb-4 rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${
            message.kind === 'ok'
              ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
              : 'bg-red-50 text-red-700 ring-red-600/20'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Создание пользователя */}
      <form
        onSubmit={create}
        className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <h2 className="mb-4 text-sm font-semibold text-slate-900">
          Новый пользователь
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Логин
            </label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              placeholder="ivan"
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Пароль
            </label>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              placeholder="не менее 6 символов"
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Имя и фамилия
            </label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Иван Петров"
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Роль
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className={inputCls}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_META[r].label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button type="submit" disabled={creating} className={btnPrimary}>
            {creating ? 'Создаём…' : 'Создать'}
          </button>
        </div>
      </form>

      {/* Список пользователей */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-400">
          <span>Пользователь</span>
          <span className="w-36">Роль</span>
        </div>
        {loading ? (
          <div className="px-4 py-10 text-center text-sm text-slate-400">Загрузка…</div>
        ) : users.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-400">
            Пользователей пока нет.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {users.map((u) => (
              <li
                key={u.id}
                className="grid grid-cols-[1fr_auto] items-center gap-2 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-slate-900">
                      {u.full_name || 'Без имени'}
                    </span>
                    {u.id === user?.id && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                        вы
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-slate-400">
                    @{u.username || '—'} · {formatDate(u.created_at)}
                  </div>
                </div>
                <div className="flex w-36 items-center gap-2">
                  {u.id === user?.id ? (
                    <Badge meta={ROLE_META[u.role]} />
                  ) : (
                    <select
                      value={u.role}
                      onChange={(e) => changeRole(u, e.target.value as Role)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_META[r].label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
