import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
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
  BellOff,
  BellRing,
  Volume2,
  VolumeX, Wallet
} from 'lucide-react'
import { motion } from 'motion/react'
import { useTheme } from 'next-themes'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../auth/AuthContext'
import { adminRoles } from '../auth/postLoginDestination'
import { buildBillingNotice } from '@/lib/billingNotice'
import { buildRefundOwedNotice } from '@/lib/refundOwedNotice'
import { buildRefundQueueNotice } from '@/lib/refundQueueNotice'
import { BrandLogo } from '../components/BrandLogo'
import { DemoIdentitySwitcher } from '../components/DemoIdentitySwitcher'
import {
  OperationalNotificationBanner,
  OperationalNotificationButton,
  sortOperationalNotices,
  type OperationalNotice,
} from '../components/OperationalNotificationCenter'
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
/**
 * Lazily, because it lives in the staff orders page and a static import pulled that whole page —
 * the thermal-printer driver, the QZ transport, every settings panel — into the entry chunk, for
 * every visitor including a customer opening a menu. The dialog is behind a button only staff can
 * see, so the wait is theirs and it is a click long.
 */
const PrinterSettingsDialog = lazy(() =>
  import('../pages/StaffOrdersPage').then((module) => ({ default: module.PrinterSettingsDialog })))
import { useRestaurantPrinting } from '../printing/RestaurantPrintingContext'
import {
  subscribeOperationalSuccess,
  type OperationalSuccessEvent,
} from '../lib/operationalNotifications'

const consoleRoles = ['PlatformOwner', 'RestaurantOwner', 'Admin', 'Staff']
const restaurantStaffRoles = ['PlatformOwner', 'RestaurantOwner', 'Admin', 'Staff']
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
    to: '/admin/billing',
    label: 'Billing',
    icon: Wallet,
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
  {
    to: '/admin/privacy-requests',
    label: 'Privacy requests',
    icon: ShieldCheck,
    platformOwnerOnly: true,
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
  const [recentSuccesses, setRecentSuccesses] = useState<OperationalSuccessEvent[]>([])
  const [visibleSuccessIds, setVisibleSuccessIds] = useState<Set<string>>(() => new Set())
  const [dismissedBannerIds, setDismissedBannerIds] = useState<Set<string>>(() => new Set())
  const successTimersRef = useRef<number[]>([])
  const printing = useRestaurantPrinting()
  const themeMode: ThemeMode = theme === 'light' || theme === 'dark' ? theme : 'system'
  const ThemeIcon = themeMode === 'dark' ? Moon : themeMode === 'light' ? Sun : Monitor
  const isSignedIn = Boolean(token)
  const canUseAdminArea = hasAnyRole(consoleRoles)
  const canUseAdminTools = hasAnyRole(adminRoles)
  const canUseStaffOrders = hasAnyRole(restaurantStaffRoles)
  const isPlatformOwner = hasAnyRole(['PlatformOwner'])
  const isAdminArea = location.pathname.startsWith('/admin')
  const isStaffOrdersArea = location.pathname.startsWith('/staff/')
  const isBackendPulseActive = backendStatus === 'checking' || backendStatus === 'ok'
  const showStripeForwardButton = import.meta.env.DEV && isSignedIn
  // Privacy requests concern a person's information across the whole platform, so they are the
  // platform owner's to answer — and until this link existed, nobody could reach the queue at all.
  const visibleAdminLinks = adminLinks
    .filter((link) => !('platformOwnerOnly' in link && link.platformOwnerOnly) || isPlatformOwner)
    .filter((link) => canUseAdminTools || ['/admin', '/admin/orders'].includes(link.to))
  const selectedPrintRestaurant = printing.printRestaurants.find(
    (restaurant) => restaurant.id === printing.activeRestaurantId,
  )

  const operationalNotices = useMemo<OperationalNotice[]>(() => {
    if (!canUseStaffOrders) return []

    const notices: OperationalNotice[] = []
    const paymentRestaurants = printing.isPlatformOwner && !printing.activeRestaurantId
      ? printing.printRestaurants
          .filter((restaurant) => restaurant.isActive && restaurant.onlinePaymentsEnabled !== true)
          .map((restaurant) => ({
            id: restaurant.id,
            name: restaurant.name,
            stripeConnectStatus: restaurant.stripeConnectStatus ?? 'NotConnected',
            onlinePaymentsEnabled: restaurant.onlinePaymentsEnabled === true,
          }))
      : printing.activeRestaurantOperations
        ? [{
            id: printing.activeRestaurantOperations.id,
            name: printing.activeRestaurantOperations.name,
            stripeConnectStatus: printing.activeRestaurantOperations.stripeConnectStatus,
            onlinePaymentsEnabled: printing.activeRestaurantOperations.onlinePaymentsEnabled,
          }]
        : []

    paymentRestaurants.forEach((restaurant) => {
      if (restaurant.onlinePaymentsEnabled) return
      const statusMessage = restaurant.stripeConnectStatus === 'Restricted'
        ? 'Stripe has restricted this account, so Online payment is disabled until the required details are resolved.'
        : restaurant.stripeConnectStatus === 'OnboardingIncomplete'
          ? 'Stripe setup is incomplete, so Online payment is disabled until onboarding is finished.'
          : 'Stripe is not connected, so Online payment is disabled. Customers can still pay at the counter.'
      const canOpenPaymentSettings = canUseAdminTools

      notices.push({
        id: `stripe-${restaurant.id}`,
        severity: 'error',
        title: `${restaurant.name}: Online payment unavailable`,
        message: statusMessage,
        actionLabel: canOpenPaymentSettings ? 'Open payment settings' : undefined,
        onAction: canOpenPaymentSettings
          ? () => navigate(`/admin/restaurants?section=restaurants&q=${encodeURIComponent(restaurant.name)}&payments=${restaurant.id}`)
          : undefined,
      })
    })

    if (
      printing.settings.mode === 'qz-tray'
      && printing.settings.autoPrintNewOrders
      && printing.qzConnectionStatus !== 'connected'
      && printing.qzConnectionStatus !== 'checking'
    ) {
      notices.push({
        id: 'printer-qz-disconnected',
        severity: 'warning',
        title: 'Kitchen printer is not connected',
        message: 'Automatic printing is paused until QZ Tray reconnects. Orders can still be accepted manually.',
        actionLabel: 'Open printer settings',
        onAction: () => printing.setSettingsOpen(true),
      })
    }

    // FS-021. QZ can be connected while the printer is not: the websocket only reaches the desktop
    // app on this same machine. Without this, a shop whose printer has gone sees nothing wrong
    // until a paid order fails to produce a docket.
    if (
      printing.settings.autoPrintNewOrders
      && printing.printerReadiness?.state === 'unreachable'
      && (printing.settings.mode !== 'qz-tray' || printing.qzConnectionStatus === 'connected')
    ) {
      notices.push({
        id: 'printer-unreachable',
        severity: 'error',
        title: 'Printer is not responding',
        message: `${printing.printerReadiness.detail}. Tickets will not print until this is fixed, `
          + 'even though the printing service is still connected.',
        actionLabel: 'Open printer settings',
        onAction: () => printing.setSettingsOpen(true),
      })
    }

    const failedPrintJobs = printing.printJobs.failedCount + printing.printJobs.deadLetterCount
    if (failedPrintJobs > 0) {
      notices.push({
        id: 'printer-failed-jobs',
        severity: 'warning',
        title: `${failedPrintJobs} print ${failedPrintJobs === 1 ? 'task needs' : 'tasks need'} attention`,
        message: 'One or more kitchen tickets were not printed successfully.',
        actionLabel: 'Review print tasks',
        // Lands on the task list itself. Opening the settings dialog alone put people in front of a
        // collapsed section and no sign the thing they came for was inside it.
        onAction: () => printing.openPrintTasks(),
      })
    }

    // Only the roles that can answer one. Approving is AdminApi — PlatformOwner, RestaurantOwner
    // and Admin — so telling a Staff member that three refunds are waiting hands them an alarm and
    // no way to silence it, and teaches everyone that the bell holds things you cannot act on.
    if (canUseAdminTools) {
      // Read from the same two places the payment warnings are: the platform owner is assigned to
      // no restaurant, so their single-restaurant record is always empty and the list is the only
      // thing that knows. Named per restaurant so an owner watching several is told which one.
      const refundQueues = printing.isPlatformOwner && !printing.activeRestaurantId
        ? printing.printRestaurants
            .filter((restaurant) => restaurant.isActive)
            .map((restaurant) => ({
              id: restaurant.id,
              name: restaurant.name,
              count: restaurant.pendingRefundRequestCount ?? 0,
              oldest: restaurant.oldestPendingRefundRequestAt ?? null,
              owedCount: restaurant.refundOwedCount ?? 0,
              owedAmountCents: restaurant.refundOwedAmountCents ?? 0,
              owedOldest: restaurant.oldestRefundOwedAt ?? null,
              currency: restaurant.currency,
            }))
        : printing.activeRestaurantOperations
          ? [{
              id: printing.activeRestaurantOperations.id,
              name: printing.activeRestaurantOperations.name,
              count: printing.activeRestaurantOperations.pendingRefundRequestCount,
              oldest: printing.activeRestaurantOperations.oldestPendingRefundRequestAt,
              owedCount: printing.activeRestaurantOperations.refundOwedCount ?? 0,
              owedAmountCents: printing.activeRestaurantOperations.refundOwedAmountCents ?? 0,
              owedOldest: printing.activeRestaurantOperations.oldestRefundOwedAt ?? null,
              currency: printing.activeRestaurantOperations.billing?.currency ?? null,
            }]
          : []

      refundQueues.forEach((queue) => {
        const pendingRefunds = buildRefundQueueNotice(queue.count, queue.oldest)
        if (pendingRefunds) notices.push({
          id: `refund-requests-pending-${queue.id}`,
          severity: pendingRefunds.severity,
          title: refundQueues.length > 1
            ? `${queue.name}: ${pendingRefunds.title}`
            : pendingRefunds.title,
          message: pendingRefunds.message,
          actionLabel: 'Review refund requests',
          onAction: () => navigate(
            `/admin/payments?view=requests&requestStatus=Pending&restaurant=${queue.id}`,
          ),
        })

        // Separate from the queue above on purpose. That one is customers who asked; this one is
        // customers who were never told, and folding them into a single number would let the
        // quieter, worse case hide inside the busier one.
        const owed = buildRefundOwedNotice(
          queue.owedCount,
          queue.owedAmountCents,
          queue.owedOldest,
          queue.currency,
        )
        if (owed) notices.push({
          id: `refund-owed-${queue.id}`,
          severity: owed.severity,
          title: refundQueues.length > 1
            ? `${queue.name}: ${owed.title}`
            : owed.title,
          message: owed.message,
          // Lands on the orders these are, not on the refund request list — there are no requests
          // to review here, which is the whole difficulty.
          actionLabel: 'Review these orders',
          onAction: () => navigate(
            `/staff/orders?queue=closed&restaurant=${queue.id}`,
          ),
        })
      })
    }

    // Read from the same two places the payment warnings are, for the same reason: the platform
    // owner is assigned to no restaurant, so their own operations record is always empty and the
    // restaurants list is the only thing that knows.
    if (canUseAdminTools) {
      const billingSources = printing.isPlatformOwner && !printing.activeRestaurantId
        ? printing.printRestaurants
            .filter((restaurant) => restaurant.isActive)
            .map((restaurant) => ({
              id: restaurant.id,
              name: restaurant.name,
              billing: restaurant.billing ?? null,
            }))
        : printing.activeRestaurantOperations
          ? [{
              id: printing.activeRestaurantOperations.id,
              name: printing.activeRestaurantOperations.name,
              billing: printing.activeRestaurantOperations.billing,
            }]
          : []

      billingSources.forEach((source) => {
        const notice = buildBillingNotice(
          source.billing,
          billingSources.length > 1 ? source.name : null,
        )
        if (!notice) return

        notices.push({
          id: `platform-billing-${source.id}`,
          severity: notice.severity,
          title: notice.title,
          message: notice.message,
          actionLabel: 'Open billing',
          // Carries which restaurant. The platform owner is assigned to none, so a bare link would
          // send them from a warning naming one shop to a page that says it knows of no shop.
          onAction: () => navigate(`/admin/billing?restaurantId=${source.id}`),
        })
      })
    }

    if (printing.printStationLeaseHeld) {
      notices.push({
        id: 'printer-station-standby',
        severity: 'warning',
        title: 'This print station is standing by',
        message: 'Another browser tab or computer owns automatic printing for this restaurant.',
        actionLabel: 'Open printer settings',
        onAction: () => printing.setSettingsOpen(true),
      })
    }

    return notices
  }, [
    canUseAdminTools,
    canUseStaffOrders,
    navigate,
    printing,
  ])

  const successNotices = useMemo<OperationalNotice[]>(() => recentSuccesses.map((event) => ({
    id: event.id,
    severity: 'success',
    title: event.title,
    message: event.message,
    createdAt: event.createdAt,
  })), [recentSuccesses])
  const allOperationalNotices = useMemo(
    () => sortOperationalNotices([...operationalNotices, ...successNotices]),
    [operationalNotices, successNotices],
  )
  const bannerNotice = useMemo(() => sortOperationalNotices([
    ...operationalNotices,
    ...successNotices.filter((notice) => visibleSuccessIds.has(notice.id)),
  ]).find((notice) => !dismissedBannerIds.has(notice.id)), [
    dismissedBannerIds,
    operationalNotices,
    successNotices,
    visibleSuccessIds,
  ])

  useEffect(() => {
    if (location.hash) {
      scrollToHash(location.hash)
    }
  }, [location.hash, location.pathname, location.search])

  useEffect(() => {
    const unsubscribe = subscribeOperationalSuccess((event) => {
      setRecentSuccesses((current) => [event, ...current].slice(0, 8))
      setVisibleSuccessIds((current) => new Set(current).add(event.id))
      const timer = window.setTimeout(() => {
        setVisibleSuccessIds((current) => {
          const next = new Set(current)
          next.delete(event.id)
          return next
        })
      }, 6_000)
      successTimersRef.current.push(timer)
    })

    return () => {
      unsubscribe()
      successTimersRef.current.forEach((timer) => window.clearTimeout(timer))
      successTimersRef.current = []
    }
  }, [])

  useEffect(() => {
    // Drops dismissals for notices that are no longer active. One extra render on mount, not a stale value.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissedBannerIds((current) => {
      const activeIds = new Set(operationalNotices.map((notice) => notice.id))
      const next = new Set([...current].filter((id) => activeIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [operationalNotices])

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

          {canUseStaffOrders ? <OperationalNotificationButton notices={allOperationalNotices} compact /> : null}

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
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="mobile-topbar-icon"
                      aria-label={printing.overdueAlertEnabled
                        ? 'Mute unaccepted order alert'
                        : 'Enable unaccepted order alert'}
                      onClick={() => void printing.toggleOverdueAlert()}
                    >
                      {printing.overdueAlertEnabled ? <BellRing size={18} /> : <BellOff size={18} />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {printing.overdueAlertEnabled
                      ? 'Unaccepted order alert on'
                      : 'Unaccepted order alert off'}
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
          {canUseStaffOrders ? <OperationalNotificationButton notices={allOperationalNotices} /> : null}
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
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={printing.overdueAlertEnabled
                        ? 'Mute unaccepted order alert'
                        : 'Enable unaccepted order alert'}
                      onClick={() => void printing.toggleOverdueAlert()}
                    >
                      {printing.overdueAlertEnabled ? <BellRing size={18} /> : <BellOff size={18} />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {printing.overdueAlertEnabled
                      ? 'Unaccepted order alert on'
                      : 'Unaccepted order alert off'}
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

      {bannerNotice ? (
        <OperationalNotificationBanner
          notice={bannerNotice}
          onDismiss={() => setDismissedBannerIds((current) => new Set(current).add(bannerNotice.id))}
        />
      ) : null}

      {canUseStaffOrders ? (
        <Suspense fallback={null}>
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
          showPrintTasks={printing.printTasksRequested}
          onPrintTasksShown={printing.acknowledgePrintTasksRequest}
          printerReadiness={printing.printerReadiness}
          lastSuccessfulPrintAt={printing.lastSuccessfulPrintAt}
          onCheckPrinterReadiness={printing.checkPrinterReadiness}
          showPrintRestaurantSelector={printing.isPlatformOwner}
          printRestaurants={printing.printRestaurants}
          activePrintRestaurantId={printing.activeRestaurantId}
          onPrintRestaurantChange={printing.setPlatformRestaurantId}
        />
        </Suspense>
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
