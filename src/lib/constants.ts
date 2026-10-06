import type {
  AttachmentKind,
  Role,
  TaskPriority,
  TaskStatus,
} from './types'

export interface BadgeMeta {
  label: string
  badge: string
  dot?: string
}

export const STATUS_META: Record<TaskStatus, BadgeMeta> = {
  new: {
    label: 'Новая',
    badge: 'bg-blue-50 text-blue-700 ring-blue-600/20',
    dot: 'bg-blue-500',
  },
  in_progress: {
    label: 'В работе',
    badge: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    dot: 'bg-amber-500',
  },
  waiting: {
    label: 'Ожидает',
    badge: 'bg-violet-50 text-violet-700 ring-violet-600/20',
    dot: 'bg-violet-500',
  },
  done: {
    label: 'Решена',
    badge: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    dot: 'bg-emerald-500',
  },
  cancelled: {
    label: 'Отменена',
    badge: 'bg-slate-100 text-slate-500 ring-slate-500/20',
    dot: 'bg-slate-400',
  },
}

export const PRIORITY_META: Record<TaskPriority, BadgeMeta> = {
  low: {
    label: 'Низкий',
    badge: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  },
  medium: {
    label: 'Средний',
    badge: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  },
  high: {
    label: 'Высокий',
    badge: 'bg-orange-50 text-orange-700 ring-orange-600/20',
  },
  urgent: {
    label: 'Срочно',
    badge: 'bg-red-50 text-red-700 ring-red-600/20',
  },
}

export const ROLE_META: Record<Role, BadgeMeta> = {
  admin: {
    label: 'Админ',
    badge: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  },
  boss: {
    label: 'Начальник',
    badge: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
  },
  executor: {
    label: 'Исполнитель',
    badge: 'bg-teal-50 text-teal-700 ring-teal-600/20',
  },
}

export const KIND_META: Record<AttachmentKind, BadgeMeta> = {
  problem: {
    label: 'Фото проблемы',
    badge: 'bg-red-50 text-red-700 ring-red-600/20',
  },
  solution: {
    label: 'Фото решения',
    badge: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  },
  other: {
    label: 'Прочее',
    badge: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  },
}

// --- Аудитории и компьютеры ---

export interface Classroom {
  code: string
  label: string
  order: number
  dot: string
}

export const CLASSROOMS: Classroom[] = [
  { code: 'zelenaia', label: 'ЗЕЛЕНАЯ', order: 1, dot: 'bg-green-500' },
  { code: 'siniaia', label: 'СИНЯЯ', order: 2, dot: 'bg-blue-500' },
  { code: 'seraia', label: 'СЕРАЯ', order: 3, dot: 'bg-slate-400' },
  { code: 'fioletovaia', label: 'ФИОЛЕТОВАЯ', order: 4, dot: 'bg-violet-500' },
  { code: 'belaia', label: 'БЕЛАЯ', order: 5, dot: 'bg-slate-300' },
  { code: 'novaia', label: 'НОВАЯ', order: 6, dot: 'bg-pink-500' },
]

export const COMPUTERS: string[] = [
  ...Array.from({ length: 21 }, (_, i) => String(i + 1)),
  'ПРЕПОДАВАТЕЛЬ',
]

export function classroomLabel(code: string | null | undefined): string {
  return CLASSROOMS.find((c) => c.code === code)?.label ?? '—'
}

export function computerLabel(value: string | null | undefined): string {
  if (!value) return '—'
  if (value === 'ПРЕПОДАВАТЕЛЬ') return 'ПРЕПОДАВАТЕЛЬ'
  return `Комп ${value}`
}
