import { useState } from 'react'
import {
  BarChart3,
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  LogIn,
  LogOut,
  ShieldCheck,
  ShoppingBag,
  Store,
  UsersRound,
  Utensils,
  UserRound,
  UserPlus,
} from 'lucide-react'
import { motion } from 'motion/react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../auth/AuthContext'
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar'
import { Button } from '../components/ui/button'

const consoleRoles = ['PlatformOwner', 'RestaurantOwner', 'Admin', 'Staff']
const restaurantStaffRoles = ['PlatformOwner', 'RestaurantOwner', 'Admin', 'Staff']
const adminRoles = ['PlatformOwner', 'RestaurantOwner', 'Admin']
const adminLinks = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/users', label: 'Users', icon: UsersRound },
  { to: '/admin/restaurants', label: 'Restaurants', icon: Store },
  { to: '/admin/orders', label: 'Orders', icon: ClipboardList },
  { to: '/admin/menu', label: 'Menu', icon: Utensils },
  { to: '/admin/payments', label: 'Payments', icon: CreditCard },
  { to: '/admin/reports', label: 'Reports', icon: BarChart3 },
]
type BackendStatus = 'idle' | 'checking' | 'ok' | 'fail'

function getInitials(name?: string | null, email?: string | null) {
  const source = name?.trim() || email?.trim() || 'U'
  const words = source.split(/\s+/).filter(Boolean)

  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase()
  }

  return source.slice(0, 2).toUpperCase()
}

export function AppLayout() {
  const { user, token, logout, hasAnyRole } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('idle')
  const isSignedIn = Boolean(token)
  const canUseAdminArea = hasAnyRole(consoleRoles)
  const canUseAdminTools = hasAnyRole(adminRoles)
  const canUseStaffOrders = hasAnyRole(restaurantStaffRoles)
  const isAdminArea = location.pathname.startsWith('/admin')
  const isBackendPulseActive = backendStatus === 'checking' || backendStatus === 'ok'

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const checkBackend = async () => {
    setBackendStatus('checking')

    try {
      const response = await fetch('/health', {
        headers: {
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      setBackendStatus('ok')
      toast.success('Backend is healthy')
    } catch {
      setBackendStatus('fail')
      toast.error('Backend health check failed')
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">DineFlow</p>
          <h1>Console</h1>
        </div>

        <nav className="nav-actions" aria-label="Primary">
          <div className="navbar-user">
            <Avatar size="sm">
              {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.fullName ?? user.email ?? 'User avatar'} />}
              <AvatarFallback>{getInitials(user?.fullName, user?.email)}</AvatarFallback>
            </Avatar>
            <div className="navbar-user-copy">
              <strong>{user?.fullName || (isSignedIn ? 'Not set' : 'Guest')}</strong>
              <span>{user?.email || 'Browser order tracking'}</span>
            </div>
          </div>
          <NavLink to="/my-orders" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            <ShoppingBag size={18} />
            My Orders
          </NavLink>
          {isSignedIn && (
            <NavLink to="/me" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              <UserRound size={18} />
              Profile
            </NavLink>
          )}
          {canUseAdminArea && (
            <>
              {canUseStaffOrders && (
                <NavLink
                  to="/staff/orders"
                  className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
                >
                  <ClipboardList size={18} />
                  Staff Orders
                </NavLink>
              )}
              <NavLink
                to="/admin"
                end
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              >
                <ShieldCheck size={18} />
                Admin
              </NavLink>
            </>
          )}
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={`navbar-status-button ${backendStatus}`}
            title="Check backend status"
            aria-label="Check backend status"
            onClick={checkBackend}
            disabled={backendStatus === 'checking'}
          >
            <span className="health-icon-wrap">
              <svg
                className="health-ecg"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  className="health-ecg-base"
                  d="M2 12h4l3-8 6 16 3-8h4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {isBackendPulseActive && (
                  <motion.path
                    className="health-ecg-sweep"
                    d="M2 12h4l3-8 6 16 3-8h4"
                    pathLength={1}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={{ strokeDashoffset: 1 }}
                    animate={{ strokeDashoffset: [1, 0] }}
                    transition={{
                      duration: backendStatus === 'checking' ? 1.05 : 1.45,
                      ease: 'linear',
                      repeat: Infinity,
                    }}
                  />
                )}
              </svg>
            </span>
          </Button>
          {isSignedIn ? (
            <Button type="button" variant="ghost" onClick={handleLogout}>
              <LogOut size={18} />
              Sign out
            </Button>
          ) : (
            <>
              <Button type="button" variant="ghost" asChild>
                <Link to="/login">
                  <LogIn size={18} />
                  Log in
                </Link>
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link to="/register">
                  <UserPlus size={18} />
                  Register
                </Link>
              </Button>
            </>
          )}
        </nav>
      </header>

      {isSignedIn && (
        <section className="identity-strip">
          <span>{user?.email}</span>
          <span>{user?.roles.join(', ')}</span>
        </section>
      )}

      {canUseAdminArea && isAdminArea && (
        <nav className="admin-shell-nav" aria-label="Admin area">
          {adminLinks
            .filter((link) => canUseAdminTools || ['/admin', '/admin/orders'].includes(link.to))
            .map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => (isActive ? 'admin-shell-link active' : 'admin-shell-link')}
            >
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
        </nav>
      )}

      <Outlet />
    </div>
  )
}
