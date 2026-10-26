import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { clearToken, currentProfile, getToken, login } from '../lib/api'
import type { Session } from '../lib/api'
import type { Profile } from '../lib/types'

export interface SignResult { error: Error | null }
interface User { id: string }
interface AuthContextValue {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
  signIn: (username: string, password: string) => Promise<SignResult>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}
const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const refreshProfile = useCallback(async () => {
    const token = getToken()
    if (!token) { setSession(null); setProfile(null); return }
    try {
      const next = await currentProfile()
      setProfile(next); setSession({ access_token: token, user: { id: next.id } })
    } catch { clearToken(); setSession(null); setProfile(null) }
  }, [])
  useEffect(() => { refreshProfile().finally(() => setLoading(false)) }, [refreshProfile])
  const signIn = useCallback(async (username: string, password: string): Promise<SignResult> => {
    try {
      const result = await login(username, password)
      setSession(result.session); setProfile(result.profile)
      return { error: null }
    } catch (error) { return { error: error as Error } }
  }, [])
  const signOut = useCallback(async () => { clearToken(); setSession(null); setProfile(null) }, [])
  const value = useMemo<AuthContextValue>(() => ({ session, user: session?.user ?? null, profile, loading, signIn, signOut, refreshProfile }), [session, profile, loading, signIn, signOut, refreshProfile])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth должен использоваться внутри AuthProvider')
  return ctx
}
