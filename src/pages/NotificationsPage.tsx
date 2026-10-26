import { useEffect, useState } from 'react'
import { btnPrimary, btnSecondary, FullScreenLoader } from '../components/ui'
import {
  createTelegramInvite,
  getProfiles,
  getTelegramStatus,
  removeTelegramSubscriber,
  updateTelegramSubscriber,
} from '../lib/api'
import type { TelegramNotificationMode, TelegramStatus } from '../lib/api'
import type { Profile } from '../lib/types'
import { formatDate } from '../lib/helpers'

export default function NotificationsPage() {
  const [status, setStatus] = useState<TelegramStatus | null>(null)
  const [invite, setInvite] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [error, setError] = useState('')

  async function load() {
    try {
      const [telegramStatus, userProfiles] = await Promise.all([getTelegramStatus(), getProfiles()])
      setStatus(telegramStatus)
      setProfiles(userProfiles)
    }
    catch (err) { setError((err as Error).message) }
  }

  useEffect(() => { load() }, [])

  async function createInvite() {
    setBusy(true)
    setError('')
    setCopied(false)
    try {
      const result = await createTelegramInvite()
      setInvite(result.url)
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }

  async function copyInvite() {
    if (!invite) return
    await navigator.clipboard.writeText(invite)
    setCopied(true)
  }

  async function remove(chatId: string) {
    if (!window.confirm('Отключить этого получателя от Telegram-отчётов?')) return
    setBusy(true)
    try {
      await removeTelegramSubscriber(chatId)
      await load()
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }

  function changeSubscriber(chatId: string, patch: Partial<TelegramStatus['subscribers'][number]>) {
    setStatus((current) => current ? {
      ...current,
      subscribers: current.subscribers.map((subscriber) => subscriber.chat_id === chatId ? { ...subscriber, ...patch } : subscriber),
    } : current)
  }

  async function saveSubscriber(chatId: string) {
    const subscriber = status?.subscribers.find((item) => item.chat_id === chatId)
    if (!subscriber) return
    setBusy(true)
    setError('')
    try {
      await updateTelegramSubscriber(chatId, {
        notification_mode: subscriber.notification_mode,
        notification_user_id: subscriber.notification_mode === 'user_completed' ? subscriber.notification_user_id : null,
        profile_id: subscriber.profile_id,
      })
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }

  if (!status) return <FullScreenLoader />

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Telegram-отчёты</h1>
      <p className="mt-1 text-sm text-slate-500">
        Создайте приглашение и отправьте его Екатерине или другому получателю отчётов.
      </p>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="font-semibold text-slate-900">Пригласить получателя</h2>
        <p className="mt-2 text-sm text-slate-600">
          После запуска бота настройте для получателя, какие отчёты ему отправлять.
          В отчёт о выполнении входят автор задачи, исполнитель, комментарий и фотографии решения.
        </p>

        {!status.enabled ? (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 ring-1 ring-inset ring-amber-600/20">
            Бот ещё не настроен на сервере.
          </p>
        ) : (
          <div className="mt-4">
            <button onClick={createInvite} disabled={busy} className={btnPrimary}>
              {busy ? 'Создаём…' : 'Создать ссылку-приглашение'}
            </button>
            {invite && (
              <div className="mt-3 rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
                <a href={invite} target="_blank" rel="noreferrer" className="break-all text-sm font-medium text-indigo-600 hover:text-indigo-700">
                  {invite}
                </a>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button onClick={copyInvite} className={btnSecondary}>
                    {copied ? 'Скопировано' : 'Скопировать ссылку'}
                  </button>
                  <a href={invite} target="_blank" rel="noreferrer" className={btnSecondary}>
                    Проверить бота
                  </a>
                </div>
                <p className="mt-2 text-xs text-slate-400">Ссылка одноразовая и действует 7 дней.</p>
              </div>
            )}
          </div>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Получатели отчётов</h2>
        </div>
        {status.subscribers.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">Пока никто не подключён.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {status.subscribers.map((subscriber) => (
              <li key={subscriber.chat_id} className="px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {subscriber.display_name || subscriber.telegram_username || 'Telegram-пользователь'}
                  </p>
                  <p className="truncate text-xs text-slate-400">
                    {subscriber.telegram_username ? `@${subscriber.telegram_username} · ` : ''}
                    подключён {formatDate(subscriber.created_at)}
                  </p>
                  </div>
                  <button onClick={() => remove(subscriber.chat_id)} disabled={busy} className="text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50">
                    Отключить
                  </button>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <label className="text-xs font-medium text-slate-500">
                    Аккаунт для комментариев и быстрого входа
                    <select
                      value={subscriber.profile_id || ''}
                      onChange={(event) => changeSubscriber(subscriber.chat_id, { profile_id: event.target.value || null })}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700"
                    >
                      <option value="">Не связан</option>
                      {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.username}</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-slate-500">
                    Какие уведомления отправлять
                  <select
                    value={subscriber.notification_mode}
                    onChange={(event) => changeSubscriber(subscriber.chat_id, { notification_mode: event.target.value as TelegramNotificationMode })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700"
                  >
                    <option value="all_completed">Все выполненные задачи</option>
                    <option value="all_completed_and_assigned">Выполненные + новые и назначенные</option>
                    <option value="user_completed">Выполненные выбранным пользователем</option>
                  </select>
                  </label>
                  {subscriber.notification_mode === 'user_completed' ? (
                    <select
                      value={subscriber.notification_user_id || ''}
                      onChange={(event) => changeSubscriber(subscriber.chat_id, { notification_user_id: event.target.value || null })}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                    >
                      <option value="">Выберите пользователя</option>
                      {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.username}</option>)}
                    </select>
                  ) : <div />}
                  <div className="flex justify-end">
                    <button onClick={() => saveSubscriber(subscriber.chat_id)} disabled={busy} className={btnSecondary}>Сохранить</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
