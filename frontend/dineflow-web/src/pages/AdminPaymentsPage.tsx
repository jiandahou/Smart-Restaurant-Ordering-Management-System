import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CreditCard,
  ExternalLink,
  ReceiptText,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  createOrderCheckoutSession,
  getAdminOrders,
  type AdminOrder,
} from '../api/auth'
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

type SortKey =
  | 'createdAt'
  | 'orderNumber'
  | 'restaurantName'
  | 'paymentStatus'
  | 'status'
  | 'totalAmount'

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

const orderStatusLabels: Record<string, string> = {
  Pending: 'Pending',
  Accepted: 'Accepted',
  Preparing: 'Preparing',
  Ready: 'Ready',
  Completed: 'Completed',
  Cancelled: 'Cancelled',
  Rejected: 'Rejected',
}

const orderTypeLabels: Record<string, string> = {
  DineIn: 'Dine in',
  Takeaway: 'Takeaway',
  Scheduled: 'Scheduled',
}

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

const orderStatusOptions = [
  'Pending',
  'Accepted',
  'Preparing',
  'Ready',
  'Completed',
  'Cancelled',
  'Rejected',
]

const orderTypeOptions = ['DineIn', 'Takeaway', 'Scheduled']

function formatMoney(amount: number, currencyCode?: string | null) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: (currencyCode || 'AUD').toUpperCase(),
  }).format(amount)
}

function formatDate(value: string | null) {
  if (!value) {
    return 'Not yet'
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function getPaymentStatusLabel(status: string) {
  return paymentStatusLabels[status] ?? status
}

function getOrderStatusLabel(status: string) {
  return orderStatusLabels[status] ?? status
}

function getOrderTypeLabel(orderType: string) {
  return orderTypeLabels[orderType] ?? orderType
}

function getPaymentBadgeVariant(status: string) {
  return badgeVariantByPaymentStatus[status] ?? 'secondary'
}

function getOrderBadgeVariant(status: string) {
  return badgeVariantByOrderStatus[status] ?? 'secondary'
}

function isOrderPayable(order: AdminOrder) {
  if (order.paymentStatus === 'Paid') {
    return false
  }

  return !['Cancelled', 'Rejected'].includes(order.status)
}

function getSearchValues(order: AdminOrder) {
  return [
    order.orderNumber,
    order.restaurantName,
    order.restaurantId,
    order.tableNumber,
    order.customerName,
    order.customerEmail,
    order.status,
    getOrderStatusLabel(order.status),
    order.paymentStatus,
    getPaymentStatusLabel(order.paymentStatus),
    order.orderType,
    getOrderTypeLabel(order.orderType),
    order.latestPayment?.providerCheckoutSessionId,
    order.latestPayment?.providerPaymentIntentId,
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

export function AdminPaymentsPage() {
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [submittingOrderId, setSubmittingOrderId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('all')
  const [orderStatusFilter, setOrderStatusFilter] = useState('all')
  const [orderTypeFilter, setOrderTypeFilter] = useState('all')
  const [restaurantFilter, setRestaurantFilter] = useState('all')
  const [payableOnly, setPayableOnly] = useState('yes')
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({
    key: 'createdAt',
    direction: 'desc',
  })

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
      .filter((order) => (paymentFilter === 'all' ? true : order.paymentStatus === paymentFilter))
      .filter((order) => (orderStatusFilter === 'all' ? true : order.status === orderStatusFilter))
      .filter((order) => (orderTypeFilter === 'all' ? true : order.orderType === orderTypeFilter))
      .filter((order) => {
        if (restaurantFilter === 'all') {
          return true
        }

        return (order.restaurantId || order.restaurantName || 'unknown') === restaurantFilter
      })
      .filter((order) => (payableOnly === 'yes' ? isOrderPayable(order) : true))
      .toSorted((first, second) => {
        const direction = sort.direction === 'asc' ? 1 : -1

        switch (sort.key) {
          case 'orderNumber':
            return first.orderNumber.localeCompare(second.orderNumber) * direction
          case 'restaurantName':
            return (first.restaurantName || '').localeCompare(second.restaurantName || '') * direction
          case 'paymentStatus':
            return getPaymentStatusLabel(first.paymentStatus).localeCompare(getPaymentStatusLabel(second.paymentStatus)) * direction
          case 'status':
            return getOrderStatusLabel(first.status).localeCompare(getOrderStatusLabel(second.status)) * direction
          case 'totalAmount':
            return (first.totalAmount - second.totalAmount) * direction
          case 'createdAt':
          default:
            return (new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime()) * direction
        }
      })
  }, [orders, orderStatusFilter, orderTypeFilter, payableOnly, paymentFilter, restaurantFilter, search, sort])

  const totals = useMemo(() => {
    return {
      count: filteredOrders.length,
      payable: filteredOrders.filter(isOrderPayable).length,
      paid: filteredOrders.filter((order) => order.paymentStatus === 'Paid').length,
      failed: filteredOrders.filter((order) => order.paymentStatus === 'Failed').length,
    }
  }, [filteredOrders])

  const hasActiveFilters =
    search.trim() !== ''
    || paymentFilter !== 'all'
    || orderStatusFilter !== 'all'
    || orderTypeFilter !== 'all'
    || restaurantFilter !== 'all'
    || payableOnly !== 'yes'

  const loadOrders = async (showToast = false) => {
    setLoading(true)

    try {
      setOrders(await getAdminOrders())

      if (showToast) {
        toast.success('Payments refreshed')
      }
    } catch (error) {
      toast.error('Could not load payment records', {
        description: error instanceof Error ? error.message : 'Order loading failed',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadOrders()
  }, [])

  const updateSort = (key: SortKey) => {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  const resetFilters = () => {
    setSearch('')
    setPaymentFilter('all')
    setOrderStatusFilter('all')
    setOrderTypeFilter('all')
    setRestaurantFilter('all')
    setPayableOnly('yes')
    setSort({
      key: 'createdAt',
      direction: 'desc',
    })
  }

  const handleCheckout = async (order: AdminOrder) => {
    setSubmittingOrderId(order.id)

    try {
      const response = await createOrderCheckoutSession({
        orderId: order.id,
      })

      toast.success('Checkout session created', {
        description: `${order.orderNumber} is ready in Stripe Checkout.`,
      })

      window.location.assign(response.checkoutUrl)
    } catch (error) {
      toast.error('Could not create checkout session', {
        description: error instanceof Error ? error.message : 'Stripe checkout failed',
      })
    } finally {
      setSubmittingOrderId(null)
    }
  }

  return (
    <main className="content-grid">
      <Card>
        <CardHeader>
          <div className="section-header">
            <div className="admin-page-title">
              <CreditCard size={22} />
              <div>
                <CardTitle>Payments</CardTitle>
                <CardDescription>
                  Review real order payment state and open Stripe Checkout only for eligible orders.
                </CardDescription>
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => loadOrders(true)}
              disabled={loading || submittingOrderId !== null}
            >
              <RefreshCw size={18} />
              {loading ? 'Refreshing' : 'Refresh'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="directory-stack">
          <div className="placeholder-grid order-summary-grid">
            <div className="placeholder-item">
              <strong>Visible orders</strong>
              <span>{totals.count}</span>
            </div>
            <div className="placeholder-item">
              <strong>Ready to pay</strong>
              <span>{totals.payable}</span>
            </div>
            <div className="placeholder-item">
              <strong>Paid</strong>
              <span>{totals.paid}</span>
            </div>
            <div className="placeholder-item">
              <strong>Failed</strong>
              <span>{totals.failed}</span>
            </div>
          </div>

          <div className="directory-tools admin-payments-tools">
            <div className="directory-search">
              <Search size={16} />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search order, customer, restaurant, table, or payment ids"
              />
            </div>

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

            <Select value={orderStatusFilter} onValueChange={setOrderStatusFilter}>
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

            <Select value={payableOnly} onValueChange={setPayableOnly}>
              <SelectTrigger className="filter-select">
                <SelectValue placeholder="Payable only" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">Payable only</SelectItem>
                <SelectItem value="no">All orders</SelectItem>
              </SelectContent>
            </Select>

            <Button type="button" variant="ghost" size="icon" onClick={resetFilters} disabled={!hasActiveFilters}>
              <X size={18} />
            </Button>
          </div>

          <div className="payment-test-note">
            <ReceiptText size={20} />
            <div>
              <strong>This page now works from real orders, not a one-off payment test picker.</strong>
              <span>
                Stripe checkout can only be launched for orders that are not paid and are not cancelled or rejected.
                If Stripe returns a 400, the toast now includes the backend detail so we can see the actual checkout
                failure reason.
              </span>
            </div>
          </div>

          <div className="table-wrap">
            <table className="data-table payment-orders-table admin-payments-table">
              <colgroup>
                <col className="payment-col-order" />
                <col className="payment-col-restaurant" />
                <col className="payment-col-status" />
                <col className="payment-col-payment" />
                <col className="payment-col-amount" />
                <col className="payment-col-latest" />
                <col className="payment-col-created" />
                <col className="payment-col-action" />
              </colgroup>
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
                  <th>Latest payment</th>
                  <th>
                    <SortHeader
                      active={sort.key === 'createdAt'}
                      direction={sort.direction}
                      label="Created"
                      onClick={() => updateSort('createdAt')}
                    />
                  </th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => {
                  const payable = isOrderPayable(order)
                  const submitting = submittingOrderId === order.id

                  return (
                    <tr key={order.id}>
                      <td>
                        <span className="table-name">
                          <ReceiptText size={16} />
                          {order.orderNumber}
                        </span>
                        <span className="table-subtext">
                          {order.tableNumber ? `Table ${order.tableNumber}` : getOrderTypeLabel(order.orderType)}
                        </span>
                      </td>
                      <td>
                        <strong>{order.restaurantName || 'Unknown restaurant'}</strong>
                        <span className="table-subtext">{order.customerName || order.customerEmail || 'Guest / unknown'}</span>
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
                      <td className="payment-action-cell">
                        {payable ? (
                          <Button
                            type="button"
                            size="sm"
                            className="payment-checkout-button"
                            onClick={() => handleCheckout(order)}
                            disabled={loading || submittingOrderId !== null}
                          >
                            <ExternalLink size={16} />
                            {submitting ? 'Opening' : 'Checkout'}
                          </Button>
                        ) : (
                          <span className="muted-action">
                            {order.paymentStatus === 'Paid' ? 'Already paid' : 'Not payable'}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {filteredOrders.length === 0 && (
                  <tr>
                    <td colSpan={8} className="empty-cell">
                      {loading
                        ? 'Loading payment records...'
                        : hasActiveFilters
                          ? 'No orders match the current payment filters.'
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
