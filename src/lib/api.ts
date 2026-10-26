import type { Attachment, Comment, Profile, Role, Task, TaskPriority, TaskStatus } from './types'
import { resizeImage } from './helpers'

export const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
export const isConfigured = API_URL.length > 0
const TOKEN_KEY = 'it-hub-token'

export interface Session { access_token: string; user: { id: string } }
export interface TaskDetails { task: Task; comments: Comment[]; attachments: Attachment[] }
export interface TelegramStatus {
  enabled: boolean
  bot_username: string | null
  subscribers: Array<{
    chat_id: string
    telegram_username: string | null
    display_name: string
    created_at: string
    notification_mode: TelegramNotificationMode
    notification_user_id: string | null
    profile_id: string | null
  }>
}
export type TelegramNotificationMode = 'all_completed' | 'all_completed_and_assigned' | 'user_completed'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

export function getToken(): string | null { return localStorage.getItem(TOKEN_KEY) }
export function clearToken() { localStorage.removeItem(TOKEN_KEY) }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${API_URL}${path}`, { ...init, headers })
  if (response.status === 401) clearToken()
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(body?.error || `Ошибка сервера (${response.status})`, response.status)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export async function login(username: string, password: string) {
  const result = await request<{ token: string; profile: Profile }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
  localStorage.setItem(TOKEN_KEY, result.token)
  return { session: { access_token: result.token, user: { id: result.profile.id } } as Session, profile: result.profile }
}
export async function loginWithMagicLink(token: string) {
  const result = await request<{ token: string; profile: Profile; destination: string }>('/auth/magic', { method: 'POST', body: JSON.stringify({ token }) })
  localStorage.setItem(TOKEN_KEY, result.token)
  return { session: { access_token: result.token, user: { id: result.profile.id } } as Session, profile: result.profile, destination: result.destination }
}
export async function currentProfile(): Promise<Profile> { return (await request<{ profile: Profile }>('/auth/me')).profile }
export async function getProfiles(): Promise<Profile[]> { return request('/profiles') }
export async function createProfile(input: { username: string; password: string; fullName: string; role: Role }): Promise<Profile> {
  return request('/profiles', { method: 'POST', body: JSON.stringify(input) })
}
export async function changeProfileRole(id: string, role: Role): Promise<Profile> {
  return request(`/profiles/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) })
}
export async function updateProfile(id: string, input: { username: string; fullName: string }): Promise<Profile> {
  return request(`/profiles/${id}`, { method: 'PATCH', body: JSON.stringify(input) })
}
export async function changeProfilePassword(id: string, password: string): Promise<void> {
  return request(`/profiles/${id}/password`, { method: 'PATCH', body: JSON.stringify({ password }) })
}
export async function deleteProfile(id: string): Promise<void> { return request(`/profiles/${id}`, { method: 'DELETE' }) }
export async function getTelegramStatus(): Promise<TelegramStatus> { return request('/telegram/status') }
export async function createTelegramInvite(): Promise<{ url: string; expires_at: string }> {
  return request('/telegram/invites', { method: 'POST' })
}
export async function removeTelegramSubscriber(chatId: string): Promise<void> {
  return request(`/telegram/subscribers/${encodeURIComponent(chatId)}`, { method: 'DELETE' })
}
export async function updateTelegramSubscriber(chatId: string, input: { notification_mode: TelegramNotificationMode; notification_user_id: string | null; profile_id: string | null }): Promise<void> {
  await request(`/telegram/subscribers/${encodeURIComponent(chatId)}`, { method: 'PATCH', body: JSON.stringify(input) })
}
export async function getTasks(archived = false): Promise<Task[]> { return request(`/tasks${archived ? '?archived=true' : ''}`) }
export async function getTask(id: string): Promise<TaskDetails> { return request(`/tasks/${id}`) }
export async function updateTask(id: string, patch: TaskPatch): Promise<Task> {
  return request(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
}
export async function deleteTask(id: string): Promise<void> { return request(`/tasks/${id}`, { method: 'DELETE' }) }
export async function reopenTask(id: string): Promise<Task> { return request(`/tasks/${id}/reopen`, { method: 'POST' }) }
export async function createTask(input: { title: string; description: string; priority: TaskPriority; classroom: string; computer: string; assigned_to: string; photos: File[] }): Promise<Task> {
  const form = new FormData()
  form.set('title', input.title); form.set('description', input.description); form.set('priority', input.priority)
  form.set('classroom', input.classroom); form.set('computer', input.computer); form.set('assigned_to', input.assigned_to)
  for (const file of input.photos) form.append('photos', await resizeImage(file), file.name)
  return request('/tasks', { method: 'POST', body: form })
}
export async function createComment(taskId: string, input: { body: string; kind: string; photos: File[] }): Promise<void> {
  const form = new FormData()
  form.set('body', input.body); form.set('kind', input.kind)
  for (const file of input.photos) form.append('photos', await resizeImage(file), file.name)
  await request(`/tasks/${taskId}/comments`, { method: 'POST', body: form })
}
export async function deleteComment(id: string): Promise<void> { return request(`/comments/${id}`, { method: 'DELETE' }) }
export async function getPushConfig(): Promise<{ enabled: boolean; publicKey: string | null }> { return request('/push/config') }
export async function savePushSubscription(subscription: PushSubscriptionJSON): Promise<void> {
  return request('/push/subscriptions', { method: 'POST', body: JSON.stringify(subscription) })
}
export async function removePushSubscription(endpoint: string): Promise<void> {
  return request('/push/subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint }) })
}
export type TaskPatch = { title?: string; description?: string; status?: TaskStatus; priority?: TaskPriority; classroom?: string | null; computer?: string | null; assigned_to?: string | null }
