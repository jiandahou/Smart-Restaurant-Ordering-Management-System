import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { OrderStatusBadge, getOrderStatusLabel, orderStatusOptions } from '../components/orders/OrderStatusBadge'
import { PaymentStatusBadge, getPaymentStatusLabel, paymentStatusOptions } from '../components/orders/PaymentStatusBadge'
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
import { getOrderStats, isOrderPayable } from '../lib/orderStats'

type SortKey =
  | 'createdAt'
  | 'orderNumber'
  | 'restaurantName'
  | 'paymentStatus'
  | 'status'
  | 'totalAmount'

const orderTypeLabels: Record<string, string> = {
  DineIn: 'Dine in',
  Takeaway: 'Takeaway',
  Scheduled: 'Scheduled',
}

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

function getOrderTypeLabel(orderType: string) {
  return orderTypeLabels[orderType] ?? orderType
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
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [totalItems, setTotalItems] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
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

  const filteredOrders = orders

  const totals = useMemo(() => {
    return getOrderStats(filteredOrders)
  }, [filteredOrders])
  const pageStart = totalItems === 0 ? 0 : (page - 1) * pageSize + 1
  const pageEnd = Math.min(page * pageSize, totalItems)

  const hasActiveFilters =
    search.trim() !== ''
    || paymentFilter !== 'all'
    || orderStatusFilter !== 'all'
    || orderTypeFilter !== 'all'
    || restaurantFilter !== 'all'
    || payableOnly !== 'yes'

  const loadOrders = useCallback(async (showToast = false) => {
    setLoading(true)

    try {
      const response = await getAdminOrders({
        page,
        pageSize,
        search: search.trim() || undefined,
        sortBy: sort.key,
        sortDirection: sort.direction,
        status: orderStatusFilter === 'all' ? undefined : orderStatusFilter,
        paymentStatus: paymentFilter === 'all' ? undefined : paymentFilter,
        orderType: orderTypeFilter === 'all' ? undefined : orderTypeFilter,
        restaurantId: restaurantFilter === 'all' ? undefined : restaurantFilter,
        payableOnly: payableOnly === 'yes' ? true : undefined,
      })
      setOrders(response.items)
      setTotalItems(response.totalItems)
      setTotalPages(response.totalPages)

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
  }, [orderStatusFilter, orderTypeFilter, page, pageSize, payableOnly, paymentFilter, restaurantFilter, search, sort])

  useEffect(() => {
    void Promise.resolve().then(() => loadOrders())
  }, [loadOrders])

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
              <span>{totalItems}</span>
            </div>
            <div className="placeholder-item">
              <strong>Ready to pay this page</strong>
              <span>{totals.payable}</span>
            </div>
            <div className="placeholder-item">
              <strong>Paid this page</strong>
              <span>{totals.paid}</span>
            </div>
            <div className="placeholder-item">
              <strong>Failed this page</strong>
              <span>{totals.failedPayment}</span>
            </div>
          </div>

          <div className="directory-tools admin-payments-tools">
            <div className="directory-search">
              <Search size={16} />
              <Input
                value={search}
                onChange={(event) => { setPage(1); setSearch(event.target.value) }}
                placeholder="Search order, customer, restaurant, table, or payment ids"
              />
            </div>

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

            <Select value={orderStatusFilter} onValueChange={(value) => { setPage(1); setOrderStatusFilter(value) }}>
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

            <Select value={payableOnly} onValueChange={(value) => { setPage(1); setPayableOnly(value) }}>
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
          <div className="pagination-bar">
            <span>{pageStart}-{pageEnd} of {totalItems}</span>
            <div className="pagination-actions">
              <Select value={String(pageSize)} onValueChange={(value) => { setPage(1); setPageSize(Number(value)) }}>
                <SelectTrigger className="page-size-select" aria-label="Payment orders per page">
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
    </main>
  )
}
