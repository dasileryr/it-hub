import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Lightbox from '../components/Lightbox'
import PhotoPicker from '../components/PhotoPicker'
import {
  Avatar,
  Badge,
  FullScreenLoader,
  btnPrimary,
  btnSecondary,
  inputCls,
} from '../components/ui'
import { useAuth } from '../context/AuthContext'
import {
  CLASSROOMS,
  COMPUTERS,
  KIND_META,
  PRIORITY_META,
  ROLE_META,
  STATUS_META,
  computerLabel,
} from '../lib/constants'
import { displayName, formatDate, uploadPhoto } from '../lib/helpers'
import { STORAGE_BUCKET, supabase } from '../lib/supabase'
import type {
  Attachment,
  AttachmentKind,
  Comment,
  Profile,
  Task,
  TaskPriority,
  TaskStatus,
} from '../lib/types'
import {
  ATTACHMENT_KINDS,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from '../lib/types'

type TaskPatch = {
  title?: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  classroom?: string | null
  computer?: string | null
  assigned_to?: string | null
}

export default function TaskPage() {
  const { id } = useParams<{ id: string }>()
  const { user, profile } = useAuth()
  const navigate = useNavigate()

  const [task, setTask] = useState<Task | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [body, setBody] = useState('')
  const [kind, setKind] = useState<AttachmentKind>('solution')
  const [files, setFiles] = useState<File[]>([])
  const [saving, setSaving] = useState(false)

  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')

  const [lightbox, setLightbox] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    const { data: t } = await supabase
      .from('tasks')
      .select(
        '*, creator:created_by(id, full_name, role), assignee:assigned_to(id, full_name, role)',
      )
      .eq('id', id)
      .maybeSingle()
    if (!t) {
      setNotFound(true)
      setLoading(false)
      return
    }
    setTask(t as Task)

    const [{ data: c }, { data: a }] = await Promise.all([
      supabase
        .from('comments')
        .select('*, author:author_id(id, full_name, role)')
        .eq('task_id', id)
        .order('created_at', { ascending: true }),
      supabase
        .from('attachments')
        .select('*, uploader:uploaded_by(id, full_name, role)')
        .eq('task_id', id)
        .order('created_at', { ascending: true }),
    ])
    if (c) setComments(c as Comment[])
    if (a) setAttachments(a as Attachment[])
    setLoading(false)
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    supabase
      .from('profiles')
      .select('*')
      .order('full_name')
      .then(({ data }) => {
        if (data) setProfiles(data as Profile[])
      })
  }, [])

  useEffect(() => {
    if (!id) return
    const channel = supabase
      .channel(`task-${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'comments', filter: `task_id=eq.${id}` },
        () => load(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attachments', filter: `task_id=eq.${id}` },
        () => load(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `id=eq.${id}` },
        () => load(),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [id, load])

  const taskAttachments = useMemo(
    () => attachments.filter((a) => !a.comment_id),
    [attachments],
  )

  const attachmentsByComment = useMemo(() => {
    const m: Record<string, Attachment[]> = {}
    for (const a of attachments) {
      if (a.comment_id) {
        ;(m[a.comment_id] ??= []).push(a)
      }
    }
    return m
  }, [attachments])

  async function patch(patchObj: TaskPatch) {
    if (!task) return
    const { error } = await supabase
      .from('tasks')
      .update(patchObj)
      .eq('id', task.id)
    if (error) {
      alert(error.message)
    } else {
      setTask({ ...task, ...patchObj })
    }
  }

  async function patchAssignee(val: string) {
    if (!task) return
    const assignee = profiles.find((p) => p.id === val) ?? null
    const { error } = await supabase
      .from('tasks')
      .update({ assigned_to: val || null })
      .eq('id', task.id)
    if (error) {
      alert(error.message)
    } else {
      setTask({ ...task, assigned_to: val || null, assignee })
    }
  }

  function startEditing() {
    if (!task) return
    setEditTitle(task.title)
    setEditDesc(task.description)
    setEditing(true)
  }

  async function saveEditing() {
    if (!task) return
    await patch({ title: editTitle.trim(), description: editDesc.trim() })
    setEditing(false)
  }

  async function handleDelete() {
    if (!task) return
    if (!window.confirm('Удалить задачу и все её комментарии и фото?')) return
    for (const a of attachments) {
      if (a.storage_path) {
        await supabase.storage.from(STORAGE_BUCKET).remove([a.storage_path])
      }
    }
    const { error } = await supabase.from('tasks').delete().eq('id', task.id)
    if (error) alert(error.message)
    else navigate('/')
  }

  async function submitComment(e: FormEvent) {
    e.preventDefault()
    if (!task || !user) return
    if (!body.trim() && files.length === 0) return
    setSaving(true)

    const { data: comment, error } = await supabase
      .from('comments')
      .insert({ task_id: task.id, author_id: user.id, body: body.trim() })
      .select('*')
      .single()

    if (error || !comment) {
      alert(error?.message ?? 'Не удалось добавить запись')
      setSaving(false)
      return
    }

    try {
      for (const f of files) {
        const { storage_path, url } = await uploadPhoto(f, task.id)
        await supabase.from('attachments').insert({
          task_id: task.id,
          comment_id: comment.id,
          kind,
          storage_path,
          url,
          uploaded_by: user.id,
        })
      }
    } catch (err) {
      alert((err as Error).message)
      setSaving(false)
      return
    }

    setBody('')
    setFiles([])
    setKind('solution')
    setSaving(false)
    load()
  }

  if (loading) return <FullScreenLoader />

  if (notFound || !task) {
    return (
      <div className="mx-auto max-w-xl text-center">
        <p className="text-lg font-medium text-slate-700">Задача не найдена</p>
        <Link
          to="/"
          className="mt-3 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          ← К списку задач
        </Link>
      </div>
    )
  }

  const canDelete =
    profile != null &&
    (profile.role === 'admin' ||
      profile.role === 'boss' ||
      task.created_by === user?.id)

  return (
    <div>
      <Link
        to="/"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-slate-500 transition hover:text-slate-700"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="h-4 w-4"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Все задачи
      </Link>

      {/* Шапка задачи */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        {editing ? (
          <div className="space-y-3">
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className={inputCls}
            />
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              rows={4}
              className={`${inputCls} resize-y`}
            />
            <div className="flex gap-2">
              <button onClick={saveEditing} className={btnPrimary}>
                Сохранить
              </button>
              <button onClick={() => setEditing(false)} className={btnSecondary}>
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="text-xl font-bold leading-snug text-slate-900 sm:text-2xl">
                {task.title}
              </h1>
              <div className="flex shrink-0 items-center gap-1.5">
                <Badge meta={STATUS_META[task.status]} />
                <Badge meta={PRIORITY_META[task.priority]} />
              </div>
            </div>

            {task.description && (
              <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">
                {task.description}
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <Avatar
                  name={displayName(task.creator)}
                  role={task.creator?.role}
                  size="sm"
                />
                <span>
                  Создал: <b className="font-medium text-slate-700">{displayName(task.creator)}</b>
                  {task.creator && (
                    <span className="ml-1 text-xs">{ROLE_META[task.creator.role].label}</span>
                  )}
                </span>
              </span>
              <span>Создано: {formatDate(task.created_at)}</span>
              <span>Обновлено: {formatDate(task.updated_at)}</span>
            </div>

            <div className="mt-5 flex flex-wrap items-end justify-between gap-3 border-t border-slate-100 pt-4">
              <div className="flex flex-wrap gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">
                    Стадия
                  </label>
                  <select
                    value={task.status}
                    onChange={(e) => patch({ status: e.target.value as TaskStatus })}
                    className={`${inputCls} w-auto`}
                  >
                    {TASK_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_META[s].label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">
                    Приоритет
                  </label>
                  <select
                    value={task.priority}
                    onChange={(e) => patch({ priority: e.target.value as TaskPriority })}
                    className={`${inputCls} w-auto`}
                  >
                    {TASK_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY_META[p].label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">
                    Исполнитель
                  </label>
                  <select
                    value={task.assigned_to ?? ''}
                    onChange={(e) => patchAssignee(e.target.value)}
                    className={`${inputCls} w-auto`}
                  >
                    <option value="">Не назначен</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name || 'Без имени'}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">
                    Аудитория
                  </label>
                  <select
                    value={task.classroom ?? ''}
                    onChange={(e) => patch({ classroom: e.target.value || null })}
                    className={`${inputCls} w-auto`}
                  >
                    <option value="">Не указана</option>
                    {CLASSROOMS.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">
                    Компьютер
                  </label>
                  <select
                    value={task.computer ?? ''}
                    onChange={(e) => patch({ computer: e.target.value || null })}
                    className={`${inputCls} w-auto`}
                  >
                    <option value="">Не указан</option>
                    {COMPUTERS.map((c) => (
                      <option key={c} value={c}>
                        {computerLabel(c)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex gap-2">
                <button onClick={startEditing} className={btnSecondary}>
                  Редактировать
                </button>
                {canDelete && (
                  <button
                    onClick={handleDelete}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 shadow-sm transition hover:bg-red-50"
                  >
                    Удалить
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Фото проблемы (на уровне задачи) */}
      {taskAttachments.length > 0 && (
        <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">
            Фото проблемы
          </h2>
          <PhotoGrid photos={taskAttachments} onOpen={setLightbox} />
        </div>
      )}

      {/* Ход решения */}
      <div className="mt-5">
        <h2 className="mb-3 text-base font-semibold text-slate-900">
          Ход решения
          {comments.length > 0 && (
            <span className="ml-2 text-sm font-normal text-slate-400">
              {comments.length}
            </span>
          )}
        </h2>

        {comments.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-400">
            Записей о ходе решения пока нет. Напишите первую — что сделано, что
            осталось, приложите фото результата.
          </div>
        ) : (
          <ol className="space-y-4">
            {comments.map((c) => (
              <li
                key={c.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
              >
                <div className="flex items-center gap-2.5">
                  <Avatar
                    name={displayName(c.author)}
                    role={c.author?.role}
                    size="md"
                  />
                  <div className="min-w-0 leading-tight">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-slate-900">
                        {displayName(c.author)}
                      </span>
                      {c.author && (
                        <Badge meta={ROLE_META[c.author.role]} />
                      )}
                    </div>
                    <div className="text-xs text-slate-400">
                      {formatDate(c.created_at)}
                    </div>
                  </div>
                </div>

                {c.body && (
                  <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">
                    {c.body}
                  </p>
                )}

                {(attachmentsByComment[c.id] ?? []).length > 0 && (
                  <div className="mt-3">
                    <PhotoGrid
                      photos={attachmentsByComment[c.id]}
                      onOpen={setLightbox}
                    />
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Новая запись */}
      <form
        onSubmit={submitComment}
        className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <h3 className="mb-3 text-sm font-semibold text-slate-900">
          Добавить запись о ходе решения
        </h3>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="Что сделано, что осталось, какие возникли сложности…"
          className={`${inputCls} resize-y`}
        />

        <div className="mt-3 flex flex-wrap items-center gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Тип фото
            </label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as AttachmentKind)}
              className={`${inputCls} w-auto`}
            >
              {ATTACHMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_META[k].label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <PhotoPicker files={files} onChange={setFiles} />
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="submit"
            disabled={saving || (!body.trim() && files.length === 0)}
            className={btnPrimary}
          >
            {saving ? 'Отправляем…' : 'Отправить'}
          </button>
        </div>
      </form>

      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  )
}

function PhotoGrid({
  photos,
  onOpen,
}: {
  photos: Attachment[]
  onOpen: (url: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {photos.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onOpen(p.url)}
          className="group relative h-24 w-24 overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
        >
          <img
            src={p.url}
            alt={KIND_META[p.kind].label}
            loading="lazy"
            className="h-full w-full object-cover transition group-hover:opacity-90"
          />
          <span
            className={`absolute bottom-0 left-0 right-0 truncate px-1.5 py-0.5 text-[10px] font-medium text-white ${
              p.kind === 'problem'
                ? 'bg-red-600/80'
                : p.kind === 'solution'
                  ? 'bg-emerald-600/80'
                  : 'bg-slate-600/80'
            }`}
          >
            {KIND_META[p.kind].label}
          </span>
        </button>
      ))}
    </div>
  )
}
