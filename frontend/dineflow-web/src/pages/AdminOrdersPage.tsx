import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  CreditCard,
  RefreshCw,
  ReceiptText,
  Search,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  getAdminOrders,
  recordCounterPayment,
  transitionAdminOrder,
  type AdminOrder,
  type OrderTransitionAction,
} from '../api/auth'
import { useAuth } from '../auth/AuthContext'
import { OrderStatusBadge, getOrderStatusLabel, orderStatusOptions } from '../components/orders/OrderStatusBadge'
import { OrderTransitionReasonField } from '../components/orders/OrderTransitionReasonField'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import { getOrderStats } from '../lib/orderStats'

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
  const [transitioningOrderId, setTransitioningOrderId] = useState<string | null>(null)
  const [pendingTransition, setPendingTransition] = useState<{
    order: AdminOrder
    action: OrderTransitionAction
  } | null>(null)
  const [transitionReason, setTransitionReason] = useState('')
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

  const hasActiveFilters =
    search.trim() !== ''
    || statusFilter !== 'all'
    || paymentFilter !== 'all'
    || orderTypeFilter !== 'all'
    || restaurantFilter !== 'all'

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
        restaurantId: restaurantFilter === 'all' ? undefined : restaurantFilter,
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
  }, [orderTypeFilter, page, pageSize, paymentFilter, restaurantFilter, search, sort, statusFilter])

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

  const submitTransition = async (
    order: AdminOrder,
    action: OrderTransitionAction,
    reason?: string,
  ) => {
    setTransitioningOrderId(order.id)
    try {
      const updatedOrder = await transitionAdminOrder(order.id, action, reason)
      setOrders((current) => current.map((item) => item.id === updatedOrder.id ? updatedOrder : item))
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
              <strong>Matching orders</strong>
              <span>{totalItems}</span>
            </div>
            <div className="placeholder-item">
              <strong>Kitchen active this page</strong>
              <span>{totals.activeKitchen}</span>
            </div>
            <div className="placeholder-item">
              <strong>Paid this page</strong>
              <span>{totals.paid}</span>
            </div>
            <div className="placeholder-item">
              <strong>Awaiting payment this page</strong>
              <span>{totals.pendingPayment}</span>
            </div>
          </div>

          <div className="directory-tools admin-orders-tools">
            <div className="directory-search">
              <Search size={16} />
              <Input
                value={search}
                onChange={(event) => { setPage(1); setSearch(event.target.value) }}
                placeholder="Search order, customer, restaurant, table, or item"
              />
            </div>

            <Select value={statusFilter} onValueChange={(value) => { setPage(1); setStatusFilter(value) }}>
              <SelectTrigger className="filter-select">
                <SelectValue placeholder="All order status" />
              </SelectTrigger>
              <SelectContent>
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
              <SelectContent>
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
              <SelectContent>
                <SelectItem value="all">All order types</SelectItem>
                {orderTypeOptions.map((orderType) => (
                  <SelectItem key={orderType} value={orderType}>
                    {getOrderTypeLabel(orderType)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={restaurantFilter} onValueChange={(value) => { setPage(1); setRestaurantFilter(value) }}>
              <SelectTrigger className="filter-select">
                <SelectValue placeholder="All restaurants" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All restaurants</SelectItem>
                {restaurantOptions.map((restaurant) => (
                  <SelectItem key={restaurant.value} value={restaurant.value}>
                    {restaurant.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button type="button" variant="ghost" size="icon" onClick={resetFilters} disabled={!hasActiveFilters}>
              <X size={18} />
            </Button>
          </div>

          <div className="table-wrap" ref={tableWrapRef}>
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
                        onClick={() => setExpandedOrderId((current) => (current === order.id ? null : order.id))}
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
                                setExpandedOrderId((current) => (current === order.id ? null : order.id))
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
                            <div className="flex min-w-36 flex-wrap gap-1.5">
                              {order.paymentMethod === 'PayAtCounter' && order.paymentStatus !== 'Paid' ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={settlingOrderId !== null || transitioningOrderId !== null}
                                  onClick={() => void handleCounterPayment(order)}
                                >
                                  {settlingOrderId === order.id ? 'Recording' : 'Mark paid'}
                                </Button>
                              ) : null}
                              {(order.availableActions ?? []).map((action) => (
                                <Button
                                  key={action}
                                  type="button"
                                  variant={action === 'Reject' || action === 'Cancel' ? 'destructive' : 'secondary'}
                                  size="sm"
                                  disabled={transitioningOrderId !== null || settlingOrderId !== null}
                                  onClick={() => handleTransition(order, action)}
                                >
                                  {transitioningOrderId === order.id ? 'Updating' : transitionLabels[action]}
                                </Button>
                              ))}
                              {(order.availableActions ?? []).length === 0 &&
                              !(order.paymentMethod === 'PayAtCounter' && order.paymentStatus !== 'Paid') ? (
                              <Badge variant={order.canProcess ? 'secondary' : 'outline'}>
                                {order.status === 'Completed' ? 'Completed' : order.canProcess ? 'No action' : 'Awaiting payment'}
                              </Badge>
                              ) : null}
                            </div>
                          </td>
                        )}
                      </tr>
                      {isExpanded && (
                        <tr className="order-detail-row">
                          <td colSpan={canManageWorkflow ? 9 : 8}>
                            <div
                              className="order-detail-panel"
                              style={tableViewportWidth ? { width: `${tableViewportWidth}px` } : undefined}
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
                                      <div>
                                        <strong>{item.itemNameSnapshot || 'Menu item'}</strong>
                                        <span>
                                          {item.quantity} x {formatMoney(item.unitPrice, order.currency)}
                                        </span>
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
                            </div>
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
          </div>
          <div className="pagination-bar">
            <span>{pageStart}-{pageEnd} of {totalItems}</span>
            <div className="pagination-actions">
              <Select value={String(pageSize)} onValueChange={(value) => { setPage(1); setPageSize(Number(value)) }}>
                <SelectTrigger className="page-size-select" aria-label="Orders per page">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 20, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{size} per page</SelectItem>)}
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" size="sm" onClick={() => setPage((current) => current - 1)} disabled={loading || page <= 1}>Previous</Button>
              <span>Page {totalPages === 0 ? 0 : page} of {totalPages}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => setPage((current) => current + 1)} disabled={loading || page >= totalPages}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>

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
