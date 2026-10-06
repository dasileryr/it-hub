import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { emailForUsername, supabase } from '../lib/supabase'
import type { Profile } from '../lib/types'

export interface SignResult {
  error: Error | null
}

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

/** Возвращает профиль, при необходимости создавая его (если триггер не сработал). */
async function ensureProfile(
  userId: string,
  fullName: string,
  username: string,
): Promise<Profile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (data) return data as Profile

  const { data: created } = await supabase
    .from('profiles')
    .insert({ id: userId, full_name: fullName, username, role: 'executor' })
    .select('*')
    .single()
  return (created as Profile) ?? null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      if (!data.session) {
        setProfile(null)
        setLoading(false)
      }
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (!s) setProfile(null)
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session) {
      setLoading(false)
      return
    }
    let active = true
    const metaName = (session.user.user_metadata?.full_name as string) ?? ''
    const username = (session.user.email ?? '').split('@')[0]
    ensureProfile(session.user.id, metaName, username).then((p) => {
      if (active) {
        setProfile(p)
        setLoading(false)
      }
    })
    return () => {
      active = false
    }
  }, [session])

  const refreshProfile = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    const s = data.session
    if (!s) {
      setProfile(null)
      return
    }
    const metaName = (s.user.user_metadata?.full_name as string) ?? ''
    const username = (s.user.email ?? '').split('@')[0]
    setProfile(await ensureProfile(s.user.id, metaName, username))
  }, [])

  const signIn = useCallback(
    async (username: string, password: string): Promise<SignResult> => {
      const { error } = await supabase.auth.signInWithPassword({
        email: emailForUsername(username),
        password,
      })
      return { error }
    },
    [],
  )

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setProfile(null)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      signIn,
      signOut,
      refreshProfile,
    }),
    [session, profile, loading, signIn, signOut, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth должен использоваться внутри AuthProvider')
  return ctx
}
