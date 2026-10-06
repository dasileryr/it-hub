import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import TaskCard from '../components/TaskCard'
import { EmptyState, FullScreenLoader } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { CLASSROOMS, STATUS_META } from '../lib/constants'
import { supabase } from '../lib/supabase'
import type { Task, TaskStatus } from '../lib/types'
import { TASK_STATUSES } from '../lib/types'

type StatusFilter = TaskStatus | 'all'

export default function DashboardPage() {
  const { user } = useAuth()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [mineOnly, setMineOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({})

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('tasks')
      .select(
        '*, creator:created_by(id, full_name, role), assignee:assigned_to(id, full_name, role)',
      )
      .order('updated_at', { ascending: false })
    if (!error && data) setTasks(data as Task[])

    const { data: comments } = await supabase
      .from('comments')
      .select('task_id')
    if (comments) {
      const m: Record<string, number> = {}
      for (const row of comments) {
        m[row.task_id] = (m[row.task_id] ?? 0) + 1
      }
      setCommentCounts(m)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Живое обновление при изменении задач и комментариев
  useEffect(() => {
    const channel = supabase
      .channel('dashboard-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks' },
        () => load(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'comments' },
        () => load(),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  const counts = useMemo(() => {
    const c = { all: tasks.length } as Record<StatusFilter, number>
    for (const s of TASK_STATUSES) {
      c[s] = tasks.filter((t) => t.status === s).length
    }
    return c
  }, [tasks])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tasks.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false
      if (mineOnly && user && t.assigned_to !== user.id && t.created_by !== user.id)
        return false
      if (q) {
        const hay =
          `${t.title} ${t.description} ${t.creator?.full_name ?? ''} ${t.assignee?.full_name ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [tasks, statusFilter, mineOnly, search, user])

  const grouped = useMemo(() => {
    const groups: {
      code: string | null
      label: string
      dot?: string
      tasks: Task[]
    }[] = []
    for (const c of CLASSROOMS) {
      const ts = filtered.filter((t) => t.classroom === c.code)
      if (ts.length > 0) {
        groups.push({ code: c.code, label: c.label, dot: c.dot, tasks: ts })
      }
    }
    const none = filtered.filter((t) => !t.classroom)
    if (none.length > 0) {
      groups.push({ code: null, label: 'Без аудитории', tasks: none })
    }
    return groups
  }, [filtered])

  if (loading) return <FullScreenLoader />

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Задачи
          </h1>
          <p className="text-sm text-slate-500">
            Всего: {tasks.length}
            {statusFilter !== 'all' &&
              ` · ${STATUS_META[statusFilter as TaskStatus].label}: ${counts[statusFilter]}`}
          </p>
        </div>
        <Link
          to="/tasks/new"
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="h-4 w-4"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
          </svg>
          Новая задача
        </Link>
      </div>

      <div className="mb-5 flex flex-col gap-3">
        <div className="flex gap-1.5 overflow-x-auto pb-1 thin-scroll">
          <FilterTab
            active={statusFilter === 'all'}
            onClick={() => setStatusFilter('all')}
            label="Все"
            count={counts.all}
          />
          {TASK_STATUSES.map((s) => (
            <FilterTab
              key={s}
              active={statusFilter === s}
              onClick={() => setStatusFilter(s)}
              label={STATUS_META[s].label}
              count={counts[s]}
              dot={STATUS_META[s].dot}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по названию, описанию, людям…"
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm">
            <input
              type="checkbox"
              checked={mineOnly}
              onChange={(e) => setMineOnly(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            Мои задачи
          </label>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="h-10 w-10"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
              />
            </svg>
          }
          title="Задач не найдено"
          hint="Создайте новую задачу или измените фильтры."
        />
      ) : (
        <div className="space-y-6">
          {grouped.map((g) => (
            <section key={g.code ?? 'none'}>
              <div className="mb-3 flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${g.dot ?? 'bg-slate-300'}`}
                />
                <h2 className="text-base font-semibold text-slate-900">
                  {g.label}
                </h2>
                <span className="text-sm text-slate-400">{g.tasks.length}</span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {g.tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    commentCount={commentCounts[task.id]}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function FilterTab({
  active,
  onClick,
  label,
  count,
  dot,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
  dot?: string
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
        active
          ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm'
          : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'
      }`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
      {label}
      <span
        className={`rounded-full px-1.5 text-xs ${
          active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
        }`}
      >
        {count}
      </span>
    </button>
  )
}
