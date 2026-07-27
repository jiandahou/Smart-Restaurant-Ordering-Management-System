import { useEffect, useMemo, type ReactNode } from 'react'
import { logoutRequest, type AuthUser, type PasswordLoginResponse } from '../api/auth'
import { useAppDispatch, useAppSelector } from '../hooks'
import { loadCurrentUser, loginUser as loginUserThunk, logout as logoutAction } from './authSlice'

type AuthContextValue = {
  user: AuthUser | null
  token: string | null
  refreshToken: string | null
  loading: boolean
  loginUser: (email: string, password: string) => Promise<PasswordLoginResponse>
  logout: () => void
  hasAnyRole: (roles: string[]) => boolean
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch()
  const token = useAppSelector((state) => state.auth.token)
  const user = useAppSelector((state) => state.auth.user)

  useEffect(() => {
    if (token && !user) {
      void dispatch(loadCurrentUser())
    }
  }, [dispatch, token, user])

  return children
}

export function useAuth() {
  const dispatch = useAppDispatch()
  const { user, token, refreshToken, loading } = useAppSelector((state) => state.auth)

  return useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      refreshToken,
      loading,
      async loginUser(email, password) {
        const response = await dispatch(loginUserThunk({ email, password })).unwrap()
        return response
      },
      logout() {
        // Clear local session state immediately — don't make the user wait on a
        // network round trip to see themselves logged out. The server-side
        // revoke is best-effort cleanup so the refresh token can't be replayed;
        // it expires on its own even if this never reaches the server.
        if (refreshToken) {
          void logoutRequest(refreshToken)
        }
        dispatch(logoutAction())
      },
      hasAnyRole(roles) {
        return Boolean(user?.roles.some((role) => roles.includes(role)))
      },
    }),
    [dispatch, loading, refreshToken, token, user],
  )
}
