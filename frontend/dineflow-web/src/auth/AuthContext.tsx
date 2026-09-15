import { useEffect, useMemo, type ReactNode } from 'react'
import { toast } from 'sonner'
import { logoutRequest, type AuthUser, type PasswordLoginResponse } from '../api/auth'
import { useAppDispatch, useAppSelector } from '../hooks'
import {
  acknowledgeSessionEnded,
  loadCurrentUser,
  loginUser as loginUserThunk,
  logout as logoutAction,
} from './authSlice'

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
  const endedUnexpectedly = useAppSelector((state) => state.auth.endedUnexpectedly)

  useEffect(() => {
    if (token && !user) {
      void dispatch(loadCurrentUser())
    }
  }, [dispatch, token, user])

  // Said once, wherever the customer happens to be. The pages that require a login explain
  // themselves by showing a login form; the ones that also serve guests do not, and My Orders
  // quietly swapping a paying customer's orders for a guest list is the reason this exists.
  useEffect(() => {
    if (!endedUnexpectedly) {
      return
    }

    toast.warning('You have been signed out', {
      description: 'Sign in again to see your account and its orders.',
    })
    dispatch(acknowledgeSessionEnded())
  }, [dispatch, endedUnexpectedly])

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
