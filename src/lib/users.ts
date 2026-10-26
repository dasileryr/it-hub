import { changeProfilePassword, changeProfileRole, createProfile, deleteProfile, getProfiles, updateProfile } from './api'
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
export async function removeUser(userId: string): Promise<CreateUserResult> {
  try { await deleteProfile(userId); return { error: null } }
  catch (error) { return { error: (error as Error).message } }
}
export async function renameUser(userId: string, username: string, fullName: string): Promise<{ error: string | null; profile?: Profile }> {
  const normalized = normalizeUsername(username)
  if (!USERNAME_RE.test(normalized)) return { error: 'Логин: 2–32 символа, только латиница, цифры, точка, дефис, подчёркивание.' }
  if (!fullName.trim()) return { error: 'Имя пользователя не может быть пустым.' }
  try { return { error: null, profile: await updateProfile(userId, { username: normalized, fullName: fullName.trim() }) } }
  catch (error) { return { error: (error as Error).message } }
}
export async function resetUserPassword(userId: string, password: string): Promise<CreateUserResult> {
  if (password.length < 8) return { error: 'Пароль должен быть не короче 8 символов.' }
  try { await changeProfilePassword(userId, password); return { error: null } }
  catch (error) { return { error: (error as Error).message } }
}
