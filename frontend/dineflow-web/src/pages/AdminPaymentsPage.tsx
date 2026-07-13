import { Fragment, type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  ExternalLink,
  ReceiptText,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Undo2,
  UserRound,
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
import { useAuth } from '../auth/AuthContext'
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
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
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

type PaymentTab = 'orders' | 'requests' | 'history'

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
  const { user } = useAuth()
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
  const [activeTab, setActiveTab] = useState<PaymentTab>('orders')
  const [paymentSummaryExpanded, setPaymentSummaryExpanded] = useState(false)
  const [refundSummaryExpanded, setRefundSummaryExpanded] = useState(false)
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null)
  const tableWrapRef = useRef<HTMLDivElement | null>(null)
  const [tableViewportWidth, setTableViewportWidth] = useState<number | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({
    key: 'createdAt',
    direction: 'desc',
  })
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
  const refundPageStart = refundTotalItems === 0 ? 0 : (refundPage - 1) * refundPageSize + 1
  const refundPageEnd = Math.min(refundPage * refundPageSize, refundTotalItems)
  const refundRequestPageStart = refundRequestTotalItems === 0 ? 0 : (refundRequestPage - 1) * refundRequestPageSize + 1
  const refundRequestPageEnd = Math.min(refundRequestPage * refundRequestPageSize, refundRequestTotalItems)
  const currentPage = totalPages === 0 ? 0 : page
  const currentRefundPage = refundTotalPages === 0 ? 0 : refundPage
  const currentRefundRequestPage = refundRequestTotalPages === 0 ? 0 : refundRequestPage
  const selectedRestaurantFilterLabel = restaurantOptions.find((restaurant) => restaurant.value === restaurantFilter)?.label ?? restaurantFilter
  const selectedPaymentFilterLabel = paymentFilter === 'all' ? '' : getPaymentStatusLabel(paymentFilter)
  const selectedOrderStatusFilterLabel = orderStatusFilter === 'all' ? '' : getOrderStatusLabel(orderStatusFilter)
  const selectedOrderTypeFilterLabel = orderTypeFilter === 'all' ? '' : getOrderTypeLabel(orderTypeFilter)
  const selectedPayableFilterLabel = payableOnly === 'yes' ? 'Payable only' : 'All orders'
  const activeDropdownFilterCount = activeTab === 'orders'
    ? [
        paymentFilter !== 'all',
        orderStatusFilter !== 'all',
        orderTypeFilter !== 'all',
        payableOnly !== 'yes',
      ].filter(Boolean).length
    : activeTab === 'requests'
      ? (refundRequestStatusFilter !== 'Pending' ? 1 : 0)
      : (refundStatusFilter !== 'all' ? 1 : 0)

  const hasActiveFilters =
    search.trim() !== ''
    || paymentFilter !== 'all'
    || orderStatusFilter !== 'all'
    || orderTypeFilter !== 'all'
    || (isPlatformOwner && restaurantFilter !== 'all')
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
        restaurantId: isPlatformOwner && restaurantFilter !== 'all' ? restaurantFilter : undefined,
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
  }, [isPlatformOwner, orderStatusFilter, orderTypeFilter, page, pageSize, payableOnly, paymentFilter, restaurantFilter, search, sort])

  const loadRefundSummary = useCallback(async (showToast = false) => {
    setRefundSummaryLoading(true)

    try {
      const summary = await getAdminRefundSummary({
        restaurantId: isPlatformOwner && restaurantFilter !== 'all' ? restaurantFilter : undefined,
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
  }, [isPlatformOwner, restaurantFilter, search])

  const loadRefunds = useCallback(async (showToast = false) => {
    setRefundsLoading(true)

    try {
      const response = await getAdminRefunds({
        page: refundPage,
        pageSize: refundPageSize,
        search: search.trim() || undefined,
        restaurantId: isPlatformOwner && restaurantFilter !== 'all' ? restaurantFilter : undefined,
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
  }, [isPlatformOwner, refundPage, refundPageSize, refundStatusFilter, restaurantFilter, search])

  const loadRefundRequests = useCallback(async (showToast = false) => {
    setRefundRequestsLoading(true)

    try {
      const response = await getAdminRefundRequests({
        page: refundRequestPage,
        pageSize: refundRequestPageSize,
        search: search.trim() || undefined,
        restaurantId: isPlatformOwner && restaurantFilter !== 'all' ? restaurantFilter : undefined,
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
  }, [isPlatformOwner, refundRequestPage, refundRequestPageSize, refundRequestStatusFilter, restaurantFilter, search])

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

  const toggleOrderExpansion = (orderId: string) => {
    setExpandedOrderId((current) => (current === orderId ? null : orderId))
  }

  const renderPaymentAction = (order: AdminOrder) => {
    const payable = isOrderPayable(order)
    const refundable = canRefundOrder(order)
    const submitting = submittingOrderId === order.id

    if (payable) {
      return (
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
      )
    }

    if (refundable) {
      return (
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
      )
    }

    return (
      <span className="muted-action">
        {order.latestPayment?.hasPendingRefund
          ? 'Refund pending'
          : order.paymentStatus === 'Paid'
            ? 'Already paid'
            : 'Not payable'}
      </span>
    )
  }

  const renderPaymentDetailPanel = (
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
  )

  const renderRefundRequestActions = (refundRequest: AdminRefundRequest) => {
    const isPendingRequest = refundRequest.status === 'Pending'
    const isReviewing = reviewingRefundRequestId === refundRequest.id

    if (!isPendingRequest) {
      return <span className="muted-action">Reviewed</span>
    }

    return (
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
    )
  }

  return (
    <main className="content-grid">
      <Card id="payment-orders">
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
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as PaymentTab)}
            className="admin-payments-tabs"
          >
            <TabsList className="admin-payments-tabs-list" aria-label="Payment views">
              <TabsTrigger value="orders">Payment orders</TabsTrigger>
              <TabsTrigger value="requests">Refund requests</TabsTrigger>
              <TabsTrigger value="history">Refund history</TabsTrigger>
            </TabsList>

            {activeTab === 'orders' && (
              <section className="admin-payments-summary-panel" aria-label="Payment order summary">
                <button
                  type="button"
                  className="admin-payments-summary-toggle"
                  aria-expanded={paymentSummaryExpanded}
                  onClick={() => setPaymentSummaryExpanded((current) => !current)}
                >
                  <span className="admin-payments-summary-title">
                    <ReceiptText size={16} />
                    Payment summary
                  </span>
                  <span className="admin-payments-summary-meta">
                    {totalItems} visible / {totals.payable} ready
                  </span>
                  {paymentSummaryExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>

                {paymentSummaryExpanded && (
                  <div className="placeholder-grid order-summary-grid admin-payments-summary-grid">
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
                )}
              </section>
            )}

          <div className="directory-tools admin-payments-tools restaurant-filter-tools">
            {isPlatformOwner && (
              <div className="admin-payments-restaurant-row restaurant-table-selector-row">
                <Select
                  value={restaurantFilter}
                  onValueChange={(value) => {
                    setPage(1)
                    setRefundPage(1)
                    setRefundRequestPage(1)
                    setRestaurantFilter(value)
                  }}
                >
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

            <div className="admin-payments-filter-row">
              <div className="restaurant-filter-search-row admin-payments-search-row">
                <div className="directory-search">
                  <Search size={16} />
                  <Input
                    value={search}
                    onChange={(event) => { setPage(1); setRefundPage(1); setRefundRequestPage(1); setSearch(event.target.value) }}
                    placeholder="Search order, customer, restaurant, table, or payment ids"
                  />
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="restaurant-filter-trigger"
                      aria-label="Filter payments"
                    >
                      <SlidersHorizontal size={16} />
                      {activeDropdownFilterCount > 0 && (
                        <span className="restaurant-filter-count">{activeDropdownFilterCount}</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="restaurant-filter-popover admin-payments-filter-popover" align="end">
                    <div className="restaurant-filter-popover-header">
                      <strong>Filters</strong>
                      <Button type="button" variant="ghost" size="xs" onClick={resetFilters} disabled={!hasActiveFilters}>
                        <X size={13} />
                        Clear all
                      </Button>
                    </div>
                    <div className="restaurant-filter-fields">
                      {activeTab === 'orders' && (
                        <>
                          <div className="restaurant-filter-field">
                            <span>Payment</span>
                            <Select value={paymentFilter} onValueChange={(value) => { setPage(1); setPaymentFilter(value) }}>
                              <SelectTrigger className="filter-select"><SelectValue placeholder="All payment status" /></SelectTrigger>
                              <SelectContent position="popper">
                                <SelectItem value="all">All payment status</SelectItem>
                                {paymentStatusOptions.map((status) => (
                                  <SelectItem key={status} value={status}>{getPaymentStatusLabel(status)}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="restaurant-filter-field">
                            <span>Order status</span>
                            <Select value={orderStatusFilter} onValueChange={(value) => { setPage(1); setOrderStatusFilter(value) }}>
                              <SelectTrigger className="filter-select"><SelectValue placeholder="All order status" /></SelectTrigger>
                              <SelectContent position="popper">
                                <SelectItem value="all">All order status</SelectItem>
                                {orderStatusOptions.map((status) => (
                                  <SelectItem key={status} value={status}>{getOrderStatusLabel(status)}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="restaurant-filter-field">
                            <span>Order type</span>
                            <Select value={orderTypeFilter} onValueChange={(value) => { setPage(1); setOrderTypeFilter(value) }}>
                              <SelectTrigger className="filter-select"><SelectValue placeholder="All order types" /></SelectTrigger>
                              <SelectContent position="popper">
                                <SelectItem value="all">All order types</SelectItem>
                                {orderTypeOptions.map((orderType) => (
                                  <SelectItem key={orderType} value={orderType}>{getOrderTypeLabel(orderType)}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="restaurant-filter-field">
                            <span>Payable</span>
                            <Select value={payableOnly} onValueChange={(value) => { setPage(1); setPayableOnly(value) }}>
                              <SelectTrigger className="filter-select"><SelectValue placeholder="Payable only" /></SelectTrigger>
                              <SelectContent position="popper">
                                <SelectItem value="yes">Payable only</SelectItem>
                                <SelectItem value="no">All orders</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </>
                      )}
                      {activeTab === 'requests' && (
                        <div className="restaurant-filter-field">
                          <span>Request status</span>
                          <Select value={refundRequestStatusFilter} onValueChange={(value) => { setRefundRequestPage(1); setRefundRequestStatusFilter(value as typeof refundRequestStatusFilter) }}>
                            <SelectTrigger className="filter-select"><SelectValue placeholder="Request status" /></SelectTrigger>
                            <SelectContent position="popper">
                              <SelectItem value="all">All request status</SelectItem>
                              {refundRequestStatusOptions.map((status) => (
                                <SelectItem key={status} value={status}>{status}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      {activeTab === 'history' && (
                        <div className="restaurant-filter-field">
                          <span>Refund status</span>
                          <Select value={refundStatusFilter} onValueChange={(value) => { setRefundPage(1); setRefundStatusFilter(value as typeof refundStatusFilter) }}>
                            <SelectTrigger className="filter-select"><SelectValue placeholder="All refund status" /></SelectTrigger>
                            <SelectContent position="popper">
                              <SelectItem value="all">All refund status</SelectItem>
                              {refundStatusOptions.map((status) => (
                                <SelectItem key={status} value={status}>{status}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {hasActiveFilters && (
              <div className="restaurant-filter-chips admin-payments-filter-chips" aria-label="Active payment filters">
                {search.trim() && (
                  <button type="button" className="restaurant-filter-chip" onClick={() => { setPage(1); setRefundPage(1); setRefundRequestPage(1); setSearch('') }} title={`Search: ${search.trim()}`}>
                    <span>Search: {search.trim()}</span>
                    <X size={13} />
                  </button>
                )}
                {isPlatformOwner && restaurantFilter !== 'all' && (
                  <button type="button" className="restaurant-filter-chip" onClick={() => { setPage(1); setRefundPage(1); setRefundRequestPage(1); setRestaurantFilter('all') }} title={`Restaurant: ${selectedRestaurantFilterLabel}`}>
                    <span>Restaurant: {selectedRestaurantFilterLabel}</span>
                    <X size={13} />
                  </button>
                )}
                {paymentFilter !== 'all' && (
                  <button type="button" className="restaurant-filter-chip" onClick={() => { setPage(1); setPaymentFilter('all') }} title={`Payment: ${selectedPaymentFilterLabel}`}>
                    <span>Payment: {selectedPaymentFilterLabel}</span>
                    <X size={13} />
                  </button>
                )}
                {orderStatusFilter !== 'all' && (
                  <button type="button" className="restaurant-filter-chip" onClick={() => { setPage(1); setOrderStatusFilter('all') }} title={`Order: ${selectedOrderStatusFilterLabel}`}>
                    <span>Order: {selectedOrderStatusFilterLabel}</span>
                    <X size={13} />
                  </button>
                )}
                {orderTypeFilter !== 'all' && (
                  <button type="button" className="restaurant-filter-chip" onClick={() => { setPage(1); setOrderTypeFilter('all') }} title={`Type: ${selectedOrderTypeFilterLabel}`}>
                    <span>Type: {selectedOrderTypeFilterLabel}</span>
                    <X size={13} />
                  </button>
                )}
                {payableOnly !== 'yes' && (
                  <button type="button" className="restaurant-filter-chip" onClick={() => { setPage(1); setPayableOnly('yes') }} title={`Payable: ${selectedPayableFilterLabel}`}>
                    <span>Payable: {selectedPayableFilterLabel}</span>
                    <X size={13} />
                  </button>
                )}
                {refundRequestStatusFilter !== 'Pending' && (
                  <button type="button" className="restaurant-filter-chip" onClick={() => { setRefundRequestPage(1); setRefundRequestStatusFilter('Pending') }} title={`Request: ${refundRequestStatusFilter}`}>
                    <span>Request: {refundRequestStatusFilter}</span>
                    <X size={13} />
                  </button>
                )}
                {refundStatusFilter !== 'all' && (
                  <button type="button" className="restaurant-filter-chip" onClick={() => { setRefundPage(1); setRefundStatusFilter('all') }} title={`Refund: ${refundStatusFilter}`}>
                    <span>Refund: {refundStatusFilter}</span>
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

            <TabsContent value="orders" className="payment-tab-content admin-payment-orders-tab">
              <div className="admin-payments-table-wrap">
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
                  const isExpanded = expandedOrderId === order.id

                  return (
                    <Fragment key={order.id}>
                      <tr
                        className="expandable-table-row"
                        aria-expanded={isExpanded}
                        onClick={() => toggleOrderExpansion(order.id)}
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
                                toggleOrderExpansion(order.id)
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
                          {renderPaymentAction(order)}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="order-detail-row">
                          <td colSpan={8}>
                            {renderPaymentDetailPanel(order, {
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
              </div>

              <div className="restaurant-mobile-list admin-payment-mobile-list" aria-label="Payment orders">
                {filteredOrders.map((order) => {
                  const isExpanded = expandedOrderId === order.id
                  const customerLabel = order.customerName || order.customerEmail || 'Guest / unknown'
                  const paymentAttemptLabel = order.paymentMethod === 'PayAtCounter'
                    ? 'Pay at counter'
                    : order.paymentAttempts > 0
                      ? `${order.paymentAttempts} payment attempt${order.paymentAttempts === 1 ? '' : 's'}`
                      : 'No payment attempts yet'
                  const latestPaymentLabel = order.latestPayment
                    ? getPaymentStatusLabel(order.latestPayment.status)
                    : 'No payment yet'

                  return (
                    <article className="restaurant-mobile-card admin-payment-mobile-card" key={order.id}>
                      <header className="restaurant-mobile-card-header admin-payment-mobile-card-header">
                        <span className="restaurant-mobile-avatar">
                          <ReceiptText size={18} />
                        </span>
                        <div className="restaurant-mobile-primary">
                          <strong title={order.orderNumber}>{order.orderNumber}</strong>
                          <span title={`${order.tableNumber ? `Table ${order.tableNumber}` : getOrderTypeLabel(order.orderType)} - ${order.items.length} item${order.items.length === 1 ? '' : 's'}`}>
                            {order.tableNumber ? `Table ${order.tableNumber}` : getOrderTypeLabel(order.orderType)}
                            {' - '}
                            {order.items.length} item{order.items.length === 1 ? '' : 's'}
                          </span>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="admin-payment-card-toggle"
                          aria-label={isExpanded ? 'Collapse payment details' : 'Expand payment details'}
                          aria-expanded={isExpanded}
                          onClick={() => toggleOrderExpansion(order.id)}
                        >
                          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </Button>
                      </header>

                      <div className="admin-payment-mobile-status-row">
                        <div>
                          <OrderStatusBadge status={order.status} />
                          <PaymentStatusBadge status={order.paymentStatus} />
                        </div>
                        <strong>{formatMoney(order.totalAmount, order.currency)}</strong>
                      </div>

                      <div className="restaurant-mobile-meta-grid admin-payment-mobile-meta-grid">
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
                            <small title={order.latestPayment?.providerCheckoutSessionId || undefined}>{latestPaymentLabel}</small>
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

                      <div className="restaurant-mobile-actions admin-payment-mobile-actions">
                        {renderPaymentAction(order)}
                      </div>

                      {isExpanded && (
                        <div className="admin-payment-mobile-detail">
                          {renderPaymentDetailPanel(order, { className: 'admin-payment-mobile-detail-panel' })}
                        </div>
                      )}
                    </article>
                  )
                })}
                {filteredOrders.length === 0 && (
                  <div className="restaurant-mobile-empty">
                    {loading
                      ? 'Loading payment records...'
                      : hasActiveFilters
                        ? 'No orders match the current payment filters.'
                        : 'No orders found.'}
                  </div>
                )}
              </div>

              <div className="pagination-bar compact-pagination admin-payments-pagination">
                <span className="pagination-range">
                  <span className="pagination-full">Showing {pageStart}-{pageEnd} of {totalItems}</span>
                  <span className="pagination-compact">{pageStart}-{pageEnd} / {totalItems}</span>
                </span>
                <div className="pagination-actions">
                  <Select value={String(pageSize)} onValueChange={(value) => { setPage(1); setPageSize(Number(value)) }}>
                    <SelectTrigger className="page-size-select" aria-label="Payment orders per page">
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
                  <Button type="button" variant="outline" size="icon" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={loading || page <= 1} aria-label="Previous payment orders page"><ChevronLeft size={16} /></Button>
                  <Button type="button" variant="outline" size="icon" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={loading || page >= totalPages} aria-label="Next payment orders page"><ChevronRight size={16} /></Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="requests" className="payment-tab-content refund-requests-tab">
              <section id="refund-requests" className="refund-records-section refund-requests-section">
                <div className="section-header">
                  <div className="admin-page-title">
                    <Undo2 size={22} />
                    <div>
                      <h3>Refund requests</h3>
                      <p>Customer-submitted requests waiting for an admin decision.</p>
                    </div>
                  </div>
                </div>

                <div className="refund-requests-table-wrap">
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
                        <td>{renderRefundRequestActions(refundRequest)}</td>
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
                </div>

                <div className="restaurant-mobile-list refund-request-mobile-list" aria-label="Refund requests">
                  {refundRequests.map((refundRequest) => {
                    const customerLabel = refundRequest.customerName || refundRequest.customerEmail || 'Guest / unknown'

                    return (
                      <article className="restaurant-mobile-card refund-mobile-card" key={refundRequest.id}>
                        <header className="restaurant-mobile-card-header refund-mobile-card-header">
                          <span className="restaurant-mobile-avatar">
                            <Undo2 size={18} />
                          </span>
                          <div className="restaurant-mobile-primary">
                            <strong title={refundRequest.id}>{refundRequest.orderNumber || refundRequest.id}</strong>
                            <span title={refundRequest.paymentRefundId || undefined}>
                              {refundRequest.paymentRefundId ? `Refund ${refundRequest.paymentRefundId}` : 'No refund transaction yet'}
                            </span>
                          </div>
                          <Badge
                            variant={refundRequest.status === 'Rejected' ? 'destructive' : refundRequest.status === 'Approved' ? 'secondary' : 'outline'}
                            className={refundRequestStatusClasses[refundRequest.status]}
                          >
                            {refundRequest.status}
                          </Badge>
                        </header>

                        <div className="refund-mobile-amount-row">
                          <span>Requested</span>
                          <strong>{formatMoney(refundRequest.requestedAmountCents / 100, refundRequest.currency)}</strong>
                        </div>

                        <div className="restaurant-mobile-meta-grid refund-mobile-meta-grid">
                          <div className="restaurant-mobile-meta">
                            <Building2 size={15} />
                            <div>
                              <span>Restaurant</span>
                              <strong title={refundRequest.restaurantName || undefined}>{refundRequest.restaurantName || 'Unknown restaurant'}</strong>
                            </div>
                          </div>
                          <div className="restaurant-mobile-meta">
                            <UserRound size={15} />
                            <div>
                              <span>Customer</span>
                              <strong title={customerLabel}>{customerLabel}</strong>
                              <small title={refundRequest.customerEmail || undefined}>{refundRequest.customerEmail || 'No customer email'}</small>
                            </div>
                          </div>
                          <div className="restaurant-mobile-meta refund-mobile-meta-wide">
                            <ReceiptText size={15} />
                            <div>
                              <span>Reason</span>
                              <strong title={refundRequest.reason || undefined}>{refundRequest.reason || 'No customer reason'}</strong>
                              {refundRequest.adminNote && <small title={refundRequest.adminNote}>{refundRequest.adminNote}</small>}
                            </div>
                          </div>
                          <div className="restaurant-mobile-meta">
                            <CalendarClock size={15} />
                            <div>
                              <span>Updated</span>
                              <strong>{formatDate(refundRequest.reviewedAt || refundRequest.updatedAt || refundRequest.createdAt)}</strong>
                            </div>
                          </div>
                        </div>

                        <div className="restaurant-mobile-actions refund-mobile-actions">
                          {renderRefundRequestActions(refundRequest)}
                        </div>
                      </article>
                    )
                  })}
                  {refundRequests.length === 0 && (
                    <div className="restaurant-mobile-empty">
                      {refundRequestsLoading
                        ? 'Loading refund requests...'
                        : 'No refund requests match the current filters.'}
                    </div>
                  )}
                </div>

                <div className="pagination-bar compact-pagination admin-payments-pagination">
                  <span className="pagination-range">
                    <span className="pagination-full">Showing {refundRequestPageStart}-{refundRequestPageEnd} of {refundRequestTotalItems}</span>
                    <span className="pagination-compact">{refundRequestPageStart}-{refundRequestPageEnd} / {refundRequestTotalItems}</span>
                  </span>
                  <div className="pagination-actions">
                    <Select value={String(refundRequestPageSize)} onValueChange={(value) => { setRefundRequestPage(1); setRefundRequestPageSize(Number(value)) }}>
                      <SelectTrigger className="page-size-select" aria-label="Refund requests per page">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        {[10, 20, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{size} / page</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <span className="pagination-page">
                      <span className="pagination-full">Page {currentRefundRequestPage} of {refundRequestTotalPages}</span>
                      <span className="pagination-compact">{currentRefundRequestPage} / {refundRequestTotalPages}</span>
                    </span>
                    <Button type="button" variant="outline" size="icon" onClick={() => setRefundRequestPage((current) => Math.max(1, current - 1))} disabled={refundRequestsLoading || refundRequestPage <= 1} aria-label="Previous refund requests page"><ChevronLeft size={16} /></Button>
                    <Button type="button" variant="outline" size="icon" onClick={() => setRefundRequestPage((current) => Math.min(refundRequestTotalPages, current + 1))} disabled={refundRequestsLoading || refundRequestPage >= refundRequestTotalPages} aria-label="Next refund requests page"><ChevronRight size={16} /></Button>
                  </div>
                </div>
              </section>
            </TabsContent>

            <TabsContent value="history" className="payment-tab-content refund-history-tab">
              <section id="refund-records" className="refund-records-section">
                <div className="section-header">
                  <div className="admin-page-title">
                    <Undo2 size={22} />
                    <div>
                      <h3>Refund records</h3>
                      <p>Refunds from the refund table, linked back to orders and Stripe refund ids.</p>
                    </div>
                  </div>
                </div>

                <section className="refund-summary-panel is-collapsible" aria-label="Refund summary">
                  <button
                    type="button"
                    className="refund-summary-toggle"
                    aria-expanded={refundSummaryExpanded}
                    onClick={() => setRefundSummaryExpanded((current) => !current)}
                  >
                    <span className="refund-summary-toggle-title">
                      <Undo2 size={16} />
                      Refund summary
                    </span>
                    <span className="refund-summary-toggle-meta">
                      {refundSummaryLoading
                        ? 'Loading refund records...'
                        : `${refundSummary.total} records / ${refundSummary.succeeded} succeeded`}
                    </span>
                    {refundSummaryExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>

                  {refundSummaryExpanded && (
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
                  )}
                </section>

                <div className="refund-records-table-wrap">
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
                </div>

                <div className="restaurant-mobile-list refund-record-mobile-list" aria-label="Refund history">
                  {refunds.map((refund) => {
                    const customerLabel = refund.customerName || refund.customerEmail || 'Guest / unknown'

                    return (
                      <article className="restaurant-mobile-card refund-mobile-card" key={refund.id}>
                        <header className="restaurant-mobile-card-header refund-mobile-card-header">
                          <span className="restaurant-mobile-avatar">
                            <Undo2 size={18} />
                          </span>
                          <div className="restaurant-mobile-primary">
                            <strong title={refund.providerRefundId || refund.id}>{refund.providerRefundId || refund.id}</strong>
                            <span title={refund.providerPaymentIntentId || undefined}>{refund.providerPaymentIntentId || 'No payment intent'}</span>
                          </div>
                          <Badge
                            variant={refund.status === 'Failed' ? 'destructive' : refund.status === 'Succeeded' ? 'secondary' : 'outline'}
                            className={refundStatusClasses[refund.status]}
                          >
                            {refund.status}
                          </Badge>
                        </header>

                        <div className="refund-mobile-amount-row">
                          <span>Refunded</span>
                          <strong>{formatMoney(refund.amountCents / 100, refund.currency)}</strong>
                        </div>

                        <div className="restaurant-mobile-meta-grid refund-mobile-meta-grid">
                          <div className="restaurant-mobile-meta">
                            <ReceiptText size={15} />
                            <div>
                              <span>Order</span>
                              <strong title={refund.orderNumber || undefined}>{refund.orderNumber || 'Unknown order'}</strong>
                            </div>
                          </div>
                          <div className="restaurant-mobile-meta">
                            <Building2 size={15} />
                            <div>
                              <span>Restaurant</span>
                              <strong title={refund.restaurantName || undefined}>{refund.restaurantName || 'Unknown restaurant'}</strong>
                            </div>
                          </div>
                          <div className="restaurant-mobile-meta">
                            <UserRound size={15} />
                            <div>
                              <span>Customer</span>
                              <strong title={customerLabel}>{customerLabel}</strong>
                              <small title={refund.customerEmail || undefined}>{refund.customerEmail || 'No customer email'}</small>
                            </div>
                          </div>
                          <div className="restaurant-mobile-meta refund-mobile-meta-wide">
                            <CreditCard size={15} />
                            <div>
                              <span>Reason</span>
                              <strong title={refund.reason || undefined}>{refund.reason || 'No reason recorded'}</strong>
                              {refund.failureReason && <small className="text-destructive" title={refund.failureReason}>{refund.failureReason}</small>}
                            </div>
                          </div>
                          <div className="restaurant-mobile-meta">
                            <CalendarClock size={15} />
                            <div>
                              <span>Updated</span>
                              <strong>{formatDate(refund.refundedAt || refund.failedAt || refund.updatedAt || refund.createdAt)}</strong>
                            </div>
                          </div>
                        </div>
                      </article>
                    )
                  })}
                  {refunds.length === 0 && (
                    <div className="restaurant-mobile-empty">
                      {refundsLoading
                        ? 'Loading refund records...'
                        : 'No refund records match the current filters.'}
                    </div>
                  )}
                </div>

                <div className="pagination-bar compact-pagination admin-payments-pagination">
                  <span className="pagination-range">
                    <span className="pagination-full">Showing {refundPageStart}-{refundPageEnd} of {refundTotalItems}</span>
                    <span className="pagination-compact">{refundPageStart}-{refundPageEnd} / {refundTotalItems}</span>
                  </span>
                  <div className="pagination-actions">
                    <Select value={String(refundPageSize)} onValueChange={(value) => { setRefundPage(1); setRefundPageSize(Number(value)) }}>
                      <SelectTrigger className="page-size-select" aria-label="Refund records per page">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        {[10, 20, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{size} / page</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <span className="pagination-page">
                      <span className="pagination-full">Page {currentRefundPage} of {refundTotalPages}</span>
                      <span className="pagination-compact">{currentRefundPage} / {refundTotalPages}</span>
                    </span>
                    <Button type="button" variant="outline" size="icon" onClick={() => setRefundPage((current) => Math.max(1, current - 1))} disabled={refundsLoading || refundPage <= 1} aria-label="Previous refund records page"><ChevronLeft size={16} /></Button>
                    <Button type="button" variant="outline" size="icon" onClick={() => setRefundPage((current) => Math.min(refundTotalPages, current + 1))} disabled={refundsLoading || refundPage >= refundTotalPages} aria-label="Next refund records page"><ChevronRight size={16} /></Button>
                  </div>
                </div>
              </section>
            </TabsContent>
          </Tabs>
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
