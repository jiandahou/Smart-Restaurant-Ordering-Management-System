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
  Copy,
  Download,
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
import { useSearchParams } from 'react-router-dom'
import {
  createOrderCheckoutSession,
  approveAdminRefundRequest,
  getAdminOrderSummary,
  getAdminRefunds,
  getAdminRefundRequests,
  getAdminRefundSummary,
  getAdminOrders,
  getPaymentEnvironment,
  getRestaurants,
  rejectAdminRefundRequest,
  refundAdminOrder,
  type AdminOrder,
  type AdminOrderSummary,
  type AdminRefund,
  type AdminRefundRequest,
  type AdminRefundRequestStatus,
  type AdminRefundSummary,
  type PaymentEnvironment,
  type Restaurant,
} from '../api/auth'
import { useAuth } from '../auth/AuthContext'
import { OrderItemOptionBadges } from '../components/orders/OrderItemOptionBadges'
import { ApproveRefundRequestDialog } from '../components/orders/ApproveRefundRequestDialog'
import { OrderRefundDialog } from '../components/orders/OrderRefundDialog'
import { OrderStatusBadge, getOrderStatusLabel, orderStatusOptions } from '../components/orders/OrderStatusBadge'
import { PaymentRefundHistory } from '../components/orders/PaymentRefundHistory'
import { PaymentStatusBadge, getPaymentStatusLabel, paymentStatusOptions } from '../components/orders/PaymentStatusBadge'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader } from '../components/ui/card'
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
import { isOrderPayable } from '../lib/orderStats'
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

/**
 * Payment statuses the "Payable only" preset keeps. Must mirror AdminOrdersController's PayableOnly
 * clause — combining that preset with any status outside this list yields a query that can never
 * match, which silently emptied the list.
 */
const payablePaymentStatuses: readonly string[] = ['Pending', 'Unpaid', 'Failed', 'Cancelled', 'Expired']
const refundStatusOptions = ['Pending', 'Succeeded', 'Failed'] as const
const refundRequestStatusOptions = ['Pending', 'Processing', 'Approved', 'Rejected', 'Cancelled'] as const
const refundStatusClasses: Partial<Record<typeof refundStatusOptions[number], string>> = {
  Succeeded: 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
}
const refundRequestStatusClasses: Partial<Record<AdminRefundRequestStatus, string>> = {
  Processing: 'border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
  Approved: 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  Rejected: 'border-red-300 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200',
}

type PaymentTab = 'orders' | 'requests' | 'history'

function readAllowedParam<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[],
  fallback: T,
) {
  const value = params.get(key)
  return value && allowed.includes(value as T) ? value as T : fallback
}

function readPositiveInteger(params: URLSearchParams, key: string, fallback: number) {
  const value = Number(params.get(key))
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function dateBoundaryToUtc(value: string, endExclusive = false) {
  if (!value) {
    return undefined
  }

  const date = new Date(`${value}T00:00:00`)
  if (endExclusive) {
    date.setDate(date.getDate() + 1)
  }
  return date.toISOString()
}

function formatMoney(amount: number, currencyCode?: string | null) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: (currencyCode || 'AUD').toUpperCase(),
  }).format(amount)
}

function formatDate(value: string | null) {
  if (!value) {
    return 'Not yet'
  }

  return new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
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

function CompactIdentifier({
  value,
  fallback,
  label,
}: {
  value?: string | null
  fallback: string
  label: string
}) {
  if (!value) {
    return <span className="table-subtext">{fallback}</span>
  }

  const compact = value.length > 22 ? `${value.slice(0, 10)}…${value.slice(-7)}` : value
  return (
    <span className="payment-identifier">
      <code title={value}>{compact}</code>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Copy ${label}`}
        onClick={(event) => {
          event.stopPropagation()
          void navigator.clipboard.writeText(value)
            .then(() => toast.success(`${label} copied`))
            .catch(() => toast.error(`Could not copy ${label}`))
        }}
      >
        <Copy size={13} />
      </Button>
    </span>
  )
}

async function fetchExportRows<T>(
  load: (page: number) => Promise<{ items: T[]; totalPages: number }>,
) {
  const first = await load(1)
  const rows = [...first.items]
  const pageLimit = Math.min(first.totalPages, 50)
  for (let page = 2; page <= pageLimit; page += 1) {
    rows.push(...(await load(page)).items)
  }
  return rows
}

function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number | null | undefined>>) {
  const escapeCell = (value: string | number | null | undefined) => {
    const text = value == null ? '' : String(value)
    return `"${text.replaceAll('"', '""')}"`
  }
  const csv = [headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
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
  const [urlSearchParams, setUrlSearchParams] = useSearchParams()
  const initialUrlState = {
    activeTab: readAllowedParam(urlSearchParams, 'view', ['orders', 'requests', 'history'] as const, 'orders'),
    search: urlSearchParams.get('q') ?? '',
    dateFrom: urlSearchParams.get('from') ?? '',
    dateTo: urlSearchParams.get('to') ?? '',
    paymentFilter: readAllowedParam(urlSearchParams, 'payment', ['all', ...paymentStatusOptions], 'all'),
    orderStatusFilter: readAllowedParam(urlSearchParams, 'orderStatus', ['all', ...orderStatusOptions], 'all'),
    orderTypeFilter: readAllowedParam(urlSearchParams, 'orderType', ['all', ...orderTypeOptions], 'all'),
    restaurantFilter: urlSearchParams.get('restaurant') || 'all',
    payableOnly: readAllowedParam(urlSearchParams, 'payable', ['yes', 'no'] as const, 'no'),
    refundStatusFilter: readAllowedParam(urlSearchParams, 'refundStatus', ['all', ...refundStatusOptions], 'all'),
    refundRequestStatusFilter: readAllowedParam(
      urlSearchParams,
      'requestStatus',
      ['all', ...refundRequestStatusOptions] as const,
      'Pending',
    ),
    page: readPositiveInteger(urlSearchParams, 'page', 1),
    pageSize: readAllowedParam(urlSearchParams, 'pageSize', ['10', '20', '50', '100'] as const, '20'),
    sortKey: readAllowedParam(
      urlSearchParams,
      'sortBy',
      ['createdAt', 'orderNumber', 'restaurantName', 'paymentStatus', 'status', 'totalAmount'] as const,
      'createdAt',
    ),
    sortDirection: readAllowedParam(urlSearchParams, 'direction', ['asc', 'desc'] as const, 'desc'),
  }
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [orderSummary, setOrderSummary] = useState<AdminOrderSummary>({
    total: 0,
    activeKitchen: 0,
    paid: 0,
    pendingPayment: 0,
    failedPayment: 0,
    payable: 0,
    revenue: 0,
  })
  const [refundSummary, setRefundSummary] = useState<AdminRefundSummary>({
    total: 0,
    pending: 0,
    succeeded: 0,
    failed: 0,
    amountsByCurrency: [],
  })
  const [refunds, setRefunds] = useState<AdminRefund[]>([])
  const [refundRequests, setRefundRequests] = useState<AdminRefundRequest[]>([])
  const [paymentEnvironment, setPaymentEnvironment] = useState<PaymentEnvironment | null>(null)
  const [restaurantDirectory, setRestaurantDirectory] = useState<Restaurant[]>([])
  const [loading, setLoading] = useState(true)
  const [refundSummaryLoading, setRefundSummaryLoading] = useState(true)
  const [refundsLoading, setRefundsLoading] = useState(true)
  const [refundRequestsLoading, setRefundRequestsLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [submittingOrderId, setSubmittingOrderId] = useState<string | null>(null)
  const [refundingOrderId, setRefundingOrderId] = useState<string | null>(null)
  const [reviewingRefundRequestId, setReviewingRefundRequestId] = useState<string | null>(null)
  const [pendingRefundOrder, setPendingRefundOrder] = useState<AdminOrder | null>(null)
  const [approvingRefundRequest, setApprovingRefundRequest] = useState<AdminRefundRequest | null>(null)
  const [rejectingRefundRequest, setRejectingRefundRequest] = useState<AdminRefundRequest | null>(null)
  const [refundReason, setRefundReason] = useState('')
  const [refundApprovalNote, setRefundApprovalNote] = useState('')
  const [refundApprovalConfirmation, setRefundApprovalConfirmation] = useState('')
  const [refundRequestRejectNote, setRefundRequestRejectNote] = useState('')
  const [search, setSearch] = useState(initialUrlState.search)
  const [debouncedSearch, setDebouncedSearch] = useState(initialUrlState.search)
  const [dateFrom, setDateFrom] = useState(initialUrlState.dateFrom)
  const [dateTo, setDateTo] = useState(initialUrlState.dateTo)
  const [ordersError, setOrdersError] = useState<string | null>(null)
  const [refundsError, setRefundsError] = useState<string | null>(null)
  const [refundRequestsError, setRefundRequestsError] = useState<string | null>(null)
  const [restaurantDirectoryError, setRestaurantDirectoryError] = useState<string | null>(null)
  // A hand-edited or bookmarked URL can carry ?payable=yes&payment=Paid, which no order can
  // satisfy. Drop the status rather than render an inexplicably empty list.
  const [paymentFilter, setPaymentFilter] = useState(
    initialUrlState.payableOnly === 'yes' &&
      initialUrlState.paymentFilter !== 'all' &&
      !payablePaymentStatuses.includes(initialUrlState.paymentFilter)
      ? 'all' as typeof initialUrlState.paymentFilter
      : initialUrlState.paymentFilter,
  )
  const [orderStatusFilter, setOrderStatusFilter] = useState(initialUrlState.orderStatusFilter)
  const [orderTypeFilter, setOrderTypeFilter] = useState(initialUrlState.orderTypeFilter)
  const [restaurantFilter, setRestaurantFilter] = useState(initialUrlState.restaurantFilter)
  const [payableOnly, setPayableOnly] = useState(initialUrlState.payableOnly)
  const [refundStatusFilter, setRefundStatusFilter] = useState<'all' | typeof refundStatusOptions[number]>(initialUrlState.refundStatusFilter)
  const [refundRequestStatusFilter, setRefundRequestStatusFilter] = useState<'all' | AdminRefundRequestStatus>(initialUrlState.refundRequestStatusFilter)
  const [page, setPage] = useState(initialUrlState.page)
  const [pageSize, setPageSize] = useState(Number(initialUrlState.pageSize))
  const [totalItems, setTotalItems] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [refundPage, setRefundPage] = useState(initialUrlState.page)
  const [refundPageSize, setRefundPageSize] = useState(Number(initialUrlState.pageSize))
  const [refundTotalItems, setRefundTotalItems] = useState(0)
  const [refundTotalPages, setRefundTotalPages] = useState(0)
  const [refundRequestPage, setRefundRequestPage] = useState(initialUrlState.page)
  const [refundRequestPageSize, setRefundRequestPageSize] = useState(Number(initialUrlState.pageSize))
  const [refundRequestTotalItems, setRefundRequestTotalItems] = useState(0)
  const [refundRequestTotalPages, setRefundRequestTotalPages] = useState(0)
  const [activeTab, setActiveTab] = useState<PaymentTab>(initialUrlState.activeTab)
  const [paymentSummaryExpanded, setPaymentSummaryExpanded] = useState(false)
  const [refundSummaryExpanded, setRefundSummaryExpanded] = useState(false)
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null)
  const tableWrapRef = useRef<HTMLDivElement | null>(null)
  const ordersAbortRef = useRef<AbortController | null>(null)
  const refundsAbortRef = useRef<AbortController | null>(null)
  const refundRequestsAbortRef = useRef<AbortController | null>(null)
  const [tableViewportWidth, setTableViewportWidth] = useState<number | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({
    key: initialUrlState.sortKey,
    direction: initialUrlState.sortDirection,
  })
  const isPlatformOwner = user?.roles.includes('PlatformOwner') ?? false

  const restaurantOptions = useMemo(() => {
    return restaurantDirectory
      .map((restaurant) => ({ value: restaurant.id, label: restaurant.name }))
      .sort((first, second) => first.label.localeCompare(second.label))
  }, [restaurantDirectory])

  const filteredOrders = orders
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

  /**
   * "Payable only" restricts payment status to the unpaid states, so pairing it with Paid (or
   * Refunded, etc.) produces a query that can never match — the page looked empty as if the orders
   * had vanished. Rather than silently correcting it afterwards, the incompatible statuses are not
   * offered while the preset is on.
   */
  const selectablePaymentStatuses = payableOnly === 'yes'
    ? paymentStatusOptions.filter((status) => payablePaymentStatuses.includes(status))
    : paymentStatusOptions

  const selectPaymentFilter = (value: typeof paymentFilter) => {
    setPaymentFilter(value)
  }

  const selectPayableOnly = (value: typeof payableOnly) => {
    setPayableOnly(value)

    // Turning the preset on can strand an already-selected status that it excludes — and a
    // hand-edited URL can arrive in that state too.
    if (value === 'yes' && paymentFilter !== 'all' && !payablePaymentStatuses.includes(paymentFilter)) {
      setPaymentFilter('all')
    }
  }
  const tabSpecificFilterCount = activeTab === 'orders'
    ? [
        paymentFilter !== 'all',
        orderStatusFilter !== 'all',
        orderTypeFilter !== 'all',
        payableOnly !== 'no',
      ].filter(Boolean).length
    : activeTab === 'requests'
      ? (refundRequestStatusFilter !== 'Pending' ? 1 : 0)
      : (refundStatusFilter !== 'all' ? 1 : 0)
  const activeDropdownFilterCount = tabSpecificFilterCount + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0)

  const hasActiveFilters =
    search.trim() !== ''
    || dateFrom !== ''
    || dateTo !== ''
    || paymentFilter !== 'all'
    || orderStatusFilter !== 'all'
    || orderTypeFilter !== 'all'
    || (isPlatformOwner && restaurantFilter !== 'all')
    || payableOnly !== 'no'
    || refundStatusFilter !== 'all'
    || refundRequestStatusFilter !== 'Pending'

  const loadOrders = useCallback(async (showToast = false) => {
    ordersAbortRef.current?.abort()
    const controller = new AbortController()
    ordersAbortRef.current = controller
    setLoading(true)
    setOrdersError(null)

    try {
      const params = {
        page,
        pageSize,
        search: debouncedSearch.trim() || undefined,
        sortBy: sort.key,
        sortDirection: sort.direction,
        status: orderStatusFilter === 'all' ? undefined : orderStatusFilter,
        paymentStatus: paymentFilter === 'all' ? undefined : paymentFilter,
        orderType: orderTypeFilter === 'all' ? undefined : orderTypeFilter,
        restaurantId: isPlatformOwner && restaurantFilter !== 'all' ? restaurantFilter : undefined,
        payableOnly: payableOnly === 'yes' ? true : undefined,
        createdFromUtc: dateBoundaryToUtc(dateFrom),
        createdToUtc: dateBoundaryToUtc(dateTo, true),
      }
      const [response, summary] = await Promise.all([
        getAdminOrders(params, { signal: controller.signal }),
        getAdminOrderSummary(params, { signal: controller.signal }),
      ])
      setOrders(response.items)
      setOrderSummary(summary)
      setTotalItems(response.totalItems)
      setTotalPages(response.totalPages)

      if (showToast) {
        toast.success('Payments refreshed')
      }
    } catch (error) {
      if (isAbortError(error)) {
        return
      }
      const message = error instanceof Error ? error.message : 'Order loading failed'
      setOrdersError(message)
      toast.error('Could not load payment records', {
        description: message,
      })
    } finally {
      if (ordersAbortRef.current === controller) {
        setLoading(false)
      }
    }
  }, [dateFrom, dateTo, debouncedSearch, isPlatformOwner, orderStatusFilter, orderTypeFilter, page, pageSize, payableOnly, paymentFilter, restaurantFilter, sort])

  const loadRefundHistory = useCallback(async (showToast = false) => {
    refundsAbortRef.current?.abort()
    const controller = new AbortController()
    refundsAbortRef.current = controller
    setRefundSummaryLoading(true)
    setRefundsLoading(true)
    setRefundsError(null)

    try {
      const commonParams = {
        restaurantId: isPlatformOwner && restaurantFilter !== 'all' ? restaurantFilter : undefined,
        search: debouncedSearch.trim() || undefined,
        status: refundStatusFilter === 'all' ? undefined : refundStatusFilter,
        createdFromUtc: dateBoundaryToUtc(dateFrom),
        createdToUtc: dateBoundaryToUtc(dateTo, true),
      }
      const [summary, response] = await Promise.all([
        getAdminRefundSummary(commonParams, { signal: controller.signal }),
        getAdminRefunds({
          ...commonParams,
          page: refundPage,
          pageSize: refundPageSize,
          sortBy: 'createdAt',
          sortDirection: 'desc',
        }, { signal: controller.signal }),
      ])
      setRefundSummary(summary)
      setRefunds(response.items)
      setRefundTotalItems(response.totalItems)
      setRefundTotalPages(response.totalPages)

      if (showToast) {
        toast.success('Refund history refreshed')
      }
    } catch (error) {
      if (isAbortError(error)) {
        return
      }
      const message = error instanceof Error ? error.message : 'Refund history loading failed'
      setRefundsError(message)
      toast.error('Could not load refund records', {
        description: message,
      })
    } finally {
      if (refundsAbortRef.current === controller) {
        setRefundSummaryLoading(false)
        setRefundsLoading(false)
      }
    }
  }, [dateFrom, dateTo, debouncedSearch, isPlatformOwner, refundPage, refundPageSize, refundStatusFilter, restaurantFilter])

  const loadRefundRequests = useCallback(async (showToast = false) => {
    refundRequestsAbortRef.current?.abort()
    const controller = new AbortController()
    refundRequestsAbortRef.current = controller
    setRefundRequestsLoading(true)
    setRefundRequestsError(null)

    try {
      const response = await getAdminRefundRequests({
        page: refundRequestPage,
        pageSize: refundRequestPageSize,
        search: debouncedSearch.trim() || undefined,
        restaurantId: isPlatformOwner && restaurantFilter !== 'all' ? restaurantFilter : undefined,
        status: refundRequestStatusFilter === 'all' ? undefined : refundRequestStatusFilter,
        createdFromUtc: dateBoundaryToUtc(dateFrom),
        createdToUtc: dateBoundaryToUtc(dateTo, true),
        sortBy: 'createdAt',
        sortDirection: 'desc',
      }, { signal: controller.signal })
      setRefundRequests(response.items)
      setRefundRequestTotalItems(response.totalItems)
      setRefundRequestTotalPages(response.totalPages)

      if (showToast) {
        toast.success('Refund requests refreshed')
      }
    } catch (error) {
      if (isAbortError(error)) {
        return
      }
      const message = error instanceof Error ? error.message : 'Refund request loading failed'
      setRefundRequestsError(message)
      toast.error('Could not load refund requests', {
        description: message,
      })
    } finally {
      if (refundRequestsAbortRef.current === controller) {
        setRefundRequestsLoading(false)
      }
    }
  }, [dateFrom, dateTo, debouncedSearch, isPlatformOwner, refundRequestPage, refundRequestPageSize, refundRequestStatusFilter, restaurantFilter])

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search), 300)
    return () => window.clearTimeout(timeout)
  }, [search])

  useEffect(() => {
    const next = new URLSearchParams()
    const activePage = activeTab === 'orders' ? page : activeTab === 'requests' ? refundRequestPage : refundPage
    const activePageSize = activeTab === 'orders' ? pageSize : activeTab === 'requests' ? refundRequestPageSize : refundPageSize

    if (activeTab !== 'orders') next.set('view', activeTab)
    if (search.trim()) next.set('q', search.trim())
    if (dateFrom) next.set('from', dateFrom)
    if (dateTo) next.set('to', dateTo)
    if (restaurantFilter !== 'all') next.set('restaurant', restaurantFilter)
    if (paymentFilter !== 'all') next.set('payment', paymentFilter)
    if (orderStatusFilter !== 'all') next.set('orderStatus', orderStatusFilter)
    if (orderTypeFilter !== 'all') next.set('orderType', orderTypeFilter)
    if (payableOnly !== 'no') next.set('payable', payableOnly)
    if (refundStatusFilter !== 'all') next.set('refundStatus', refundStatusFilter)
    if (refundRequestStatusFilter !== 'Pending') next.set('requestStatus', refundRequestStatusFilter)
    if (activePage > 1) next.set('page', String(activePage))
    if (activePageSize !== 20) next.set('pageSize', String(activePageSize))
    if (sort.key !== 'createdAt') next.set('sortBy', sort.key)
    if (sort.direction !== 'desc') next.set('direction', sort.direction)

    setUrlSearchParams(next, { replace: true })
  }, [
    activeTab,
    dateFrom,
    dateTo,
    orderStatusFilter,
    orderTypeFilter,
    page,
    pageSize,
    payableOnly,
    paymentFilter,
    refundPage,
    refundPageSize,
    refundRequestPage,
    refundRequestPageSize,
    refundRequestStatusFilter,
    refundStatusFilter,
    restaurantFilter,
    search,
    setUrlSearchParams,
    sort,
  ])

  useEffect(() => {
    void getPaymentEnvironment()
      .then(setPaymentEnvironment)
      .catch(() => setPaymentEnvironment({
        provider: 'Stripe',
        mode: 'Unconfigured',
        destructiveActionsRequireConfirmation: true,
      }))
  }, [])

  useEffect(() => {
    if (!isPlatformOwner) {
      return
    }

    void getRestaurants()
      .then((restaurants) => {
        setRestaurantDirectoryError(null)
        setRestaurantDirectory(restaurants)
      })
      .catch((error) => setRestaurantDirectoryError(
        error instanceof Error ? error.message : 'Restaurant directory loading failed',
      ))
  }, [isPlatformOwner])

  useEffect(() => {
    if (activeTab === 'orders') {
      void Promise.resolve().then(() => loadOrders())
    } else if (activeTab === 'requests') {
      void Promise.resolve().then(() => loadRefundRequests())
    } else {
      void Promise.resolve().then(() => loadRefundHistory())
    }

    return () => {
      ordersAbortRef.current?.abort()
      refundsAbortRef.current?.abort()
      refundRequestsAbortRef.current?.abort()
    }
  }, [activeTab, loadOrders, loadRefundHistory, loadRefundRequests])

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
    setDateFrom('')
    setDateTo('')
    setPaymentFilter('all')
    setOrderStatusFilter('all')
    setOrderTypeFilter('all')
    setRestaurantFilter('all')
    setPayableOnly('no')
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

  const exportCurrentView = async () => {
    setExporting(true)
    const createdFromUtc = dateBoundaryToUtc(dateFrom)
    const createdToUtc = dateBoundaryToUtc(dateTo, true)
    const restaurantId = isPlatformOwner && restaurantFilter !== 'all' ? restaurantFilter : undefined
    const exportDate = new Date().toISOString().slice(0, 10)

    try {
      if (activeTab === 'orders') {
        const rows = await fetchExportRows((exportPage) => getAdminOrders({
          page: exportPage,
          pageSize: 100,
          search: debouncedSearch.trim() || undefined,
          sortBy: sort.key,
          sortDirection: sort.direction,
          status: orderStatusFilter === 'all' ? undefined : orderStatusFilter,
          paymentStatus: paymentFilter === 'all' ? undefined : paymentFilter,
          orderType: orderTypeFilter === 'all' ? undefined : orderTypeFilter,
          restaurantId,
          payableOnly: payableOnly === 'yes' ? true : undefined,
          createdFromUtc,
          createdToUtc,
        }))
        downloadCsv(
          `dineflow-payment-orders-${exportDate}.csv`,
          ['Order', 'Restaurant', 'Customer', 'Order status', 'Payment status', 'Method', 'Amount', 'Currency', 'Created', 'Payment intent', 'Checkout session'],
          rows.map((order) => [
            order.orderNumber,
            order.restaurantName,
            order.customerName || order.customerEmail,
            order.status,
            order.paymentStatus,
            order.paymentMethod,
            order.totalAmount,
            order.currency,
            order.createdAt,
            order.latestPayment?.providerPaymentIntentId,
            order.latestPayment?.providerCheckoutSessionId,
          ]),
        )
      } else if (activeTab === 'requests') {
        const rows = await fetchExportRows((exportPage) => getAdminRefundRequests({
          page: exportPage,
          pageSize: 100,
          search: debouncedSearch.trim() || undefined,
          restaurantId,
          status: refundRequestStatusFilter === 'all' ? undefined : refundRequestStatusFilter,
          sortBy: 'createdAt',
          sortDirection: 'desc',
          createdFromUtc,
          createdToUtc,
        }))
        downloadCsv(
          `dineflow-refund-requests-${exportDate}.csv`,
          ['Request', 'Order', 'Restaurant', 'Customer', 'Status', 'Requested amount', 'Original payment', 'Already refunded', 'Refundable balance', 'Currency', 'Reason', 'Admin note', 'Created', 'Reviewed', 'Payment intent'],
          rows.map((request) => [
            request.id,
            request.orderNumber,
            request.restaurantName,
            request.customerName || request.customerEmail,
            request.status,
            request.requestedAmountCents / 100,
            request.originalPaymentAmountCents / 100,
            request.alreadyRefundedAmountCents / 100,
            request.refundableAmountCents / 100,
            request.currency,
            request.reason,
            request.adminNote,
            request.createdAt,
            request.reviewedAt,
            request.providerPaymentIntentId,
          ]),
        )
      } else {
        const rows = await fetchExportRows((exportPage) => getAdminRefunds({
          page: exportPage,
          pageSize: 100,
          search: debouncedSearch.trim() || undefined,
          restaurantId,
          status: refundStatusFilter === 'all' ? undefined : refundStatusFilter,
          sortBy: 'createdAt',
          sortDirection: 'desc',
          createdFromUtc,
          createdToUtc,
        }))
        downloadCsv(
          `dineflow-refund-history-${exportDate}.csv`,
          ['Refund', 'Payment intent', 'Order', 'Restaurant', 'Customer', 'Status', 'Amount', 'Currency', 'Reason', 'Failure reason', 'Created', 'Updated'],
          rows.map((refund) => [
            refund.providerRefundId || refund.id,
            refund.providerPaymentIntentId,
            refund.orderNumber,
            refund.restaurantName,
            refund.customerName || refund.customerEmail,
            refund.status,
            refund.amountCents / 100,
            refund.currency,
            refund.reason,
            refund.failureReason,
            refund.createdAt,
            refund.refundedAt || refund.failedAt || refund.updatedAt,
          ]),
        )
      }

      toast.success('CSV export created')
    } catch (error) {
      toast.error('Could not export payment data', {
        description: error instanceof Error ? error.message : 'CSV export failed',
      })
    } finally {
      setExporting(false)
    }
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
      await loadOrders()
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
      await approveAdminRefundRequest(refundRequest.id, {
        note: refundApprovalNote.trim() || undefined,
      })
      await Promise.all([loadRefundRequests(), loadOrders()])
      toast.success('Refund request approved', {
        description: `${refundRequest.orderNumber} has been sent to Stripe for refund.`,
      })
      setApprovingRefundRequest(null)
      setRefundApprovalNote('')
      setRefundApprovalConfirmation('')
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
          onClick={() => {
            setRefundApprovalNote('')
            setRefundApprovalConfirmation('')
            setApprovingRefundRequest(refundRequest)
          }}
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
                <div className="payment-title-line">
                  <h1 className="admin-payment-page-heading">Payments</h1>
                  <Badge
                    variant={paymentEnvironment?.mode === 'Live' ? 'destructive' : 'outline'}
                    className={paymentEnvironment?.mode === 'Test' ? 'payment-environment-test' : undefined}
                  >
                    Stripe {paymentEnvironment?.mode ?? 'Checking'}
                  </Badge>
                </div>
                <CardDescription>
                  Review real order payment state and open Stripe Checkout only for eligible orders.
                </CardDescription>
              </div>
            </div>
            <div className="payment-header-actions">
              <Button
                type="button"
                variant="outline"
                onClick={() => void exportCurrentView()}
                disabled={exporting || (activeTab === 'orders' ? loading : activeTab === 'requests' ? refundRequestsLoading : refundsLoading)}
              >
                <Download size={17} />
                {exporting ? 'Exporting' : 'Export CSV'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  if (activeTab === 'orders') {
                    void loadOrders(true)
                  } else if (activeTab === 'requests') {
                    void loadRefundRequests(true)
                  } else {
                    void loadRefundHistory(true)
                  }
                }}
                disabled={
                  (activeTab === 'orders' ? loading : activeTab === 'requests' ? refundRequestsLoading : refundsLoading)
                  || submittingOrderId !== null
                  || refundingOrderId !== null
                  || reviewingRefundRequestId !== null
                }
              >
                <RefreshCw size={18} />
                {(activeTab === 'orders' ? loading : activeTab === 'requests' ? refundRequestsLoading : refundsLoading)
                  ? 'Refreshing'
                  : 'Refresh'}
              </Button>
            </div>
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
                    {orderSummary.total} visible / {orderSummary.payable} ready
                  </span>
                  {paymentSummaryExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>

                {paymentSummaryExpanded && (
                  <div className="placeholder-grid order-summary-grid admin-payments-summary-grid">
                    <div className="placeholder-item">
                      <strong>Visible orders</strong>
                      <span>{orderSummary.total}</span>
                    </div>
                    <div className="placeholder-item">
                      <strong>Ready to pay</strong>
                      <span>{orderSummary.payable}</span>
                    </div>
                    <div className="placeholder-item">
                      <strong>Paid</strong>
                      <span>{orderSummary.paid}</span>
                    </div>
                    <div className="placeholder-item">
                      <strong>Failed</strong>
                      <span>{orderSummary.failedPayment}</span>
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
                  <SelectTrigger className="filter-select" aria-label="Filter by restaurant">
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
                {restaurantDirectoryError && (
                  <p className="payment-filter-error" role="alert">{restaurantDirectoryError}</p>
                )}
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
                            <Select value={paymentFilter} onValueChange={(value) => { setPage(1); selectPaymentFilter(value as typeof paymentFilter) }}>
                              <SelectTrigger className="filter-select"><SelectValue placeholder="All payment status" /></SelectTrigger>
                              <SelectContent position="popper">
                                <SelectItem value="all">All payment status</SelectItem>
                                {/* Offering Paid here while "Payable only" is on would build a
                                    contradictory query that can never match. */}
                                {selectablePaymentStatuses.map((status) => (
                                  <SelectItem key={status} value={status}>{getPaymentStatusLabel(status)}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="restaurant-filter-field">
                            <span>Order status</span>
                            <Select value={orderStatusFilter} onValueChange={(value) => { setPage(1); setOrderStatusFilter(value as typeof orderStatusFilter) }}>
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
                            <Select value={payableOnly} onValueChange={(value) => { setPage(1); selectPayableOnly(value as typeof payableOnly) }}>
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
                      <label className="restaurant-filter-field">
                        <span>Created from</span>
                        <Input
                          type="date"
                          value={dateFrom}
                          max={dateTo || undefined}
                          onChange={(event) => {
                            setPage(1)
                            setRefundPage(1)
                            setRefundRequestPage(1)
                            setDateFrom(event.target.value)
                          }}
                        />
                      </label>
                      <label className="restaurant-filter-field">
                        <span>Created through</span>
                        <Input
                          type="date"
                          value={dateTo}
                          min={dateFrom || undefined}
                          onChange={(event) => {
                            setPage(1)
                            setRefundPage(1)
                            setRefundRequestPage(1)
                            setDateTo(event.target.value)
                          }}
                        />
                      </label>
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
                {dateFrom && (
                  <button type="button" className="restaurant-filter-chip" onClick={() => setDateFrom('')} title={`Created from: ${dateFrom}`}>
                    <span>From: {dateFrom}</span>
                    <X size={13} />
                  </button>
                )}
                {dateTo && (
                  <button type="button" className="restaurant-filter-chip" onClick={() => setDateTo('')} title={`Created through: ${dateTo}`}>
                    <span>Through: {dateTo}</span>
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
                  <button type="button" className="restaurant-filter-chip" onClick={() => { setPage(1); selectPayableOnly('no') }} title={`Payable: ${selectedPayableFilterLabel}`}>
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
              {ordersError && (
                <div className="payment-load-error" role="alert">
                  <span>Payment orders could not be loaded: {ordersError}</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => void loadOrders()}>
                    Retry
                  </Button>
                </div>
              )}
              <div className="admin-payments-table-wrap">
                <HorizontalTableScroll ref={tableWrapRef} topScrollLabel="Scroll payment orders table horizontally">
                  <table className="data-table payment-orders-table admin-payments-table">
              <caption className="sr-only">Filtered payment orders and available payment actions</caption>
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

                {refundRequestsError && (
                  <div className="payment-load-error" role="alert">
                    <span>Refund requests could not be loaded: {refundRequestsError}</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => void loadRefundRequests()}>
                      Retry
                    </Button>
                  </div>
                )}

                <div className="refund-requests-table-wrap">
                  <HorizontalTableScroll topScrollLabel="Scroll refund requests table horizontally">
                    <table className="data-table payment-orders-table refund-records-table refund-requests-table">
                <caption className="sr-only">Customer refund requests awaiting or showing an admin review decision</caption>
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
                            <CompactIdentifier value={refundRequest.id} fallback="No request id" label="refund request id" />
                          </span>
                          <CompactIdentifier value={refundRequest.paymentRefundId} fallback="No refund transaction yet" label="refund id" />
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
                          <strong className="payment-untrusted-text" title={refundRequest.reason || undefined}>
                            {refundRequest.reason || 'No customer reason'}
                          </strong>
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
                              <strong className="payment-untrusted-text" title={refundRequest.reason || undefined}>{refundRequest.reason || 'No customer reason'}</strong>
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

                {refundsError && (
                  <div className="payment-load-error" role="alert">
                    <span>Refund history could not be loaded: {refundsError}</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => void loadRefundHistory()}>
                      Retry
                    </Button>
                  </div>
                )}

                <div className="refund-records-table-wrap">
                  <HorizontalTableScroll topScrollLabel="Scroll refund records table horizontally">
                    <table className="data-table payment-orders-table refund-records-table">
                <caption className="sr-only">Stripe refund transaction history</caption>
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
                          <CompactIdentifier value={refund.providerRefundId || refund.id} fallback="No refund id" label="refund id" />
                        </span>
                        <CompactIdentifier value={refund.providerPaymentIntentId} fallback="No payment intent" label="payment intent id" />
                      </td>
                      <td>
                        <strong>{refund.orderNumber || 'Unknown order'}</strong>
                        <span className="table-subtext">{refund.customerName || refund.customerEmail || 'Guest / unknown'}</span>
                      </td>
                      <td>
                        <strong>{refund.restaurantName || 'Unknown restaurant'}</strong>
                        <span className="table-subtext">{refund.customerEmail || 'No customer email'}</span>
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
                        <strong className="payment-untrusted-text" title={refund.reason || undefined}>{refund.reason || 'No reason recorded'}</strong>
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
                              <strong className="payment-untrusted-text" title={refund.reason || undefined}>{refund.reason || 'No reason recorded'}</strong>
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

      <ApproveRefundRequestDialog
        request={approvingRefundRequest}
        environmentMode={paymentEnvironment?.mode ?? null}
        note={refundApprovalNote}
        confirmation={refundApprovalConfirmation}
        submitting={reviewingRefundRequestId !== null}
        onNoteChange={setRefundApprovalNote}
        onConfirmationChange={setRefundApprovalConfirmation}
        onOpenChange={(open) => {
          if (!open && reviewingRefundRequestId === null) {
            setApprovingRefundRequest(null)
            setRefundApprovalNote('')
            setRefundApprovalConfirmation('')
          }
        }}
        onConfirm={() => {
          if (approvingRefundRequest) {
            void approveRefundRequest(approvingRefundRequest)
          }
        }}
      />

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
