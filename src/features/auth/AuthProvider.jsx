import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { getSupabaseClient } from '../../lib/supabaseClient.js'
import { ADMIN_ROLES } from './authConstants.js'
import { AuthContext } from './AuthContext.js'

function getHomePath(roles) {
  if (roles.includes('super_admin') || roles.includes('branch_admin') || roles.includes('staff')) {
    return '/admin'
  }
  return '/customer'
}

function getQueryError(result) {
  if (result.error) {
    throw new Error(result.error.message)
  }
  return result.data
}

export function AuthProvider({ children }) {
  const [{ client, configurationError }] = useState(() => {
    try {
      return { client: getSupabaseClient(), configurationError: '' }
    } catch (error) {
      return { client: null, configurationError: error.message }
    }
  })
  const [session, setSession] = useState(null)
  const [account, setAccount] = useState(null)
  const [isLoading, setIsLoading] = useState(Boolean(client))
  const [authError, setAuthError] = useState('')
  const requestId = useRef(0)
  const accountRef = useRef(null)
  const loadingAccountUserId = useRef('')

  useEffect(() => {
    if (!client) return undefined
    let active = true
    const supabase = client

    async function loadAccount(userId, authSession) {
      if (accountRef.current?.id === userId) {
        setSession(authSession)
        return
      }
      if (loadingAccountUserId.current === userId) return

      loadingAccountUserId.current = userId
      const currentRequest = ++requestId.current
      if (!accountRef.current) setIsLoading(true)
      setAuthError('')

      try {
        const [profileResult, rolesResult, assignmentsResult, permissionsResult] =
          await Promise.all([
            supabase
              .from('profiles')
              .select('id, email, display_name, phone, address, avatar_path, is_active')
              .eq('id', userId)
              .maybeSingle(),
            supabase.from('user_roles').select('role').eq('user_id', userId),
            supabase
              .from('user_branch_assignments')
              .select('branch_id, branch:branches(id, name)')
              .eq('user_id', userId),
            supabase
              .from('user_permissions')
              .select('branch_id, permission:permissions!inner(module_id, action)')
              .eq('user_id', userId),
          ])

        const profile = getQueryError(profileResult)
        const roles = getQueryError(rolesResult).map(({ role }) => role)
        const branchAssignments = getQueryError(assignmentsResult)
        const permissions = getQueryError(permissionsResult).map(
          ({ branch_id, permission }) => ({
            branchId: branch_id,
            module: permission.module_id,
            action: permission.action,
          }),
        )

        if (!profile) {
          throw new Error('Your account profile is missing. Contact an administrator.')
        }
        if (!profile.is_active) {
          await supabase.auth.signOut()
          if (active && currentRequest === requestId.current) {
            accountRef.current = null
            setAccount(null)
            setAuthError('This account is deactivated. Contact an administrator for help.')
            setIsLoading(false)
          }
          return
        }

        if (active && currentRequest === requestId.current) {
          setSession(authSession)
          const googleUserMetadata = authSession.user.user_metadata || {}
          const loadedAccount = {
            ...profile,
            google_avatar_url:
              googleUserMetadata.avatar_url || googleUserMetadata.picture || '',
            roles,
            branchAssignments,
            permissions,
            homePath: getHomePath(roles),
          }
          accountRef.current = loadedAccount
          setAccount(loadedAccount)
          setIsLoading(false)
        }
      } catch (error) {
        console.error('Unable to load the authenticated account.', error)
        if (active && currentRequest === requestId.current) {
          accountRef.current = null
          setAccount(null)
          setAuthError(
            error instanceof Error
              ? `We could not load your account permissions: ${error.message}`
              : 'We could not load your account permissions. Please try again.',
          )
          setIsLoading(false)
        }
      } finally {
        if (loadingAccountUserId.current === userId) {
          loadingAccountUserId.current = ''
        }
      }
    }

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, authSession) => {
        if (!active) return
        if (event === 'TOKEN_REFRESHED') return

        const userId = authSession?.user?.id
        setSession(authSession)
        if (userId) {
          window.setTimeout(() => {
            if (active) void loadAccount(userId, authSession)
          }, 0)
        } else {
          requestId.current += 1
          accountRef.current = null
          loadingAccountUserId.current = ''
          setAccount(null)
          setAuthError('')
          setIsLoading(false)
        }
      },
    )

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) {
        console.error('Unable to restore the authentication session.', error)
        setAuthError('We could not restore your session. Please sign in again.')
        setIsLoading(false)
        return
      }
      if (data.session) {
        setSession(data.session)
        void loadAccount(data.session.user.id, data.session)
      } else {
        setIsLoading(false)
      }
    }).catch((error) => {
      if (!active) return
      console.error('Unable to restore the authentication session.', error)
      setAuthError('We could not restore your session. Please sign in again.')
      setIsLoading(false)
    })

    return () => {
      active = false
      requestId.current += 1
      loadingAccountUserId.current = ''
      authListener.subscription.unsubscribe()
    }
  }, [client])

  const signInWithGoogle = useCallback(async (nextPath = '/') => {
    if (!client) {
      throw new Error(configurationError || 'Supabase is not configured.')
    }
    const safeNextPath =
      nextPath.startsWith('/') && !nextPath.startsWith('//') ? nextPath : '/'
    const redirectTo = new URL('/auth/callback', window.location.origin)
    redirectTo.searchParams.set('next', safeNextPath)

    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectTo.toString(),
        queryParams: { prompt: 'select_account' },
      },
    })

    if (error) throw error
  }, [client, configurationError])

  const signOut = useCallback(async () => {
    if (!client) return
    const { error } = await client.auth.signOut()
    if (error) {
      console.error('Unable to sign out.', error)
      throw new Error('Sign out failed. Please try again.')
    }
  }, [client])

  const updateProfile = useCallback(async (profile) => {
    if (!client || !accountRef.current) {
      throw new Error('Sign in before updating your profile.')
    }
    const { data, error } = await client
      .from('profiles')
      .update({
        display_name: profile.display_name.trim(),
        phone: profile.phone.trim() || null,
        address: profile.address.trim() || null,
      })
      .eq('id', accountRef.current.id)
      .select('display_name, phone, address')
      .single()
    if (error) throw new Error(`Could not save your profile: ${error.message}`)
    const updatedAccount = { ...accountRef.current, ...data }
    accountRef.current = updatedAccount
    setAccount(updatedAccount)
    return updatedAccount
  }, [client])

  const value = useMemo(
    () => ({
      account,
      session,
      isLoading,
      authError,
      configurationError,
      isConfigured: Boolean(client),
      signInWithGoogle,
      signOut,
      updateProfile,
      hasRole: (roles) => roles.some((role) => account?.roles.includes(role)),
      hasPermission: (module, action = 'view') =>
        account?.roles.includes('super_admin') ||
        account?.permissions.some(
          (permission) =>
            permission.module === module &&
            (permission.action === action || permission.action === 'manage') &&
            account.branchAssignments.some(
              (assignment) => assignment.branch_id === permission.branchId,
            ),
        ) ||
        false,
      isBranchAdmin: () =>
        account?.roles.some((role) => ADMIN_ROLES.includes(role)) ?? false,
    }),
    [account, session, isLoading, authError, configurationError, client, signInWithGoogle, signOut, updateProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
