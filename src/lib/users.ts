import { changeProfileRole, createProfile, getProfiles } from './api'
import type { Profile, Role } from './types'

const USERNAME_RE = /^[a-z0-9._-]{2,32}$/
export function normalizeUsername(raw: string): string { return raw.trim().toLowerCase() }
export interface CreateUserResult { error: string | null }
export async function adminCreateUser(params: { username: string; password: string; fullName: string; role: Role }): Promise<CreateUserResult> {
  const username = normalizeUsername(params.username)
  if (!USERNAME_RE.test(username)) return { error: 'Логин: 2–32 символа, только латиница, цифры, точка, дефис, подчёркивание.' }
  if (params.password.length < 8) return { error: 'Пароль должен быть не короче 8 символов.' }
  try { await createProfile({ ...params, username }); return { error: null } }
  catch (error) { return { error: (error as Error).message } }
}
export async function updateUserRole(userId: string, role: Role): Promise<CreateUserResult> {
  try { await changeProfileRole(userId, role); return { error: null } }
  catch (error) { return { error: (error as Error).message } }
}
export async function listUsers(): Promise<Profile[]> { return getProfiles() }
