import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ROLE_META } from '../lib/constants'
import { displayName } from '../lib/helpers'
import { Avatar } from './ui'

function navCls({ isActive }: { isActive: boolean }) {
  return `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
    isActive
      ? 'bg-indigo-50 text-indigo-700'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
  }`
}

export default function Layout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-5">
            <Link to="/" className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="h-5 w-5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12l2 2 4-4m5.6-1.4A5.6 5.6 0 0121 12c0 1.1-.3 2.1-.8 3l-1.6 2.3a3 3 0 01-2.4 1.2H7.8a3 3 0 01-2.4-1.2L3.8 15A5.6 5.6 0 013 12a5.6 5.6 0 01.8-2.9L5.4 6.8A3 3 0 017.8 5.6h8.4a3 3 0 012.4 1.2l1.6 2.3z"
                  />
                </svg>
              </span>
              <span className="text-base font-semibold text-slate-900">
                ИТ-Задачи
              </span>
            </Link>
            <nav className="hidden items-center gap-1 sm:flex">
              <NavLink to="/" end className={navCls}>
                Задачи
              </NavLink>
              <NavLink to="/tasks/new" className={navCls}>
                Новая задача
              </NavLink>
              {profile?.role === 'admin' && (
                <NavLink to="/users" className={navCls}>
                  Пользователи
                </NavLink>
              )}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 sm:flex">
              <Avatar
                name={displayName(profile)}
                role={profile?.role}
                size="sm"
              />
              <div className="leading-tight">
                <div className="max-w-[180px] truncate text-sm font-medium text-slate-900">
                  {displayName(profile)}
                </div>
                <div className="text-xs text-slate-500">
                  {profile ? ROLE_META[profile.role].label : ''}
                </div>
              </div>
            </div>
            <button
              onClick={handleSignOut}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              Выйти
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  )
}
