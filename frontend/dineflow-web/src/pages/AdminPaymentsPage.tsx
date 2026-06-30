import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CreditCard,
  ExternalLink,
  ReceiptText,
  RefreshCw,
  Search,
  Undo2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  createOrderCheckoutSession,
  approveAdminRefundRequest,
  getAdminRefunds,
  getAdminRefundRequests,
  getAdminRefundSummary,
  getAdminOrders,
  rejectAdminRefundRequest,
  refundAdminOrder,
  type AdminOrder,
  type AdminRefund,
  type AdminRefundRequest,
  type AdminRefundRequestStatus,
  type AdminRefundSummary,
} from '../api/auth'
import { OrderItemOptionBadges } from '../components/orders/OrderItemOptionBadges'
import { OrderRefundDialog } from '../components/orders/OrderRefundDialog'
import { OrderStatusBadge, getOrderStatusLabel, orderStatusOptions } from '../components/orders/OrderStatusBadge'
import { PaymentRefundHistory } from '../components/orders/PaymentRefundHistory'
import { PaymentStatusBadge, getPaymentStatusLabel, paymentStatusOptions } from '../components/orders/PaymentStatusBadge'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import { Textarea } from '../components/ui/textarea'
import { HorizontalTableScroll } from '../components/HorizontalTableScroll'
import { getOrderStats, isOrderPayable } from '../lib/orderStats'
import { canRefundOrder } from '../lib/paymentRefunds'

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
const refundStatusOptions = ['Pending', 'Succeeded', 'Failed'] as const
const refundRequestStatusOptions = ['Pending', 'Approved', 'Rejected', 'Cancelled'] as const
const refundStatusClasses: Partial<Record<typeof refundStatusOptions[number], string>> = {
  Succeeded: 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
}
const refundRequestStatusClasses: Partial<Record<AdminRefundRequestStatus, string>> = {
  Approved: 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  Rejected: 'border-red-300 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200',
}

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

function formatCurrencyBreakdown(
  amounts: AdminRefundSummary['amountsByCurrency'],
  key: 'pendingAmountCents' | 'succeededAmountCents' | 'failedAmountCents',
) {
  const visibleAmounts = amounts.filter((item) => item[key] > 0)

  if (visibleAmounts.length === 0) {
    return 'None'
  }

  return visibleAmounts
    .map((item) => formatMoney(item[key] / 100, item.currency))
    .join(' · ')
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
  const [refundSummary, setRefundSummary] = useState<AdminRefundSummary>({
    total: 0,
    pending: 0,
    succeeded: 0,
    failed: 0,
    amountsByCurrency: [],
  })
  const [refunds, setRefunds] = useState<AdminRefund[]>([])
  const [refundRequests, setRefundRequests] = useState<AdminRefundRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [refundSummaryLoading, setRefundSummaryLoading] = useState(true)
  const [refundsLoading, setRefundsLoading] = useState(true)
  const [refundRequestsLoading, setRefundRequestsLoading] = useState(true)
  const [submittingOrderId, setSubmittingOrderId] = useState<string | null>(null)
  const [refundingOrderId, setRefundingOrderId] = useState<string | null>(null)
  const [reviewingRefundRequestId, setReviewingRefundRequestId] = useState<string | null>(null)
  const [pendingRefundOrder, setPendingRefundOrder] = useState<AdminOrder | null>(null)
  const [rejectingRefundRequest, setRejectingRefundRequest] = useState<AdminRefundRequest | null>(null)
  const [refundReason, setRefundReason] = useState('')
  const [refundRequestRejectNote, setRefundRequestRejectNote] = useState('')
  const [search, setSearch] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('all')
  const [orderStatusFilter, setOrderStatusFilter] = useState('all')
  const [orderTypeFilter, setOrderTypeFilter] = useState('all')
  const [restaurantFilter, setRestaurantFilter] = useState('all')
  const [payableOnly, setPayableOnly] = useState('yes')
  const [refundStatusFilter, setRefundStatusFilter] = useState<'all' | typeof refundStatusOptions[number]>('all')
  const [refundRequestStatusFilter, setRefundRequestStatusFilter] = useState<'all' | AdminRefundRequestStatus>('Pending')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [totalItems, setTotalItems] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [refundPage, setRefundPage] = useState(1)
  const [refundPageSize, setRefundPageSize] = useState(10)
  const [refundTotalItems, setRefundTotalItems] = useState(0)
  const [refundTotalPages, setRefundTotalPages] = useState(0)
  const [refundRequestPage, setRefundRequestPage] = useState(1)
  const [refundRequestPageSize, setRefundRequestPageSize] = useState(10)
  const [refundRequestTotalItems, setRefundRequestTotalItems] = useState(0)
  const [refundRequestTotalPages, setRefundRequestTotalPages] = useState(0)
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null)
  const tableWrapRef = useRef<HTMLDivElement | null>(null)
  const [tableViewportWidth, setTableViewportWidth] = useState<number | null>(null)
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
  const refundPageStart = refundTotalItems === 0 ? 0 : (refundPage - 1) * refundPageSize + 1
  const refundPageEnd = Math.min(refundPage * refundPageSize, refundTotalItems)
  const refundRequestPageStart = refundRequestTotalItems === 0 ? 0 : (refundRequestPage - 1) * refundRequestPageSize + 1
  const refundRequestPageEnd = Math.min(refundRequestPage * refundRequestPageSize, refundRequestTotalItems)

  const hasActiveFilters =
    search.trim() !== ''
    || paymentFilter !== 'all'
    || orderStatusFilter !== 'all'
    || orderTypeFilter !== 'all'
    || restaurantFilter !== 'all'
    || payableOnly !== 'yes'
    || refundStatusFilter !== 'all'
    || refundRequestStatusFilter !== 'Pending'

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

  const loadRefundSummary = useCallback(async (showToast = false) => {
    setRefundSummaryLoading(true)

    try {
      const summary = await getAdminRefundSummary({
        restaurantId: restaurantFilter === 'all' ? undefined : restaurantFilter,
        search: search.trim() || undefined,
      })
      setRefundSummary(summary)

      if (showToast) {
        toast.success('Refund summary refreshed')
      }
    } catch (error) {
      toast.error('Could not load refund summary', {
        description: error instanceof Error ? error.message : 'Refund summary loading failed',
      })
    } finally {
      setRefundSummaryLoading(false)
    }
  }, [restaurantFilter, search])

  const loadRefunds = useCallback(async (showToast = false) => {
    setRefundsLoading(true)

    try {
      const response = await getAdminRefunds({
        page: refundPage,
        pageSize: refundPageSize,
        search: search.trim() || undefined,
        restaurantId: restaurantFilter === 'all' ? undefined : restaurantFilter,
        status: refundStatusFilter === 'all' ? undefined : refundStatusFilter,
        sortBy: 'createdAt',
        sortDirection: 'desc',
      })
      setRefunds(response.items)
      setRefundTotalItems(response.totalItems)
      setRefundTotalPages(response.totalPages)

      if (showToast) {
        toast.success('Refund records refreshed')
      }
    } catch (error) {
      toast.error('Could not load refund records', {
        description: error instanceof Error ? error.message : 'Refund records loading failed',
      })
    } finally {
      setRefundsLoading(false)
    }
  }, [refundPage, refundPageSize, refundStatusFilter, restaurantFilter, search])

  const loadRefundRequests = useCallback(async (showToast = false) => {
    setRefundRequestsLoading(true)

    try {
      const response = await getAdminRefundRequests({
        page: refundRequestPage,
        pageSize: refundRequestPageSize,
        search: search.trim() || undefined,
        restaurantId: restaurantFilter === 'all' ? undefined : restaurantFilter,
        status: refundRequestStatusFilter === 'all' ? undefined : refundRequestStatusFilter,
        sortBy: 'createdAt',
        sortDirection: 'desc',
      })
      setRefundRequests(response.items)
      setRefundRequestTotalItems(response.totalItems)
      setRefundRequestTotalPages(response.totalPages)

      if (showToast) {
        toast.success('Refund requests refreshed')
      }
    } catch (error) {
      toast.error('Could not load refund requests', {
        description: error instanceof Error ? error.message : 'Refund request loading failed',
      })
    } finally {
      setRefundRequestsLoading(false)
    }
  }, [refundRequestPage, refundRequestPageSize, refundRequestStatusFilter, restaurantFilter, search])

  useEffect(() => {
    void Promise.resolve().then(() => loadOrders())
  }, [loadOrders])

  useEffect(() => {
    void Promise.resolve().then(() => loadRefundSummary())
  }, [loadRefundSummary])

  useEffect(() => {
    void Promise.resolve().then(() => loadRefunds())
  }, [loadRefunds])

  useEffect(() => {
    void Promise.resolve().then(() => loadRefundRequests())
  }, [loadRefundRequests])

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
    setPaymentFilter('all')
    setOrderStatusFilter('all')
    setOrderTypeFilter('all')
    setRestaurantFilter('all')
    setPayableOnly('yes')
    setRefundStatusFilter('all')
    setRefundRequestStatusFilter('Pending')
    setRefundPage(1)
    setRefundRequestPage(1)
    setSort({
      key: 'createdAt',
      direction: 'desc',
    })
    setExpandedOrderId(null)
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
      await loadRefundSummary()
      await loadRefunds()
      toast.success('Refund created', {
        description: `${pendingRefundOrder.orderNumber} is now ${updatedOrder.paymentStatus}.`,
      })
      setPendingRefundOrder(null)
      setRefundReason('')
    } catch (error) {
      toast.error('Could not refund payment', {
        description: error instanceof Error ? error.message : 'Stripe refund failed',
      })
    } finally {
      setRefundingOrderId(null)
    }
  }

  const approveRefundRequest = async (refundRequest: AdminRefundRequest) => {
    setReviewingRefundRequestId(refundRequest.id)

    try {
      await approveAdminRefundRequest(refundRequest.id)
      await loadRefundRequests()
      await loadRefundSummary()
      await loadRefunds()
      await loadOrders()
      toast.success('Refund request approved', {
        description: `${refundRequest.orderNumber} has been sent to Stripe for refund.`,
      })
    } catch (error) {
      toast.error('Could not approve refund request', {
        description: error instanceof Error ? error.message : 'Refund approval failed.',
      })
    } finally {
      setReviewingRefundRequestId(null)
    }
  }

  const rejectRefundRequest = async () => {
    if (!rejectingRefundRequest) {
      return
    }

    setReviewingRefundRequestId(rejectingRefundRequest.id)

    try {
      await rejectAdminRefundRequest(rejectingRefundRequest.id, {
        note: refundRequestRejectNote.trim(),
      })
      await loadRefundRequests()
      toast.success('Refund request rejected', {
        description: `${rejectingRefundRequest.orderNumber} now shows the rejection reason to the customer.`,
      })
      setRejectingRefundRequest(null)
      setRefundRequestRejectNote('')
    } catch (error) {
      toast.error('Could not reject refund request', {
        description: error instanceof Error ? error.message : 'Refund rejection failed.',
      })
    } finally {
      setReviewingRefundRequestId(null)
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
              onClick={() => {
                void loadOrders(true)
                void loadRefundSummary(true)
                void loadRefunds(true)
                void loadRefundRequests(true)
              }}
              disabled={loading || refundRequestsLoading || submittingOrderId !== null || refundingOrderId !== null || reviewingRefundRequestId !== null}
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
                onChange={(event) => { setPage(1); setRefundPage(1); setRefundRequestPage(1); setSearch(event.target.value) }}
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

            <Select value={restaurantFilter} onValueChange={(value) => { setPage(1); setRefundPage(1); setRefundRequestPage(1); setRestaurantFilter(value) }}>
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

          <HorizontalTableScroll ref={tableWrapRef} topScrollLabel="Scroll payment orders table horizontally">
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
                  const refundable = canRefundOrder(order)
                  const submitting = submittingOrderId === order.id
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
                              aria-label={isExpanded ? 'Collapse order payment details' : 'Expand order payment details'}
                              onClick={(event) => {
                                event.stopPropagation()
                                setExpandedOrderId((current) => (current === order.id ? null : order.id))
                              }}
                            >
                              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </Button>
                            <ReceiptText size={16} />
                            {order.orderNumber}
                          </span>
                          <span className="table-subtext">
                            {order.tableNumber ? `Table ${order.tableNumber}` : getOrderTypeLabel(order.orderType)}
                            {' - '}
                            {order.items.length} item{order.items.length === 1 ? '' : 's'}
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
                              onClick={(event) => {
                                event.stopPropagation()
                                void handleCheckout(order)
                              }}
                              disabled={loading || submittingOrderId !== null || refundingOrderId !== null}
                            >
                              <ExternalLink size={16} />
                              {submitting ? 'Opening' : 'Checkout'}
                            </Button>
                          ) : refundable ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              onClick={(event) => {
                                event.stopPropagation()
                                setRefundReason('')
                                setPendingRefundOrder(order)
                              }}
                              disabled={loading || submittingOrderId !== null || refundingOrderId !== null}
                            >
                              <Undo2 size={16} />
                              {refundingOrderId === order.id ? 'Refunding' : 'Refund'}
                            </Button>
                          ) : (
                            <span className="muted-action">
                              {order.latestPayment?.hasPendingRefund
                                ? 'Refund pending'
                                : order.paymentStatus === 'Paid'
                                  ? 'Already paid'
                                  : 'Not payable'}
                            </span>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="order-detail-row">
                          <td colSpan={8}>
                            <div
                              className="order-detail-panel"
                              style={tableViewportWidth ? { width: `${tableViewportWidth}px` } : undefined}
                              aria-live="polite"
                            >
                              <section className="order-detail-section order-detail-section-wide">
                                <div className="order-detail-heading">
                                  <ReceiptText size={16} />
                                  <strong>Order items</strong>
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
                                  <strong>Payment context</strong>
                                </div>
                                <div className="order-payment-grid">
                                  <span>Status</span>
                                  <strong>{getPaymentStatusLabel(order.paymentStatus)}</strong>
                                  <span>Method</span>
                                  <strong>{order.paymentMethod === 'PayAtCounter' ? 'Pay at counter' : 'Online'}</strong>
                                  <span>Order amount</span>
                                  <strong>{formatMoney(order.totalAmount, order.currency)}</strong>
                                  <span>Refunded</span>
                                  <strong>
                                    {order.latestPayment
                                      ? formatMoney(order.latestPayment.refundedAmountCents / 100, order.latestPayment.currency)
                                      : formatMoney(0, order.currency)}
                                  </strong>
                                  <span>Refundable</span>
                                  <strong>
                                    {order.latestPayment
                                      ? formatMoney(order.latestPayment.refundableAmountCents / 100, order.latestPayment.currency)
                                      : formatMoney(0, order.currency)}
                                  </strong>
                                  <span>Latest session</span>
                                  <strong>{order.latestPayment?.providerCheckoutSessionId || 'No checkout session yet'}</strong>
                                  <span>Created</span>
                                  <strong>{formatDate(order.createdAt)}</strong>
                                </div>
                                <PaymentRefundHistory payment={order.latestPayment} fallbackCurrency={order.currency} />
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
          </HorizontalTableScroll>
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

          <section className="refund-records-section refund-requests-section">
            <div className="section-header">
              <div className="admin-page-title">
                <Undo2 size={22} />
                <div>
                  <h3>Refund requests</h3>
                  <p>Customer-submitted requests waiting for an admin decision.</p>
                </div>
              </div>
              <Select
                value={refundRequestStatusFilter}
                onValueChange={(value) => {
                  setRefundRequestPage(1)
                  setRefundRequestStatusFilter(value as typeof refundRequestStatusFilter)
                }}
              >
                <SelectTrigger className="filter-select">
                  <SelectValue placeholder="Request status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All request status</SelectItem>
                  {refundRequestStatusOptions.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <HorizontalTableScroll topScrollLabel="Scroll refund requests table horizontally">
              <table className="data-table payment-orders-table refund-records-table refund-requests-table">
                <thead>
                  <tr>
                    <th>Request</th>
                    <th>Order</th>
                    <th>Restaurant</th>
                    <th>Status</th>
                    <th>Amount</th>
                    <th>Reason</th>
                    <th>Updated</th>
                    <th>Review</th>
                  </tr>
                </thead>
                <tbody>
                  {refundRequests.map((refundRequest) => {
                    const isPendingRequest = refundRequest.status === 'Pending'
                    const isReviewing = reviewingRefundRequestId === refundRequest.id

                    return (
                      <tr key={refundRequest.id}>
                        <td>
                          <span className="table-name">
                            <Undo2 size={16} />
                            {refundRequest.id}
                          </span>
                          <span className="table-subtext">
                            {refundRequest.paymentRefundId ? `Refund ${refundRequest.paymentRefundId}` : 'No refund transaction yet'}
                          </span>
                        </td>
                        <td>
                          <strong>{refundRequest.orderNumber || 'Unknown order'}</strong>
                          <span className="table-subtext">
                            {refundRequest.customerName || refundRequest.customerEmail || 'Guest / unknown'}
                          </span>
                        </td>
                        <td>
                          <strong>{refundRequest.restaurantName || 'Unknown restaurant'}</strong>
                          <span className="table-subtext">{refundRequest.restaurantId || 'No restaurant id'}</span>
                        </td>
                        <td>
                          <Badge
                            variant={refundRequest.status === 'Rejected' ? 'destructive' : refundRequest.status === 'Approved' ? 'secondary' : 'outline'}
                            className={refundRequestStatusClasses[refundRequest.status]}
                          >
                            {refundRequest.status}
                          </Badge>
                        </td>
                        <td>
                          <strong>{formatMoney(refundRequest.requestedAmountCents / 100, refundRequest.currency)}</strong>
                        </td>
                        <td>
                          <strong>{refundRequest.reason || 'No customer reason'}</strong>
                          {refundRequest.adminNote && <span className="table-subtext">{refundRequest.adminNote}</span>}
                        </td>
                        <td>
                          {formatDate(refundRequest.reviewedAt || refundRequest.updatedAt || refundRequest.createdAt)}
                        </td>
                        <td>
                          {isPendingRequest ? (
                            <div className="refund-request-actions">
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => void approveRefundRequest(refundRequest)}
                                disabled={reviewingRefundRequestId !== null}
                              >
                                {isReviewing ? <RefreshCw className="animate-spin" /> : <CheckCircle2 />}
                                Approve
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                onClick={() => {
                                  setRefundRequestRejectNote('')
                                  setRejectingRefundRequest(refundRequest)
                                }}
                                disabled={reviewingRefundRequestId !== null}
                              >
                                <X size={16} />
                                Reject
                              </Button>
                            </div>
                          ) : (
                            <span className="muted-action">Reviewed</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {refundRequests.length === 0 && (
                    <tr>
                      <td colSpan={8} className="empty-cell">
                        {refundRequestsLoading
                          ? 'Loading refund requests...'
                          : 'No refund requests match the current filters.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </HorizontalTableScroll>

            <div className="pagination-bar">
              <span>{refundRequestPageStart}-{refundRequestPageEnd} of {refundRequestTotalItems}</span>
              <div className="pagination-actions">
                <Select value={String(refundRequestPageSize)} onValueChange={(value) => { setRefundRequestPage(1); setRefundRequestPageSize(Number(value)) }}>
                  <SelectTrigger className="page-size-select" aria-label="Refund requests per page">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 20, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{size} per page</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" size="sm" onClick={() => setRefundRequestPage((current) => current - 1)} disabled={refundRequestsLoading || refundRequestPage <= 1}>Previous</Button>
                <span>Page {refundRequestTotalPages === 0 ? 0 : refundRequestPage} of {refundRequestTotalPages}</span>
                <Button type="button" variant="outline" size="sm" onClick={() => setRefundRequestPage((current) => current + 1)} disabled={refundRequestsLoading || refundRequestPage >= refundRequestTotalPages}>Next</Button>
              </div>
            </div>
          </section>

          <section className="refund-records-section">
            <div className="section-header">
              <div className="admin-page-title">
                <Undo2 size={22} />
                <div>
                  <h3>Refund records</h3>
                  <p>Refunds from the refund table, linked back to orders and Stripe refund ids.</p>
                </div>
              </div>
              <Select
                value={refundStatusFilter}
                onValueChange={(value) => {
                  setRefundPage(1)
                  setRefundStatusFilter(value as typeof refundStatusFilter)
                }}
              >
                <SelectTrigger className="filter-select">
                  <SelectValue placeholder="All refund status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All refund status</SelectItem>
                  {refundStatusOptions.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="refund-summary-panel">
              <div className="refund-summary-title">
                <Undo2 size={20} />
                <div>
                  <strong>Refunds from refund table</strong>
                  <span>
                    {refundSummaryLoading
                      ? 'Loading refund records...'
                      : `${refundSummary.total} refund record${refundSummary.total === 1 ? '' : 's'} visible`}
                  </span>
                </div>
              </div>
              <div className="refund-summary-grid">
                <div className="refund-summary-item">
                  <span>Succeeded</span>
                  <strong>{refundSummary.succeeded}</strong>
                  <small>{formatCurrencyBreakdown(refundSummary.amountsByCurrency, 'succeededAmountCents')}</small>
                </div>
                <div className="refund-summary-item">
                  <span>Pending</span>
                  <strong>{refundSummary.pending}</strong>
                  <small>{formatCurrencyBreakdown(refundSummary.amountsByCurrency, 'pendingAmountCents')}</small>
                </div>
                <div className="refund-summary-item">
                  <span>Failed</span>
                  <strong>{refundSummary.failed}</strong>
                  <small>{formatCurrencyBreakdown(refundSummary.amountsByCurrency, 'failedAmountCents')}</small>
                </div>
              </div>
            </div>

            <HorizontalTableScroll topScrollLabel="Scroll refund records table horizontally">
              <table className="data-table payment-orders-table refund-records-table">
                <thead>
                  <tr>
                    <th>Refund</th>
                    <th>Order</th>
                    <th>Restaurant</th>
                    <th>Status</th>
                    <th>Amount</th>
                    <th>Reason</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {refunds.map((refund) => (
                    <tr key={refund.id}>
                      <td>
                        <span className="table-name">
                          <Undo2 size={16} />
                          {refund.providerRefundId || refund.id}
                        </span>
                        <span className="table-subtext">{refund.providerPaymentIntentId || 'No payment intent'}</span>
                      </td>
                      <td>
                        <strong>{refund.orderNumber || 'Unknown order'}</strong>
                        <span className="table-subtext">{refund.customerName || refund.customerEmail || 'Guest / unknown'}</span>
                      </td>
                      <td>
                        <strong>{refund.restaurantName || 'Unknown restaurant'}</strong>
                        <span className="table-subtext">{refund.restaurantId || 'No restaurant id'}</span>
                      </td>
                      <td>
                        <Badge
                          variant={refund.status === 'Failed' ? 'destructive' : refund.status === 'Succeeded' ? 'secondary' : 'outline'}
                          className={refundStatusClasses[refund.status]}
                        >
                          {refund.status}
                        </Badge>
                      </td>
                      <td>
                        <strong>{formatMoney(refund.amountCents / 100, refund.currency)}</strong>
                      </td>
                      <td>
                        <strong>{refund.reason || 'No reason recorded'}</strong>
                        {refund.failureReason && <span className="table-subtext text-destructive">{refund.failureReason}</span>}
                      </td>
                      <td>
                        {formatDate(refund.refundedAt || refund.failedAt || refund.updatedAt || refund.createdAt)}
                      </td>
                    </tr>
                  ))}
                  {refunds.length === 0 && (
                    <tr>
                      <td colSpan={7} className="empty-cell">
                        {refundsLoading
                          ? 'Loading refund records...'
                          : 'No refund records match the current filters.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </HorizontalTableScroll>

            <div className="pagination-bar">
              <span>{refundPageStart}-{refundPageEnd} of {refundTotalItems}</span>
              <div className="pagination-actions">
                <Select value={String(refundPageSize)} onValueChange={(value) => { setRefundPage(1); setRefundPageSize(Number(value)) }}>
                  <SelectTrigger className="page-size-select" aria-label="Refund records per page">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 20, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{size} per page</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" size="sm" onClick={() => setRefundPage((current) => current - 1)} disabled={refundsLoading || refundPage <= 1}>Previous</Button>
                <span>Page {refundTotalPages === 0 ? 0 : refundPage} of {refundTotalPages}</span>
                <Button type="button" variant="outline" size="sm" onClick={() => setRefundPage((current) => current + 1)} disabled={refundsLoading || refundPage >= refundTotalPages}>Next</Button>
              </div>
            </div>
          </section>
        </CardContent>
      </Card>

      <Dialog
        open={rejectingRefundRequest !== null}
        onOpenChange={(open) => {
          if (!open && reviewingRefundRequestId === null) {
            setRejectingRefundRequest(null)
            setRefundRequestRejectNote('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject refund request</DialogTitle>
            <DialogDescription>
              {rejectingRefundRequest
                ? `${rejectingRefundRequest.orderNumber}: explain why this refund request cannot be approved.`
                : 'Explain why this refund request cannot be approved.'}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={refundRequestRejectNote}
            onChange={(event) => setRefundRequestRejectNote(event.target.value)}
            placeholder="Reason shown to the customer"
            rows={4}
            maxLength={1000}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setRejectingRefundRequest(null)
                setRefundRequestRejectNote('')
              }}
              disabled={reviewingRefundRequestId !== null}
            >
              Keep pending
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void rejectRefundRequest()}
              disabled={reviewingRefundRequestId !== null || refundRequestRejectNote.trim() === ''}
            >
              {reviewingRefundRequestId !== null ? <RefreshCw className="animate-spin" /> : <X />}
              Reject request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
    </main>
  )
}
