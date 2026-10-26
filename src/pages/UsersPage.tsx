import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Badge, btnPrimary, inputCls } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { ROLE_META } from '../lib/constants'
import { formatDate } from '../lib/helpers'
import type { Profile, Role } from '../lib/types'
import { adminCreateUser, listUsers, removeUser, renameUser, resetUserPassword, updateUserRole } from '../lib/users'

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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editUsername, setEditUsername] = useState('')
  const [editFullName, setEditFullName] = useState('')
  const [passwordEditingId, setPasswordEditingId] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')

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

  const remove = async (u: Profile) => {
    if (!window.confirm(`Удалить пользователя «${u.full_name || u.username}»? Его старые задачи и комментарии сохранятся.`)) return
    setMessage(null)
    const res = await removeUser(u.id)
    if (res.error) return setMessage({ kind: 'err', text: res.error })
    setUsers((prev) => prev.filter((profile) => profile.id !== u.id))
    setMessage({ kind: 'ok', text: 'Пользователь удалён. История его работы сохранена.' })
  }

  const startRename = (u: Profile) => {
    setPasswordEditingId(null)
    setNewPassword('')
    setEditingId(u.id)
    setEditUsername(u.username || '')
    setEditFullName(u.full_name)
    setMessage(null)
  }

  const startPasswordChange = (u: Profile) => {
    setEditingId(null)
    setPasswordEditingId(u.id)
    setNewPassword('')
    setMessage(null)
  }

  const savePassword = async (u: Profile) => {
    const res = await resetUserPassword(u.id, newPassword)
    if (res.error) {
      setMessage({ kind: 'err', text: res.error })
      return
    }
    setPasswordEditingId(null)
    setNewPassword('')
    setMessage({ kind: 'ok', text: `Пароль пользователя «${u.full_name || u.username}» изменён.` })
  }

  const saveRename = async (u: Profile) => {
    const res = await renameUser(u.id, editUsername, editFullName)
    if (res.error || !res.profile) {
      setMessage({ kind: 'err', text: res.error || 'Не удалось переименовать пользователя.' })
      return
    }
    setUsers((prev) => prev.map((profile) => profile.id === u.id ? res.profile! : profile))
    setEditingId(null)
    setMessage({ kind: 'ok', text: 'Имя и логин пользователя обновлены.' })
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
              minLength={8}
              placeholder="не менее 8 символов"
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
          <span className="w-52">Роль и действия</span>
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
                  {editingId === u.id ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input
                        value={editFullName}
                        onChange={(event) => setEditFullName(event.target.value)}
                        placeholder="Имя и фамилия"
                        className="min-w-0 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
                      />
                      <input
                        value={editUsername}
                        onChange={(event) => setEditUsername(event.target.value)}
                        placeholder="Логин"
                        className="min-w-0 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                  ) : passwordEditingId === u.id ? (
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-500">Новый пароль</label>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        minLength={8}
                        autoComplete="new-password"
                        placeholder="Не менее 8 символов"
                        className="w-full max-w-xs rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                  ) : <><div className="flex items-center gap-2">
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
                  </>}
                </div>
                <div className="flex max-w-sm flex-wrap items-center justify-end gap-2">
                  {u.id === user?.id ? (
                    <Badge meta={ROLE_META[u.role]} />
                  ) : (
                    <select
                      value={u.role}
                      onChange={(e) => changeRole(u, e.target.value as Role)}
                      className="w-36 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_META[r].label}
                        </option>
                      ))}
                    </select>
                  )}
                  {editingId === u.id ? <>
                      <button type="button" onClick={() => saveRename(u)} className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">Сохранить</button>
                      <button type="button" onClick={() => setEditingId(null)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Отмена</button>
                    </> : passwordEditingId === u.id ? <>
                      <button type="button" onClick={() => savePassword(u)} disabled={newPassword.length < 8} className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">Сохранить пароль</button>
                      <button type="button" onClick={() => { setPasswordEditingId(null); setNewPassword('') }} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Отмена</button>
                    </> : <>
                      <button type="button" onClick={() => startRename(u)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Переименовать</button>
                      <button type="button" onClick={() => startPasswordChange(u)} className="rounded-lg border border-amber-200 px-2.5 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-50">Сменить пароль</button>
                      {u.id !== user?.id && <button
                        type="button"
                        onClick={() => remove(u)}
                        className="rounded-lg border border-red-200 px-2.5 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
                      >
                        Удалить
                      </button>}
                    </>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
