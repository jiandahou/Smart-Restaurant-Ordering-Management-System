import { Fragment, type CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  CreditCard,
  History,
  MoreHorizontal,
  RefreshCw,
  ReceiptText,
  Search,
  SlidersHorizontal,
  Undo2,
  UserRound,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useSearchParams } from 'react-router-dom'
import {
  getAdminOrderSummary,
  getAdminOrderStatusHistory,
  getAdminOrders,
  getRestaurants,
  recordCounterPayment,
  refundAdminOrder,
  transitionAdminOrder,
  type AdminOrder,
  type AdminOrderSummary,
  type AdminOrderStatusHistory,
  type OrderTransitionAction,
  type Restaurant,
} from '../api/auth'
import { useAuth } from '../auth/AuthContext'
import { OrderStatusBadge, getOrderStatusLabel, orderStatusOptions } from '../components/orders/OrderStatusBadge'
import { OrderItemOptionBadges } from '../components/orders/OrderItemOptionBadges'
import { OrderRefundDialog, type RefundMode } from '../components/orders/OrderRefundDialog'
import { parseRefundAmountCents } from '../components/orders/refundAmount'
import { OrderStatusHistoryList } from '../components/orders/OrderStatusHistoryList'
import { OrderTransitionReasonField } from '../components/orders/OrderTransitionReasonField'
import { PaymentRefundHistory } from '../components/orders/PaymentRefundHistory'
import { PaymentStatusBadge, getPaymentStatusLabel, paymentStatusOptions } from '../components/orders/PaymentStatusBadge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import { HorizontalTableScroll } from '../components/HorizontalTableScroll'
import {
  adminOrderPageSizes,
  adminOrderSortKeys,
  adminOrderTransitionNeedsConfirmation,
  getAdminOrderArrayValue,
  getAdminOrderPage,
  getAdminOrderPageSize,
  splitAdminOrderActions,
  type AdminOrderSortKey,
} from '../lib/adminOrderManagement'
import { canRefundOrder } from '../lib/paymentRefunds'
import { useRestaurantPrinting } from '../printing/RestaurantPrintingContext'

const orderTypeLabels: Record<string, string> = {
  DineIn: 'Dine in',
  Takeaway: 'Takeaway',
  Scheduled: 'Scheduled',
}

const orderTypeOptions = ['DineIn', 'Takeaway', 'Scheduled']
const orderFilterOptions = ['all', ...orderStatusOptions] as const
const paymentFilterOptions = ['all', ...paymentStatusOptions] as const
const orderTypeFilterOptions = ['all', ...orderTypeOptions] as const
const searchDebounceMs = 300
const realtimeRefreshDebounceMs = 250

const transitionLabels: Record<OrderTransitionAction, string> = {
  Accept: 'Accept',
  StartPreparing: 'Start preparing',
  MarkReady: 'Mark ready',
  Complete: 'Complete',
  Reject: 'Reject',
  Cancel: 'Cancel',
  Reopen: 'Reopen',
}

const reasonRequiredActions = new Set<OrderTransitionAction>(['Reject', 'Cancel', 'Reopen'])

function formatMoney(amount: number, currencyCode?: string | null) {
  return new Intl.NumberFormat(document.documentElement.lang || 'en-AU', {
    style: 'currency',
    currency: (currencyCode || 'AUD').toUpperCase(),
  }).format(amount)
}

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat(document.documentElement.lang || 'en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatPaymentAmount(amountCents: number, currencyCode?: string | null) {
  return formatMoney(amountCents / 100, currencyCode)
}

function getOrderTypeLabel(orderType: string) {
  return orderTypeLabels[orderType] ?? orderType
}

function getOrderScope(order: AdminOrder) {
  return order.tableNumber ? `Table ${order.tableNumber}` : getOrderTypeLabel(order.orderType)
}

function getPaymentTimeline(order: AdminOrder) {
  if (!order.latestPayment) {
    return [
      {
        label: 'Payment',
        value: 'No payment attempt yet',
      },
    ]
  }

  return [
    {
      label: 'Attempt created',
      value: formatDate(order.latestPayment.createdAt),
    },
    {
      label: 'Paid at',
      value: formatDate(order.latestPayment.paidAt),
    },
    {
      label: 'Failed at',
      value: formatDate(order.latestPayment.failedAt),
    },
    {
      label: 'Last updated',
      value: formatDate(order.latestPayment.updatedAt),
    },
  ]
}

function SortHeader({
  active,
  direction,
  label,
  onClick,
}: {
  active: boolean
  direction: 'asc' | 'desc'
  label: string
  onClick: () => void
}) {
  return (
    <button type="button" className="sort-button" onClick={onClick}>
      {label}
      {active ? (direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />) : <ArrowUpDown size={14} />}
    </button>
  )
}

function OrderActionMenu({
  actions,
  busy,
  order,
  onAction,
}: {
  actions: OrderTransitionAction[]
  busy: boolean
  order: AdminOrder
  onAction: (action: OrderTransitionAction) => void
}) {
  const [open, setOpen] = useState(false)

  if (actions.length === 0) {
    return null
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          aria-label={`More actions for ${order.orderNumber}`}
        >
          <MoreHorizontal size={15} />
          More
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="admin-order-action-popover"
        align="end"
        aria-label={`More actions for ${order.orderNumber}`}
      >
        {actions.map((action) => (
          <Button
            key={action}
            type="button"
            variant={action === 'Reject' || action === 'Cancel' ? 'destructive' : 'ghost'}
            size="sm"
            aria-label={`${transitionLabels[action]} ${order.orderNumber}`}
            onClick={() => {
              setOpen(false)
              onAction(action)
            }}
          >
            {transitionLabels[action]}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

export function AdminOrdersPage() {
  const { user } = useAuth()
  const { orderEventRevision, orderRealtimeState } = useRestaurantPrinting()
  const [searchParams, setSearchParams] = useSearchParams()
  const urlSearch = searchParams.get('q')?.trim() ?? ''
  const statusFilter = getAdminOrderArrayValue(searchParams.get('status'), orderFilterOptions, 'all')
  const paymentFilter = getAdminOrderArrayValue(searchParams.get('payment'), paymentFilterOptions, 'all')
  const orderTypeFilter = getAdminOrderArrayValue(searchParams.get('type'), orderTypeFilterOptions, 'all')
  const restaurantFilter = searchParams.get('restaurant') || 'all'
  const page = getAdminOrderPage(searchParams.get('page'))
  const pageSize = getAdminOrderPageSize(searchParams.get('pageSize'))
  const sort: { key: AdminOrderSortKey; direction: 'asc' | 'desc' } = {
    key: getAdminOrderArrayValue(searchParams.get('sort'), adminOrderSortKeys, 'createdAt'),
    direction: searchParams.get('direction') === 'asc' ? 'asc' : 'desc',
  }
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [summary, setSummary] = useState<AdminOrderSummary>({
    total: 0,
    activeKitchen: 0,
    paid: 0,
    pendingPayment: 0,
    failedPayment: 0,
    payable: 0,
    revenue: 0,
  })
  const [initialLoading, setInitialLoading] = useState(true)
  const [isFetching, setIsFetching] = useState(false)
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null)
  const [settlingOrderId, setSettlingOrderId] = useState<string | null>(null)
  const [refundingOrderId, setRefundingOrderId] = useState<string | null>(null)
  const [transitioningOrderId, setTransitioningOrderId] = useState<string | null>(null)
  const [pendingConfirmation, setPendingConfirmation] = useState<
    | { kind: 'counter-payment'; order: AdminOrder }
    | { kind: 'transition'; order: AdminOrder; action: OrderTransitionAction }
    | null
  >(null)
  const [pendingTransition, setPendingTransition] = useState<{
    order: AdminOrder
    action: OrderTransitionAction
  } | null>(null)
  const [transitionReason, setTransitionReason] = useState('')
  const [pendingRefundOrder, setPendingRefundOrder] = useState<AdminOrder | null>(null)
  const [refundReason, setRefundReason] = useState('')
  const [refundMode, setRefundMode] = useState<RefundMode>('full')
  const [refundAmount, setRefundAmount] = useState('')
  const [statusHistoryByOrderId, setStatusHistoryByOrderId] = useState<Record<string, AdminOrderStatusHistory[]>>({})
  const [statusHistoryLoadingId, setStatusHistoryLoadingId] = useState<string | null>(null)
  const [search, setSearch] = useState(urlSearch)
  const [totalItems, setTotalItems] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null)
  const tableWrapRef = useRef<HTMLDivElement | null>(null)
  const [tableViewportWidth, setTableViewportWidth] = useState<number | null>(null)
  const requestIdRef = useRef(0)
  const requestAbortRef = useRef<AbortController | null>(null)
  const committedSearchRef = useRef<string | null>(null)
  const lastOrderEventRevisionRef = useRef(orderEventRevision)
  const canManageWorkflow = user?.roles.some((role) =>
    ['PlatformOwner', 'RestaurantOwner', 'Admin', 'Staff'].includes(role),
  ) ?? false
  const isPlatformOwner = user?.roles.includes('PlatformOwner') ?? false

  const updateOrderParams = useCallback((
    updates: Record<string, string | null>,
    replace = false,
  ) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)

      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === '') {
          next.delete(key)
        } else {
          next.set(key, value)
        }
      })

      return next
    }, { replace })
  }, [setSearchParams])

  const filteredOrders = orders

  const pageStart = totalItems === 0 ? 0 : (page - 1) * pageSize + 1
  const pageEnd = Math.min(page * pageSize, totalItems)
  const currentPage = totalPages === 0 ? 0 : page
  const selectedStatusFilterLabel = statusFilter === 'all' ? '' : getOrderStatusLabel(statusFilter)
  const selectedPaymentFilterLabel = paymentFilter === 'all' ? '' : getPaymentStatusLabel(paymentFilter)
  const selectedOrderTypeFilterLabel = orderTypeFilter === 'all' ? '' : getOrderTypeLabel(orderTypeFilter)
  const selectedRestaurantFilterLabel = restaurants.find((restaurant) => restaurant.id === restaurantFilter)?.name ?? restaurantFilter
  const activeDropdownFilterCount = [
    statusFilter !== 'all',
    paymentFilter !== 'all',
    orderTypeFilter !== 'all',
  ].filter(Boolean).length

  const hasActiveFilters =
    urlSearch !== ''
    || statusFilter !== 'all'
    || paymentFilter !== 'all'
    || orderTypeFilter !== 'all'
    || (isPlatformOwner && restaurantFilter !== 'all')

  const loadOrders = useCallback(async (showToast = false) => {
    const requestId = ++requestIdRef.current
    requestAbortRef.current?.abort()
    const controller = new AbortController()
    requestAbortRef.current = controller
    setIsFetching(true)
    setError(null)

    const query = {
      search: urlSearch || undefined,
      status: statusFilter === 'all' ? undefined : statusFilter,
      paymentStatus: paymentFilter === 'all' ? undefined : paymentFilter,
      orderType: orderTypeFilter === 'all' ? undefined : orderTypeFilter,
      restaurantId: isPlatformOwner && restaurantFilter !== 'all' ? restaurantFilter : undefined,
    }

    try {
      const [response, nextSummary] = await Promise.all([
        getAdminOrders({
          ...query,
          page,
          pageSize,
          sortBy: sort.key,
          sortDirection: sort.direction,
        }, { signal: controller.signal }),
        getAdminOrderSummary(query, { signal: controller.signal }),
      ])

      if (requestId !== requestIdRef.current) {
        return
      }

      setOrders(response.items)
      setTotalItems(response.totalItems)
      setTotalPages(response.totalPages)
      setSummary(nextSummary)
      setLastUpdatedAt(new Date())

      if (page > 1 && (response.totalPages === 0 || page > response.totalPages)) {
        updateOrderParams({
          page: response.totalPages > 1 ? String(response.totalPages) : null,
        }, true)
      }
      if (showToast) {
        toast.success('Orders refreshed')
      }
    } catch (loadError) {
      if (requestId !== requestIdRef.current || (
        loadError instanceof DOMException && loadError.name === 'AbortError'
      )) {
        return
      }

      const message = loadError instanceof Error ? loadError.message : 'Order loading failed'
      setError(message)
      toast.error('Could not load orders', {
        description: message,
      })
    } finally {
      if (requestId === requestIdRef.current) {
        setInitialLoading(false)
        setIsFetching(false)
        requestAbortRef.current = null
      }
    }
  }, [
    isPlatformOwner,
    orderTypeFilter,
    page,
    pageSize,
    paymentFilter,
    restaurantFilter,
    setError,
    setInitialLoading,
    setIsFetching,
    setLastUpdatedAt,
    setOrders,
    setSummary,
    setTotalItems,
    setTotalPages,
    sort.direction,
    sort.key,
    statusFilter,
    updateOrderParams,
    urlSearch,
  ])

  const loadRestaurantOptions = useCallback(async (showToast = false) => {
    if (!isPlatformOwner) {
      return
    }

    setOptionsLoading(true)
    setOptionsError(null)
    try {
      setRestaurants(await getRestaurants())
      if (showToast) {
        toast.success('Restaurant options refreshed')
      }
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Restaurant loading failed'
      setOptionsError(message)
      if (showToast) {
        toast.error('Could not load restaurant options', { description: message })
      }
    } finally {
      setOptionsLoading(false)
    }
  }, [
    isPlatformOwner,
    setOptionsError,
    setOptionsLoading,
    setRestaurants,
  ])

  const handleCounterPayment = async (order: AdminOrder) => {
    setSettlingOrderId(order.id)
    try {
      await recordCounterPayment(order.id)
      toast.success('Counter payment recorded', { description: order.orderNumber })
      await loadOrders()
    } catch (error) {
      toast.error('Could not record payment', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    } finally {
      setSettlingOrderId(null)
    }
  }

  const loadStatusHistory = async (orderId: string, force = false) => {
    if ((!force && statusHistoryByOrderId[orderId]) || statusHistoryLoadingId === orderId) {
      return
    }

    setStatusHistoryLoadingId(orderId)
    try {
      const history = await getAdminOrderStatusHistory(orderId)
      setStatusHistoryByOrderId((current) => ({
        ...current,
        [orderId]: history,
      }))
    } catch (error) {
      toast.error('Could not load status history', {
        description: error instanceof Error ? error.message : 'Status history loading failed.',
      })
    } finally {
      setStatusHistoryLoadingId(null)
    }
  }

  const toggleOrderExpansion = (order: AdminOrder) => {
    setExpandedOrderId((current) => {
      const next = current === order.id ? null : order.id
      if (next) {
        void loadStatusHistory(order.id)
      }
      return next
    })
  }

  const submitRefund = async () => {
    if (!pendingRefundOrder) {
      return
    }

    setRefundingOrderId(pendingRefundOrder.id)
    try {
      const updatedOrder = await refundAdminOrder(pendingRefundOrder.id, {
        reason: refundReason.trim() || undefined,
        amountCents: refundMode === 'full' ? undefined : (parseRefundAmountCents(refundAmount) ?? undefined),
      })
      setOrders((current) => current.map((item) => item.id === updatedOrder.id ? updatedOrder : item))
      toast.success('Refund created', {
        description: `${pendingRefundOrder.orderNumber} is now ${updatedOrder.paymentStatus}.`,
      })
      setPendingRefundOrder(null)
      setRefundReason('')
      setRefundMode('full')
      setRefundAmount('')
      await loadOrders()
    } catch (error) {
      toast.error('Could not refund order', {
        description: error instanceof Error ? error.message : 'Stripe refund failed.',
      })
    } finally {
      setRefundingOrderId(null)
    }
  }

  const submitTransition = async (
    order: AdminOrder,
    action: OrderTransitionAction,
    reason?: string,
  ) => {
    setTransitioningOrderId(order.id)
    try {
      const updatedOrder = await transitionAdminOrder(order.id, action, reason)
      setOrders((current) => current.map((item) => item.id === updatedOrder.id ? updatedOrder : item))
      setStatusHistoryByOrderId((current) => {
        const next = { ...current }
        delete next[updatedOrder.id]
        return next
      })
      if (expandedOrderId === updatedOrder.id) {
        void loadStatusHistory(updatedOrder.id, true)
      }
      toast.success(`Order ${transitionLabels[action].toLowerCase()}`, {
        description: `${order.orderNumber} is now ${updatedOrder.status}.`,
      })
      setPendingTransition(null)
      setTransitionReason('')
      await loadOrders()
    } catch (error) {
      toast.error('Could not update order status', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    } finally {
      setTransitioningOrderId(null)
    }
  }

  const handleTransition = (order: AdminOrder, action: OrderTransitionAction) => {
    if (reasonRequiredActions.has(action)) {
      setTransitionReason('')
      setPendingTransition({ order, action })
      return
    }

    if (adminOrderTransitionNeedsConfirmation(order, action)) {
      setPendingConfirmation({ kind: 'transition', order, action })
      return
    }

    void submitTransition(order, action)
  }

  useEffect(() => {
    if (committedSearchRef.current === urlSearch) {
      committedSearchRef.current = null
      return
    }

    setSearch(urlSearch)
  }, [urlSearch])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextSearch = search.trim()
      if (nextSearch !== urlSearch) {
        committedSearchRef.current = nextSearch
        updateOrderParams({
          q: nextSearch || null,
          page: null,
        }, true)
      }
    }, searchDebounceMs)

    return () => window.clearTimeout(timer)
  }, [search, updateOrderParams, urlSearch])

  useEffect(() => {
    void Promise.resolve().then(() => loadOrders())
  }, [loadOrders])

  useEffect(() => {
    void Promise.resolve().then(() => loadRestaurantOptions())
  }, [loadRestaurantOptions])

  useEffect(() => {
    if (lastOrderEventRevisionRef.current === orderEventRevision) {
      return undefined
    }

    lastOrderEventRevisionRef.current = orderEventRevision
    const timer = window.setTimeout(() => {
      void loadOrders()
    }, realtimeRefreshDebounceMs)

    return () => window.clearTimeout(timer)
  }, [loadOrders, orderEventRevision])

  useEffect(() => () => {
    requestAbortRef.current?.abort()
  }, [])

  useEffect(() => {
    const element = tableWrapRef.current

    if (!element) {
      return undefined
    }

    const updateWidth = () => {
      setTableViewportWidth(element.clientWidth)
    }

    updateWidth()

    const resizeObserver = new ResizeObserver(updateWidth)
    resizeObserver.observe(element)
    window.addEventListener('resize', updateWidth)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateWidth)
    }
  }, [])

  const updateSort = (key: AdminOrderSortKey) => {
    const direction = sort.key === key && sort.direction === 'asc' ? 'desc' : 'asc'
    updateOrderParams({
      page: null,
      sort: key === 'createdAt' ? null : key,
      direction: direction === 'desc' ? null : direction,
    })
  }

  const resetFilters = () => {
    setSearch('')
    updateOrderParams({
      page: null,
      q: null,
      status: null,
      payment: null,
      type: null,
      restaurant: null,
      sort: null,
      direction: null,
    })
    setExpandedOrderId(null)
  }

  const renderOrderActions = (order: AdminOrder) => {
    const refundable = canRefundOrder(order)
    const busy = settlingOrderId === order.id
      || transitioningOrderId === order.id
      || refundingOrderId === order.id
    const actions = splitAdminOrderActions(order)

    return (
      <div className="admin-order-actions" onClick={(event) => event.stopPropagation()}>
        {order.paymentMethod === 'PayAtCounter' && order.paymentStatus !== 'Paid' ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            aria-label={`Mark ${order.orderNumber} as paid`}
            onClick={(event) => {
              event.stopPropagation()
              setPendingConfirmation({ kind: 'counter-payment', order })
            }}
          >
            {settlingOrderId === order.id ? 'Recording' : 'Mark paid'}
          </Button>
        ) : null}
        {refundable ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={busy}
            aria-label={`Refund ${order.orderNumber}`}
            onClick={(event) => {
              event.stopPropagation()
              setRefundReason('')
              setRefundMode('full')
              setRefundAmount((((order.latestPayment?.refundableAmountCents ?? 0)) / 100).toFixed(2))
              setPendingRefundOrder(order)
            }}
          >
            <Undo2 size={15} />
            {refundingOrderId === order.id ? 'Refunding' : 'Refund'}
          </Button>
        ) : null}
        {actions.primary ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            aria-label={`${transitionLabels[actions.primary]} ${order.orderNumber}`}
            onClick={(event) => {
              event.stopPropagation()
              handleTransition(order, actions.primary!)
            }}
          >
            {transitioningOrderId === order.id ? 'Updating' : transitionLabels[actions.primary]}
          </Button>
        ) : null}
        <OrderActionMenu
          actions={actions.secondary}
          busy={busy}
          order={order}
          onAction={(action) => handleTransition(order, action)}
        />
        {(order.availableActions ?? []).length === 0 &&
        !(order.paymentMethod === 'PayAtCounter' && order.paymentStatus !== 'Paid') &&
        !refundable ? (
          <Badge variant={order.canProcess ? 'secondary' : 'outline'}>
            {order.status === 'Completed' ? 'Completed' : order.canProcess ? 'No action' : 'Awaiting payment'}
          </Badge>
        ) : null}
      </div>
    )
  }

  const renderOrderDetailPanel = (
    order: AdminOrder,
    options?: { className?: string; style?: CSSProperties },
  ) => (
    <div
      className={['order-detail-panel', options?.className].filter(Boolean).join(' ')}
      style={options?.style}
      aria-live="polite"
    >
      <section className="order-detail-section order-detail-section-wide">
        <div className="order-detail-heading">
          <ReceiptText size={16} />
          <strong>Items</strong>
        </div>
        <div className="order-item-list">
          {order.items.map((item) => (
            <div key={item.id} className="order-item-line">
              <div className="order-item-line-copy">
                <strong>{item.itemNameSnapshot || 'Menu item'}</strong>
                <span>
                  {item.quantity} x {formatMoney(item.unitPrice, order.currency)}
                </span>
                <OrderItemOptionBadges options={item.selectedOptions} currency={order.currency} />
                {item.note && <small>{item.note}</small>}
              </div>
              <strong>{formatMoney(item.totalPrice, order.currency)}</strong>
            </div>
          ))}
        </div>
        {order.customerNote && (
          <div className="order-note">
            <strong>Order note</strong>
            <span>{order.customerNote}</span>
          </div>
        )}
      </section>

      <section className="order-detail-section">
        <div className="order-detail-heading">
          <CreditCard size={16} />
          <strong>Payment</strong>
        </div>
        <div className="order-payment-grid">
          <span>Status</span>
          <strong>{getPaymentStatusLabel(order.paymentStatus)}</strong>
          <span>Method</span>
          <strong>{order.paymentMethod === 'PayAtCounter' ? 'Pay at counter' : 'Online'}</strong>
          <span>Attempts</span>
          <strong>{order.paymentAttempts}</strong>
          <span>Latest amount</span>
          <strong>
            {order.latestPayment
              ? formatPaymentAmount(order.latestPayment.amountCents, order.latestPayment.currency)
              : formatMoney(order.totalAmount, order.currency)}
          </strong>
          {getPaymentTimeline(order).map((entry) => (
            <Fragment key={entry.label}>
              <span>{entry.label}</span>
              <strong>{entry.value}</strong>
            </Fragment>
          ))}
        </div>
        {order.latestPayment?.failureReason && (
          <div className="order-payment-failure">
            {order.latestPayment.failureReason}
          </div>
        )}
      </section>

      <section className="order-detail-section">
        <div className="order-detail-heading">
          <Undo2 size={16} />
          <strong>Refunds</strong>
        </div>
        <PaymentRefundHistory payment={order.latestPayment} fallbackCurrency={order.currency} />
      </section>

      <section className="order-detail-section">
        <div className="order-detail-heading">
          <History size={16} />
          <strong>Status history</strong>
        </div>
        <OrderStatusHistoryList
          history={statusHistoryByOrderId[order.id]}
          loading={statusHistoryLoadingId === order.id}
        />
      </section>
    </div>
  )

  return (
    <main className="content-grid">
      <h1 className="admin-orders-page-heading">Order Management</h1>
      <Card>
        <CardHeader>
          <div className="section-header">
            <div className="admin-page-title">
              <ClipboardList size={22} />
              <div>
                <CardTitle aria-hidden="true">Order Management</CardTitle>
                <CardDescription>Live orders and payment state from the real order backend.</CardDescription>
              </div>
            </div>
            <div className="admin-orders-header-actions">
              <div
                className="admin-orders-live-status"
                data-state={orderRealtimeState}
                role="status"
                aria-live="polite"
                title={lastUpdatedAt ? `Last updated ${formatDate(lastUpdatedAt.toISOString())}` : undefined}
              >
                {orderRealtimeState === 'connected' ? <Wifi size={15} /> : <WifiOff size={15} />}
                <span>
                  {orderRealtimeState === 'connected'
                    ? 'Live'
                    : orderRealtimeState === 'connecting'
                      ? 'Connecting'
                      : orderRealtimeState === 'reconnecting'
                        ? 'Reconnecting'
                        : 'Offline'}
                </span>
                {isFetching && <small>Updating</small>}
              </div>
              <Button type="button" variant="secondary" onClick={() => loadOrders(true)} disabled={isFetching}>
                <RefreshCw size={18} />
                {isFetching ? 'Refreshing' : 'Refresh'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="directory-stack">
          {error && (
            <div className="admin-orders-error" role="alert">
              <span>
                <strong>Orders may be out of date.</strong>
                <small>{error}</small>
              </span>
              <Button type="button" variant="outline" size="sm" onClick={() => loadOrders()}>
                Retry
              </Button>
            </div>
          )}
          <div className="placeholder-grid order-summary-grid">
            <div className="placeholder-item">
              <strong>
                <span className="order-summary-label-full">Matching orders</span>
                <span className="order-summary-label-short">Orders</span>
              </strong>
              <span>{totalItems}</span>
            </div>
            <div className="placeholder-item">
              <strong>
                <span>Kitchen active</span>
              </strong>
              <span>{summary.activeKitchen}</span>
            </div>
            <div className="placeholder-item">
              <strong>
                <span>Paid</span>
              </strong>
              <span>{summary.paid}</span>
            </div>
            <div className="placeholder-item">
              <strong>
                <span>Awaiting payment</span>
              </strong>
              <span>{summary.pendingPayment}</span>
            </div>
          </div>

          <div className="directory-tools admin-orders-tools restaurant-filter-tools">
            {isPlatformOwner && (
              <div className="admin-orders-restaurant-row restaurant-table-selector-row">
                <Select
                  value={restaurantFilter}
                  disabled={optionsLoading}
                  onValueChange={(value) => updateOrderParams({
                    page: null,
                    restaurant: value === 'all' ? null : value,
                  })}
                >
                  <SelectTrigger className="filter-select" aria-label="Filter by restaurant">
                    <SelectValue placeholder="All restaurants" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="all">All restaurants</SelectItem>
                    {restaurants.map((restaurant) => (
                      <SelectItem key={restaurant.id} value={restaurant.id}>
                        {restaurant.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {optionsError && (
                  <div className="admin-orders-options-error" role="alert">
                    <span>Restaurant list unavailable</span>
                    <Button type="button" variant="ghost" size="xs" onClick={() => loadRestaurantOptions(true)}>
                      Retry
                    </Button>
                  </div>
                )}
              </div>
            )}

            <div className="admin-orders-filter-row">
              <div className="restaurant-filter-search-row admin-orders-search-row">
                <div className="directory-search">
                  <Search size={16} />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search order, customer, restaurant, table, or item"
                    aria-label="Search orders"
                  />
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="restaurant-filter-trigger"
                      aria-label="Filter orders"
                    >
                      <SlidersHorizontal size={16} />
                      {activeDropdownFilterCount > 0 && (
                        <span className="restaurant-filter-count">{activeDropdownFilterCount}</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="restaurant-filter-popover admin-orders-filter-popover"
                    align="end"
                    aria-label="Order filters"
                  >
                    <div className="restaurant-filter-popover-header">
                      <strong>Filters</strong>
                      <Button type="button" variant="ghost" size="xs" onClick={resetFilters} disabled={!hasActiveFilters}>
                        <X size={13} />
                        Clear all
                      </Button>
                    </div>
                    <div className="restaurant-filter-fields">
                      <div className="restaurant-filter-field">
                        <span>Order status</span>
                        <Select value={statusFilter} onValueChange={(value) => updateOrderParams({ page: null, status: value === 'all' ? null : value })}>
                          <SelectTrigger className="filter-select" aria-label="Filter by order status">
                            <SelectValue placeholder="All order status" />
                          </SelectTrigger>
                          <SelectContent position="popper">
                            <SelectItem value="all">All order status</SelectItem>
                            {orderStatusOptions.map((status) => (
                              <SelectItem key={status} value={status}>
                                {getOrderStatusLabel(status)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="restaurant-filter-field">
                        <span>Payment</span>
                        <Select value={paymentFilter} onValueChange={(value) => updateOrderParams({ page: null, payment: value === 'all' ? null : value })}>
                          <SelectTrigger className="filter-select" aria-label="Filter by payment status">
                            <SelectValue placeholder="All payment status" />
                          </SelectTrigger>
                          <SelectContent position="popper">
                            <SelectItem value="all">All payment status</SelectItem>
                            {paymentStatusOptions.map((status) => (
                              <SelectItem key={status} value={status}>
                                {getPaymentStatusLabel(status)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="restaurant-filter-field">
                        <span>Order type</span>
                        <Select value={orderTypeFilter} onValueChange={(value) => updateOrderParams({ page: null, type: value === 'all' ? null : value })}>
                          <SelectTrigger className="filter-select" aria-label="Filter by order type">
                            <SelectValue placeholder="All order types" />
                          </SelectTrigger>
                          <SelectContent position="popper">
                            <SelectItem value="all">All order types</SelectItem>
                            {orderTypeOptions.map((orderType) => (
                              <SelectItem key={orderType} value={orderType}>
                                {getOrderTypeLabel(orderType)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="restaurant-inline-filters admin-orders-inline-filters">
                <Select value={statusFilter} onValueChange={(value) => updateOrderParams({ page: null, status: value === 'all' ? null : value })}>
                  <SelectTrigger className="filter-select" aria-label="Filter by order status">
                    <SelectValue placeholder="All order status" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="all">All order status</SelectItem>
                    {orderStatusOptions.map((status) => (
                      <SelectItem key={status} value={status}>
                        {getOrderStatusLabel(status)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={paymentFilter} onValueChange={(value) => updateOrderParams({ page: null, payment: value === 'all' ? null : value })}>
                  <SelectTrigger className="filter-select" aria-label="Filter by payment status">
                    <SelectValue placeholder="All payment status" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="all">All payment status</SelectItem>
                    {paymentStatusOptions.map((status) => (
                      <SelectItem key={status} value={status}>
                        {getPaymentStatusLabel(status)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={orderTypeFilter} onValueChange={(value) => updateOrderParams({ page: null, type: value === 'all' ? null : value })}>
                  <SelectTrigger className="filter-select" aria-label="Filter by order type">
                    <SelectValue placeholder="All order types" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="all">All order types</SelectItem>
                    {orderTypeOptions.map((orderType) => (
                      <SelectItem key={orderType} value={orderType}>
                        {getOrderTypeLabel(orderType)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button type="button" variant="ghost" size="icon" onClick={resetFilters} disabled={!hasActiveFilters} title="Clear filters" aria-label="Clear order filters">
                  <X size={18} />
                </Button>
              </div>
            </div>

            {hasActiveFilters && (
              <div className="restaurant-filter-chips admin-orders-filter-chips" aria-label="Active order filters">
                {urlSearch && (
                  <button type="button" className="restaurant-filter-chip" onClick={() => { setSearch(''); updateOrderParams({ page: null, q: null }) }} title={`Search: ${urlSearch}`} aria-label={`Remove search filter ${urlSearch}`}>
                    <span>Search: {urlSearch}</span>
                    <X size={13} />
                  </button>
                )}
                {isPlatformOwner && restaurantFilter !== 'all' && (
                  <button type="button" className="restaurant-filter-chip" onClick={() => updateOrderParams({ page: null, restaurant: null })} title={`Restaurant: ${selectedRestaurantFilterLabel}`} aria-label={`Remove restaurant filter ${selectedRestaurantFilterLabel}`}>
                    <span>Restaurant: {selectedRestaurantFilterLabel}</span>
                    <X size={13} />
                  </button>
                )}
                {statusFilter !== 'all' && (
                  <button type="button" className="restaurant-filter-chip" onClick={() => updateOrderParams({ page: null, status: null })} title={`Status: ${selectedStatusFilterLabel}`} aria-label={`Remove status filter ${selectedStatusFilterLabel}`}>
                    <span>Status: {selectedStatusFilterLabel}</span>
                    <X size={13} />
                  </button>
                )}
                {paymentFilter !== 'all' && (
                  <button type="button" className="restaurant-filter-chip" onClick={() => updateOrderParams({ page: null, payment: null })} title={`Payment: ${selectedPaymentFilterLabel}`} aria-label={`Remove payment filter ${selectedPaymentFilterLabel}`}>
                    <span>Payment: {selectedPaymentFilterLabel}</span>
                    <X size={13} />
                  </button>
                )}
                {orderTypeFilter !== 'all' && (
                  <button type="button" className="restaurant-filter-chip" onClick={() => updateOrderParams({ page: null, type: null })} title={`Type: ${selectedOrderTypeFilterLabel}`} aria-label={`Remove order type filter ${selectedOrderTypeFilterLabel}`}>
                    <span>Type: {selectedOrderTypeFilterLabel}</span>
                    <X size={13} />
                  </button>
                )}
                <button type="button" className="restaurant-filter-chip restaurant-filter-chip-clear" onClick={resetFilters}>
                  <X size={13} />
                  <span>Clear all</span>
                </button>
              </div>
            )}
          </div>

          <div className="admin-orders-table-wrap">
            <HorizontalTableScroll ref={tableWrapRef} topScrollLabel="Scroll orders table horizontally">
              <table
                className={`data-table payment-orders-table admin-orders-table${isFetching ? ' is-fetching' : ''}`}
                aria-busy={isFetching}
              >
                <caption className="admin-orders-table-caption">
                  Orders matching the current search and filters
                </caption>
                <thead>
                  <tr>
                    <th aria-sort={sort.key === 'orderNumber' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <SortHeader
                        active={sort.key === 'orderNumber'}
                        direction={sort.direction}
                        label="Order"
                        onClick={() => updateSort('orderNumber')}
                      />
                    </th>
                    <th aria-sort={sort.key === 'restaurantName' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <SortHeader
                        active={sort.key === 'restaurantName'}
                        direction={sort.direction}
                        label="Restaurant"
                        onClick={() => updateSort('restaurantName')}
                      />
                    </th>
                    <th aria-sort={sort.key === 'status' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <SortHeader
                        active={sort.key === 'status'}
                        direction={sort.direction}
                        label="Order status"
                        onClick={() => updateSort('status')}
                      />
                    </th>
                    <th aria-sort={sort.key === 'paymentStatus' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <SortHeader
                        active={sort.key === 'paymentStatus'}
                        direction={sort.direction}
                        label="Payment"
                        onClick={() => updateSort('paymentStatus')}
                      />
                    </th>
                    <th aria-sort={sort.key === 'totalAmount' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <SortHeader
                        active={sort.key === 'totalAmount'}
                        direction={sort.direction}
                        label="Amount"
                        onClick={() => updateSort('totalAmount')}
                      />
                    </th>
                    <th>Customer</th>
                    <th aria-sort={sort.key === 'createdAt' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <SortHeader
                        active={sort.key === 'createdAt'}
                        direction={sort.direction}
                        label="Created"
                        onClick={() => updateSort('createdAt')}
                      />
                    </th>
                    {canManageWorkflow && <th className="admin-orders-actions-column">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => {
                    const isExpanded = expandedOrderId === order.id

                    return (
                      <Fragment key={order.id}>
                        <tr
                          className="expandable-table-row"
                          aria-expanded={isExpanded}
                          onClick={() => toggleOrderExpansion(order)}
                        >
                          <td>
                            <span className="table-name">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="row-expand-button"
                                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} details for ${order.orderNumber}`}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  toggleOrderExpansion(order)
                                }}
                              >
                                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                              </Button>
                              <ClipboardList size={16} />
                              {order.orderNumber}
                            </span>
                            <span className="table-subtext">
                              {getOrderScope(order)} - {order.items.length} item{order.items.length === 1 ? '' : 's'}
                            </span>
                          </td>
                          <td>
                            <strong>{order.restaurantName || 'Unknown restaurant'}</strong>
                            <span className="table-subtext">{getOrderTypeLabel(order.orderType)}</span>
                          </td>
                          <td>
                            <OrderStatusBadge status={order.status} />
                          </td>
                          <td>
                            <PaymentStatusBadge status={order.paymentStatus} />
                            <span className="table-subtext">
                              {order.paymentMethod === 'PayAtCounter'
                                ? 'Pay at counter'
                                : order.paymentAttempts > 0
                                ? `${order.paymentAttempts} payment attempt${order.paymentAttempts === 1 ? '' : 's'}`
                                : 'No payment attempts yet'}
                            </span>
                            {order.latestPayment && (
                              <span className="table-subtext">
                                Latest: {getPaymentStatusLabel(order.latestPayment.status)}
                              </span>
                            )}
                          </td>
                          <td>
                            <strong>{formatMoney(order.totalAmount, order.currency)}</strong>
                          </td>
                          <td>
                            <strong>{order.customerName || order.customerEmail || 'Guest / unknown'}</strong>
                            <span className="table-subtext">{order.customerEmail || order.customerId || 'No customer account'}</span>
                          </td>
                          <td>{formatDate(order.createdAt)}</td>
                          {canManageWorkflow && (
                            <td className="admin-orders-actions-column">
                              {renderOrderActions(order)}
                            </td>
                          )}
                        </tr>
                        {isExpanded && (
                          <tr className="order-detail-row">
                            <td colSpan={canManageWorkflow ? 8 : 7}>
                              {renderOrderDetailPanel(order, {
                                style: tableViewportWidth ? { width: `${tableViewportWidth}px` } : undefined,
                              })}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                  {filteredOrders.length === 0 && (
                    <tr>
                      <td colSpan={canManageWorkflow ? 8 : 7} className="empty-cell">
                        {initialLoading
                          ? 'Loading real orders...'
                          : hasActiveFilters
                            ? 'No orders match the current filters.'
                            : 'No orders found.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </HorizontalTableScroll>
          </div>

          <div className="restaurant-mobile-list admin-order-mobile-list" aria-label="Orders">
            {filteredOrders.map((order) => {
              const isExpanded = expandedOrderId === order.id
              const customerLabel = order.customerName || order.customerEmail || 'Guest / unknown'
              const paymentAttemptLabel = order.paymentMethod === 'PayAtCounter'
                ? 'Pay at counter'
                : order.paymentAttempts > 0
                  ? `${order.paymentAttempts} payment attempt${order.paymentAttempts === 1 ? '' : 's'}`
                  : 'No payment attempts yet'

              return (
                <article
                  className="restaurant-mobile-card admin-order-mobile-card"
                  key={order.id}
                  aria-labelledby={`admin-order-${order.id}`}
                >
                  <header className="restaurant-mobile-card-header admin-order-mobile-card-header">
                    <span className="restaurant-mobile-avatar">
                      <ClipboardList size={18} />
                    </span>
                    <div className="restaurant-mobile-primary">
                      <strong id={`admin-order-${order.id}`} title={order.orderNumber}>{order.orderNumber}</strong>
                      <span title={`${getOrderScope(order)} - ${order.items.length} item${order.items.length === 1 ? '' : 's'}`}>
                        {getOrderScope(order)} - {order.items.length} item{order.items.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="admin-order-card-toggle"
                      aria-label={`${isExpanded ? 'Collapse' : 'Expand'} details for ${order.orderNumber}`}
                      aria-expanded={isExpanded}
                      onClick={() => toggleOrderExpansion(order)}
                    >
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </Button>
                  </header>

                  <div className="admin-order-mobile-status-row">
                    <div>
                      <OrderStatusBadge status={order.status} />
                      <PaymentStatusBadge status={order.paymentStatus} />
                    </div>
                    <strong>{formatMoney(order.totalAmount, order.currency)}</strong>
                  </div>

                  <div className="restaurant-mobile-meta-grid admin-order-mobile-meta-grid">
                    <div className="restaurant-mobile-meta">
                      <Building2 size={15} />
                      <div>
                        <span>Restaurant</span>
                        <strong title={order.restaurantName || undefined}>{order.restaurantName || 'Unknown restaurant'}</strong>
                        <small title={getOrderTypeLabel(order.orderType)}>{getOrderTypeLabel(order.orderType)}</small>
                      </div>
                    </div>
                    <div className="restaurant-mobile-meta">
                      <UserRound size={15} />
                      <div>
                        <span>Customer</span>
                        <strong title={customerLabel}>{customerLabel}</strong>
                        <small title={order.customerEmail || order.customerId || undefined}>{order.customerEmail || order.customerId || 'No customer account'}</small>
                      </div>
                    </div>
                    <div className="restaurant-mobile-meta">
                      <CreditCard size={15} />
                      <div>
                        <span>Payment</span>
                        <strong title={paymentAttemptLabel}>{paymentAttemptLabel}</strong>
                        <small title={order.latestPayment?.providerCheckoutSessionId || undefined}>
                          {order.latestPayment ? getPaymentStatusLabel(order.latestPayment.status) : 'No payment yet'}
                        </small>
                      </div>
                    </div>
                    <div className="restaurant-mobile-meta">
                      <CalendarClock size={15} />
                      <div>
                        <span>Created</span>
                        <strong>{formatDate(order.createdAt)}</strong>
                      </div>
                    </div>
                  </div>

                  {canManageWorkflow && (
                    <div className="restaurant-mobile-actions admin-order-mobile-actions">
                      {renderOrderActions(order)}
                    </div>
                  )}

                  {isExpanded && (
                    <div className="admin-order-mobile-detail">
                      {renderOrderDetailPanel(order, { className: 'admin-order-mobile-detail-panel' })}
                    </div>
                  )}
                </article>
              )
            })}
            {filteredOrders.length === 0 && (
              <div className="restaurant-mobile-empty">
                {initialLoading
                  ? 'Loading real orders...'
                  : hasActiveFilters
                    ? 'No orders match the current filters.'
                    : 'No orders found.'}
              </div>
            )}
          </div>
          <div className="pagination-bar compact-pagination admin-orders-pagination">
            <span className="pagination-range">
              <span className="pagination-full">Showing {pageStart}-{pageEnd} of {totalItems}</span>
              <span className="pagination-compact">{pageStart}-{pageEnd} / {totalItems}</span>
            </span>
            <div className="pagination-actions">
              <Select
                value={String(pageSize)}
                onValueChange={(value) => updateOrderParams({
                  page: null,
                  pageSize: Number(value) === 20 ? null : value,
                })}
              >
                <SelectTrigger className="page-size-select" aria-label="Orders per page">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {adminOrderPageSizes.map((size) => <SelectItem key={size} value={String(size)}>{size} / page</SelectItem>)}
                </SelectContent>
              </Select>
              <span className="pagination-page">
                <span className="pagination-full">Page {currentPage} of {totalPages}</span>
                <span className="pagination-compact">{currentPage} / {totalPages}</span>
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => updateOrderParams({ page: page - 1 <= 1 ? null : String(page - 1) })}
                disabled={isFetching || page <= 1}
                aria-label="Previous page"
              >
                <ChevronLeft size={16} />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => updateOrderParams({ page: String(Math.min(totalPages, page + 1)) })}
                disabled={isFetching || page >= totalPages}
                aria-label="Next page"
              >
                <ChevronRight size={16} />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={pendingConfirmation !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingConfirmation(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingConfirmation?.kind === 'counter-payment'
                ? 'Record counter payment?'
                : pendingConfirmation
                  ? `${transitionLabels[pendingConfirmation.action]} this order?`
                  : 'Confirm order action'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingConfirmation?.kind === 'counter-payment'
                ? `${pendingConfirmation.order.orderNumber} will be marked paid for ${formatMoney(
                    pendingConfirmation.order.totalAmount,
                    pendingConfirmation.order.currency,
                  )}. Confirm that payment was received at the counter.`
                : pendingConfirmation
                  ? pendingConfirmation.order.status === 'Pending' && pendingConfirmation.action === 'MarkReady'
                    ? `${pendingConfirmation.order.orderNumber} will move directly from Pending to Ready, skipping acceptance and preparation.`
                    : `${pendingConfirmation.order.orderNumber} will be marked Completed. This remains visible in the status history.`
                  : 'Review this order action before continuing.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current state</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const confirmation = pendingConfirmation
                setPendingConfirmation(null)
                if (confirmation?.kind === 'counter-payment') {
                  void handleCounterPayment(confirmation.order)
                } else if (confirmation) {
                  void submitTransition(confirmation.order, confirmation.action)
                }
              }}
            >
              {pendingConfirmation?.kind === 'counter-payment' ? 'Confirm payment' : 'Confirm change'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <OrderRefundDialog
        order={pendingRefundOrder}
        reason={refundReason}
        mode={refundMode}
        amount={refundAmount}
        submitting={refundingOrderId !== null}
        onReasonChange={setRefundReason}
        onModeChange={setRefundMode}
        onAmountChange={setRefundAmount}
        onOpenChange={(open) => {
          if (!open && refundingOrderId === null) {
            setPendingRefundOrder(null)
            setRefundReason('')
            setRefundMode('full')
            setRefundAmount('')
          }
        }}
        onConfirm={() => void submitRefund()}
      />

      <Dialog
        open={pendingTransition !== null}
        onOpenChange={(open) => {
          if (!open && transitioningOrderId === null) {
            setPendingTransition(null)
            setTransitionReason('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingTransition ? transitionLabels[pendingTransition.action] : 'Update order'}
            </DialogTitle>
            <DialogDescription>
              {pendingTransition
                ? `${pendingTransition.order.orderNumber}: add a reason for this status change.`
                : 'Add a reason for this status change.'}
            </DialogDescription>
          </DialogHeader>
          {pendingTransition ? (
            <OrderTransitionReasonField
              key={`${pendingTransition.order.id}-${pendingTransition.action}`}
              action={pendingTransition.action}
              value={transitionReason}
              onChange={setTransitionReason}
            />
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={transitioningOrderId !== null}
              onClick={() => {
                setPendingTransition(null)
                setTransitionReason('')
              }}
            >
              Keep current status
            </Button>
            <Button
              type="button"
              variant={pendingTransition?.action === 'Reject' || pendingTransition?.action === 'Cancel' ? 'destructive' : 'default'}
              disabled={!transitionReason.trim() || transitioningOrderId !== null || pendingTransition === null}
              onClick={() => {
                if (pendingTransition) {
                  void submitTransition(
                    pendingTransition.order,
                    pendingTransition.action,
                    transitionReason.trim(),
                  )
                }
              }}
            >
              {transitioningOrderId ? 'Updating' : 'Confirm change'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
