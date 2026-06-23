import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, Clock3, CreditCard, RefreshCw, ShoppingBag, Utensils } from 'lucide-react'
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

type Queue = 'active' | 'new' | 'kitchen' | 'ready' | 'closed'
type SortOption = 'newest' | 'oldest' | 'recentlyUpdated' | 'amountHigh' | 'amountLow' | 'orderNumber'

const sortRequests: Record<SortOption, { sortBy: string; sortDirection: 'asc' | 'desc' }> = {
  newest: { sortBy: 'createdAt', sortDirection: 'desc' },
  oldest: { sortBy: 'createdAt', sortDirection: 'asc' },
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

export function StaffOrdersPage() {
  const { user } = useAuth()
  const isPlatformOwner = user?.roles.includes('PlatformOwner') ?? false
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [restaurantFilter, setRestaurantFilter] = useState('all')
  const [sortOption, setSortOption] = useState<SortOption>('newest')
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

  const loadOrders = useCallback(async (showToast = false) => {
    try {
      setError(null)
      const sort = sortRequests[sortOption]
      const request = {
        page: 1,
        pageSize: 100,
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
  }, [isPlatformOwner, restaurantFilter, sortOption])

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
          <div className="flex flex-wrap gap-4">
            {isPlatformOwner ? (
              <div className="w-full max-w-sm space-y-1.5">
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

            <div className="w-full max-w-xs space-y-1.5">
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
            <div className="dashboard-empty-state">No orders in this queue.</div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {visibleOrders.map((order, index) => {
                const onlinePaymentBlocked = order.paymentMethod === 'Online' && order.paymentStatus !== 'Paid'
                const isBusy = busyOrderId === order.id

                return (
                  <motion.article
                    key={order.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, delay: Math.min(index * 0.025, 0.15) }}
                  >
                    <Card className="h-full">
                      <CardHeader className="space-y-3 pb-3">
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
                          <Badge variant="outline">
                            <CreditCard size={12} />
                            {order.paymentMethod === 'PayAtCounter' ? 'Counter' : 'Online'}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="space-y-2">
                          {order.items.map((item) => (
                            <div key={item.id} className="flex justify-between gap-3 text-sm">
                              <span><strong>{item.quantity}x</strong> {item.itemNameSnapshot}</span>
                              <span>{formatMoney(item.totalPrice, order.currency)}</span>
                            </div>
                          ))}
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

                        <div className="flex flex-wrap gap-2 border-t pt-4">
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

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}
