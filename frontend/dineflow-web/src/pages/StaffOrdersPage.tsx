import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Clock3, CreditCard, RefreshCw, Search, ShoppingBag, Utensils, X } from 'lucide-react'
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
import { createOrderRealtimeClient, type OrderRealtimeUpdate } from '@/realtime/orderConnection'
import { cn } from '@/lib/utils'

type Queue = 'active' | 'new' | 'kitchen' | 'ready' | 'closed'
type SortOption = 'oldest' | 'newest' | 'recentlyUpdated' | 'amountHigh' | 'amountLow' | 'orderNumber'
type OrderSignalTone = 'new' | 'ready' | 'kitchen' | 'blocked' | 'closed' | 'neutral'

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

function getOrderScope(order: AdminOrder) {
  if (order.tableNumber) return `Table ${order.tableNumber}`
  if (order.orderType === 'DineIn') return 'Dine in'
  return order.orderType
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
    void loadOrders()
    const refreshTimer = window.setInterval(() => void loadOrders(), 15_000)
    return () => window.clearInterval(refreshTimer)
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
            <Button type="button" variant="secondary" disabled={loading} onClick={() => void loadOrders(true)}>
              <RefreshCw className={loading ? 'animate-spin' : ''} size={17} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
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

          {error ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          ) : null}

          {loading && orders.length === 0 ? (
            <div className="dashboard-empty-state">Loading restaurant orders...</div>
          ) : visibleOrders.length === 0 ? (
            <div className="dashboard-empty-state">
              {debouncedSearch ? `No orders match "${debouncedSearch}" in this queue.` : 'No orders in this queue.'}
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
                          <span className={cn('staff-order-wait-time', signal.isLate && 'is-late')}>
                            <Clock3 size={13} />
                            Waiting {formatElapsedTime(order, now)}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <CardTitle className="text-base">{order.orderNumber}</CardTitle>
                            <CardDescription className="mt-1 flex items-center gap-1.5">
                              {order.tableNumber ? <Utensils size={14} /> : <ShoppingBag size={14} />}
                              {getOrderScope(order)}
                              <span>·</span>
                              <Clock3 size={14} />
                              {formatTime(order.createdAt)}
                            </CardDescription>
                          </div>
                          <strong>{formatMoney(order.totalAmount, order.currency)}</strong>
                        </div>
                        <div className="flex flex-wrap gap-2">
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
