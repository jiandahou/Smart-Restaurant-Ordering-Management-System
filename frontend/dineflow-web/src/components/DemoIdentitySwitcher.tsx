import { useMemo, useState } from 'react'
import { LogIn, RotateCcw, ShieldCheck, UserRound } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { login, type AuthUser, type LoginResponse } from '@/api/auth'
import { useAuth } from '@/auth/AuthContext'
import { setAuthenticated } from '@/auth/authSlice'
import { useAppDispatch } from '@/hooks'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'

const demoLoginEnabled = import.meta.env.VITE_ENABLE_DEMO_LOGIN === 'true'
const demoSeedPassword = import.meta.env.VITE_DEMO_SEED_PASSWORD || 'DineFlow123!'
const ownerSessionKey = 'dineflow.demo.platform-owner-session'

const demoIdentities = [
  {
    label: 'Restaurant owner',
    email: 'owner.one@dineflow.test',
    role: 'RestaurantOwner',
    targetPath: '/admin',
  },
  {
    label: 'Admin',
    email: 'admin.one.a@dineflow.test',
    role: 'Admin',
    targetPath: '/admin',
  },
  {
    label: 'Staff',
    email: 'staff.one.a@dineflow.test',
    role: 'Staff',
    targetPath: '/staff/orders',
  },
  {
    label: 'Customer',
    email: 'customer.one@dineflow.test',
    role: 'Customer',
    targetPath: '/me',
  },
] as const

type StoredOwnerSession = {
  token: string
  user: AuthUser
}

function isLoginResponse(response: Awaited<ReturnType<typeof login>>): response is LoginResponse {
  return 'token' in response
}

function readOwnerSession() {
  try {
    const rawValue = sessionStorage.getItem(ownerSessionKey)
    return rawValue ? JSON.parse(rawValue) as StoredOwnerSession : null
  } catch {
    sessionStorage.removeItem(ownerSessionKey)
    return null
  }
}

function writeOwnerSession(session: StoredOwnerSession) {
  sessionStorage.setItem(ownerSessionKey, JSON.stringify(session))
}

function clearOwnerSession() {
  sessionStorage.removeItem(ownerSessionKey)
}

function hasPlatformOwnerRole(user: AuthUser | null) {
  return Boolean(user?.roles.includes('PlatformOwner'))
}

export function DemoIdentitySwitcher() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const { user, token } = useAuth()
  const [open, setOpen] = useState(false)
  const [switchingEmail, setSwitchingEmail] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [storedOwnerSession, setStoredOwnerSession] = useState<StoredOwnerSession | null>(() => readOwnerSession())
  const canStoreOwner = hasPlatformOwnerRole(user) && Boolean(token)
  const canShowSwitcher = demoLoginEnabled && (canStoreOwner || storedOwnerSession)

  const currentRoleLabel = useMemo(() => {
    if (!user) return 'Demo identity'
    if (hasPlatformOwnerRole(user)) return 'PlatformOwner'
    return user.roles[0] ?? 'Demo identity'
  }, [user])

  if (!canShowSwitcher) {
    return null
  }

  const switchIdentity = async (identity: typeof demoIdentities[number]) => {
    if (switchingEmail || restoring) {
      return
    }

    if (canStoreOwner && user && token) {
      writeOwnerSession({ token, user })
      setStoredOwnerSession({ token, user })
    }

    setSwitchingEmail(identity.email)

    try {
      const response = await login(identity.email, demoSeedPassword)
      if (!isLoginResponse(response)) {
        throw new Error('Demo identity requires MFA and cannot be switched automatically.')
      }

      dispatch(setAuthenticated(response))
      toast.success(`Switched to ${identity.role}`)
      setOpen(false)
      navigate(identity.targetPath)
    } catch (error) {
      toast.error('Could not switch identity', {
        description: error instanceof Error ? error.message : 'Seed login failed.',
      })
    } finally {
      setSwitchingEmail(null)
    }
  }

  const restoreOwner = () => {
    if (!storedOwnerSession || restoring) {
      return
    }

    setRestoring(true)
    dispatch(setAuthenticated({
      message: 'Restored PlatformOwner demo session.',
      token: storedOwnerSession.token,
      user: storedOwnerSession.user,
    }))
    clearOwnerSession()
    setStoredOwnerSession(null)
    toast.success('Restored PlatformOwner')
    setOpen(false)
    setRestoring(false)
    navigate('/admin')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="demo-identity-trigger">
          <ShieldCheck size={17} />
          {currentRoleLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="demo-identity-popover">
        <PopoverHeader>
          <PopoverTitle>Demo identity</PopoverTitle>
          <PopoverDescription>
            Switch seeded roles quickly, then restore the PlatformOwner session.
          </PopoverDescription>
        </PopoverHeader>

        {storedOwnerSession ? (
          <Button
            type="button"
            variant="secondary"
            className="demo-identity-restore"
            disabled={restoring || switchingEmail !== null}
            onClick={restoreOwner}
          >
            <RotateCcw size={16} />
            {restoring ? 'Restoring...' : 'Restore PlatformOwner'}
          </Button>
        ) : null}

        <div className="demo-identity-options">
          {demoIdentities.map((identity) => (
            <button
              key={identity.email}
              type="button"
              className="demo-identity-option"
              disabled={switchingEmail !== null || restoring}
              onClick={() => void switchIdentity(identity)}
            >
              <span className="demo-identity-option-icon">
                {identity.role === 'Customer' ? <UserRound size={16} /> : <LogIn size={16} />}
              </span>
              <span>
                <strong>{identity.label}</strong>
                <small>{identity.email}</small>
              </span>
              <em>{switchingEmail === identity.email ? 'Signing in...' : identity.role}</em>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
