import { useEffect, useState } from 'react'
import {
  BarChart3,
  BadgeCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  CreditCard,
  DoorOpen,
  LayoutDashboard,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  Printer,
  ShieldCheck,
  ShoppingBag,
  SquareTerminal,
  Store,
  Sun,
  UsersRound,
  Utensils,
  UserRound,
  UserPlus,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useTheme } from 'next-themes'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../auth/AuthContext'
import { BrandLogo } from '../components/BrandLogo'
import { DemoIdentitySwitcher } from '../components/DemoIdentitySwitcher'
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar'
import { Button } from '../components/ui/button'
import { Switch } from '../components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../components/ui/tooltip'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '../components/ui/drawer'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../components/ui/popover'
import { PrinterSettingsDialog } from '../pages/StaffOrdersPage'
import { useRestaurantPrinting } from '../printing/RestaurantPrintingContext'

const consoleRoles = ['PlatformOwner', 'RestaurantOwner', 'Admin', 'Staff']
const restaurantStaffRoles = ['PlatformOwner', 'RestaurantOwner', 'Admin', 'Staff']
const adminRoles = ['PlatformOwner', 'RestaurantOwner', 'Admin']
const adminLinks = [
  {
    to: '/admin',
    label: 'Dashboard',
    icon: LayoutDashboard,
    end: true,
    children: [
      { to: '/admin#dashboard-summary', label: 'Summary' },
      { to: '/admin#dashboard-access', label: 'Public URLs' },
      { to: '/admin#dashboard-orders', label: 'Recent orders' },
    ],
  },
  {
    to: '/admin/users',
    label: 'Users',
    icon: UsersRound,
    children: [
      { to: '/admin/users', label: 'User center' },
      { to: '/admin/users?section=create', label: 'Create user' },
      { to: '/admin/users?section=email', label: 'Email' },
      { to: '/admin/users?section=permissions', label: 'Permission guard' },
    ],
  },
  {
    to: '/admin/restaurants',
    label: 'Restaurants',
    icon: Store,
    children: [
      { to: '/admin/restaurants#restaurant-directory', label: 'Directory' },
      { to: '/admin/restaurants#restaurant-tables', label: 'Tables' },
    ],
  },
  { to: '/admin/orders', label: 'Orders', icon: ClipboardList },
  {
    to: '/admin/menu',
    label: 'Menu',
    icon: Utensils,
    children: [
      { to: '/admin/menu#menu-categories', label: 'Categories' },
      { to: '/admin/menu#menu-items', label: 'Items & options' },
    ],
  },
  {
    to: '/admin/payments',
    label: 'Payments',
    icon: CreditCard,
    children: [
      { to: '/admin/payments#payment-orders', label: 'Orders' },
      { to: '/admin/payments#refund-requests', label: 'Refund requests' },
      { to: '/admin/payments#refund-records', label: 'Refund records' },
    ],
  },
  {
    to: '/admin/reports',
    label: 'Reports',
    icon: BarChart3,
    children: [
      { to: '/admin/reports', label: 'Audit' },
      { to: '/admin/reports?section=orders', label: 'Orders' },
      { to: '/admin/reports?section=payments', label: 'Payments' },
    ],
  },
]
type BackendStatus = 'idle' | 'checking' | 'ok' | 'fail'
type ThemeMode = 'system' | 'light' | 'dark'

const themeCycle: Record<ThemeMode, ThemeMode> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
}

const themeLabels: Record<ThemeMode, string> = {
  system: 'System theme',
  light: 'Light theme',
  dark: 'Dark theme',
}

const themeNextAction: Record<ThemeMode, string> = {
  system: 'Click to switch to light',
  light: 'Click to switch to dark',
  dark: 'Click to use system theme',
}

const backendStatusTooltip: Record<BackendStatus, string> = {
  idle: 'Check backend connection',
  checking: 'Checking backend…',
  ok: 'Backend is healthy',
  fail: 'Connection failed — click to retry',
}

function getInitials(name?: string | null, email?: string | null) {
  const source = name?.trim() || email?.trim() || 'U'
  const words = source.split(/\s+/).filter(Boolean)

  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase()
  }

  return source.slice(0, 2).toUpperCase()
}

function isCurrentChildLink(target: string, locationPathname: string, locationSearch: string, locationHash: string) {
  const [pathAndSearch, hash = ''] = target.split('#')
  const [pathname, search = ''] = pathAndSearch.split('?')

  return pathname === locationPathname
    && `?${search}`.replace(/^\?$/, '') === locationSearch
    && (hash ? `#${hash}` === locationHash : !locationHash)
}

function scrollToHash(hash: string) {
  const id = hash.replace(/^#/, '')

  if (!id) {
    return
  }

  window.setTimeout(() => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, 0)
}

export function AppLayout() {
  const { user, token, logout, hasAnyRole } = useAuth()
  const { theme = 'system', setTheme } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('idle')
  const [isAdminDrawerOpen, setIsAdminDrawerOpen] = useState(false)
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)
  const [isDesktopUserMenuOpen, setIsDesktopUserMenuOpen] = useState(false)
  const [expandedAdminGroups, setExpandedAdminGroups] = useState<Record<string, boolean>>({})
  const printing = useRestaurantPrinting()
  const themeMode: ThemeMode = theme === 'light' || theme === 'dark' ? theme : 'system'
  const ThemeIcon = themeMode === 'dark' ? Moon : themeMode === 'light' ? Sun : Monitor
  const isSignedIn = Boolean(token)
  const canUseAdminArea = hasAnyRole(consoleRoles)
  const canUseAdminTools = hasAnyRole(adminRoles)
  const canUseStaffOrders = hasAnyRole(restaurantStaffRoles)
  const isAdminArea = location.pathname.startsWith('/admin')
  const isStaffOrdersArea = location.pathname.startsWith('/staff/')
  const isBackendPulseActive = backendStatus === 'checking' || backendStatus === 'ok'
  const showStripeForwardButton = import.meta.env.DEV && isSignedIn
  const visibleAdminLinks = adminLinks.filter((link) => canUseAdminTools || ['/admin', '/admin/orders'].includes(link.to))
  const selectedPrintRestaurant = printing.printRestaurants.find(
    (restaurant) => restaurant.id === printing.activeRestaurantId,
  )

  useEffect(() => {
    if (location.hash) {
      scrollToHash(location.hash)
    }
  }, [location.hash, location.pathname, location.search])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const closeUserMenu = () => {
    setIsUserMenuOpen(false)
  }

  const closeDesktopUserMenu = () => {
    setIsDesktopUserMenuOpen(false)
  }

  const cycleTheme = () => {
    setTheme(themeCycle[themeMode])
  }

  const isAdminGroupExpanded = (to: string) => expandedAdminGroups[to] ?? location.pathname === to

  const toggleAdminGroup = (to: string) => {
    setExpandedAdminGroups((current) => ({
      ...current,
      [to]: !(current[to] ?? location.pathname === to),
    }))
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

  const openStripeForward = () => {
    window.location.assign('dineflow-dev://stripe-forward')
  }

  return (
    <div className={`app-shell${isStaffOrdersArea ? ' staff-orders-shell' : ''}`}>
      <header className="topbar">
        <div className="topbar-brand">
          <BrandLogo className="topbar-brand-logo" />
        </div>

        <div className="mobile-topbar-actions" aria-label="Quick actions">
          <Popover open={isUserMenuOpen} onOpenChange={setIsUserMenuOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="mobile-user-menu-trigger"
                aria-label="Open user menu"
                aria-expanded={isUserMenuOpen}
              >
                <Avatar size="sm">
                  {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.fullName ?? user.email ?? 'User avatar'} />}
                  <AvatarFallback>{getInitials(user?.fullName, user?.email)}</AvatarFallback>
                </Avatar>
                <span className="mobile-user-menu-trigger-copy">
                  <strong>{user?.fullName || (isSignedIn ? 'Not set' : 'Guest')}</strong>
                  <span>{user?.email || 'Browser order tracking'}</span>
                </span>
                <ChevronDown size={15} />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="mobile-user-menu">
              <div className="mobile-user-menu-header">
                <Avatar size="sm">
                  {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.fullName ?? user.email ?? 'User avatar'} />}
                  <AvatarFallback>{getInitials(user?.fullName, user?.email)}</AvatarFallback>
                </Avatar>
                <div>
                  <strong>{user?.fullName || (isSignedIn ? 'Not set' : 'Guest')}</strong>
                  <span>{user?.email || 'Browser order tracking'}</span>
                </div>
              </div>

              <div className="mobile-user-menu-demo">
                <DemoIdentitySwitcher />
              </div>

              <div className="mobile-user-menu-items">
                <Link
                  to="/my-orders"
                  className={`mobile-user-menu-item${location.pathname === '/my-orders' ? ' active' : ''}`}
                  onClick={closeUserMenu}
                >
                  <ShoppingBag size={17} />
                  My Orders
                </Link>
                {isSignedIn && (
                  <Link
                    to="/me"
                    className={`mobile-user-menu-item${location.pathname === '/me' ? ' active' : ''}`}
                    onClick={closeUserMenu}
                  >
                    <UserRound size={17} />
                    Profile
                  </Link>
                )}
                {canUseStaffOrders && (
                  <>
                    <Link
                      to="/staff/front-counter"
                      className={`mobile-user-menu-item${location.pathname.startsWith('/staff/front-counter') ? ' active' : ''}`}
                      onClick={closeUserMenu}
                    >
                      <DoorOpen size={17} />
                      Front Counter
                    </Link>
                    <Link
                      to="/staff/orders"
                      className={`mobile-user-menu-item${location.pathname.startsWith('/staff/orders') ? ' active' : ''}`}
                      onClick={closeUserMenu}
                    >
                      <ClipboardList size={17} />
                      Staff Orders
                    </Link>
                  </>
                )}
                {canUseAdminArea && (
                  <Link
                    to="/admin"
                    className={`mobile-user-menu-item${location.pathname.startsWith('/admin') ? ' active' : ''}`}
                    onClick={closeUserMenu}
                  >
                    <ShieldCheck size={17} />
                    Admin
                  </Link>
                )}
                {isSignedIn ? (
                  <button
                    type="button"
                    className="mobile-user-menu-item"
                    onClick={() => {
                      closeUserMenu()
                      handleLogout()
                    }}
                  >
                    <LogOut size={17} />
                    Sign out
                  </button>
                ) : (
                  <>
                    <Link to="/login" className="mobile-user-menu-item" onClick={closeUserMenu}>
                      <LogIn size={17} />
                      Log in
                    </Link>
                    <Link to="/register" className="mobile-user-menu-item" onClick={closeUserMenu}>
                      <UserPlus size={17} />
                      Register
                    </Link>
                  </>
                )}
              </div>
            </PopoverContent>
          </Popover>

          {canUseStaffOrders ? (
            <>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-2">
                      <BadgeCheck size={17} aria-hidden="true" />
                      <Switch
                        checked={printing.autoAcceptOrders}
                        disabled={!printing.activeRestaurantId || printing.autoAcceptUpdating}
                        aria-label="Automatically accept eligible new orders"
                        onCheckedChange={(checked) => void printing.setAutoAcceptOrders(checked)}
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {printing.activeRestaurantId
                      ? `Auto accept ${printing.autoAcceptOrders ? 'on' : 'off'}`
                      : 'Select a restaurant to control automatic acceptance'}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="mobile-topbar-icon relative"
                      aria-label="Kitchen printer settings"
                      onClick={() => printing.setSettingsOpen(true)}
                    >
                      <Printer size={18} />
                      {printing.printJobs.failedCount + printing.printJobs.deadLetterCount > 0 ? (
                        <motion.span
                          className="absolute -right-1 -top-1 size-2.5 rounded-full bg-destructive"
                          initial={{ scale: 0.8 }}
                          animate={{ scale: [0.8, 1.15, 0.8] }}
                          transition={{ duration: 1.8, repeat: Infinity }}
                        />
                      ) : null}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Printer: {printing.settings.mode === 'qz-tray' ? 'QZ Tray' : printing.settings.mode}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="mobile-topbar-icon"
                      aria-label={printing.audioEnabled ? 'Mute new order sound' : 'Enable new order sound'}
                      onClick={() => void printing.toggleAudio()}
                    >
                      {printing.audioEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {printing.audioEnabled ? 'New order sound on' : 'New order sound off'}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </>
          ) : null}

          {showStripeForwardButton ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="mobile-topbar-icon"
                    aria-label="Open Stripe webhook forwarding terminal"
                    onClick={openStripeForward}
                  >
                    <SquareTerminal size={18} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Open Stripe forward terminal (dev only)</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="mobile-topbar-icon"
                  aria-label={`${themeLabels[themeMode]} — ${themeNextAction[themeMode]}`}
                  onClick={cycleTheme}
                >
                  <ThemeIcon size={18} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <span className="flex flex-col items-start gap-0.5">
                  <span className="font-medium">{themeLabels[themeMode]}</span>
                  <span className="opacity-70">{themeNextAction[themeMode]}</span>
                </span>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className={`mobile-topbar-icon navbar-status-button ${backendStatus}`}
                  aria-label={backendStatusTooltip[backendStatus]}
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
              </TooltipTrigger>
              <TooltipContent side="bottom">{backendStatusTooltip[backendStatus]}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <nav className="nav-actions" aria-label="Primary">
          <Popover open={isDesktopUserMenuOpen} onOpenChange={setIsDesktopUserMenuOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="navbar-user navbar-user-trigger"
                aria-label="Open user menu"
                aria-expanded={isDesktopUserMenuOpen}
              >
                <Avatar size="sm">
                  {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.fullName ?? user.email ?? 'User avatar'} />}
                  <AvatarFallback>{getInitials(user?.fullName, user?.email)}</AvatarFallback>
                </Avatar>
                <span className="navbar-user-copy">
                  <strong>{user?.fullName || (isSignedIn ? 'Not set' : 'Guest')}</strong>
                  <span>{user?.email || 'Browser order tracking'}</span>
                </span>
                <ChevronDown size={15} />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="mobile-user-menu desktop-user-menu">
              <div className="mobile-user-menu-header">
                <Avatar size="sm">
                  {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.fullName ?? user.email ?? 'User avatar'} />}
                  <AvatarFallback>{getInitials(user?.fullName, user?.email)}</AvatarFallback>
                </Avatar>
                <div>
                  <strong>{user?.fullName || (isSignedIn ? 'Not set' : 'Guest')}</strong>
                  <span>{user?.email || 'Browser order tracking'}</span>
                </div>
              </div>

              <div className="mobile-user-menu-demo">
                <DemoIdentitySwitcher />
              </div>

              <div className="mobile-user-menu-items">
                <Link
                  to="/my-orders"
                  className={`mobile-user-menu-item${location.pathname === '/my-orders' ? ' active' : ''}`}
                  onClick={closeDesktopUserMenu}
                >
                  <ShoppingBag size={17} />
                  My Orders
                </Link>
                {isSignedIn && (
                  <Link
                    to="/me"
                    className={`mobile-user-menu-item${location.pathname === '/me' ? ' active' : ''}`}
                    onClick={closeDesktopUserMenu}
                  >
                    <UserRound size={17} />
                    Profile
                  </Link>
                )}
                {canUseStaffOrders && (
                  <>
                    <Link
                      to="/staff/front-counter"
                      className={`mobile-user-menu-item${location.pathname.startsWith('/staff/front-counter') ? ' active' : ''}`}
                      onClick={closeDesktopUserMenu}
                    >
                      <DoorOpen size={17} />
                      Front Counter
                    </Link>
                    <Link
                      to="/staff/orders"
                      className={`mobile-user-menu-item${location.pathname.startsWith('/staff/orders') ? ' active' : ''}`}
                      onClick={closeDesktopUserMenu}
                    >
                      <ClipboardList size={17} />
                      Staff Orders
                    </Link>
                  </>
                )}
                {canUseAdminArea && (
                  <Link
                    to="/admin"
                    className={`mobile-user-menu-item${location.pathname.startsWith('/admin') ? ' active' : ''}`}
                    onClick={closeDesktopUserMenu}
                  >
                    <ShieldCheck size={17} />
                    Admin
                  </Link>
                )}
                {isSignedIn ? (
                  <button
                    type="button"
                    className="mobile-user-menu-item"
                    onClick={() => {
                      closeDesktopUserMenu()
                      handleLogout()
                    }}
                  >
                    <LogOut size={17} />
                    Sign out
                  </button>
                ) : (
                  <>
                    <Link to="/login" className="mobile-user-menu-item" onClick={closeDesktopUserMenu}>
                      <LogIn size={17} />
                      Log in
                    </Link>
                    <Link to="/register" className="mobile-user-menu-item" onClick={closeDesktopUserMenu}>
                      <UserPlus size={17} />
                      Register
                    </Link>
                  </>
                )}
              </div>
            </PopoverContent>
          </Popover>
          {canUseStaffOrders ? (
            <>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3">
                      <BadgeCheck size={18} aria-hidden="true" />
                      <span className="text-sm font-medium">Auto accept</span>
                      <Switch
                        checked={printing.autoAcceptOrders}
                        disabled={!printing.activeRestaurantId || printing.autoAcceptUpdating}
                        aria-label="Automatically accept eligible new orders"
                        onCheckedChange={(checked) => void printing.setAutoAcceptOrders(checked)}
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {printing.activeRestaurantId
                      ? 'Pay-at-counter orders are accepted immediately; online orders after payment.'
                      : 'Select a restaurant to control automatic acceptance'}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="relative"
                      aria-label="Kitchen printer settings"
                      onClick={() => printing.setSettingsOpen(true)}
                    >
                      <Printer size={18} />
                      {printing.printJobs.failedCount + printing.printJobs.deadLetterCount > 0 ? (
                        <motion.span
                          className="absolute -right-1 -top-1 size-2.5 rounded-full bg-destructive"
                          initial={{ scale: 0.8 }}
                          animate={{ scale: [0.8, 1.15, 0.8] }}
                          transition={{ duration: 1.8, repeat: Infinity }}
                        />
                      ) : null}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Printer: {printing.settings.mode === 'qz-tray' ? 'QZ Tray' : printing.settings.mode}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={printing.audioEnabled ? 'Mute new order sound' : 'Enable new order sound'}
                      onClick={() => void printing.toggleAudio()}
                    >
                      {printing.audioEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {printing.audioEnabled ? 'New order sound on' : 'New order sound off'}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </>
          ) : null}
          {showStripeForwardButton ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Open Stripe webhook forwarding terminal"
                    onClick={openStripeForward}
                  >
                    <SquareTerminal size={18} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Open Stripe forward terminal (dev only)</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`${themeLabels[themeMode]} — ${themeNextAction[themeMode]}`}
                  onClick={cycleTheme}
                >
                  <ThemeIcon size={18} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <span className="flex flex-col items-start gap-0.5">
                  <span className="font-medium">{themeLabels[themeMode]}</span>
                  <span className="opacity-70">{themeNextAction[themeMode]}</span>
                </span>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className={`navbar-status-button ${backendStatus}`}
                  aria-label={backendStatusTooltip[backendStatus]}
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
              </TooltipTrigger>
              <TooltipContent side="bottom">{backendStatusTooltip[backendStatus]}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </nav>
      </header>

      {canUseStaffOrders ? (
        <PrinterSettingsDialog
          open={printing.settingsOpen}
          kitchenSettings={printing.settings}
          frontCounterSettings={printing.frontCounterSettings}
          printJobs={printing.printJobs}
          printJobsLoading={printing.printJobsLoading}
          onOpenChange={printing.setSettingsOpen}
          onKitchenSettingsChange={printing.updateSettings}
          onFrontCounterSettingsChange={printing.updateFrontCounterSettings}
          onRefreshPrintJobs={() => void printing.refreshPrintJobs(true)}
          onRetryPrintJob={(jobId) => void printing.retryQueuedPrint(jobId)}
          onPrintTestTicket={(target) => void printing.printTestTicket(
            target,
            selectedPrintRestaurant?.name ?? 'DineFlow',
          )}
          showPrintRestaurantSelector={printing.isPlatformOwner}
          printRestaurants={printing.printRestaurants}
          activePrintRestaurantId={printing.activeRestaurantId}
          onPrintRestaurantChange={printing.setPlatformRestaurantId}
        />
      ) : null}

      {canUseAdminArea && isAdminArea && (
        <>
          <nav className="admin-shell-nav" aria-label="Admin area">
            {visibleAdminLinks.map(({ to, label, icon: Icon, end }) => (
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

          <Drawer direction="left" open={isAdminDrawerOpen} onOpenChange={setIsAdminDrawerOpen}>
            <div className="admin-mobile-nav">
              <Button
                type="button"
                variant="outline"
                className={`admin-mobile-trigger${isAdminDrawerOpen ? ' hidden' : ''}`}
                aria-label="Open admin navigation"
                aria-expanded={isAdminDrawerOpen}
                onClick={() => setIsAdminDrawerOpen(true)}
              >
                <ChevronRight size={18} />
              </Button>
            </div>
            <DrawerContent className="admin-mobile-drawer">
              <Button
                type="button"
                variant="outline"
                className="admin-mobile-drawer-tab"
                aria-label="Close admin navigation"
                aria-expanded={isAdminDrawerOpen}
                onClick={() => setIsAdminDrawerOpen(false)}
              >
                <ChevronLeft size={18} />
              </Button>
              <DrawerHeader className="admin-mobile-drawer-header">
                <BrandLogo className="admin-mobile-drawer-brand" />
                <DrawerTitle>Admin</DrawerTitle>
                <DrawerDescription>DineFlow console navigation</DrawerDescription>
              </DrawerHeader>
              <nav className="admin-mobile-drawer-nav" aria-label="Admin area">
                {visibleAdminLinks.map(({ to, label, icon: Icon, end, children }) => (
                  <div key={to} className="admin-mobile-drawer-group">
                    <div className="admin-mobile-drawer-row">
                      <DrawerClose asChild>
                        <NavLink
                          to={to}
                          end={end}
                          className={({ isActive }) =>
                            isActive ? 'admin-mobile-drawer-link active' : 'admin-mobile-drawer-link'
                          }
                        >
                          <Icon size={18} />
                          <span>{label}</span>
                        </NavLink>
                      </DrawerClose>
                      {children && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={`admin-mobile-drawer-expand${isAdminGroupExpanded(to) ? ' open' : ''}`}
                          aria-label={`${isAdminGroupExpanded(to) ? 'Collapse' : 'Expand'} ${label} navigation`}
                          aria-expanded={isAdminGroupExpanded(to)}
                          onClick={() => toggleAdminGroup(to)}
                        >
                          <ChevronDown size={17} />
                        </Button>
                      )}
                    </div>
                    {children && isAdminGroupExpanded(to) && (
                      <div
                        className="admin-mobile-drawer-subnav"
                        id={`admin-mobile-subnav-${label.toLowerCase().replace(/\s+/g, '-')}`}
                      >
                        {children.map((child) => (
                          <DrawerClose key={child.to} asChild>
                            <Link
                              to={child.to}
                              onClick={() => {
                                const [, hash] = child.to.split('#')

                                if (hash) {
                                  scrollToHash(hash)
                                }
                              }}
                              className={
                                isCurrentChildLink(child.to, location.pathname, location.search, location.hash)
                                  ? 'admin-mobile-drawer-sublink active'
                                  : 'admin-mobile-drawer-sublink'
                              }
                            >
                              {child.label}
                            </Link>
                          </DrawerClose>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </nav>
            </DrawerContent>
          </Drawer>
        </>
      )}

      <Outlet />
    </div>
  )
}
