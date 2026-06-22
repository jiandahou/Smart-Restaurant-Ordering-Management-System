import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
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
import { getAdminOrders, type AdminOrder } from '../api/auth'
import { useAuth } from '../auth/AuthContext'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
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

const badgeVariantByPaymentStatus: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  Paid: 'default',
  Pending: 'secondary',
  Failed: 'destructive',
  Cancelled: 'outline',
  Expired: 'outline',
  Refunded: 'outline',
  PartiallyRefunded: 'outline',
  NotRequired: 'outline',
}

const badgeVariantByOrderStatus: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  Completed: 'default',
  Ready: 'default',
  Preparing: 'secondary',
  Accepted: 'secondary',
  Pending: 'outline',
  Cancelled: 'destructive',
  Rejected: 'destructive',
}

const orderStatusLabels: Record<string, string> = {
  Pending: 'Pending',
  Accepted: 'Accepted',
  Preparing: 'Preparing',
  Ready: 'Ready',
  Completed: 'Completed',
  Cancelled: 'Cancelled',
  Rejected: 'Rejected',
}

const paymentStatusLabels: Record<string, string> = {
  Pending: 'Pending',
  Paid: 'Paid',
  Failed: 'Failed',
  Cancelled: 'Cancelled',
  Expired: 'Expired',
  Refunded: 'Refunded',
  PartiallyRefunded: 'Partially refunded',
  NotRequired: 'Not required',
}

const orderTypeLabels: Record<string, string> = {
  DineIn: 'Dine in',
  Takeaway: 'Takeaway',
  Scheduled: 'Scheduled',
}

const orderStatusOptions = [
  'Pending',
  'Accepted',
  'Preparing',
  'Ready',
  'Completed',
  'Cancelled',
  'Rejected',
]

const paymentStatusOptions = [
  'Pending',
  'Paid',
  'Failed',
  'Cancelled',
  'Expired',
  'Refunded',
  'PartiallyRefunded',
  'NotRequired',
]

const orderTypeOptions = ['DineIn', 'Takeaway', 'Scheduled']

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

function getPaymentBadgeVariant(status: string) {
  return badgeVariantByPaymentStatus[status] ?? 'secondary'
}

function getOrderBadgeVariant(status: string) {
  return badgeVariantByOrderStatus[status] ?? 'secondary'
}

function getOrderStatusLabel(status: string) {
  return orderStatusLabels[status] ?? status
}

function getPaymentStatusLabel(status: string) {
  return paymentStatusLabels[status] ?? status
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

function getSearchValues(order: AdminOrder) {
  return [
    order.orderNumber,
    order.restaurantName,
    order.restaurantId,
    order.tableNumber,
    order.customerName,
    order.customerEmail,
    order.customerId,
    order.status,
    getOrderStatusLabel(order.status),
    order.paymentStatus,
    getPaymentStatusLabel(order.paymentStatus),
    order.orderType,
    getOrderTypeLabel(order.orderType),
    order.items.map((item) => item.itemNameSnapshot).join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
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
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [paymentFilter, setPaymentFilter] = useState('all')
  const [orderTypeFilter, setOrderTypeFilter] = useState('all')
  const [restaurantFilter, setRestaurantFilter] = useState('all')
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({
    key: 'createdAt',
    direction: 'desc',
  })
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null)
  const tableWrapRef = useRef<HTMLDivElement | null>(null)
  const [tableViewportWidth, setTableViewportWidth] = useState<number | null>(null)
  const isStaff = Boolean(user?.roles.includes('Staff'))
    && !user?.roles.some((role) => ['PlatformOwner', 'RestaurantOwner', 'Admin'].includes(role))

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

  const filteredOrders = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()

    return orders
      .filter((order) => {
        if (!normalizedSearch) {
          return true
        }

        return getSearchValues(order).includes(normalizedSearch)
      })
      .filter((order) => (statusFilter === 'all' ? true : order.status === statusFilter))
      .filter((order) => (paymentFilter === 'all' ? true : order.paymentStatus === paymentFilter))
      .filter((order) => (orderTypeFilter === 'all' ? true : order.orderType === orderTypeFilter))
      .filter((order) => {
        if (restaurantFilter === 'all') {
          return true
        }

        return (order.restaurantId || order.restaurantName || 'unknown') === restaurantFilter
      })
      .toSorted((first, second) => {
        const direction = sort.direction === 'asc' ? 1 : -1

        switch (sort.key) {
          case 'orderNumber':
            return first.orderNumber.localeCompare(second.orderNumber) * direction
          case 'restaurantName':
            return (first.restaurantName || '').localeCompare(second.restaurantName || '') * direction
          case 'status':
            return getOrderStatusLabel(first.status).localeCompare(getOrderStatusLabel(second.status)) * direction
          case 'paymentStatus':
            return (
              getPaymentStatusLabel(first.paymentStatus).localeCompare(getPaymentStatusLabel(second.paymentStatus))
              * direction
            )
          case 'totalAmount':
            return (first.totalAmount - second.totalAmount) * direction
          case 'createdAt':
          default:
            return (
              (new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime())
              * direction
            )
        }
      })
  }, [orders, orderTypeFilter, paymentFilter, restaurantFilter, search, sort, statusFilter])

  const totals = useMemo(() => {
    return getOrderStats(filteredOrders)
  }, [filteredOrders])

  const hasActiveFilters =
    search.trim() !== ''
    || statusFilter !== 'all'
    || paymentFilter !== 'all'
    || orderTypeFilter !== 'all'
    || restaurantFilter !== 'all'

  const loadOrders = async (showToast = false) => {
    setLoading(true)
    try {
      setOrders(await getAdminOrders())
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
  }

  useEffect(() => {
    void Promise.resolve().then(() => loadOrders())
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

  const updateSort = (key: SortKey) => {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  const resetFilters = () => {
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
              <strong>Total orders</strong>
              <span>{totals.total}</span>
            </div>
            <div className="placeholder-item">
              <strong>Kitchen active</strong>
              <span>{totals.activeKitchen}</span>
            </div>
            <div className="placeholder-item">
              <strong>Paid</strong>
              <span>{totals.paid}</span>
            </div>
            <div className="placeholder-item">
              <strong>Awaiting payment</strong>
              <span>{totals.pendingPayment}</span>
            </div>
          </div>

          <div className="directory-tools admin-orders-tools">
            <div className="directory-search">
              <Search size={16} />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search order, customer, restaurant, table, or item"
              />
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
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

            <Select value={paymentFilter} onValueChange={setPaymentFilter}>
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

            <Select value={orderTypeFilter} onValueChange={setOrderTypeFilter}>
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

            <Select value={restaurantFilter} onValueChange={setRestaurantFilter}>
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
                  {isStaff && <th>Action</th>}
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
                          <Badge variant={getOrderBadgeVariant(order.status)}>{getOrderStatusLabel(order.status)}</Badge>
                          <span className="table-subtext">{getOrderTypeLabel(order.orderType)}</span>
                        </td>
                        <td>
                          <Badge variant={getPaymentBadgeVariant(order.paymentStatus)}>
                            {getPaymentStatusLabel(order.paymentStatus)}
                          </Badge>
                          <span className="table-subtext">
                            {order.paymentAttempts > 0
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
                        {isStaff && (
                          <td>
                            <Button type="button" variant="outline" size="sm" disabled>
                              Process soon
                            </Button>
                          </td>
                        )}
                      </tr>
                      {isExpanded && (
                        <tr className="order-detail-row">
                          <td colSpan={isStaff ? 9 : 8}>
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
                    <td colSpan={isStaff ? 9 : 8} className="empty-cell">
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
        </CardContent>
      </Card>
    </main>
  )
}
