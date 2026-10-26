import type { Attachment, Comment, Profile, Role, Task, TaskPriority, TaskStatus } from './types'
import { resizeImage } from './helpers'

export const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
export const isConfigured = API_URL.length > 0
const TOKEN_KEY = 'it-hub-token'

export interface Session { access_token: string; user: { id: string } }
export interface TaskDetails { task: Task; comments: Comment[]; attachments: Attachment[] }

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
export async function currentProfile(): Promise<Profile> { return (await request<{ profile: Profile }>('/auth/me')).profile }
export async function getProfiles(): Promise<Profile[]> { return request('/profiles') }
export async function createProfile(input: { username: string; password: string; fullName: string; role: Role }): Promise<Profile> {
  return request('/profiles', { method: 'POST', body: JSON.stringify(input) })
}
export async function changeProfileRole(id: string, role: Role): Promise<Profile> {
  return request(`/profiles/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) })
}
export async function getTasks(): Promise<Task[]> { return request('/tasks') }
export async function getTask(id: string): Promise<TaskDetails> { return request(`/tasks/${id}`) }
export async function updateTask(id: string, patch: TaskPatch): Promise<Task> {
  return request(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
}
export async function deleteTask(id: string): Promise<void> { return request(`/tasks/${id}`, { method: 'DELETE' }) }
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
export type TaskPatch = { title?: string; description?: string; status?: TaskStatus; priority?: TaskPriority; classroom?: string | null; computer?: string | null; assigned_to?: string | null }
