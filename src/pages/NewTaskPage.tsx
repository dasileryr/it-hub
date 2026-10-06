import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import PhotoPicker from '../components/PhotoPicker'
import { btnPrimary, btnSecondary, inputCls } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { CLASSROOMS, COMPUTERS, PRIORITY_META, computerLabel } from '../lib/constants'
import { uploadPhoto } from '../lib/helpers'
import { supabase } from '../lib/supabase'
import type { Profile, TaskPriority } from '../lib/types'
import { TASK_PRIORITIES } from '../lib/types'

export default function NewTaskPage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [profiles, setProfiles] = useState<Profile[]>([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [assignee, setAssignee] = useState('')
  const [classroom, setClassroom] = useState('')
  const [computer, setComputer] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase
      .from('profiles')
      .select('*')
      .order('full_name')
      .then(({ data }) => {
        if (data) setProfiles(data as Profile[])
      })
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    setBusy(true)
    setError('')

    const { data, error: taskErr } = await supabase
      .from('tasks')
      .insert({
        title: title.trim(),
        description: description.trim(),
        priority,
        classroom: classroom || null,
        computer: computer || null,
        assigned_to: assignee || null,
        created_by: user.id,
      })
      .select('*')
      .single()

    if (taskErr || !data) {
      setError(taskErr?.message ?? 'Не удалось создать задачу')
      setBusy(false)
      return
    }

    try {
      for (const f of files) {
        const { storage_path, url } = await uploadPhoto(f, data.id)
        await supabase.from('attachments').insert({
          task_id: data.id,
          comment_id: null,
          kind: 'problem',
          storage_path,
          url,
          uploaded_by: user.id,
        })
      }
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
      return
    }

    navigate(`/tasks/${data.id}`)
  }

  return (
    <div className="mx-auto max-w-2xl">
      <button
        onClick={() => navigate(-1)}
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
        Назад
      </button>

      <h1 className="mb-1 text-2xl font-bold tracking-tight text-slate-900">
        Новая задача
      </h1>
      <p className="mb-5 text-sm text-slate-500">
        Опишите проблему и приложите фото, если нужно.
      </p>

      <form
        onSubmit={submit}
        className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Название задачи
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            placeholder="Например: Не работает принтер в бухгалтерии"
            className={inputCls}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Описание проблемы
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            placeholder="Что случилось, где, когда, какие симптомы…"
            className={`${inputCls} resize-y`}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Аудитория
            </label>
            <select
              value={classroom}
              onChange={(e) => setClassroom(e.target.value)}
              className={inputCls}
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
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Компьютер
            </label>
            <select
              value={computer}
              onChange={(e) => setComputer(e.target.value)}
              className={inputCls}
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

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Приоритет
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              className={inputCls}
            >
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_META[p].label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Исполнитель
            </label>
            <select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className={inputCls}
            >
              <option value="">Не назначен</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || 'Без имени'}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Фото проблемы
          </label>
          <PhotoPicker
            files={files}
            onChange={setFiles}
            hint="Фото автоматически сжимаются перед загрузкой."
          />
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className={btnSecondary}
          >
            Отмена
          </button>
          <button type="submit" disabled={busy || !title.trim()} className={btnPrimary}>
            {busy ? 'Создаём…' : 'Создать задачу'}
          </button>
        </div>
      </form>
    </div>
  )
}
