import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ChefHat, Clock3, CreditCard, ListChecks, Printer, RefreshCw, Search, Settings2, ShoppingBag, Utensils, Volume2, VolumeX, X } from 'lucide-react'
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
import { useAuth } from '@/auth/AuthContext'
import { OrderStatusBadge } from '@/components/orders/OrderStatusBadge'
import { OrderTransitionReasonField } from '@/components/orders/OrderTransitionReasonField'
import { PaymentStatusBadge } from '@/components/orders/PaymentStatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { createOrderRealtimeClient, type OrderRealtimeUpdate } from '@/realtime/orderConnection'
import {
  createKitchenTicket,
  defaultThermalPrinterSettings,
  printKitchenTicketWithQzTray,
  printKitchenTicketWithWebSerial,
  printKitchenTicketWithWebUsb,
  readStoredThermalPrinterSettings,
  storeThermalPrinterSettings,
  type ThermalPaperWidth,
  type ThermalPrinterMode,
  type ThermalPrinterSettings,
} from '@/lib/thermalPrinter'
import { cn } from '@/lib/utils'

type Queue = 'active' | 'new' | 'kitchen' | 'ready' | 'closed'
type StaffOrdersViewMode = 'orders' | 'kitchen'
type KitchenLane = 'new' | 'preparing' | 'ready'
type SortOption = 'oldest' | 'newest' | 'recentlyUpdated' | 'amountHigh' | 'amountLow' | 'orderNumber'
type OrderSignalTone = 'new' | 'ready' | 'kitchen' | 'blocked' | 'closed' | 'neutral'
type PrintTicketRequest = {
  order: AdminOrder
  requestedAt: number
}

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
  closed: new Set(['Completed', 'Cancelled', 'Rejected']),
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

function isOnlinePaymentBlocked(order: AdminOrder) {
  return order.paymentMethod === 'Online' && order.paymentStatus !== 'Paid'
}

function needsCounterPayment(order: AdminOrder) {
  return order.paymentMethod === 'PayAtCounter' && order.paymentStatus !== 'Paid'
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
  const isLate = getOrderAgeMinutes(order, now) >= 20 && !isClosedOrder(order) && !isOnlinePaymentBlocked(order)

  if (isClosedOrder(order)) {
    return { label: 'Closed', tone: 'closed', isLate: false }
  }

  if (isOnlinePaymentBlocked(order)) {
    return { label: 'Waiting payment', tone: 'blocked', isLate: false }
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

function playNewOrderSound(ctx: AudioContext): void {
  const now = ctx.currentTime

  // First tone: C6 (1047 Hz)
  const osc1 = ctx.createOscillator()
  const gain1 = ctx.createGain()
  osc1.connect(gain1)
  gain1.connect(ctx.destination)
  osc1.type = 'sine'
  osc1.frequency.setValueAtTime(1046.5, now)
  gain1.gain.setValueAtTime(0, now)
  gain1.gain.linearRampToValueAtTime(0.42, now + 0.012)
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.28)
  osc1.start(now)
  osc1.stop(now + 0.3)

  // Second tone: E6 (1319 Hz), offset 220 ms
  const osc2 = ctx.createOscillator()
  const gain2 = ctx.createGain()
  osc2.connect(gain2)
  gain2.connect(ctx.destination)
  osc2.type = 'sine'
  osc2.frequency.setValueAtTime(1318.5, now + 0.22)
  gain2.gain.setValueAtTime(0, now + 0.22)
  gain2.gain.linearRampToValueAtTime(0.42, now + 0.232)
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.65)
  osc2.start(now + 0.22)
  osc2.stop(now + 0.65)
}

export function StaffOrdersPage() {
  const { user } = useAuth()
  const isPlatformOwner = user?.roles.includes('PlatformOwner') ?? false
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [restaurantFilter, setRestaurantFilter] = useState('all')
  const [sortOption, setSortOption] = useState<SortOption>('newest')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [queue, setQueue] = useState<Queue>('active')
  const [viewMode, setViewMode] = useState<StaffOrdersViewMode>('orders')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null)
  const [pendingTransition, setPendingTransition] = useState<{
    order: AdminOrder
    action: OrderTransitionAction
  } | null>(null)
  const [reason, setReason] = useState('')
  const loadOrdersRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const restaurantFilterRef = useRef(restaurantFilter)
  const isPlatformOwnerRef = useRef(isPlatformOwner)
  const realtimeRefreshTimerRef = useRef<number | null>(null)
  const [audioEnabled, setAudioEnabled] = useState(true)
  const audioEnabledRef = useRef(true)
  const audioContextRef = useRef<AudioContext | null>(null)
  const [printTicket, setPrintTicket] = useState<PrintTicketRequest | null>(null)
  const [printerSettingsOpen, setPrinterSettingsOpen] = useState(false)
  const [printerSettings, setPrinterSettings] = useState<ThermalPrinterSettings>(() => readStoredThermalPrinterSettings())
  const [printingOrderId, setPrintingOrderId] = useState<string | null>(null)

  useEffect(() => {
    audioEnabledRef.current = audioEnabled
  }, [audioEnabled])

  useEffect(() => {
    storeThermalPrinterSettings(printerSettings)
  }, [printerSettings])

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

  // Auto-create AudioContext on mount; resume on first user gesture (browser autoplay policy)
  useEffect(() => {
    try {
      audioContextRef.current = new AudioContext()
    } catch {
      return
    }
    const resume = () => {
      if (audioContextRef.current?.state === 'suspended') {
        void audioContextRef.current.resume()
      }
    }
    window.addEventListener('pointerdown', resume, { once: true })
    return () => window.removeEventListener('pointerdown', resume)
  }, [])

  const loadOrders = useCallback(async (showToast = false) => {
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
      setOrders(response.items)
      setLastUpdated(new Date())
      if (showToast) toast.success('Staff order queue refreshed')
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Could not load orders.'
      setError(message)
      if (showToast) toast.error('Could not refresh orders', { description: message })
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, isPlatformOwner, restaurantFilter, sortOption])

  useEffect(() => {
    loadOrdersRef.current = () => loadOrders()
  }, [loadOrders])

  useEffect(() => {
    restaurantFilterRef.current = restaurantFilter
    isPlatformOwnerRef.current = isPlatformOwner
  }, [isPlatformOwner, restaurantFilter])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim())
    }, 250)

    return () => window.clearTimeout(timer)
  }, [search])

  const shouldHandleRealtimeUpdate = useCallback((update: OrderRealtimeUpdate) => {
    if (!isPlatformOwnerRef.current) {
      return true
    }

    const activeRestaurantFilter = restaurantFilterRef.current
    return activeRestaurantFilter === 'all' || update.restaurantId === activeRestaurantFilter
  }, [])

  const scheduleRealtimeRefresh = useCallback(() => {
    if (realtimeRefreshTimerRef.current !== null) {
      window.clearTimeout(realtimeRefreshTimerRef.current)
    }

    realtimeRefreshTimerRef.current = window.setTimeout(() => {
      realtimeRefreshTimerRef.current = null
      void loadOrdersRef.current()
    }, 300)
  }, [])

  const toggleAudio = useCallback(async () => {
    if (audioEnabled) {
      setAudioEnabled(false)
      return
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext()
    } else if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume()
    }

    setAudioEnabled(true)
    playNewOrderSound(audioContextRef.current)
  }, [audioEnabled])

  const updatePrinterSettings = useCallback((updates: Partial<ThermalPrinterSettings>) => {
    setPrinterSettings((current) => ({ ...current, ...updates }))
  }, [])

  const printOrderTicket = useCallback(async (order: AdminOrder) => {
    const printedAt = new Date()

    if (printerSettings.mode === 'browser') {
      setPrintTicket({ order, requestedAt: printedAt.getTime() })
      return
    }

    const ticket = createKitchenTicket(order, printedAt)
    setPrintingOrderId(order.id)

    try {
      if (printerSettings.mode === 'qz-tray') {
        await printKitchenTicketWithQzTray(ticket, printerSettings)
      } else if (printerSettings.mode === 'web-serial') {
        await printKitchenTicketWithWebSerial(ticket, printerSettings)
      } else if (printerSettings.mode === 'web-usb') {
        await printKitchenTicketWithWebUsb(ticket, printerSettings)
      }

      toast.success('Kitchen ticket sent', {
        description: `${order.orderNumber} via ${printerModeLabels[printerSettings.mode]}.`,
      })
    } catch (printError) {
      toast.error('Kitchen ticket could not be printed', {
        description: printError instanceof Error ? printError.message : 'The print request failed.',
      })
    } finally {
      setPrintingOrderId(null)
    }
  }, [printerSettings])

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

  useEffect(() => {
    if (!user) return

    const client = createOrderRealtimeClient({
      onOrderCreated: (update) => {
        if (!shouldHandleRealtimeUpdate(update)) {
          return
        }

        setQueue('active')
        toast('New order received', {
          description: `${update.orderNumber} is waiting in the staff queue.`,
        })
        scheduleRealtimeRefresh()
      },
      onOrderUpdated: (update) => {
        if (shouldHandleRealtimeUpdate(update)) {
          scheduleRealtimeRefresh()
        }
      },
      onOrderPaymentUpdated: (update) => {
        if (shouldHandleRealtimeUpdate(update)) {
          scheduleRealtimeRefresh()
          const isPayAtCounterConfirmed = update.paymentMethod === 'PayAtCounter' && update.paymentStatus === 'Unpaid'
          const isOnlinePaid = update.paymentMethod === 'Online' && update.paymentStatus === 'Paid'
          if (audioEnabledRef.current && audioContextRef.current && (isPayAtCounterConfirmed || isOnlinePaid)) {
            playNewOrderSound(audioContextRef.current)
          }
        }
      },
      onOrderDeleted: (update) => {
        if (shouldHandleRealtimeUpdate(update)) {
          scheduleRealtimeRefresh()
        }
      },
      onReconnected: () => {
        void loadOrdersRef.current()
      },
    })

    void client.start().catch((realtimeError) => {
      console.warn('[SignalR] Staff order realtime connection failed.', realtimeError)
    })

    return () => {
      if (realtimeRefreshTimerRef.current !== null) {
        window.clearTimeout(realtimeRefreshTimerRef.current)
        realtimeRefreshTimerRef.current = null
      }

      void client.stop()
    }
  }, [scheduleRealtimeRefresh, shouldHandleRealtimeUpdate, user])

  const visibleOrders = useMemo(
    () => orders.filter((order) => queueStatuses[queue].has(order.status)),
    [orders, queue],
  )

  const kitchenLanes = useMemo(() => {
    const now = lastUpdated ?? new Date()

    return (['new', 'preparing', 'ready'] as KitchenLane[]).map((lane) => ({
      lane,
      orders: orders
        .filter((order) => kitchenLaneStatuses[lane].has(order.status))
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

  const queueCounts = useMemo(() => ({
    active: orders.filter((order) => queueStatuses.active.has(order.status)).length,
    new: orders.filter((order) => queueStatuses.new.has(order.status)).length,
    kitchen: orders.filter((order) => queueStatuses.kitchen.has(order.status)).length,
    ready: orders.filter((order) => queueStatuses.ready.has(order.status)).length,
    closed: orders.filter((order) => queueStatuses.closed.has(order.status)).length,
  }), [orders])

  const priorityCounts = useMemo(() => {
    const now = lastUpdated ?? new Date()
    const activeOrders = orders.filter((order) => queueStatuses.active.has(order.status))

    return {
      needsAction: activeOrders.filter((order) => {
        const signal = getOrderSignal(order, now)
        return signal.tone !== 'blocked' && signal.tone !== 'closed'
      }).length,
      ready: activeOrders.filter((order) => order.status === 'Ready').length,
      late: activeOrders.filter((order) => getOrderSignal(order, now).isLate).length,
      waitingPayment: activeOrders.filter(isOnlinePaymentBlocked).length,
    }
  }, [lastUpdated, orders])

  const selectedRestaurant = restaurants.find((restaurant) => restaurant.id === restaurantFilter)
  const restaurantName = isPlatformOwner
    ? selectedRestaurant?.name ?? 'All restaurants'
    : orders[0]?.restaurantName ?? 'Your restaurant'

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

  return (
    <main className="content-grid">
      <Card>
        <CardHeader className="section-header">
          <div className="admin-page-title">
            <Utensils size={22} />
            <div>
              <CardTitle>Staff Orders</CardTitle>
              <CardDescription>
                {restaurantName} · {isPlatformOwner ? 'Platform-wide order queue.' : 'Restaurant-scoped live order queue.'}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated ? (
              <span className="text-xs text-muted-foreground">
                Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            ) : null}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Kitchen printer settings"
                  onClick={() => setPrinterSettingsOpen(true)}
                >
                  <Settings2 size={17} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end" sideOffset={6}>
                Printer: {printerModeLabels[printerSettings.mode]}
              </TooltipContent>
            </Tooltip>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={audioEnabled ? 'Mute new order sound' : 'Enable new order sound'}
              title={audioEnabled ? 'Sound on - click to mute' : 'Sound off - click to enable'}
              onClick={() => void toggleAudio()}
            >
              {audioEnabled
                ? <Volume2 size={17} />
                : <VolumeX size={17} className="text-muted-foreground" />}
            </Button>
            <Button type="button" variant="secondary" disabled={loading} onClick={() => void loadOrders(true)}>
              <RefreshCw className={loading ? 'animate-spin' : ''} size={17} />
              Refresh
            </Button>
          </div>
        </CardHeader>
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
            <div className="staff-orders-priority-pill is-action">
              <strong>{priorityCounts.needsAction}</strong>
              <span>Need action</span>
            </div>
            <div className="staff-orders-priority-pill is-ready">
              <strong>{priorityCounts.ready}</strong>
              <span>Ready now</span>
            </div>
            <div className="staff-orders-priority-pill is-late">
              <strong>{priorityCounts.late}</strong>
              <span>Over 20 min</span>
            </div>
            <div className="staff-orders-priority-pill is-blocked">
              <strong>{priorityCounts.waitingPayment}</strong>
              <span>Waiting payment</span>
            </div>
          </div>

          <div className="staff-orders-toolbar">
            {isPlatformOwner ? (
              <div className="staff-orders-filter space-y-1.5">
                <span className="text-sm font-medium">Restaurant</span>
                <Select value={restaurantFilter} onValueChange={setRestaurantFilter}>
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
                  placeholder="Order, table, or item"
                  aria-label="Search staff orders"
                  onChange={(event) => setSearch(event.target.value)}
                />
                {search.trim() ? (
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
              <span className="text-sm font-medium">Sort orders</span>
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
            </div>
          </div>

          {viewMode === 'orders' ? (
            <Tabs value={queue} onValueChange={(value) => setQueue(value as Queue)}>
              <TabsList className="grid h-11 w-full grid-cols-5">
                {(['active', 'new', 'kitchen', 'ready', 'closed'] as Queue[]).map((value) => (
                  <TabsTrigger
                    key={value}
                    value={value}
                    className="h-full min-w-0 gap-1 px-1 py-1 capitalize sm:gap-2 sm:px-3"
                  >
                    {value}
                    <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1.5 leading-none">
                      {queueCounts[value]}
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
                <section key={lane} className={cn('staff-kitchen-lane', `is-${lane}`)}>
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
                        const onlinePaymentBlocked = isOnlinePaymentBlocked(order)
                        const counterPaymentNeeded = needsCounterPayment(order)
                        const isBusy = busyOrderId === order.id
                        const itemCount = order.items.reduce((total, item) => total + item.quantity, 0)

                        return (
                          <article key={order.id} className={cn('staff-kitchen-card', `staff-kitchen-card-${signal.tone}`, signal.isLate && 'is-late')}>
                            <div className="staff-kitchen-card-header">
                              <div className="staff-kitchen-card-title">
                                <span className="staff-kitchen-order-number">{order.orderNumber}</span>
                                <strong>{order.tableNumber ? `Table ${order.tableNumber}` : getOrderTypeLabel(order.orderType)}</strong>
                              </div>
                              <div className="staff-kitchen-card-tools">
                                <span className={cn('staff-kitchen-timer', signal.isLate && 'is-late')}>
                                  <Clock3 size={15} />
                                  {formatElapsedTime(order, now)}
                                </span>
                                <PrintTicketButton
                                  disabled={printingOrderId === order.id}
                                  modeLabel={printerModeLabels[printerSettings.mode]}
                                  onClick={() => void printOrderTicket(order)}
                                />
                              </div>
                            </div>

                            <div className="staff-kitchen-meta">
                              <Badge variant="outline">{itemCount} item{itemCount === 1 ? '' : 's'}</Badge>
                              <OrderStatusBadge status={order.status} />
                              <PaymentStatusBadge status={order.paymentStatus} />
                              {counterPaymentNeeded ? <Badge variant="outline" className="staff-order-counter-badge">Counter due</Badge> : null}
                            </div>

                            {onlinePaymentBlocked ? (
                              <div className="staff-kitchen-warning">
                                <AlertCircle size={16} />
                                Awaiting online payment
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
                                      <div className="staff-kitchen-note">
                                        <strong>Item note</strong>
                                        <span>{item.note}</span>
                                      </div>
                                    ) : null}
                                  </div>
                                )
                              })}
                            </div>

                            {order.customerNote ? (
                              <div className="staff-kitchen-note is-order-note">
                                <strong>Order note</strong>
                                <span>{order.customerNote}</span>
                              </div>
                            ) : null}

                            <div className="staff-kitchen-actions">
                              {order.paymentMethod === 'PayAtCounter' && order.paymentStatus !== 'Paid' ? (
                                <Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={() => void markCounterPayment(order)}>
                                  Mark paid
                                </Button>
                              ) : null}
                              {(order.availableActions ?? [])
                                .filter((action) => ['Accept', 'StartPreparing', 'MarkReady', 'Complete'].includes(action))
                                .map((action) => (
                                  <Button
                                    key={action}
                                    type="button"
                                    size="sm"
                                    className="staff-order-primary-action"
                                    disabled={isBusy || onlinePaymentBlocked}
                                    onClick={() => beginTransition(order, action)}
                                  >
                                    {isBusy ? 'Updating' : actionLabels[action]}
                                  </Button>
                                ))}
                              {(order.availableActions ?? [])
                                .filter((action) => action === 'Reject' || action === 'Cancel')
                                .map((action) => (
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
                              {(order.availableActions ?? []).length === 0 && !onlinePaymentBlocked ? (
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
                const onlinePaymentBlocked = isOnlinePaymentBlocked(order)
                const counterPaymentNeeded = needsCounterPayment(order)
                const isBusy = busyOrderId === order.id

                return (
                  <motion.article
                    key={order.id}
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
                              disabled={printingOrderId === order.id}
                              modeLabel={printerModeLabels[printerSettings.mode]}
                              onClick={() => void printOrderTicket(order)}
                            />
                          </div>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <CardTitle className="text-base">{order.orderNumber}</CardTitle>
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
                          <Badge variant="outline">
                            <CreditCard size={12} />
                            {order.paymentMethod === 'PayAtCounter' ? 'Counter' : 'Online'}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
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
                                  <div className="mt-2 rounded-md bg-background/80 px-2 py-1 text-xs text-muted-foreground">
                                    <strong>Item note: </strong>{item.note}
                                  </div>
                                ) : null}
                              </div>
                            )
                          })}
                        </div>

                        {order.customerNote ? (
                          <div className="rounded-lg bg-muted/60 p-3 text-sm">
                            <strong>Note: </strong>{order.customerNote}
                          </div>
                        ) : null}

                        {onlinePaymentBlocked ? (
                          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                            <AlertCircle className="mt-0.5 size-4 shrink-0" />
                            <span className="text-sm">Awaiting online payment. Processing is locked by the server.</span>
                          </div>
                        ) : null}

                        <div className="staff-order-action-row">
                          {order.paymentMethod === 'PayAtCounter' && order.paymentStatus !== 'Paid' ? (
                            <Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={() => void markCounterPayment(order)}>
                              Mark paid
                            </Button>
                          ) : null}
                          {(order.availableActions ?? []).map((action) => (
                            <Button
                              key={action}
                              type="button"
                              size="sm"
                              variant={action === 'Reject' || action === 'Cancel' ? 'destructive' : 'default'}
                              className={cn(action !== 'Reject' && action !== 'Cancel' && 'staff-order-primary-action')}
                              disabled={isBusy}
                              onClick={() => beginTransition(order, action)}
                            >
                              {isBusy ? 'Updating' : actionLabels[action]}
                            </Button>
                          ))}
                          {(order.availableActions ?? []).length === 0 && !onlinePaymentBlocked ? (
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

      <PrinterSettingsDialog
        open={printerSettingsOpen}
        settings={printerSettings}
        onOpenChange={setPrinterSettingsOpen}
        onSettingsChange={updatePrinterSettings}
      />

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

function PrinterSettingsDialog({
  open,
  settings,
  onOpenChange,
  onSettingsChange,
}: {
  open: boolean
  settings: ThermalPrinterSettings
  onOpenChange: (open: boolean) => void
  onSettingsChange: (updates: Partial<ThermalPrinterSettings>) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="staff-printer-dialog">
        <DialogHeader>
          <DialogTitle>Kitchen printer</DialogTitle>
          <DialogDescription>
            Select the route used by the print icon on staff order cards.
          </DialogDescription>
        </DialogHeader>

        <div className="staff-printer-settings">
          <div className="staff-printer-grid">
            <div className="staff-printer-field">
              <span>Route</span>
              <Select
                value={settings.mode}
                onValueChange={(value) => onSettingsChange({ mode: value as ThermalPrinterMode })}
              >
                <SelectTrigger aria-label="Kitchen printer route">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="browser">Browser print</SelectItem>
                  <SelectItem value="qz-tray">QZ Tray</SelectItem>
                  <SelectItem value="web-serial">Web Serial</SelectItem>
                  <SelectItem value="web-usb">WebUSB</SelectItem>
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

            <label className="staff-printer-switch">
              <span>Cut paper</span>
              <Switch
                checked={settings.cutPaper}
                onCheckedChange={(checked) => onSettingsChange({ cutPaper: checked })}
              />
            </label>
          </div>

          <div className="staff-printer-route-grid">
            <section className={cn('staff-printer-route-card', settings.mode === 'qz-tray' && 'active')}>
              <header>
                <strong>QZ Tray</strong>
                <Badge variant={settings.mode === 'qz-tray' ? 'default' : 'outline'}>{settings.mode === 'qz-tray' ? 'Active' : 'Ready'}</Badge>
              </header>
              <div className="staff-printer-field">
                <span>Printer name</span>
                <Input
                  value={settings.qzPrinterName}
                  placeholder="Epson TM-T88VI"
                  onChange={(event) => onSettingsChange({ qzPrinterName: event.target.value })}
                />
              </div>
            </section>

            <section className={cn('staff-printer-route-card', settings.mode === 'web-serial' && 'active')}>
              <header>
                <strong>Web Serial</strong>
                <Badge variant={settings.mode === 'web-serial' ? 'default' : 'outline'}>{settings.mode === 'web-serial' ? 'Active' : 'Ready'}</Badge>
              </header>
              <div className="staff-printer-field">
                <span>Baud rate</span>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={settings.serialBaudRate}
                  onChange={(event) => onSettingsChange({ serialBaudRate: Number(event.target.value) })}
                />
              </div>
            </section>

            <section className={cn('staff-printer-route-card', settings.mode === 'web-usb' && 'active')}>
              <header>
                <strong>WebUSB</strong>
                <Badge variant={settings.mode === 'web-usb' ? 'default' : 'outline'}>{settings.mode === 'web-usb' ? 'Active' : 'Ready'}</Badge>
              </header>
              <div className="staff-printer-usb-grid">
                <div className="staff-printer-field">
                  <span>Vendor ID</span>
                  <Input
                    value={settings.usbVendorId}
                    placeholder="0x04b8"
                    onChange={(event) => onSettingsChange({ usbVendorId: event.target.value })}
                  />
                </div>
                <div className="staff-printer-field">
                  <span>Product ID</span>
                  <Input
                    value={settings.usbProductId}
                    placeholder="optional"
                    onChange={(event) => onSettingsChange({ usbProductId: event.target.value })}
                  />
                </div>
                <div className="staff-printer-field">
                  <span>Interface</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={settings.usbInterfaceNumber}
                    onChange={(event) => onSettingsChange({ usbInterfaceNumber: Number(event.target.value) })}
                  />
                </div>
                <div className="staff-printer-field">
                  <span>Endpoint</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={settings.usbEndpointNumber}
                    onChange={(event) => onSettingsChange({ usbEndpointNumber: Number(event.target.value) })}
                  />
                </div>
              </div>
            </section>
          </div>
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
