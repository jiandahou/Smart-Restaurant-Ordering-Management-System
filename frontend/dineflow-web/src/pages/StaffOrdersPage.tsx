import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Bluetooth, Cable, CalendarClock, CheckCircle2, ChefHat, CircleHelp, Clock3, Copy, CreditCard, Download, ListChecks, Loader2, Printer, RefreshCw, Search, ShieldAlert, ShieldCheck, ShieldOff, ShoppingBag, Trash2, Usb, UserRound, Utensils, X } from 'lucide-react'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import {
  getAdminOrders,
  getRestaurants,
  getStaffOrders,
  recordCounterPayment,
  transitionAdminOrder,
  type AdminOrder,
  type OrderTransitionAction,
  type Restaurant,
} from '@/api/auth'
import type { PrintJobList } from '@/api/printing'
import { useAuth } from '@/auth/AuthContext'
import { OrderStatusBadge } from '@/components/orders/OrderStatusBadge'
import { OrderTransitionReasonField } from '@/components/orders/OrderTransitionReasonField'
import { PaymentStatusBadge } from '@/components/orders/PaymentStatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getBackgroundBrowserGuidance } from '@/lib/backgroundBrowser'
import { downloadPrinterDiagnostics, recordPrinterDiagnostic } from '@/lib/printerDiagnostics'
import {
  canStaffProcessOrder,
  getStaffDestructiveActions,
  getStaffPaymentMessage,
  getStaffPaymentState,
  getStaffPrimaryAction,
  hasSafetyNote,
  isCarriedOverOrder,
  isSafetyNoteText,
  isStaffPaymentHold,
} from '@/lib/staffOrderManagement'
import { useRestaurantPrinting } from '@/printing/RestaurantPrintingContext'
import {
  canManageQzTrustCertificate,
  checkQzPrinterHealth,
  clearQzPrinterQueue,
  defaultThermalPrinterSettings,
  detectWebUsbPrinter,
  downloadQzTrustCertificate,
  getQzHostNetwork,
  getQzRuntimeInfo,
  getQzTrayDefaultPrinter,
  hasQzTrayConnectedBefore,
  installQzTrustCertificate,
  isQzTrayConnected,
  formatQzPrinterConnectionLabel,
  listQzSerialPorts,
  listQzTrayPrinterDescriptors,
  probeQzNetworkPrinter,
  removeQzTrustCertificate,
  selectWebSerialPort,
  selectWebBluetoothPrinter,
  probeQzTrayStatus,
  QZ_TRAY_DOWNLOAD_URL,
  QzTrayError,
  subscribeQzTrayConnectionStatus,
  testQzSerialConnection,
  testWebSerialConnection,
  testWebUsbConnection,
  type QzTargetType,
  type QzPrintEncoding,
  type QzTrayConnectionStatus,
  type QzTrayPrinterDescriptor,
  type ThermalPaperWidth,
  type ThermalPrinterMode,
  type ThermalPrinterSettings,
} from '@/lib/thermalPrinter'
import { cn } from '@/lib/utils'

type Queue = 'active' | 'new' | 'kitchen' | 'ready' | 'late' | 'payment' | 'carried' | 'closed'
type StaffOrdersViewMode = 'orders' | 'kitchen'
type KitchenLane = 'new' | 'preparing' | 'ready'
type SortOption = 'oldest' | 'newest' | 'recentlyUpdated' | 'amountHigh' | 'amountLow' | 'orderNumber'
type OrderSignalTone = 'new' | 'ready' | 'kitchen' | 'blocked' | 'closed' | 'neutral'
type PrintTicketRequest = {
  order: AdminOrder
  requestedAt: number
}
type ConnectionTestStatus = 'untested' | 'testing' | 'succeeded' | 'failed'

const sortRequests: Record<SortOption, { sortBy: string; sortDirection: 'asc' | 'desc' }> = {
  oldest: { sortBy: 'createdAt', sortDirection: 'asc' },
  newest: { sortBy: 'createdAt', sortDirection: 'desc' },
  recentlyUpdated: { sortBy: 'updatedAt', sortDirection: 'desc' },
  amountHigh: { sortBy: 'totalAmount', sortDirection: 'desc' },
  amountLow: { sortBy: 'totalAmount', sortDirection: 'asc' },
  orderNumber: { sortBy: 'orderNumber', sortDirection: 'asc' },
}

const actionLabels: Record<OrderTransitionAction, string> = {
  Accept: 'Accept',
  StartPreparing: 'Start preparing',
  MarkReady: 'Mark ready',
  Complete: 'Complete',
  Reject: 'Reject',
  Cancel: 'Cancel',
  Reopen: 'Reopen',
}

const reasonRequiredActions = new Set<OrderTransitionAction>(['Reject', 'Cancel', 'Reopen'])

const queueStatuses: Record<Queue, Set<string>> = {
  active: new Set(['Pending', 'Accepted', 'Preparing', 'Ready']),
  new: new Set(['Pending']),
  kitchen: new Set(['Accepted', 'Preparing']),
  ready: new Set(['Ready']),
  late: new Set(['Pending', 'Accepted', 'Preparing', 'Ready']),
  payment: new Set(['Pending', 'Accepted', 'Preparing', 'Ready']),
  carried: new Set(['Pending', 'Accepted', 'Preparing', 'Ready']),
  closed: new Set(['Completed', 'Cancelled', 'Rejected']),
}

const queueLabels: Record<Queue, string> = {
  active: 'Active',
  new: 'New',
  kitchen: 'Kitchen',
  ready: 'Ready',
  late: 'Over 20 min',
  payment: 'Payment holds',
  carried: 'Carried over',
  closed: 'Closed',
}

const kitchenLaneLabels: Record<KitchenLane, string> = {
  new: 'New',
  preparing: 'Preparing',
  ready: 'Ready',
}

const kitchenLaneDescriptions: Record<KitchenLane, string> = {
  new: 'Needs acceptance',
  preparing: 'Accepted or cooking',
  ready: 'Waiting pickup',
}

const kitchenLaneStatuses: Record<KitchenLane, Set<string>> = {
  new: new Set(['Pending']),
  preparing: new Set(['Accepted', 'Preparing']),
  ready: new Set(['Ready']),
}

const printerModeLabels: Record<ThermalPrinterMode, string> = {
  browser: 'Browser',
  'qz-tray': 'QZ Tray',
  'web-serial': 'Web Serial',
  'web-usb': 'WebUSB',
  'web-bluetooth': 'Web Bluetooth',
}

const orderTypeLabels: Record<AdminOrder['orderType'], string> = {
  DineIn: 'Dine in',
  Takeaway: 'Takeaway',
  Scheduled: 'Scheduled',
}

function getOrderTypeLabel(orderType: AdminOrder['orderType']) {
  return orderTypeLabels[orderType] ?? orderType
}

function getOrderScope(order: AdminOrder) {
  if (order.orderType === 'DineIn') {
    return order.tableNumber ? `Dine in · Table ${order.tableNumber}` : 'Dine in'
  }

  if (order.orderType === 'Scheduled') {
    return order.tableNumber ? `Scheduled · Table ${order.tableNumber}` : 'Scheduled'
  }

  return getOrderTypeLabel(order.orderType)
}

function groupSelectedOptions(item: AdminOrder['items'][number]) {
  const grouped = new Map<string, AdminOrder['items'][number]['selectedOptions']>()

  for (const option of item.selectedOptions ?? []) {
    const groupName = option.groupNameSnapshot || 'Options'
    grouped.set(groupName, [...(grouped.get(groupName) ?? []), option])
  }

  return Array.from(grouped, ([groupName, options]) => ({ groupName, options }))
}

function isClosedOrder(order: AdminOrder) {
  return queueStatuses.closed.has(order.status)
}

function needsCounterPayment(order: AdminOrder) {
  return getStaffPaymentState(order) === 'counterDue'
}

function getOrderAgeMinutes(order: AdminOrder, now: Date) {
  const createdAt = new Date(order.createdAt).getTime()
  return Math.max(0, Math.floor((now.getTime() - createdAt) / 60_000))
}

function formatElapsedTime(order: AdminOrder, now: Date) {
  const minutes = getOrderAgeMinutes(order, now)

  if (minutes < 1) return '<1 min'
  if (minutes < 60) return `${minutes} min`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

function getOrderSignal(order: AdminOrder, now: Date): {
  label: string
  tone: OrderSignalTone
  isLate: boolean
} {
  const paymentState = getStaffPaymentState(order)
  const paymentHold = isStaffPaymentHold(order)
  const carriedOver = isCarriedOverOrder(order, now)
  const isLate = getOrderAgeMinutes(order, now) >= 20 && !isClosedOrder(order) && !paymentHold && !carriedOver

  if (isClosedOrder(order)) {
    return { label: 'Closed', tone: 'closed', isLate: false }
  }

  if (paymentState === 'refunded') {
    return { label: 'Refunded — close order', tone: 'blocked', isLate: false }
  }

  if (paymentState === 'failed') {
    return { label: 'Payment issue', tone: 'blocked', isLate: false }
  }

  if (paymentState === 'awaiting') {
    return { label: 'Waiting payment', tone: 'blocked', isLate: false }
  }

  if (carriedOver) {
    return { label: 'Carried over', tone: 'blocked', isLate: false }
  }

  if (order.status === 'Ready') {
    return { label: 'Ready now', tone: 'ready', isLate }
  }

  if (order.status === 'Pending') {
    return { label: isLate ? 'Needs accept now' : 'Needs accept', tone: 'new', isLate }
  }

  if (order.status === 'Accepted') {
    return { label: 'Start cooking', tone: 'kitchen', isLate }
  }

  if (order.status === 'Preparing') {
    return { label: 'In kitchen', tone: 'kitchen', isLate }
  }

  return { label: 'Review order', tone: 'neutral', isLate }
}

function orderMatchesQueue(order: AdminOrder, queue: Queue, now: Date) {
  if (!queueStatuses[queue].has(order.status)) {
    return false
  }

  if (queue === 'closed') {
    return true
  }

  const paymentHold = isStaffPaymentHold(order)
  const carriedOver = isCarriedOverOrder(order, now)

  if (queue === 'payment') {
    return paymentHold
  }

  if (queue === 'carried') {
    return carriedOver && !paymentHold
  }

  if (queue === 'late') {
    return !paymentHold && !carriedOver && getOrderAgeMinutes(order, now) >= 20
  }

  return !paymentHold && !carriedOver
}

export function StaffOrdersPage() {
  const { user } = useAuth()
  const printing = useRestaurantPrinting()
  const isPlatformOwner = user?.roles.includes('PlatformOwner') ?? false
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [totalOrderCount, setTotalOrderCount] = useState(0)
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [restaurantFilter, setRestaurantFilter] = useState(
    () => printing.activeRestaurantId ?? 'all',
  )
  const [sortOption, setSortOption] = useState<SortOption>('newest')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [queue, setQueue] = useState<Queue>('active')
  const [viewMode, setViewMode] = useState<StaffOrdersViewMode>('orders')
  const [mobileKitchenLane, setMobileKitchenLane] = useState<KitchenLane>('new')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null)
  const [pendingTransition, setPendingTransition] = useState<{
    order: AdminOrder
    action: OrderTransitionAction
  } | null>(null)
  const [reason, setReason] = useState('')
  const loadOrdersRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const loadRequestIdRef = useRef(0)
  const [printTicket, setPrintTicket] = useState<PrintTicketRequest | null>(null)
  const {
    settings: printerSettings,
    printingOrderId,
    printJobs,
    printStationLeaseHeld,
    orderEventRevision,
    printOrder,
    setSettingsOpen,
    setPlatformRestaurantId,
  } = printing

  useEffect(() => {
    if (!printTicket) return

    document.body.classList.add('staff-printing-order')

    const clearPrintTicket = () => setPrintTicket(null)
    const printTimer = window.setTimeout(() => {
      window.print()
    }, 80)

    window.addEventListener('afterprint', clearPrintTicket, { once: true })

    return () => {
      window.clearTimeout(printTimer)
      window.removeEventListener('afterprint', clearPrintTicket)
      document.body.classList.remove('staff-printing-order')
    }
  }, [printTicket])

  const loadOrders = useCallback(async (showToast = false) => {
    const requestId = loadRequestIdRef.current + 1
    loadRequestIdRef.current = requestId
    setRefreshing(true)

    try {
      setError(null)
      const sort = sortRequests[sortOption]
      const normalizedSearch = debouncedSearch.trim()
      const request = {
        page: 1,
        pageSize: 100,
        search: normalizedSearch || undefined,
        sortBy: sort.sortBy,
        sortDirection: sort.sortDirection,
        restaurantId: isPlatformOwner && restaurantFilter !== 'all' ? restaurantFilter : undefined,
      } as const
      const response = isPlatformOwner
        ? await getAdminOrders(request)
        : await getStaffOrders(request)

      if (requestId !== loadRequestIdRef.current) {
        return
      }

      setOrders(response.items)
      setTotalOrderCount(response.totalItems)
      setLastUpdated(new Date())
      if (showToast) toast.success('Staff order queue refreshed')
    } catch (loadError) {
      if (requestId !== loadRequestIdRef.current) {
        return
      }

      const message = loadError instanceof Error ? loadError.message : 'Could not load orders.'
      setError(message)
      if (showToast) toast.error('Could not refresh orders', { description: message })
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [debouncedSearch, isPlatformOwner, restaurantFilter, sortOption])

  useEffect(() => {
    loadOrdersRef.current = () => loadOrders()
  }, [loadOrders])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim())
    }, 250)

    return () => window.clearTimeout(timer)
  }, [search])

  const lastOrderEventRevisionRef = useRef(orderEventRevision)
  useEffect(() => {
    if (lastOrderEventRevisionRef.current === orderEventRevision) return
    lastOrderEventRevisionRef.current = orderEventRevision
    setQueue('active')
    const timer = window.setTimeout(() => void loadOrdersRef.current(), 300)
    return () => window.clearTimeout(timer)
  }, [orderEventRevision])

  useEffect(() => {
    if (!isPlatformOwner) return

    void getRestaurants()
      .then(setRestaurants)
      .catch((restaurantError) => {
        toast.error('Could not load restaurant filter', {
          description: restaurantError instanceof Error ? restaurantError.message : 'The request failed.',
        })
      })
  }, [isPlatformOwner])

  useEffect(() => {
    const initialLoadTimer = window.setTimeout(() => void loadOrders(), 0)
    const refreshTimer = window.setInterval(() => void loadOrders(), 15_000)
    return () => {
      window.clearTimeout(initialLoadTimer)
      window.clearInterval(refreshTimer)
    }
  }, [loadOrders])

  const visibleOrders = useMemo(() => {
    const now = lastUpdated ?? new Date()
    return orders.filter((order) => orderMatchesQueue(order, queue, now))
  }, [lastUpdated, orders, queue])

  const kitchenLanes = useMemo(() => {
    const now = lastUpdated ?? new Date()

    return (['new', 'preparing', 'ready'] as KitchenLane[]).map((lane) => ({
      lane,
      orders: orders
        .filter((order) =>
          kitchenLaneStatuses[lane].has(order.status) &&
          canStaffProcessOrder(order) &&
          !isCarriedOverOrder(order, now),
        )
        .sort((first, second) => {
          const firstAge = getOrderAgeMinutes(first, now)
          const secondAge = getOrderAgeMinutes(second, now)
          return secondAge - firstAge
        }),
    }))
  }, [lastUpdated, orders])

  const kitchenOrderCount = useMemo(
    () => kitchenLanes.reduce((total, lane) => total + lane.orders.length, 0),
    [kitchenLanes],
  )

  const queueCounts = useMemo(() => {
    const now = lastUpdated ?? new Date()

    return Object.fromEntries(
      (Object.keys(queueLabels) as Queue[]).map((value) => [
        value,
        orders.filter((order) => orderMatchesQueue(order, value, now)).length,
      ]),
    ) as Record<Queue, number>
  }, [lastUpdated, orders])

  const priorityCounts = useMemo(() => {
    const now = lastUpdated ?? new Date()
    const activeOrders = orders.filter((order) => orderMatchesQueue(order, 'active', now))

    return {
      needsAction: activeOrders.filter((order) => {
        const signal = getOrderSignal(order, now)
        return signal.tone !== 'blocked' && signal.tone !== 'closed'
      }).length,
      ready: activeOrders.filter((order) => order.status === 'Ready').length,
      late: activeOrders.filter((order) => getOrderSignal(order, now).isLate).length,
      paymentHolds: orders.filter((order) => orderMatchesQueue(order, 'payment', now)).length,
      carried: orders.filter((order) => orderMatchesQueue(order, 'carried', now)).length,
    }
  }, [lastUpdated, orders])

  const selectedRestaurant = restaurants.find((restaurant) => restaurant.id === restaurantFilter)
  const restaurantName = isPlatformOwner
    ? selectedRestaurant?.name ?? 'All restaurants'
    : orders[0]?.restaurantName ?? 'Your restaurant'
  const queueScopeDescription = isPlatformOwner
    ? restaurantFilter === 'all'
      ? 'Platform-wide live order queue.'
      : `Filtered to ${restaurantName}.`
    : 'Restaurant-scoped live order queue.'

  const replaceOrder = (updatedOrder: AdminOrder) => {
    setOrders((current) => current.map((order) => order.id === updatedOrder.id ? updatedOrder : order))
  }

  const submitTransition = async (
    order: AdminOrder,
    action: OrderTransitionAction,
    transitionReason?: string,
  ) => {
    setBusyOrderId(order.id)
    try {
      const updatedOrder = await transitionAdminOrder(order.id, action, transitionReason)
      replaceOrder(updatedOrder)
      setPendingTransition(null)
      setReason('')
      toast.success(`${order.orderNumber}: ${actionLabels[action]}`, {
        description: `Order is now ${updatedOrder.status}.`,
      })
    } catch (transitionError) {
      toast.error('Order could not be processed', {
        description: transitionError instanceof Error ? transitionError.message : 'The request failed.',
      })
    } finally {
      setBusyOrderId(null)
    }
  }

  const beginTransition = (order: AdminOrder, action: OrderTransitionAction) => {
    if (reasonRequiredActions.has(action)) {
      setPendingTransition({ order, action })
      setReason('')
      return
    }

    void submitTransition(order, action)
  }

  const markCounterPayment = async (order: AdminOrder) => {
    setBusyOrderId(order.id)
    try {
      const updatedOrder = await recordCounterPayment(order.id)
      replaceOrder(updatedOrder)
      toast.success('Counter payment recorded', { description: order.orderNumber })
    } catch (paymentError) {
      toast.error('Counter payment could not be recorded', {
        description: paymentError instanceof Error ? paymentError.message : 'The request failed.',
      })
    } finally {
      setBusyOrderId(null)
    }
  }

  const printOrQueueOrder = useCallback(async (order: AdminOrder) => {
    const result = await printOrder(order)
    if (result === 'browser') {
      setPrintTicket({ order, requestedAt: Date.now() })
    }
  }, [printOrder])

  return (
    <main className="content-grid">
      <Card>
        <CardHeader className="section-header">
          <div className="admin-page-title">
            <Utensils size={22} />
            <div>
              <h1 className="font-heading text-base font-medium">Staff Orders</h1>
              <CardDescription>
                {restaurantName} · {queueScopeDescription}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated ? (
              <span className="text-xs text-muted-foreground">
                Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            ) : null}
            <Button type="button" variant="secondary" disabled={refreshing} onClick={() => void loadOrders(true)}>
              <RefreshCw className={refreshing ? 'animate-spin' : ''} size={17} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        {isPlatformOwner && !printing.activeRestaurantId ? (
          <div className="mx-6 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            <span className="flex items-center gap-2 text-sm">
              <AlertCircle className="size-4 shrink-0" />
              Automatic printing is paused because this print station is not assigned to a restaurant.
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
              Choose print restaurant
            </Button>
          </div>
        ) : null}
        {printJobs.failedCount + printJobs.deadLetterCount > 0 ? (
          <div className="mx-6 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive">
            <span className="flex items-center gap-2 text-sm">
              <AlertCircle className="size-4 shrink-0" />
              {printJobs.failedCount + printJobs.deadLetterCount} print job
              {printJobs.failedCount + printJobs.deadLetterCount === 1 ? '' : 's'} need attention.
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
              Open print tasks
            </Button>
          </div>
        ) : null}
        {printStationLeaseHeld ? (
          <div className="mx-6 mb-3 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            <AlertCircle className="size-4 shrink-0" />
            Another tab or computer currently owns this print station. This page is standing by to prevent duplicate tickets.
          </div>
        ) : null}
        <CardContent className="space-y-5">
          <Tabs value={viewMode} onValueChange={(value) => setViewMode(value as StaffOrdersViewMode)} className="staff-orders-view-tabs">
            <TabsList aria-label="Staff order display mode">
              <TabsTrigger value="orders">
                <ListChecks size={16} />
                Orders
              </TabsTrigger>
              <TabsTrigger value="kitchen">
                <ChefHat size={16} />
                Kitchen
                <Badge variant="secondary" className="ml-1 h-5 min-w-5 justify-center px-1.5 leading-none">
                  {kitchenOrderCount}
                </Badge>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="staff-orders-priority-strip" aria-label="Staff order priority summary">
            <Button type="button" variant="outline" className="staff-orders-priority-pill is-action" aria-pressed={queue === 'active'} onClick={() => { setViewMode('orders'); setQueue('active') }}>
              <strong>{priorityCounts.needsAction}</strong>
              <span>Need action</span>
            </Button>
            <Button type="button" variant="outline" className="staff-orders-priority-pill is-ready" aria-pressed={queue === 'ready'} onClick={() => { setViewMode('orders'); setQueue('ready') }}>
              <strong>{priorityCounts.ready}</strong>
              <span>Ready now</span>
            </Button>
            <Button type="button" variant="outline" className="staff-orders-priority-pill is-late" aria-pressed={queue === 'late'} onClick={() => { setViewMode('orders'); setQueue('late') }}>
              <strong>{priorityCounts.late}</strong>
              <span>Over 20 min</span>
            </Button>
            <Button type="button" variant="outline" className="staff-orders-priority-pill is-blocked" aria-pressed={queue === 'payment'} onClick={() => { setViewMode('orders'); setQueue('payment') }}>
              <strong>{priorityCounts.paymentHolds}</strong>
              <span>Payment holds</span>
            </Button>
          </div>

          <div className="staff-orders-toolbar">
            {isPlatformOwner ? (
              <div className="staff-orders-filter space-y-1.5">
                <span className="text-sm font-medium">Restaurant</span>
                <Select
                  value={restaurantFilter}
                  onValueChange={(value) => {
                    setRestaurantFilter(value)
                    setPlatformRestaurantId(value === 'all' ? undefined : value)
                  }}
                >
                  <SelectTrigger aria-label="Filter staff orders by restaurant">
                    <SelectValue placeholder="Select restaurant" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="all">All restaurants</SelectItem>
                    {restaurants.map((restaurant) => (
                      <SelectItem key={restaurant.id} value={restaurant.id}>{restaurant.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="staff-orders-search space-y-1.5">
              <span className="text-sm font-medium">Search orders</span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  className="h-10 pl-9 pr-9"
                  placeholder="Order, pickup, customer, table, or item"
                  aria-label="Search staff orders"
                  onChange={(event) => setSearch(event.target.value)}
                />
                {refreshing && search.trim() ? (
                  <Loader2
                    className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
                    aria-label="Searching orders"
                  />
                ) : search.trim() ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Clear order search"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2"
                    onClick={() => setSearch('')}
                  >
                    <X className="size-3.5" />
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="staff-orders-sort space-y-1.5">
              <span className="text-sm font-medium">{viewMode === 'kitchen' ? 'Kitchen priority' : 'Sort orders'}</span>
              {viewMode === 'kitchen' ? (
                <div className="flex h-10 items-center rounded-md border bg-muted/35 px-3 text-sm text-muted-foreground">
                  Oldest actionable first
                </div>
              ) : (
                <Select value={sortOption} onValueChange={(value) => setSortOption(value as SortOption)}>
                  <SelectTrigger aria-label="Sort staff orders">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="newest">Newest first</SelectItem>
                    <SelectItem value="oldest">Oldest first</SelectItem>
                    <SelectItem value="recentlyUpdated">Recently updated</SelectItem>
                    <SelectItem value="amountHigh">Amount: high to low</SelectItem>
                    <SelectItem value="amountLow">Amount: low to high</SelectItem>
                    <SelectItem value="orderNumber">Order number</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {viewMode === 'orders' ? (
            <Tabs value={queue} onValueChange={(value) => setQueue(value as Queue)}>
              <TabsList className="staff-orders-queue-tabs h-11 w-full">
                {(Object.keys(queueLabels) as Queue[]).map((value) => (
                  <TabsTrigger
                    key={value}
                    value={value}
                    className="h-full min-w-max gap-1 px-2 py-1 sm:gap-2 sm:px-3"
                  >
                    {queueLabels[value]}
                    <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1.5 leading-none">
                      {queueCounts[value]}
                    </Badge>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ) : null}

          {viewMode === 'kitchen' ? (
            <Tabs
              value={mobileKitchenLane}
              onValueChange={(value) => setMobileKitchenLane(value as KitchenLane)}
              className="staff-kitchen-mobile-tabs"
            >
              <TabsList className="grid h-11 w-full grid-cols-3">
                {kitchenLanes.map(({ lane, orders: laneOrders }) => (
                  <TabsTrigger key={lane} value={lane} className="gap-1">
                    {kitchenLaneLabels[lane]}
                    <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1.5 leading-none">
                      {laneOrders.length}
                    </Badge>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ) : null}

          {error ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          ) : null}

          {totalOrderCount > orders.length ? (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/35 p-3 text-muted-foreground">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span className="text-sm">
                Showing the first {orders.length} of {totalOrderCount} matching orders. Refine the restaurant or search filter to find older orders.
              </span>
            </div>
          ) : null}

          {loading && orders.length === 0 ? (
            <div className="dashboard-empty-state">Loading restaurant orders...</div>
          ) : viewMode === 'orders' && visibleOrders.length === 0 ? (
            <div className="dashboard-empty-state">
              {debouncedSearch ? `No orders match "${debouncedSearch}" in this queue.` : 'No orders in this queue.'}
            </div>
          ) : viewMode === 'kitchen' && kitchenOrderCount === 0 ? (
            <div className="dashboard-empty-state">
              {debouncedSearch ? `No kitchen orders match "${debouncedSearch}".` : 'No active kitchen orders.'}
            </div>
          ) : viewMode === 'kitchen' ? (
            <div className="staff-kitchen-board" aria-label="Kitchen order board">
              {kitchenLanes.map(({ lane, orders: laneOrders }) => (
                <section key={lane} className={cn('staff-kitchen-lane', `is-${lane}`, lane !== mobileKitchenLane && 'is-mobile-hidden')}>
                  <header className="staff-kitchen-lane-header">
                    <div>
                      <h3>{kitchenLaneLabels[lane]}</h3>
                      <span>{kitchenLaneDescriptions[lane]}</span>
                    </div>
                    <Badge variant="secondary">{laneOrders.length}</Badge>
                  </header>

                  {laneOrders.length === 0 ? (
                    <div className="staff-kitchen-empty">Clear</div>
                  ) : (
                    <div className="staff-kitchen-card-list">
                      {laneOrders.map((order) => {
                        const now = lastUpdated ?? new Date()
                        const signal = getOrderSignal(order, now)
                        const counterPaymentNeeded = needsCounterPayment(order)
                        const isBusy = busyOrderId === order.id
                        const itemCount = order.items.reduce((total, item) => total + item.quantity, 0)
                        const primaryAction = getStaffPrimaryAction(order)
                        const destructiveActions = getStaffDestructiveActions(order)
                        const safetyNote = hasSafetyNote(order)

                        return (
                          <article
                            key={order.id}
                            aria-labelledby={`staff-kitchen-order-${order.id}`}
                            className={cn('staff-kitchen-card', `staff-kitchen-card-${signal.tone}`, signal.isLate && 'is-late')}
                          >
                            <div className="staff-kitchen-card-header">
                              <div className="staff-kitchen-card-title">
                                <span className="staff-kitchen-order-number">{order.orderNumber}</span>
                                <strong id={`staff-kitchen-order-${order.id}`}>{order.tableNumber ? `Table ${order.tableNumber}` : getOrderTypeLabel(order.orderType)}</strong>
                              </div>
                              <div className="staff-kitchen-card-tools">
                                <span className={cn('staff-kitchen-timer', signal.isLate && 'is-late')}>
                                  <Clock3 size={15} />
                                  {formatElapsedTime(order, now)}
                                </span>
                                <PrintTicketButton
                                  disabled={printingOrderId === order.id}
                                  modeLabel={printerModeLabels[printerSettings.mode]}
                                  onClick={() => void printOrQueueOrder(order)}
                                />
                              </div>
                            </div>

                            <div className="staff-kitchen-meta">
                              <Badge variant="outline">{itemCount} item{itemCount === 1 ? '' : 's'}</Badge>
                              <OrderStatusBadge status={order.status} />
                              <PaymentStatusBadge status={order.paymentStatus} />
                              {counterPaymentNeeded ? <Badge variant="outline" className="staff-order-counter-badge">Counter due</Badge> : null}
                              {order.orderType !== 'DineIn' && order.pickupNumber ? <Badge className="staff-order-pickup-badge">Pickup {order.pickupCode || `#${order.pickupNumber}`}</Badge> : null}
                              {order.customerName ? <Badge variant="outline"><UserRound className="size-3" />{order.customerName}</Badge> : null}
                              {order.scheduledTime ? <Badge variant="outline"><CalendarClock className="size-3" />{formatDateTime(order.scheduledTime)}</Badge> : null}
                            </div>

                            {order.customerNote ? (
                              <div className={cn('staff-kitchen-note is-order-note', safetyNote && 'is-safety-note')}>
                                {safetyNote ? <ShieldAlert className="size-4 shrink-0" /> : null}
                                <div>
                                  <strong>{safetyNote ? 'Kitchen safety note' : 'Order note'}</strong>
                                  <span>{order.customerNote}</span>
                                </div>
                              </div>
                            ) : null}

                            <div className="staff-kitchen-items">
                              {order.items.map((item) => {
                                const optionGroups = groupSelectedOptions(item)
                                const itemName = item.itemNameSnapshot?.trim() || 'Unnamed item'

                                return (
                                  <div key={item.id} className="staff-kitchen-item">
                                    <div className="staff-kitchen-item-main">
                                      <span>{item.quantity}x</span>
                                      <strong>{itemName}</strong>
                                    </div>
                                    {optionGroups.length > 0 ? (
                                      <div className="staff-kitchen-options">
                                        {optionGroups.map((group) => (
                                          <div key={group.groupName}>
                                            <span>{group.groupName}</span>
                                            <p>{group.options.map((option) => `${option.optionNameSnapshot}${(option.quantity ?? 1) > 1 ? ` x${option.quantity ?? 1}` : ''}`).join(', ')}</p>
                                          </div>
                                        ))}
                                      </div>
                                    ) : null}
                                    {item.note ? (
                                      <div className={cn('staff-kitchen-note', isSafetyNoteText(item.note) && 'is-safety-note')}>
                                        {isSafetyNoteText(item.note) ? <ShieldAlert className="size-4 shrink-0" /> : null}
                                        <div>
                                        <strong>{isSafetyNoteText(item.note) ? 'Item safety note' : 'Item note'}</strong>
                                        <span>{item.note}</span>
                                        </div>
                                      </div>
                                    ) : null}
                                  </div>
                                )
                              })}
                            </div>

                            <div className="staff-kitchen-actions">
                              {order.paymentMethod === 'PayAtCounter' && order.paymentStatus !== 'Paid' ? (
                                <Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={() => void markCounterPayment(order)}>
                                  Mark paid
                                </Button>
                              ) : null}
                              {primaryAction ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  className="staff-order-primary-action"
                                  disabled={isBusy}
                                  onClick={() => beginTransition(order, primaryAction)}
                                >
                                  {isBusy ? 'Updating' : actionLabels[primaryAction]}
                                </Button>
                              ) : null}
                              {destructiveActions.map((action) => (
                                  <Button
                                    key={action}
                                    type="button"
                                    size="sm"
                                    variant="destructive"
                                    disabled={isBusy}
                                    onClick={() => beginTransition(order, action)}
                                  >
                                    {actionLabels[action]}
                                  </Button>
                                ))}
                              {!primaryAction && destructiveActions.length === 0 ? (
                                <span>No kitchen action available.</span>
                              ) : null}
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  )}
                </section>
              ))}
            </div>
          ) : (
            <div className="staff-orders-grid">
              {visibleOrders.map((order, index) => {
                const now = lastUpdated ?? new Date()
                const signal = getOrderSignal(order, now)
                const paymentHold = isStaffPaymentHold(order)
                const paymentMessage = getStaffPaymentMessage(order)
                const counterPaymentNeeded = needsCounterPayment(order)
                const isBusy = busyOrderId === order.id
                const primaryAction = getStaffPrimaryAction(order)
                const destructiveActions = getStaffDestructiveActions(order)
                const safetyNote = hasSafetyNote(order)

                return (
                  <motion.article
                    key={order.id}
                    aria-labelledby={`staff-order-${order.id}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, delay: Math.min(index * 0.025, 0.15) }}
                  >
                    <Card className={cn(
                      'staff-order-card',
                      `staff-order-card-${signal.tone}`,
                      signal.isLate && 'staff-order-card-late',
                    )}>
                      <CardHeader className="space-y-3 pb-3">
                        <div className="staff-order-signal-row">
                          <Badge
                            variant="outline"
                            className={cn('staff-order-signal-badge', `is-${signal.tone}`)}
                          >
                            {signal.label}
                          </Badge>
                          <div className="staff-order-card-tools">
                            <span className={cn('staff-order-wait-time', signal.isLate && 'is-late')}>
                              <Clock3 size={13} />
                              Waiting {formatElapsedTime(order, now)}
                            </span>
                            <PrintTicketButton
                              disabled={printingOrderId === order.id || paymentHold}
                              modeLabel={printerModeLabels[printerSettings.mode]}
                              onClick={() => void printOrQueueOrder(order)}
                            />
                          </div>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h2 id={`staff-order-${order.id}`} className="font-heading text-base font-medium">{order.orderNumber}</h2>
                            <CardDescription className="mt-1 flex items-center gap-1.5">
                              {order.orderType === 'DineIn' ? <Utensils size={14} /> : <ShoppingBag size={14} />}
                              {getOrderScope(order)}
                              <span>·</span>
                              <Clock3 size={14} />
                              {formatTime(order.createdAt)}
                            </CardDescription>
                          </div>
                          <strong>{formatMoney(order.totalAmount, order.currency)}</strong>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline" className="staff-order-type-badge">
                            {order.orderType === 'DineIn' ? <Utensils size={12} /> : <ShoppingBag size={12} />}
                            {getOrderTypeLabel(order.orderType)}
                          </Badge>
                          {order.tableNumber ? (
                            <Badge variant="secondary">Table {order.tableNumber}</Badge>
                          ) : null}
                          <OrderStatusBadge status={order.status} />
                          <PaymentStatusBadge status={order.paymentStatus} />
                          <Badge variant="secondary">{order.restaurantName ?? 'Assigned restaurant'}</Badge>
                          {counterPaymentNeeded ? (
                            <Badge variant="outline" className="staff-order-counter-badge">
                              Counter payment due
                            </Badge>
                          ) : null}
                          {order.orderType !== 'DineIn' && order.pickupNumber ? (
                            <Badge className="staff-order-pickup-badge">
                              Pickup {order.pickupCode || `#${order.pickupNumber}`}
                            </Badge>
                          ) : null}
                          {order.customerName ? (
                            <Badge variant="outline">
                              <UserRound className="size-3" />
                              {order.customerName}
                            </Badge>
                          ) : null}
                          {order.scheduledTime ? (
                            <Badge variant="outline">
                              <CalendarClock className="size-3" />
                              {formatDateTime(order.scheduledTime)}
                            </Badge>
                          ) : null}
                          <Badge variant="outline">
                            <CreditCard size={12} />
                            {order.paymentMethod === 'PayAtCounter' ? 'Counter' : 'Online'}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {order.customerNote ? (
                          <div className={cn('staff-order-priority-note', safetyNote && 'is-safety-note')}>
                            {safetyNote ? <ShieldAlert className="mt-0.5 size-4 shrink-0" /> : null}
                            <div>
                              <strong>{safetyNote ? 'Kitchen safety note' : 'Order note'}</strong>
                              <p>{order.customerNote}</p>
                            </div>
                          </div>
                        ) : null}

                        <div className="space-y-2">
                          {order.items.map((item) => {
                            const optionGroups = groupSelectedOptions(item)
                            const itemName = item.itemNameSnapshot?.trim() || 'Unnamed item'

                            return (
                              <div key={item.id} className="rounded-lg border bg-muted/20 p-3">
                                <div className="flex justify-between gap-3 text-sm">
                                  <span className="font-medium text-foreground">
                                    <strong>{item.quantity}x</strong> {itemName}
                                  </span>
                                  <span className="font-medium">{formatMoney(item.totalPrice, order.currency)}</span>
                                </div>

                                {optionGroups.length > 0 ? (
                                  <div className="mt-2 space-y-1.5 border-l pl-3">
                                    {optionGroups.map((group) => (
                                      <div key={group.groupName} className="flex flex-wrap items-center gap-1.5 text-xs">
                                        <span className="font-semibold text-muted-foreground">{group.groupName}</span>
                                        {group.options.map((option) => (
                                          <Badge key={option.id} variant="outline" className="h-auto rounded-md px-2 py-0.5 text-[11px] font-medium">
                                            {option.optionNameSnapshot}
                                            {(option.quantity ?? 1) > 1 ? ` ×${option.quantity ?? 1}` : ''}
                                            {option.priceAdjustmentSnapshot !== 0 ? (
                                              <span className="ml-1 text-muted-foreground">
                                                {formatOptionAdjustment(option.priceAdjustmentSnapshot * (option.quantity ?? 1), order.currency)}
                                              </span>
                                            ) : null}
                                          </Badge>
                                        ))}
                                      </div>
                                    ))}
                                  </div>
                                ) : null}

                                {item.note ? (
                                  <div className={cn(
                                    'staff-order-item-note',
                                    isSafetyNoteText(item.note) && 'is-safety-note',
                                  )}>
                                    {isSafetyNoteText(item.note) ? <ShieldAlert className="size-3.5 shrink-0" /> : null}
                                    <span><strong>{isSafetyNoteText(item.note) ? 'Item safety note: ' : 'Item note: '}</strong>{item.note}</span>
                                  </div>
                                ) : null}
                              </div>
                            )
                          })}
                        </div>

                        {paymentMessage ? (
                          <div className={cn(
                            'staff-order-payment-message',
                            getStaffPaymentState(order) === 'refunded' && 'is-refunded',
                          )}>
                            {getStaffPaymentState(order) === 'refunded'
                              ? <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                              : <AlertCircle className="mt-0.5 size-4 shrink-0" />}
                            <span className="text-sm">{paymentMessage}</span>
                          </div>
                        ) : null}

                        <div className="staff-order-action-row">
                          {order.paymentMethod === 'PayAtCounter' && order.paymentStatus !== 'Paid' ? (
                            <Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={() => void markCounterPayment(order)}>
                              Mark paid
                            </Button>
                          ) : null}
                          {primaryAction && !paymentHold ? (
                            <Button
                              type="button"
                              size="sm"
                              className="staff-order-primary-action"
                              disabled={isBusy}
                              onClick={() => beginTransition(order, primaryAction)}
                            >
                              {isBusy ? 'Updating' : actionLabels[primaryAction]}
                            </Button>
                          ) : null}
                          {destructiveActions.map((action) => (
                            <Button
                              key={action}
                              type="button"
                              size="sm"
                              variant="destructive"
                              disabled={isBusy}
                              onClick={() => beginTransition(order, action)}
                            >
                              {actionLabels[action]}
                            </Button>
                          ))}
                          {!primaryAction && destructiveActions.length === 0 && !counterPaymentNeeded ? (
                            <span className="text-sm text-muted-foreground">No action available.</span>
                          ) : null}
                        </div>
                      </CardContent>
                    </Card>
                  </motion.article>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {printTicket ? (
        <OrderPrintTicket
          order={printTicket.order}
          paperWidth={printerSettings.paperWidth}
          printedAt={new Date(printTicket.requestedAt)}
        />
      ) : null}

      <Dialog open={pendingTransition !== null} onOpenChange={(open) => {
        if (!open && busyOrderId === null) {
          setPendingTransition(null)
          setReason('')
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pendingTransition ? actionLabels[pendingTransition.action] : 'Update order'}</DialogTitle>
            <DialogDescription>
              {pendingTransition ? `${pendingTransition.order.orderNumber}: explain this status change.` : 'Explain this status change.'}
            </DialogDescription>
          </DialogHeader>
          {pendingTransition ? (
            <OrderTransitionReasonField
              key={`${pendingTransition.order.id}-${pendingTransition.action}`}
              action={pendingTransition.action}
              value={reason}
              onChange={setReason}
            />
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busyOrderId !== null} onClick={() => setPendingTransition(null)}>
              Keep current status
            </Button>
            <Button
              type="button"
              variant={pendingTransition?.action === 'Reject' || pendingTransition?.action === 'Cancel' ? 'destructive' : 'default'}
              disabled={!reason.trim() || busyOrderId !== null || pendingTransition === null}
              onClick={() => {
                if (pendingTransition) void submitTransition(pendingTransition.order, pendingTransition.action, reason.trim())
              }}
            >
              {busyOrderId ? 'Updating' : 'Confirm change'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}

function ConnectionTestBadge({ status }: { status: ConnectionTestStatus }) {
  if (status === 'testing') {
    return (
      <Badge role="status" aria-live="polite" variant="outline" className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
        <RefreshCw className="animate-spin" />
        Testing…
      </Badge>
    )
  }

  if (status === 'succeeded') {
    return (
      <Badge role="status" aria-live="polite" variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
        <CheckCircle2 />
        Passed
      </Badge>
    )
  }

  if (status === 'failed') {
    return (
      <Badge role="status" aria-live="polite" variant="destructive">
        <AlertCircle />
        Failed
      </Badge>
    )
  }

  return (
    <Badge role="status" aria-live="polite" variant="secondary">
      <CircleHelp />
      Not tested
    </Badge>
  )
}

const qzSettingsProbeTimeoutMs = 10_000

async function withSettingsTimeout<T>(operation: Promise<T>, message: string): Promise<T> {
  let timeoutId: number | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error(message)), qzSettingsProbeTimeoutMs)
      }),
    ])
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId)
  }
}

export function PrinterSettingsDialog({
  open,
  kitchenSettings,
  frontCounterSettings,
  printJobs,
  printJobsLoading,
  onOpenChange,
  onKitchenSettingsChange,
  onFrontCounterSettingsChange,
  onRefreshPrintJobs,
  onRetryPrintJob,
  onPrintTestTicket,
  showPrintRestaurantSelector = false,
  printRestaurants = [],
  activePrintRestaurantId,
  onPrintRestaurantChange,
}: {
  open: boolean
  kitchenSettings: ThermalPrinterSettings
  frontCounterSettings: ThermalPrinterSettings
  printJobs: PrintJobList
  printJobsLoading: boolean
  onOpenChange: (open: boolean) => void
  onKitchenSettingsChange: (updates: Partial<ThermalPrinterSettings>) => void
  onFrontCounterSettingsChange: (updates: Partial<ThermalPrinterSettings>) => void
  onRefreshPrintJobs: () => void
  onRetryPrintJob: (jobId: string) => void
  onPrintTestTicket: (target: 'kitchen' | 'front-counter') => void
  showPrintRestaurantSelector?: boolean
  printRestaurants?: Restaurant[]
  activePrintRestaurantId?: string
  onPrintRestaurantChange?: (restaurantId: string) => void
}) {
  const [printerArea, setPrinterArea] = useState<'kitchen' | 'front-counter'>('kitchen')
  const settings = printerArea === 'kitchen' ? kitchenSettings : frontCounterSettings
  const onSettingsChange = printerArea === 'kitchen'
    ? onKitchenSettingsChange
    : onFrontCounterSettingsChange
  const [qzStatus, setQzStatus] = useState<QzTrayConnectionStatus | 'checking' | 'unknown'>('unknown')
  const [qzVersion, setQzVersion] = useState<string | null>(null)
  const [qzPrinters, setQzPrinters] = useState<QzTrayPrinterDescriptor[]>([])
  const [qzSerialPorts, setQzSerialPorts] = useState<string[]>([])
  const [qzPrintersLoading, setQzPrintersLoading] = useState(false)
  const [qzHostSubnet, setQzHostSubnet] = useState<string | null>(null)
  const qzDiscoveryGenerationRef = useRef(0)
  const [qzPrinterTestStatus, setQzPrinterTestStatus] = useState<ConnectionTestStatus>('untested')
  const [qzNetworkTestStatus, setQzNetworkTestStatus] = useState<ConnectionTestStatus>('untested')
  const [qzSerialTestStatus, setQzSerialTestStatus] = useState<ConnectionTestStatus>('untested')
  const [webSerialTestStatus, setWebSerialTestStatus] = useState<ConnectionTestStatus>('untested')
  const [webUsbTestStatus, setWebUsbTestStatus] = useState<ConnectionTestStatus>('untested')
  const netTesting = qzNetworkTestStatus === 'testing'
  const qzSerialTesting = qzSerialTestStatus === 'testing'
  const serialTesting = webSerialTestStatus === 'testing'
  const usbTesting = webUsbTestStatus === 'testing'
  const qzPrinterOptions = useMemo(() => {
    const selectedName = settings.qzPrinterName.trim()
    if (!selectedName || qzPrinters.some((printer) => printer.name === selectedName)) {
      return qzPrinters
    }

    return [
      {
        name: selectedName,
        driverName: null,
        portName: null,
        connectionKind: null,
        connectionLabel: null,
        isVirtual: false,
        isDefault: false,
        sharedPortQueueCount: 1,
      } satisfies QzTrayPrinterDescriptor,
      ...qzPrinters,
    ]
  }, [qzPrinters, settings.qzPrinterName])
  const selectedQzPrinter = qzPrinterOptions.find((printer) => printer.name === settings.qzPrinterName) ?? null
  const backgroundBrowser = useMemo(
    () => getBackgroundBrowserGuidance(window.navigator.userAgent),
    [],
  )

  const showBackgroundBrowserGuidance = useCallback(async () => {
    const origin = window.location.origin

    if (!backgroundBrowser.supportsSiteException || !backgroundBrowser.settingsPath) {
      const description = backgroundBrowser.kind === 'firefox'
        ? 'Firefox may unload inactive tabs when memory is low. Use about:unloads to inspect unloaded tabs; for an unattended printing station, Edge or Chrome with a site exception is the safer setup.'
        : 'For unattended printing, use a dedicated Edge or Chrome window and add this site to “Always keep these sites active”.'

      recordPrinterDiagnostic('background_browser_guidance_used', {
        browser: backgroundBrowser.kind,
        action: 'advice',
      })
      toast.info(`${backgroundBrowser.browserLabel} background printing`, { description })
      return
    }

    let copied: boolean
    try {
      await window.navigator.clipboard.writeText(origin)
      copied = true
    } catch {
      const textArea = document.createElement('textarea')
      textArea.value = origin
      textArea.setAttribute('readonly', '')
      textArea.style.position = 'fixed'
      textArea.style.opacity = '0'
      document.body.appendChild(textArea)
      textArea.select()
      copied = document.execCommand('copy')
      textArea.remove()
    }

    recordPrinterDiagnostic('background_browser_guidance_used', {
      browser: backgroundBrowser.kind,
      action: 'copy_site',
      copied,
    })

    if (copied) {
      toast.success('Printing site copied', {
        description: `Open ${backgroundBrowser.settingsPath}, choose Add, then paste ${origin}.`,
      })
    } else {
      toast.error('Could not copy the site address', {
        description: `Copy ${origin}, then add it under ${backgroundBrowser.settingsPath}.`,
      })
    }
  }, [backgroundBrowser])

  // Verify a network printer answers on IP:port before saving — a raw socket
  // probe through QZ, no need to print a real ticket to find out.
  const testNetworkPrinter = useCallback(async () => {
    const host = settings.qzNetworkHost.trim()
    if (!host) {
      toast.error('Enter the printer IP first')
      return
    }
    setQzNetworkTestStatus('testing')
    try {
      const port = settings.qzNetworkPort || defaultThermalPrinterSettings.qzNetworkPort
      const reachable = await probeQzNetworkPrinter(host, port)
      if (reachable) {
        setQzNetworkTestStatus('succeeded')
        toast.success('Printer reachable', { description: `${host}:${port} accepted a connection.` })
      } else {
        setQzNetworkTestStatus('failed')
        toast.error('No response', {
          description: `${host}:${port} did not answer. Check the IP, that the printer is on the network, and that RAW/9100 is enabled.`,
        })
      }
    } catch (error) {
      setQzNetworkTestStatus('failed')
      toast.error('Could not test the printer', {
        description: error instanceof Error ? error.message : 'The connection test failed.',
      })
    }
  }, [settings.qzNetworkHost, settings.qzNetworkPort])

  // Track the latest printer name without making the discovery callback depend on
  // it (which would refetch the printer list on every keystroke).
  const qzPrinterNameRef = useRef(settings.qzPrinterName)
  useEffect(() => {
    qzPrinterNameRef.current = settings.qzPrinterName
  }, [settings.qzPrinterName])

  // Discover the printers QZ Tray can see and preselect the OS default when the
  // user has not chosen one yet. Safe to call only when connected (or from an
  // explicit user action, since connecting may show the QZ allow-prompt).
  const loadQzPrinters = useCallback(async () => {
    const generation = ++qzDiscoveryGenerationRef.current
    setQzPrintersLoading(true)
    setQzStatus('checking')
    try {
      const [printers, serialPorts, hostNetwork] = await withSettingsTimeout(
        Promise.all([
          listQzTrayPrinterDescriptors(),
          listQzSerialPorts().catch(() => [] as string[]),
          getQzHostNetwork().catch(() => null),
        ]),
        'QZ Tray did not respond within 10 seconds.',
      )
      if (generation !== qzDiscoveryGenerationRef.current) return

      setQzPrinters(printers)
      setQzSerialPorts(serialPorts)
      setQzHostSubnet(hostNetwork?.subnetPrefix ?? null)
      setQzStatus('connected')
      void getQzRuntimeInfo().then((runtime) => setQzVersion(runtime.version))

      if (!qzPrinterNameRef.current.trim() && printers.length > 0) {
        const defaultPrinter = await getQzTrayDefaultPrinter()
        onSettingsChange({
          qzPrinterName:
            defaultPrinter && printers.some((printer) => printer.name === defaultPrinter)
              ? defaultPrinter
              : printers[0].name,
        })
      }
    } catch (error) {
      if (generation !== qzDiscoveryGenerationRef.current) return

      setQzStatus(error instanceof QzTrayError && error.reason === 'not-loaded' ? 'unavailable' : 'disconnected')
      setQzPrinters([])
      setQzSerialPorts([])
      setQzHostSubnet(null)
      setQzVersion(null)
      recordPrinterDiagnostic('qz_settings_discovery_failed', {
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      if (generation === qzDiscoveryGenerationRef.current) {
        setQzPrintersLoading(false)
      }
    }
  }, [onSettingsChange])

  // On open, show whether a connection is already active (cheap, no prompt) and
  // refresh the printer list for the dropdown. If this browser has connected
  // before (e.g. the websocket dropped on a page reload), auto-reconnect instead
  // of requiring a manual Test connection — silent when QZ has remembered the site.
  useEffect(() => {
    if (!open) return
    let cancelled = false

    const unsubscribe = subscribeQzTrayConnectionStatus((status) => {
      if (cancelled) return
      setQzStatus(status)
      if (status !== 'connected') {
        setQzVersion(null)
        qzDiscoveryGenerationRef.current += 1
        setQzPrintersLoading(false)
      }
    })

    void Promise.resolve().then(() => {
      if (cancelled) return
      if (isQzTrayConnected() || hasQzTrayConnectedBefore()) {
        void loadQzPrinters()
      } else {
        setQzStatus('unknown')
      }
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [open, loadQzPrinters])

  // Explicit user-triggered probe: may open a connection (and show the QZ Tray
  // allow-prompt on unsigned setups), so it never runs automatically.
  const testQzConnection = useCallback(async () => {
    setQzStatus('checking')
    let status: QzTrayConnectionStatus
    try {
      status = await withSettingsTimeout(
        probeQzTrayStatus(),
        'QZ Tray did not respond within 10 seconds.',
      )
    } catch (error) {
      status = 'disconnected'
      recordPrinterDiagnostic('qz_settings_probe_timed_out', {
        message: error instanceof Error ? error.message : String(error),
      })
    }
    setQzStatus(status)
    if (status === 'connected') {
      await loadQzPrinters()
    }
  }, [loadQzPrinters])

  const [usbDetecting, setUsbDetecting] = useState(false)
  const [usbDeviceLabel, setUsbDeviceLabel] = useState<string | null>(null)
  const [serialSelecting, setSerialSelecting] = useState(false)
  const [serialPortLabel, setSerialPortLabel] = useState<string | null>(null)
  const [trustBusy, setTrustBusy] = useState(false)
  const [clearingQueue, setClearingQueue] = useState(false)
  const [bleSelecting, setBleSelecting] = useState(false)

  const resetQzTargetTests = useCallback(() => {
    setQzPrinterTestStatus('untested')
    setQzNetworkTestStatus('untested')
    setQzSerialTestStatus('untested')
  }, [])

  const resetAllConnectionTests = useCallback(() => {
    resetQzTargetTests()
    setWebSerialTestStatus('untested')
    setWebUsbTestStatus('untested')
  }, [resetQzTargetTests])

  const testSelectedQzPrinter = useCallback(async () => {
    const printerName = settings.qzPrinterName.trim()
    if (!printerName) {
      toast.error('Choose a system printer first')
      return
    }

    setQzPrinterTestStatus('testing')
    try {
      const printers = await listQzTrayPrinterDescriptors()
      const printer = printers.find((candidate) => candidate.name === printerName)
      if (!printer) {
        throw new QzTrayError('no-printer', `${printerName} is no longer available in Windows.`)
      }

      setQzPrinters(printers)
      const health = await checkQzPrinterHealth(printerName)
      if (!health.ok) {
        throw new QzTrayError(
          'printer-unavailable',
          `${printerName} reported ${health.status.replaceAll('_', ' ').toLowerCase()}.`,
        )
      }

      setQzPrinterTestStatus('succeeded')
      toast.success('System printer test completed', {
        description: health.status === 'UNKNOWN'
          ? `${printerName} is available to QZ and Windows. Its driver did not expose physical device status, so only a real test ticket can fully verify the USB cable and printer.`
          : `${printerName} is available and reported ${health.status.replaceAll('_', ' ').toLowerCase()}.`,
      })
    } catch (error) {
      setQzPrinterTestStatus('failed')
      toast.error('System printer test failed', {
        description: error instanceof Error ? error.message : 'The selected Windows printer could not be verified.',
      })
    }
  }, [settings.qzPrinterName])

  // BLE picker (user gesture) → connect + discover the writable characteristic.
  // The GATT connection then stays open between prints.
  const selectBlePrinter = useCallback(async () => {
    setBleSelecting(true)
    try {
      const name = await selectWebBluetoothPrinter()
      onSettingsChange({ bleDeviceName: name })
      toast.success('Bluetooth printer connected', {
        description: `${name} — the connection stays open between prints.`,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        return // User closed the chooser without picking.
      }
      toast.error('Could not connect Bluetooth printer', {
        description: error instanceof Error ? error.message : 'The device request failed.',
      })
    } finally {
      setBleSelecting(false)
    }
  }, [onSettingsChange])

  const testSelectedQzSerialPort = useCallback(async () => {
    const portName = settings.qzSerialPort.trim()
    if (!portName) {
      toast.error('Choose a COM port first')
      return
    }

    setQzSerialTestStatus('testing')
    try {
      await testQzSerialConnection(portName, settings.serialBaudRate)
      setQzSerialTestStatus('succeeded')
      toast.success('Bluetooth COM connection verified', {
        description: `${portName} opened through QZ and accepted a non-printing status request. The connection will stay open.`,
      })
    } catch (error) {
      setQzSerialTestStatus('failed')
      toast.error('Could not open the Bluetooth COM port', {
        description: error instanceof Error ? error.message : 'The QZ serial connection test failed.',
      })
    }
  }, [settings.qzSerialPort, settings.serialBaudRate])

  const testSelectedWebSerialPort = useCallback(async () => {
    setWebSerialTestStatus('testing')
    try {
      const { label } = await testWebSerialConnection(settings.serialBaudRate)
      setSerialPortLabel(label)
      setWebSerialTestStatus('succeeded')
      toast.success('Serial connection verified', {
        description: `${label} opened and accepted a non-printing status request. The connection will stay open.`,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        setWebSerialTestStatus('untested')
        return
      }
      setWebSerialTestStatus('failed')
      toast.error('Could not test the serial connection', {
        description: error instanceof Error ? error.message : 'The Web Serial connection test failed.',
      })
    }
  }, [settings.serialBaudRate])

  const testSelectedWebUsbPrinter = useCallback(async () => {
    setWebUsbTestStatus('testing')
    try {
      const result = await testWebUsbConnection(settings)
      setUsbDeviceLabel(result.label)
      if (
        result.interfaceNumber !== settings.usbInterfaceNumber
        || result.endpointNumber !== settings.usbEndpointNumber
      ) {
        onSettingsChange({
          usbInterfaceNumber: result.interfaceNumber,
          usbEndpointNumber: result.endpointNumber,
        })
      }
      setWebUsbTestStatus('succeeded')
      toast.success('USB connection verified', {
        description: `${result.label} accepted a non-printing status request on interface ${result.interfaceNumber}, endpoint ${result.endpointNumber}.`,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        setWebUsbTestStatus('untested')
        return
      }
      setWebUsbTestStatus('failed')
      toast.error('Could not test the USB connection', {
        description: error instanceof Error ? error.message : 'The WebUSB connection test failed.',
      })
    }
  }, [onSettingsChange, settings])

  // Recovery tool for the classic spooler pile-up: cancel jobs that queued while
  // the printer was down, so bringing it back does not burst out stale tickets.
  // `allPrinters` clears every OS queue (used from Browser mode, where the page
  // has no idea which printer the OS sent jobs to and cannot touch the spooler
  // itself); otherwise just the selected QZ printer. Both go through QZ Tray, so
  // when QZ is not installed we fall back to Windows manual instructions.
  const clearQueue = useCallback(async (allPrinters = false) => {
    setClearingQueue(true)
    try {
      await clearQzPrinterQueue(allPrinters ? undefined : qzPrinterNameRef.current)
      toast.success('Print queue cleared', {
        description: 'Stale queued tickets were cancelled. Safe to bring the printer back now.',
      })
    } catch (error) {
      const qzMissing = error instanceof QzTrayError && (error.reason === 'not-running' || error.reason === 'not-loaded')
      toast.error('Could not clear the print queue', {
        description: qzMissing
          ? 'No web API can clear browser-print jobs directly. Clear them in Windows: Settings → Bluetooth & devices → Printers → your printer → Open print queue → Cancel all. (Installing QZ Tray adds a one-click Clear queue here.)'
          : error instanceof Error
            ? error.message
            : 'The clear request failed.',
      })
    } finally {
      setClearingQueue(false)
    }
  }, [])

  // One-time serial port grant (browser picker), immediately probed with an
  // ESC/POS status query so the user learns right away whether a printer
  // actually answers on the picked port (Bluetooth pairs create an outgoing
  // AND an incoming COM port — only the outgoing one reaches the printer).
  const selectSerialPort = useCallback(async () => {
    setSerialSelecting(true)
    try {
      // Probe disabled while we isolate a Bluetooth-module wedge: selection only
      // grants + remembers the port, exactly like the pre-probe behaviour.
      const { label, probe } = await selectWebSerialPort(settings.serialBaudRate, { probe: false })

      if (probe === 'skipped') {
        setSerialPortLabel(label)
        setWebSerialTestStatus('untested')
        toast.success('Serial port selected', { description: `${label} — later prints reuse it without asking.` })
        return
      }

      if (probe === 'open-failed') {
        setSerialPortLabel(null)
        // Chrome's direct-Bluetooth entries (device name, no COM number) are the
        // primary path on macOS/Android/ChromeOS but often lose to the OS-owned
        // COM ports on Windows — so the guidance differs per platform.
        const isWindows = navigator.userAgent.includes('Windows')
        toast.error('Could not open that port', {
          description: isWindows
            ? 'On Windows, prefer the entry with a COM number (the Bluetooth "outgoing" port, usually named like "Serial Port…"). The device-name entry sometimes works — retrying is fine — but the COM port is the reliable one.'
            : 'Make sure the printer is powered on, paired and in range, then try again — direct Bluetooth connections can fail transiently.',
        })
        return
      }

      setSerialPortLabel(label)

      if (probe === 'responded') {
        toast.success('Printer verified on this port', {
          description: `${label} answered the status query — prints will reuse it silently.`,
        })
      } else {
        toast.warning('Port opened, but no printer replied', {
          description: 'This may be the Bluetooth "incoming" port — if printing produces nothing, re-select and pick the other COM. (Some printers simply ignore status queries.)',
        })
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        return // User closed the picker without choosing.
      }
      toast.error('Could not select serial port', {
        description: error instanceof Error ? error.message : 'The port request failed.',
      })
    } finally {
      setSerialSelecting(false)
    }
  }, [settings.serialBaudRate])
  const qzTrustSupported = canManageQzTrustCertificate()

  // Quick trust setup: user picks the QZ Tray install folder in the system picker
  // and we write override.crt there — the one file that makes QZ stop prompting.
  const installTrust = useCallback(async () => {
    setTrustBusy(true)
    try {
      const folder = await installQzTrustCertificate()
      toast.success('Trust certificate installed', {
        description: `override.crt written to "${folder}". Restart QZ Tray (tray icon → exit, reopen) to apply.`,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return // User closed the folder picker.
      }
      toast.error('Could not install trust certificate', {
        description: error instanceof Error ? error.message : 'Writing override.crt failed.',
      })
    } finally {
      setTrustBusy(false)
    }
  }, [])

  const removeTrust = useCallback(async () => {
    setTrustBusy(true)
    try {
      const folder = await removeQzTrustCertificate()
      toast.success('Trust certificate removed', {
        description: `override.crt deleted from "${folder}". Restart QZ Tray to apply.`,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        toast.info('Nothing to remove', { description: 'No override.crt was found in that folder.' })
        return
      }
      toast.error('Could not remove trust certificate', {
        description: error instanceof Error ? error.message : 'Deleting override.crt failed.',
      })
    } finally {
      setTrustBusy(false)
    }
  }, [])

  const downloadTrustCert = useCallback(async () => {
    try {
      await downloadQzTrustCertificate()
    } catch (error) {
      toast.error('Could not download certificate', {
        description: error instanceof Error ? error.message : 'The certificate request failed.',
      })
    }
  }, [])

  // Browser-native USB picker (user gesture) → auto-fill vendor/product IDs and
  // the detected bulk-OUT interface/endpoint, instead of hand-typed hex values.
  const selectUsbPrinter = useCallback(async () => {
    setUsbDetecting(true)
    try {
      const detected = await detectWebUsbPrinter()
      onSettingsChange({
        usbVendorId: detected.vendorId,
        usbProductId: detected.productId,
        usbInterfaceNumber: detected.interfaceNumber,
        usbEndpointNumber: detected.endpointNumber,
      })
      setUsbDeviceLabel(detected.label)
      setWebUsbTestStatus('untested')
      toast.success('USB printer selected', { description: detected.label })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        return // User closed the picker without choosing — not an error.
      }
      toast.error('Could not select USB printer', {
        description: error instanceof Error ? error.message : 'The device request failed.',
      })
    } finally {
      setUsbDetecting(false)
    }
  }, [onSettingsChange])

  const qzConnected = qzStatus === 'connected'
  const qzStatusLabel =
    qzStatus === 'connected'
      ? 'QZ Tray connected'
      : qzStatus === 'checking'
        ? 'Checking QZ Tray…'
        : qzStatus === 'unavailable'
          ? 'QZ Tray helper unavailable'
          : 'QZ Tray not detected'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="staff-printer-dialog">
        <DialogHeader>
          <DialogTitle>Printer settings</DialogTitle>
          <DialogDescription>
            Configure separate printers for kitchen tickets and front counter receipts.
          </DialogDescription>
        </DialogHeader>

        <div className="staff-printer-settings">
          <Tabs
            value={printerArea}
            onValueChange={(value) => {
              resetAllConnectionTests()
              setPrinterArea(value as 'kitchen' | 'front-counter')
            }}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="kitchen">Kitchen</TabsTrigger>
              <TabsTrigger value="front-counter">Front counter</TabsTrigger>
            </TabsList>
          </Tabs>

          {showPrintRestaurantSelector && printerArea === 'kitchen' ? (
            <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
              <div className="staff-printer-field">
                <span>Print restaurant</span>
                <Select
                  value={activePrintRestaurantId}
                  onValueChange={(restaurantId) => onPrintRestaurantChange?.(restaurantId)}
                >
                  <SelectTrigger aria-label="Restaurant used for automatic printing">
                    <SelectValue placeholder="Select a restaurant" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {printRestaurants.map((restaurant) => (
                      <SelectItem key={restaurant.id} value={restaurant.id}>
                        {restaurant.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {!activePrintRestaurantId ? (
                <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  Select the restaurant served by this printer before enabling automatic printing.
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="staff-printer-grid">
            <div className="staff-printer-field">
              <span>Route</span>
              <Select
                value={settings.mode}
                onValueChange={(value) => {
                  resetAllConnectionTests()
                  onSettingsChange({ mode: value as ThermalPrinterMode })
                }}
              >
                <SelectTrigger aria-label={`${printerArea === 'kitchen' ? 'Kitchen' : 'Front counter'} printer route`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="browser">Browser print</SelectItem>
                  <SelectItem value="qz-tray">QZ Tray</SelectItem>
                  <SelectItem value="web-serial">Web Serial</SelectItem>
                  <SelectItem value="web-usb">WebUSB</SelectItem>
                  <SelectItem value="web-bluetooth">Web Bluetooth (BLE)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="staff-printer-field">
              <span>Paper</span>
              <Select
                value={settings.paperWidth}
                onValueChange={(value) => onSettingsChange({ paperWidth: value as ThermalPaperWidth })}
              >
                <SelectTrigger aria-label="Thermal paper width">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="80mm">80mm</SelectItem>
                  <SelectItem value="58mm">58mm</SelectItem>
                </SelectContent>
              </Select>
            </div>

          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="staff-printer-switch">
              <span>Cut paper</span>
              <Switch
                checked={settings.cutPaper}
                onCheckedChange={(checked) => onSettingsChange({ cutPaper: checked })}
              />
            </label>

            <label className="staff-printer-switch">
              <span>Beep on print</span>
              <Switch
                checked={settings.beepOnPrint}
                onCheckedChange={(checked) => onSettingsChange({ beepOnPrint: checked })}
              />
            </label>
          </div>

          {settings.mode === 'browser' ? (
            <section className="staff-printer-route-card active">
              <header>
                <strong>Browser print</strong>
              </header>
              <p className="text-[0.7rem] leading-snug text-muted-foreground">
                Prints through the system print dialog — works with any installed printer, but shows a dialog for
                every ticket. Pick another route for silent printing.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => void clearQueue(true)}
                disabled={clearingQueue}
              >
                <Trash2 size={14} className={cn(clearingQueue && 'animate-pulse')} />
                Clear print queue
              </Button>
              <p className="text-[0.7rem] leading-snug text-muted-foreground">
                Cancels stale jobs stuck in every printer's Windows queue (needs QZ Tray installed). Use it before
                bringing a recovered printer back so it does not spew a backlog.
              </p>
            </section>
          ) : null}

          {settings.mode === 'qz-tray' ? (
            <section className="staff-printer-route-card active">
              <header>
                <div className="flex min-w-0 items-center gap-2.5">
                  <strong>QZ Tray</strong>
                  {printerArea === 'kitchen' ? (
                    <label className="flex cursor-pointer items-center gap-1.5 text-[0.68rem] font-medium text-muted-foreground">
                      <span>Auto-print</span>
                      <Switch
                        size="sm"
                        aria-label="Auto-print new orders"
                        checked={settings.autoPrintNewOrders}
                        disabled={showPrintRestaurantSelector && !activePrintRestaurantId}
                        onCheckedChange={(checked) => onSettingsChange({ autoPrintNewOrders: checked })}
                      />
                    </label>
                  ) : null}
                </div>
                <span className="flex items-center gap-2 text-xs">
                  <span
                    className={cn(
                      'inline-block size-2 shrink-0 rounded-full',
                      qzConnected ? 'bg-emerald-500' : qzStatus === 'checking' ? 'bg-amber-500' : 'bg-muted-foreground/40',
                    )}
                  />
                  <span className="text-muted-foreground">
                    {qzStatusLabel}{qzVersion ? ` · v${qzVersion}` : ''}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={qzConnected ? 'Refresh printers' : 'Test connection'}
                    title={qzConnected ? 'Refresh printers' : 'Test connection'}
                    onClick={() => void testQzConnection()}
                    disabled={qzStatus === 'checking' || qzPrintersLoading}
                  >
                    <RefreshCw size={14} className={cn((qzStatus === 'checking' || qzPrintersLoading) && 'animate-spin')} />
                  </Button>
                </span>
              </header>

              {!qzConnected ? (
                <div className="flex flex-col gap-2">
                  <Button asChild type="button" variant="outline" size="sm" className="self-start">
                    <a href={QZ_TRAY_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">
                      <Download size={14} />
                      Download QZ Tray
                    </a>
                  </Button>
                  <p className="text-[0.7rem] leading-snug text-muted-foreground">
                    QZ Tray is a small desktop app for silent printing. Install and launch it, then use the refresh
                    button above to connect. If QZ is running but remains unavailable in Edge/Chrome, open this
                    site's permissions and allow <strong>Local network access</strong>, then reload.
                  </p>
                </div>
              ) : null}

              <div
                className={cn(
                  'grid grid-cols-1 gap-3',
                  settings.qzTargetType === 'printer' && 'lg:grid-cols-2 lg:items-start',
                )}
              >
                <div className="staff-printer-field">
                  <span>Connection</span>
                  <Select
                    value={settings.qzTargetType}
                    onValueChange={(value) => {
                      resetQzTargetTests()
                      onSettingsChange({ qzTargetType: value as QzTargetType })
                    }}
                  >
                    <SelectTrigger aria-label="QZ connection type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectItem value="printer">System printer</SelectItem>
                      <SelectItem value="network">Network (IP:9100)</SelectItem>
                      <SelectItem value="serial">Serial / Bluetooth COM</SelectItem>
                    </SelectContent>
                  </Select>
                  {settings.qzTargetType === 'printer' ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void testSelectedQzPrinter()}
                        disabled={qzPrinterTestStatus === 'testing' || !settings.qzPrinterName.trim()}
                      >
                        {qzPrinterTestStatus === 'testing'
                          ? <RefreshCw size={14} className="animate-spin" />
                          : <Cable size={14} />}
                        Test connection
                      </Button>
                      <ConnectionTestBadge status={qzPrinterTestStatus} />
                    </div>
                  ) : null}
                </div>

                {settings.qzTargetType === 'printer' ? (
                  <div className="staff-printer-field lg:justify-items-end">
                    <span>Printer name</span>
                    {qzPrinterOptions.length > 0 ? (
                      <Select
                        value={settings.qzPrinterName || undefined}
                        onValueChange={(value) => {
                          setQzPrinterTestStatus('untested')
                          onSettingsChange({ qzPrinterName: value })
                        }}
                      >
                        <SelectTrigger aria-label="QZ Tray printer">
                          <SelectValue placeholder="Choose a printer">
                            {selectedQzPrinter ? (
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="truncate">{selectedQzPrinter.name}</span>
                                {selectedQzPrinter.connectionLabel ? (
                                  <span className="shrink-0 text-xs text-muted-foreground">
                                    {selectedQzPrinter.connectionLabel}
                                  </span>
                                ) : null}
                              </span>
                            ) : null}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent position="popper">
                          {qzPrinterOptions.map((printer) => {
                            const connectionLabel = formatQzPrinterConnectionLabel(printer)
                            return (
                              <SelectItem
                                key={printer.name}
                                value={printer.name}
                                className="py-2"
                                title={[printer.driverName, printer.portName].filter(Boolean).join(' · ') || undefined}
                              >
                                <span className="flex min-w-0 flex-col pr-2 text-left">
                                  <span className="truncate">{printer.name}</span>
                                  {connectionLabel ? (
                                    <span
                                      className={cn(
                                        'truncate text-xs text-muted-foreground',
                                        printer.isVirtual && 'text-amber-700 dark:text-amber-400',
                                      )}
                                    >
                                      {connectionLabel}
                                    </span>
                                  ) : null}
                                </span>
                              </SelectItem>
                            )
                          })}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={settings.qzPrinterName}
                        placeholder={qzPrintersLoading ? 'Detecting printers…' : 'Epson TM-T88VI'}
                        onChange={(event) => {
                          setQzPrinterTestStatus('untested')
                          onSettingsChange({ qzPrinterName: event.target.value })
                        }}
                      />
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="justify-self-start lg:justify-self-end"
                      onClick={() => void clearQueue()}
                      disabled={clearingQueue}
                    >
                      <Trash2 size={14} className={cn(clearingQueue && 'animate-pulse')} />
                      Clear queue
                    </Button>
                  </div>
                ) : null}
              </div>

              {settings.qzTargetType === 'printer' ? (
                <p className="text-[0.7rem] leading-snug text-muted-foreground">
                  Prints via the OS print queue. If jobs piled up while the printer was down, Clear queue cancels
                  them before you bring it back.
                </p>
              ) : null}

              {settings.qzTargetType === 'network' ? (
                <>
                  <div className="staff-printer-usb-grid">
                    <div className="staff-printer-field">
                      <span>Printer IP</span>
                      <Input
                        value={settings.qzNetworkHost}
                        placeholder={qzHostSubnet ? `${qzHostSubnet}50` : '192.168.1.50'}
                        onChange={(event) => {
                          setQzNetworkTestStatus('untested')
                          onSettingsChange({ qzNetworkHost: event.target.value })
                        }}
                      />
                    </div>
                    <div className="staff-printer-field">
                      <span>Port</span>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        value={settings.qzNetworkPort}
                        onChange={(event) => {
                          setQzNetworkTestStatus('untested')
                          onSettingsChange({ qzNetworkPort: Number(event.target.value) })
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void testNetworkPrinter()}
                      disabled={netTesting || !settings.qzNetworkHost.trim()}
                    >
                      {netTesting ? <RefreshCw size={14} className="animate-spin" /> : <Cable size={14} />}
                      Test connection
                    </Button>
                    <ConnectionTestBadge status={qzNetworkTestStatus} />
                    {qzHostSubnet ? (
                      <button
                        type="button"
                        className="text-[0.7rem] text-muted-foreground underline-offset-2 hover:underline"
                        onClick={() => {
                          if (!settings.qzNetworkHost.trim()) onSettingsChange({ qzNetworkHost: qzHostSubnet })
                        }}
                      >
                        Detected network: {qzHostSubnet}x
                      </button>
                    ) : null}
                  </div>
                  <p className="text-[0.7rem] leading-snug text-muted-foreground">
                    RAW network printing straight to the printer — no Windows driver needed. Give the printer a fixed
                    IP on the router first, then Test connection to confirm it answers on port {settings.qzNetworkPort || 9100}.
                  </p>
                </>
              ) : null}

              {settings.qzTargetType === 'serial' ? (
                <>
                  <div className="staff-printer-field">
                    <span>COM port</span>
                    <div className="flex flex-wrap items-center gap-2">
                      {qzSerialPorts.length > 0 ? (
                        <Select
                          value={settings.qzSerialPort || undefined}
                          onValueChange={(value) => {
                            setQzSerialTestStatus('untested')
                            onSettingsChange({ qzSerialPort: value })
                          }}
                        >
                          <SelectTrigger aria-label="QZ serial port">
                            <SelectValue placeholder="Choose a COM port" />
                          </SelectTrigger>
                          <SelectContent position="popper">
                            {(settings.qzSerialPort && !qzSerialPorts.includes(settings.qzSerialPort)
                              ? [settings.qzSerialPort, ...qzSerialPorts]
                              : qzSerialPorts
                            ).map((portName) => (
                              <SelectItem key={portName} value={portName}>
                                {portName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          className="w-32"
                          value={settings.qzSerialPort}
                          placeholder="COM4"
                          onChange={(event) => {
                            setQzSerialTestStatus('untested')
                            onSettingsChange({ qzSerialPort: event.target.value })
                          }}
                        />
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void testSelectedQzSerialPort()}
                        disabled={qzSerialTesting || !settings.qzSerialPort.trim()}
                      >
                        {qzSerialTesting ? <RefreshCw size={14} className="animate-spin" /> : <Cable size={14} />}
                        Test connection
                      </Button>
                      <ConnectionTestBadge status={qzSerialTestStatus} />
                    </div>
                  </div>
                  <p className="text-[0.7rem] leading-snug text-muted-foreground">
                    QZ keeps the connection open between prints (one dial-up, no per-print beep/reconnect) — best
                    route for Bluetooth printers. Baud rate: {settings.serialBaudRate}.
                  </p>
                </>
              ) : null}

              <div className="flex flex-wrap items-end justify-between gap-2 rounded-md border border-border/70 p-2">
                <div className="staff-printer-field min-w-44">
                  <span>Text encoding</span>
                  <Select
                    value={settings.qzEncoding}
                    onValueChange={(value) => onSettingsChange({ qzEncoding: value as QzPrintEncoding })}
                  >
                    <SelectTrigger aria-label="QZ print encoding">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectItem value="UTF-8">UTF-8</SelectItem>
                      <SelectItem value="GBK">GBK (简体中文)</SelectItem>
                      <SelectItem value="GB2312">GB2312</SelectItem>
                      <SelectItem value="CP1252">CP1252 (Western)</SelectItem>
                      <SelectItem value="ISO-8859-1">ISO-8859-1</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onPrintTestTicket(printerArea)}
                >
                  <Printer size={14} />
                  Print test ticket
                </Button>
              </div>

              {printerArea === 'kitchen' && settings.autoPrintNewOrders ? (
                <div className="flex flex-col items-start gap-2 rounded-md border border-amber-300/70 bg-amber-50/70 p-2 dark:border-amber-700/70 dark:bg-amber-950/30">
                  <p className="text-[0.7rem] leading-snug text-amber-800 dark:text-amber-200">
                    <strong>{backgroundBrowser.browserLabel}:</strong> {backgroundBrowser.notice}
                    {backgroundBrowser.settingsPath ? (
                      <> Add <strong>{window.location.origin}</strong> under {backgroundBrowser.settingsPath}.</>
                    ) : null}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void showBackgroundBrowserGuidance()}
                  >
                    <Copy size={14} />
                    {backgroundBrowser.actionLabel}
                  </Button>
                </div>
              ) : null}

              {printerArea === 'kitchen' ? (
                <details className="rounded-md border border-border bg-background/60 p-2">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-medium">
                    <span className="flex items-center gap-2">
                      <ListChecks size={14} />
                      Print tasks
                      {printJobs.pendingCount > 0 ? (
                        <Badge variant="secondary">{printJobs.pendingCount} waiting</Badge>
                      ) : null}
                      {printJobs.failedCount + printJobs.deadLetterCount > 0 ? (
                        <Badge variant="destructive">
                          {printJobs.failedCount + printJobs.deadLetterCount} failed
                        </Badge>
                      ) : null}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Refresh print tasks"
                      onClick={(event) => {
                        event.preventDefault()
                        onRefreshPrintJobs()
                      }}
                      disabled={printJobsLoading}
                    >
                      <RefreshCw size={14} className={cn(printJobsLoading && 'animate-spin')} />
                    </Button>
                  </summary>
                  <div className="mt-2 max-h-52 space-y-1.5 overflow-y-auto">
                    {printJobs.jobs.length === 0 ? (
                      <p className="text-[0.7rem] text-muted-foreground">No print jobs recorded for this restaurant.</p>
                    ) : printJobs.jobs.map((job) => (
                      <div
                        key={job.id}
                        className="flex items-start justify-between gap-2 rounded-md border border-border/70 px-2 py-1.5"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            <strong>{job.order.orderNumber}</strong>
                            <Badge
                              variant={
                                job.state === 'Completed'
                                  ? 'secondary'
                                  : job.state === 'Failed' || job.state === 'DeadLetter'
                                    ? 'destructive'
                                    : 'outline'
                              }
                            >
                              {job.state}
                            </Badge>
                            <span className="text-muted-foreground">attempt {job.attempts}</span>
                          </div>
                          {job.lastError || job.lastStatusDetail ? (
                            <p className="mt-0.5 truncate text-[0.68rem] text-muted-foreground" title={job.lastError ?? job.lastStatusDetail ?? undefined}>
                              {job.lastError ?? job.lastStatusDetail}
                            </p>
                          ) : null}
                        </div>
                        {job.state === 'Failed' || job.state === 'DeadLetter' ? (
                          <Button type="button" variant="outline" size="sm" onClick={() => onRetryPrintJob(job.id)}>
                            Retry
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}

              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={downloadPrinterDiagnostics}
                >
                  <Download size={14} />
                  Download diagnostics
                </Button>
                <p className="text-[0.7rem] leading-snug text-muted-foreground">
                  Saves the latest connection checks, queue timing, print results, failures and auto-print retries as JSON.
                </p>
              </div>

              <details className="mt-1 border-t border-border pt-2">
                <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground">
                  One-time setup: silent printing (trust certificate)
                </summary>
                <div className="mt-2 flex flex-col gap-2">
                {qzTrustSupported ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void installTrust()}
                      disabled={trustBusy}
                    >
                      <ShieldCheck size={14} />
                      Install trust cert
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void removeTrust()}
                      disabled={trustBusy}
                    >
                      <ShieldOff size={14} />
                      Remove
                    </Button>
                  </div>
                ) : (
                  <Button type="button" variant="outline" size="sm" onClick={() => void downloadTrustCert()}>
                    <Download size={14} />
                    Download override.crt
                  </Button>
                )}
                <p className="text-[0.7rem] leading-snug text-muted-foreground">
                  {qzTrustSupported
                    ? 'Pick the QZ Tray install folder (e.g. D:\\QZ tray) when asked, then restart QZ Tray. Install stops the security prompt on this machine; Remove undoes it.'
                    : 'Place the downloaded override.crt in the QZ Tray install folder, then restart QZ Tray.'}
                </p>
                </div>
              </details>
            </section>
          ) : null}

          {settings.mode === 'web-serial' ? (
            <section className="staff-printer-route-card active">
              <header>
                <strong>Web Serial</strong>
              </header>
              <div className="mb-2 flex flex-col gap-1">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void selectSerialPort()}
                    disabled={serialSelecting || serialTesting}
                  >
                    {serialSelecting ? <RefreshCw size={14} className="animate-spin" /> : <Cable size={14} />}
                    Select port
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void testSelectedWebSerialPort()}
                    disabled={serialSelecting || serialTesting}
                  >
                    {serialTesting ? <RefreshCw size={14} className="animate-spin" /> : <Cable size={14} />}
                    Test connection
                  </Button>
                  <ConnectionTestBadge status={webSerialTestStatus} />
                </div>
                <span className="text-[0.7rem] leading-snug text-muted-foreground">
                  {serialPortLabel
                    ? `Selected: ${serialPortLabel}`
                    : 'Grant a port once — the connection then stays open between prints. Bluetooth printers paired with Windows appear as COM ports (pick the outgoing one).'}
                </span>
              </div>
              <div className="staff-printer-field">
                <span>Baud rate</span>
                <Select
                  value={String(settings.serialBaudRate)}
                  onValueChange={(value) => {
                    setQzSerialTestStatus('untested')
                    setWebSerialTestStatus('untested')
                    onSettingsChange({ serialBaudRate: Number(value) })
                  }}
                >
                  <SelectTrigger aria-label="Serial baud rate">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {(['9600', '19200', '38400', '57600', '115200'].includes(String(settings.serialBaudRate))
                      ? ['9600', '19200', '38400', '57600', '115200']
                      : [String(settings.serialBaudRate), '9600', '19200', '38400', '57600', '115200']
                    ).map((rate) => (
                      <SelectItem key={rate} value={rate}>
                        {rate}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-[0.7rem] leading-snug text-muted-foreground">
                Only matters for real RS-232 serial cables (must match the printer's DIP switches). Bluetooth and USB
                ports ignore it — leave 9600.
              </p>
            </section>
          ) : null}

          {settings.mode === 'web-usb' ? (
            <section className="staff-printer-route-card active">
              <header>
                <strong>WebUSB</strong>
              </header>
              <div className="mb-2 flex flex-col gap-1">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void selectUsbPrinter()}
                    disabled={usbDetecting || usbTesting}
                  >
                    {usbDetecting ? <RefreshCw size={14} className="animate-spin" /> : <Usb size={14} />}
                    Select printer
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void testSelectedWebUsbPrinter()}
                    disabled={usbDetecting || usbTesting}
                  >
                    {usbTesting ? <RefreshCw size={14} className="animate-spin" /> : <Usb size={14} />}
                    Test connection
                  </Button>
                  <ConnectionTestBadge status={webUsbTestStatus} />
                </div>
                <span className="text-[0.7rem] leading-snug text-muted-foreground">
                  {usbDeviceLabel
                    ? `Selected: ${usbDeviceLabel}`
                    : 'Pick your printer from the browser list — IDs below fill in automatically. For driver-free USB devices; if Windows holds the device, use QZ Tray instead.'}
                </span>
              </div>
              <div className="staff-printer-usb-grid">
                <div className="staff-printer-field">
                  <span>Vendor ID</span>
                  <Input
                    value={settings.usbVendorId}
                    placeholder="0x04b8"
                    onChange={(event) => {
                      setWebUsbTestStatus('untested')
                      onSettingsChange({ usbVendorId: event.target.value })
                    }}
                  />
                </div>
                <div className="staff-printer-field">
                  <span>Product ID</span>
                  <Input
                    value={settings.usbProductId}
                    placeholder="optional"
                    onChange={(event) => {
                      setWebUsbTestStatus('untested')
                      onSettingsChange({ usbProductId: event.target.value })
                    }}
                  />
                </div>
                <div className="staff-printer-field">
                  <span>Interface</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={settings.usbInterfaceNumber}
                    onChange={(event) => {
                      setWebUsbTestStatus('untested')
                      onSettingsChange({ usbInterfaceNumber: Number(event.target.value) })
                    }}
                  />
                </div>
                <div className="staff-printer-field">
                  <span>Endpoint</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={settings.usbEndpointNumber}
                    onChange={(event) => {
                      setWebUsbTestStatus('untested')
                      onSettingsChange({ usbEndpointNumber: Number(event.target.value) })
                    }}
                  />
                </div>
              </div>
            </section>
          ) : null}

          {settings.mode === 'web-bluetooth' ? (
            <section className="staff-printer-route-card active">
              <header>
                <strong>Web Bluetooth</strong>
              </header>
              <div className="mb-2 flex flex-col gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void selectBlePrinter()}
                  disabled={bleSelecting}
                >
                  {bleSelecting ? <RefreshCw size={14} className="animate-spin" /> : <Bluetooth size={14} />}
                  Select printer
                </Button>
                <span className="text-[0.7rem] leading-snug text-muted-foreground">
                  {settings.bleDeviceName
                    ? `Selected: ${settings.bleDeviceName}`
                    : 'For printers with a BLE mode (dual-mode modules). Connection is discovered automatically and stays open.'}
                </span>
                <span className="text-[0.7rem] leading-snug text-muted-foreground">
                  BLE is slower than serial/USB (a ticket takes a few seconds). Chrome/Edge only; not available on iOS.
                </span>
              </div>
            </section>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onSettingsChange(defaultThermalPrinterSettings)}
          >
            Reset
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function OrderPrintTicket({ order, paperWidth, printedAt }: { order: AdminOrder; paperWidth: ThermalPaperWidth; printedAt: Date }) {
  const itemCount = order.items.reduce((total, item) => total + item.quantity, 0)

  return (
    <section className={cn('staff-order-print-ticket', paperWidth === '58mm' && 'is-58mm')} aria-label="Kitchen print ticket">
      <header className="staff-order-print-header">
        <span>Kitchen ticket</span>
        <h1>{order.orderNumber}</h1>
        <p>{order.restaurantName ?? 'Assigned restaurant'}</p>
      </header>

      <dl className="staff-order-print-meta">
        <div>
          <dt>Order</dt>
          <dd>{getPrintOrderScope(order)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{order.status}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{formatDateTime(order.createdAt)}</dd>
        </div>
        <div>
          <dt>Printed</dt>
          <dd>{formatDateTime(printedAt)}</dd>
        </div>
        <div>
          <dt>Items</dt>
          <dd>{itemCount}</dd>
        </div>
      </dl>

      <div className="staff-order-print-items">
        {order.items.map((item) => {
          const optionGroups = groupSelectedOptions(item)
          const itemName = item.itemNameSnapshot?.trim() || 'Unnamed item'

          return (
            <article key={item.id} className="staff-order-print-item">
              <div className="staff-order-print-item-main">
                <strong>{item.quantity}x</strong>
                <span>{itemName}</span>
              </div>

              {optionGroups.length > 0 ? (
                <div className="staff-order-print-options">
                  {optionGroups.map((group) => (
                    <div key={group.groupName}>
                      <strong>{group.groupName}</strong>
                      <span>
                        {group.options
                          .map((option) => `${option.optionNameSnapshot}${(option.quantity ?? 1) > 1 ? ` x${option.quantity ?? 1}` : ''}`)
                          .join(', ')}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}

              {item.note ? (
                <p className="staff-order-print-note">
                  <strong>Item note:</strong> {item.note}
                </p>
              ) : null}
            </article>
          )
        })}
      </div>

      {order.customerNote ? (
        <section className="staff-order-print-order-note">
          <strong>Order note</strong>
          <p>{order.customerNote}</p>
        </section>
      ) : null}
    </section>
  )
}

function PrintTicketButton({ disabled, modeLabel, onClick }: { disabled: boolean; modeLabel: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="staff-order-print-button"
          aria-label="Print kitchen ticket"
          disabled={disabled}
          onClick={onClick}
        >
          {disabled ? <RefreshCw className="animate-spin" size={15} /> : <Printer size={15} />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" align="end" sideOffset={6}>
        Print kitchen ticket via {modeLabel}
      </TooltipContent>
    </Tooltip>
  )
}

function getPrintOrderScope(order: AdminOrder) {
  const label = getOrderTypeLabel(order.orderType)
  return order.tableNumber ? `${label} - Table ${order.tableNumber}` : label
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency || 'AUD',
  }).format(amount)
}

function formatOptionAdjustment(amount: number, currency: string) {
  const formattedAmount = formatMoney(Math.abs(amount), currency)
  return amount > 0 ? `+${formattedAmount}` : `-${formattedAmount}`
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatDateTime(value: string | Date) {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value instanceof Date ? value : new Date(value))
}
