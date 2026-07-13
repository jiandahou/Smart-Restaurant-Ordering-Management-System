import { Fragment, type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  RefreshCw,
  ReceiptText,
  Search,
  SlidersHorizontal,
  Undo2,
  UserRound,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  getAdminOrderStatusHistory,
  getAdminOrders,
  recordCounterPayment,
  refundAdminOrder,
  transitionAdminOrder,
  type AdminOrder,
  type AdminOrderStatusHistory,
  type OrderTransitionAction,
} from '../api/auth'
import { useAuth } from '../auth/AuthContext'
import { OrderStatusBadge, getOrderStatusLabel, orderStatusOptions } from '../components/orders/OrderStatusBadge'
import { OrderItemOptionBadges } from '../components/orders/OrderItemOptionBadges'
import { OrderRefundDialog } from '../components/orders/OrderRefundDialog'
import { OrderStatusHistoryList } from '../components/orders/OrderStatusHistoryList'
import { OrderTransitionReasonField } from '../components/orders/OrderTransitionReasonField'
import { PaymentRefundHistory } from '../components/orders/PaymentRefundHistory'
import { PaymentStatusBadge, getPaymentStatusLabel, paymentStatusOptions } from '../components/orders/PaymentStatusBadge'
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
import { getOrderStats } from '../lib/orderStats'
import { canRefundOrder } from '../lib/paymentRefunds'

type SortKey =
  | 'createdAt'
  | 'orderNumber'
  | 'restaurantName'
  | 'status'
  | 'paymentStatus'
  | 'totalAmount'

const orderTypeLabels: Record<string, string> = {
  DineIn: 'Dine in',
  Takeaway: 'Takeaway',
  Scheduled: 'Scheduled',
}

const orderTypeOptions = ['DineIn', 'Takeaway', 'Scheduled']

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
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: (currencyCode || 'AUD').toUpperCase(),
  }).format(amount)
}

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat(undefined, {
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

export function AdminOrdersPage() {
  const { user } = useAuth()
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [settlingOrderId, setSettlingOrderId] = useState<string | null>(null)
  const [refundingOrderId, setRefundingOrderId] = useState<string | null>(null)
  const [transitioningOrderId, setTransitioningOrderId] = useState<string | null>(null)
  const [pendingTransition, setPendingTransition] = useState<{
    order: AdminOrder
    action: OrderTransitionAction
  } | null>(null)
  const [transitionReason, setTransitionReason] = useState('')
  const [pendingRefundOrder, setPendingRefundOrder] = useState<AdminOrder | null>(null)
  const [refundReason, setRefundReason] = useState('')
  const [statusHistoryByOrderId, setStatusHistoryByOrderId] = useState<Record<string, AdminOrderStatusHistory[]>>({})
  const [statusHistoryLoadingId, setStatusHistoryLoadingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [paymentFilter, setPaymentFilter] = useState('all')
  const [orderTypeFilter, setOrderTypeFilter] = useState('all')
  const [restaurantFilter, setRestaurantFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [totalItems, setTotalItems] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({
    key: 'createdAt',
    direction: 'desc',
  })
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null)
  const tableWrapRef = useRef<HTMLDivElement | null>(null)
  const [tableViewportWidth, setTableViewportWidth] = useState<number | null>(null)
  const canManageWorkflow = user?.roles.some((role) =>
    ['PlatformOwner', 'RestaurantOwner', 'Admin', 'Staff'].includes(role),
  ) ?? false
  const isPlatformOwner = user?.roles.includes('PlatformOwner') ?? false

  const restaurantOptions = useMemo(() => {
    return Array.from(
      new Map(
        orders.map((order) => [
          order.restaurantId || order.restaurantName || 'unknown',
          {
            value: order.restaurantId || order.restaurantName || 'unknown',
            label: order.restaurantName || 'Unknown restaurant',
          },
        ]),
      ).values(),
    ).sort((first, second) => first.label.localeCompare(second.label))
  }, [orders])

  const filteredOrders = orders

  const totals = useMemo(() => {
    return getOrderStats(filteredOrders)
  }, [filteredOrders])
  const pageStart = totalItems === 0 ? 0 : (page - 1) * pageSize + 1
  const pageEnd = Math.min(page * pageSize, totalItems)
  const currentPage = totalPages === 0 ? 0 : page
  const selectedStatusFilterLabel = statusFilter === 'all' ? '' : getOrderStatusLabel(statusFilter)
  const selectedPaymentFilterLabel = paymentFilter === 'all' ? '' : getPaymentStatusLabel(paymentFilter)
  const selectedOrderTypeFilterLabel = orderTypeFilter === 'all' ? '' : getOrderTypeLabel(orderTypeFilter)
  const selectedRestaurantFilterLabel = restaurantOptions.find((restaurant) => restaurant.value === restaurantFilter)?.label ?? restaurantFilter
  const activeDropdownFilterCount = [
    statusFilter !== 'all',
    paymentFilter !== 'all',
    orderTypeFilter !== 'all',
  ].filter(Boolean).length

  const hasActiveFilters =
    search.trim() !== ''
    || statusFilter !== 'all'
    || paymentFilter !== 'all'
    || orderTypeFilter !== 'all'
    || (isPlatformOwner && restaurantFilter !== 'all')

  const loadOrders = useCallback(async (showToast = false) => {
    setLoading(true)
    try {
      const response = await getAdminOrders({
        page,
        pageSize,
        search: search.trim() || undefined,
        sortBy: sort.key,
        sortDirection: sort.direction,
        status: statusFilter === 'all' ? undefined : statusFilter,
        paymentStatus: paymentFilter === 'all' ? undefined : paymentFilter,
        orderType: orderTypeFilter === 'all' ? undefined : orderTypeFilter,
        restaurantId: isPlatformOwner && restaurantFilter !== 'all' ? restaurantFilter : undefined,
      })
      setOrders(response.items)
      setTotalItems(response.totalItems)
      setTotalPages(response.totalPages)
      if (showToast) {
        toast.success('Orders refreshed')
      }
    } catch (error) {
      toast.error('Could not load orders', {
        description: error instanceof Error ? error.message : 'Order loading failed',
      })
    } finally {
      setLoading(false)
    }
  }, [isPlatformOwner, orderTypeFilter, page, pageSize, paymentFilter, restaurantFilter, search, sort, statusFilter])

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
      })
      setOrders((current) => current.map((item) => item.id === updatedOrder.id ? updatedOrder : item))
      toast.success('Refund created', {
        description: `${pendingRefundOrder.orderNumber} is now ${updatedOrder.paymentStatus}.`,
      })
      setPendingRefundOrder(null)
      setRefundReason('')
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

    void submitTransition(order, action)
  }

  useEffect(() => {
    void Promise.resolve().then(() => loadOrders())
  }, [loadOrders])

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

  const updateSort = (key: SortKey) => {
    setPage(1)
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  const resetFilters = () => {
    setPage(1)
    setSearch('')
    setStatusFilter('all')
    setPaymentFilter('all')
    setOrderTypeFilter('all')
    setRestaurantFilter('all')
    setSort({
      key: 'createdAt',
      direction: 'desc',
    })
    setExpandedOrderId(null)
  }

  const renderOrderActions = (order: AdminOrder) => {
    const refundable = canRefundOrder(order)
    const busy = settlingOrderId !== null || transitioningOrderId !== null || refundingOrderId !== null

    return (
      <div className="admin-order-actions">
        {order.paymentMethod === 'PayAtCounter' && order.paymentStatus !== 'Paid' ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation()
              void handleCounterPayment(order)
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
            onClick={(event) => {
              event.stopPropagation()
              setRefundReason('')
              setPendingRefundOrder(order)
            }}
          >
            <Undo2 size={15} />
            {refundingOrderId === order.id ? 'Refunding' : 'Refund'}
          </Button>
        ) : null}
        {(order.availableActions ?? []).map((action) => (
          <Button
            key={action}
            type="button"
            variant={action === 'Reject' || action === 'Cancel' ? 'destructive' : 'secondary'}
            size="sm"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation()
              handleTransition(order, action)
            }}
          >
            {transitioningOrderId === order.id ? 'Updating' : transitionLabels[action]}
          </Button>
        ))}
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
      <Card>
        <CardHeader>
          <div className="section-header">
            <div className="admin-page-title">
              <ClipboardList size={22} />
              <div>
                <CardTitle>Order Management</CardTitle>
                <CardDescription>Live orders and payment state from the real order backend.</CardDescription>
              </div>
            </div>
            <Button type="button" variant="secondary" onClick={() => loadOrders(true)} disabled={loading}>
              <RefreshCw size={18} />
              {loading ? 'Refreshing' : 'Refresh'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="directory-stack">
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
                <span className="order-summary-label-full">Kitchen active this page</span>
                <span className="order-summary-label-short">Kitchen</span>
              </strong>
              <span>{totals.activeKitchen}</span>
            </div>
            <div className="placeholder-item">
              <strong>
                <span className="order-summary-label-full">Paid this page</span>
                <span className="order-summary-label-short">Paid</span>
              </strong>
              <span>{totals.paid}</span>
            </div>
            <div className="placeholder-item">
              <strong>
                <span className="order-summary-label-full">Awaiting payment this page</span>
                <span className="order-summary-label-short">Awaiting</span>
              </strong>
              <span>{totals.pendingPayment}</span>
            </div>
          </div>

          <div className="directory-tools admin-orders-tools restaurant-filter-tools">
            {isPlatformOwner && (
              <div className="admin-orders-restaurant-row restaurant-table-selector-row">
                <Select value={restaurantFilter} onValueChange={(value) => { setPage(1); setRestaurantFilter(value) }}>
                  <SelectTrigger className="filter-select">
                    <SelectValue placeholder="All restaurants" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="all">All restaurants</SelectItem>
                    {restaurantOptions.map((restaurant) => (
                      <SelectItem key={restaurant.value} value={restaurant.value}>
                        {restaurant.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="admin-orders-filter-row">
              <div className="restaurant-filter-search-row admin-orders-search-row">
                <div className="directory-search">
                  <Search size={16} />
                  <Input
                    value={search}
                    onChange={(event) => { setPage(1); setSearch(event.target.value) }}
                    placeholder="Search order, customer, restaurant, table, or item"
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
                  <PopoverContent className="restaurant-filter-popover admin-orders-filter-popover" align="end">
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
                        <Select value={statusFilter} onValueChange={(value) => { setPage(1); setStatusFilter(value) }}>
                          <SelectTrigger className="filter-select">
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
                        <Select value={paymentFilter} onValueChange={(value) => { setPage(1); setPaymentFilter(value) }}>
                          <SelectTrigger className="filter-select">
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
                        <Select value={orderTypeFilter} onValueChange={(value) => { setPage(1); setOrderTypeFilter(value) }}>
                          <SelectTrigger className="filter-select">
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
                <Select value={statusFilter} onValueChange={(value) => { setPage(1); setStatusFilter(value) }}>
                  <SelectTrigger className="filter-select">
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

                <Select value={paymentFilter} onValueChange={(value) => { setPage(1); setPaymentFilter(value) }}>
                  <SelectTrigger className="filter-select">
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

                <Select value={orderTypeFilter} onValueChange={(value) => { setPage(1); setOrderTypeFilter(value) }}>
                  <SelectTrigger className="filter-select">
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
                {search.trim() && (
                  <button type="button" className="restaurant-filter-chip" onClick={() => { setPage(1); setSearch('') }} title={`Search: ${search.trim()}`}>
                    <span>Search: {search.trim()}</span>
                    <X size={13} />
                  </button>
                )}
                {isPlatformOwner && restaurantFilter !== 'all' && (
                  <button type="button" className="restaurant-filter-chip" onClick={() => { setPage(1); setRestaurantFilter('all') }} title={`Restaurant: ${selectedRestaurantFilterLabel}`}>
                    <span>Restaurant: {selectedRestaurantFilterLabel}</span>
                    <X size={13} />
                  </button>
                )}
                {statusFilter !== 'all' && (
                  <button type="button" className="restaurant-filter-chip" onClick={() => { setPage(1); setStatusFilter('all') }} title={`Status: ${selectedStatusFilterLabel}`}>
                    <span>Status: {selectedStatusFilterLabel}</span>
                    <X size={13} />
                  </button>
                )}
                {paymentFilter !== 'all' && (
                  <button type="button" className="restaurant-filter-chip" onClick={() => { setPage(1); setPaymentFilter('all') }} title={`Payment: ${selectedPaymentFilterLabel}`}>
                    <span>Payment: {selectedPaymentFilterLabel}</span>
                    <X size={13} />
                  </button>
                )}
                {orderTypeFilter !== 'all' && (
                  <button type="button" className="restaurant-filter-chip" onClick={() => { setPage(1); setOrderTypeFilter('all') }} title={`Type: ${selectedOrderTypeFilterLabel}`}>
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
              <table className="data-table payment-orders-table">
                <thead>
                  <tr>
                    <th>
                      <SortHeader
                        active={sort.key === 'orderNumber'}
                        direction={sort.direction}
                        label="Order"
                        onClick={() => updateSort('orderNumber')}
                      />
                    </th>
                    <th>
                      <SortHeader
                        active={sort.key === 'restaurantName'}
                        direction={sort.direction}
                        label="Restaurant"
                        onClick={() => updateSort('restaurantName')}
                      />
                    </th>
                    <th>
                      <SortHeader
                        active={sort.key === 'status'}
                        direction={sort.direction}
                        label="Order status"
                        onClick={() => updateSort('status')}
                      />
                    </th>
                    <th>
                      <SortHeader
                        active={sort.key === 'paymentStatus'}
                        direction={sort.direction}
                        label="Payment"
                        onClick={() => updateSort('paymentStatus')}
                      />
                    </th>
                    <th>
                      <SortHeader
                        active={sort.key === 'totalAmount'}
                        direction={sort.direction}
                        label="Amount"
                        onClick={() => updateSort('totalAmount')}
                      />
                    </th>
                    <th>Customer</th>
                    <th>Latest payment</th>
                    <th>
                      <SortHeader
                        active={sort.key === 'createdAt'}
                        direction={sort.direction}
                        label="Created"
                        onClick={() => updateSort('createdAt')}
                      />
                    </th>
                    {canManageWorkflow && <th>Actions</th>}
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
                                aria-label={isExpanded ? 'Collapse order details' : 'Expand order details'}
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
                            <span className="table-subtext">{order.restaurantId || 'No restaurant id'}</span>
                          </td>
                          <td>
                            <OrderStatusBadge status={order.status} />
                            <span className="table-subtext">{getOrderTypeLabel(order.orderType)}</span>
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
                          </td>
                          <td>
                            <strong>{formatMoney(order.totalAmount, order.currency)}</strong>
                          </td>
                          <td>
                            <strong>{order.customerName || order.customerEmail || 'Guest / unknown'}</strong>
                            <span className="table-subtext">{order.customerEmail || order.customerId || 'No customer account'}</span>
                          </td>
                          <td>
                            <strong>
                              {order.latestPayment
                                ? getPaymentStatusLabel(order.latestPayment.status)
                                : 'No payment yet'}
                            </strong>
                            <span className="table-subtext">
                              {order.latestPayment?.providerCheckoutSessionId || 'No checkout session yet'}
                            </span>
                          </td>
                          <td>{formatDate(order.createdAt)}</td>
                          {canManageWorkflow && (
                            <td>
                              {renderOrderActions(order)}
                            </td>
                          )}
                        </tr>
                        {isExpanded && (
                          <tr className="order-detail-row">
                            <td colSpan={canManageWorkflow ? 9 : 8}>
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
                      <td colSpan={canManageWorkflow ? 9 : 8} className="empty-cell">
                        {loading
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
                <article className="restaurant-mobile-card admin-order-mobile-card" key={order.id}>
                  <header className="restaurant-mobile-card-header admin-order-mobile-card-header">
                    <span className="restaurant-mobile-avatar">
                      <ClipboardList size={18} />
                    </span>
                    <div className="restaurant-mobile-primary">
                      <strong title={order.orderNumber}>{order.orderNumber}</strong>
                      <span title={`${getOrderScope(order)} - ${order.items.length} item${order.items.length === 1 ? '' : 's'}`}>
                        {getOrderScope(order)} - {order.items.length} item{order.items.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="admin-order-card-toggle"
                      aria-label={isExpanded ? 'Collapse order details' : 'Expand order details'}
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
                {loading
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
              <Select value={String(pageSize)} onValueChange={(value) => { setPage(1); setPageSize(Number(value)) }}>
                <SelectTrigger className="page-size-select" aria-label="Orders per page">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {[10, 20, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{size} / page</SelectItem>)}
                </SelectContent>
              </Select>
              <span className="pagination-page">
                <span className="pagination-full">Page {currentPage} of {totalPages}</span>
                <span className="pagination-compact">{currentPage} / {totalPages}</span>
              </span>
              <Button type="button" variant="outline" size="icon" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={loading || page <= 1} aria-label="Previous page"><ChevronLeft size={16} /></Button>
              <Button type="button" variant="outline" size="icon" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={loading || page >= totalPages} aria-label="Next page"><ChevronRight size={16} /></Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <OrderRefundDialog
        order={pendingRefundOrder}
        reason={refundReason}
        submitting={refundingOrderId !== null}
        onReasonChange={setRefundReason}
        onOpenChange={(open) => {
          if (!open && refundingOrderId === null) {
            setPendingRefundOrder(null)
            setRefundReason('')
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
