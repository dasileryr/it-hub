import { Link } from 'react-router-dom'
import { PRIORITY_META, STATUS_META, computerLabel } from '../lib/constants'
import { displayName, formatDateShort } from '../lib/helpers'
import type { Task } from '../lib/types'
import { Avatar, Badge } from './ui'

export default function TaskCard({
  task,
  commentCount,
}: {
  task: Task
  commentCount?: number
}) {
  return (
    <Link
      to={`/tasks/${task.id}`}
      className="group flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-indigo-300 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge meta={STATUS_META[task.status]} />
          <Badge meta={PRIORITY_META[task.priority]} />
          {task.computer && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-500/20">
              {computerLabel(task.computer)}
            </span>
          )}
        </div>
        {commentCount != null && commentCount > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-slate-400">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-4 w-4"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8 10h8M8 14h5m-9 6l-3 3V6a2 2 0 012-2h14a2 2 0 012 2v9a2 2 0 01-2 2H8z"
              />
            </svg>
            {commentCount}
          </span>
        )}
      </div>

      <div>
        <h3 className="line-clamp-2 font-semibold text-slate-900 transition group-hover:text-indigo-700">
          {task.title}
        </h3>
        {task.description && (
          <p className="line-clamp-2 mt-1 text-sm text-slate-500">
            {task.description}
          </p>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
        <div className="flex min-w-0 items-center gap-1.5">
          <Avatar
            name={displayName(task.creator)}
            role={task.creator?.role}
            size="sm"
          />
          <span className="truncate">{displayName(task.creator)}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {task.assignee && (
            <span className="inline-flex items-center gap-1" title={displayName(task.assignee)}>
              <span className="text-slate-300">→</span>
              <Avatar
                name={displayName(task.assignee)}
                role={task.assignee?.role}
                size="sm"
              />
            </span>
          )}
          <span className="text-slate-400">
            {formatDateShort(task.updated_at)}
          </span>
        </div>
      </div>
    </Link>
  )
}
