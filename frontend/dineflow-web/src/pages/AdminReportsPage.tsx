import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertCircle,
  BarChart3,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleDollarSign,
  CreditCard,
  Download,
  FileClock,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Store,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  downloadReportLogsCsv,
  getActivityLogs,
  getActivitySummary,
  getAuditLogs,
  getOrderEventLogs,
  getPaymentEventLogs,
  getReportPolicy,
  getRestaurants,
  type ActivityLog,
  type ActivityLogListParams,
  type ActivityMoneyTotal,
  type ActivitySummary,
  type AuditLog,
  type OrderEventLog,
  type PaymentEventLog,
  type ReportLogListParams,
  type ReportPolicy,
  type Restaurant,
} from '../api/auth'
import { HorizontalTableScroll } from '../components/HorizontalTableScroll'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '../components/ui/card'
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
import {
  formatMinorCurrency,
  formatReportDate,
  humanActorType,
  shortReportId,
  toUtcDateBoundary,
} from '../lib/reportActivity'

type ReportTab = 'activity' | 'audit' | 'orders' | 'payments'
const reportTabs = ['activity', 'audit', 'orders', 'payments'] as const satisfies readonly ReportTab[]

const emptySummary: ActivitySummary = {
  timeZone: 'UTC',
  activityCountToday: 0,
  completedOrdersToday: 0,
  failedPaymentsToday: 0,
  paymentsReceivedToday: [],
  refundsSucceededToday: [],
}

function getReportTab(value: string | null): ReportTab {
  return reportTabs.includes(value as ReportTab) ? (value as ReportTab) : 'activity'
}

function isAbortError(error: unknown) {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}

function ExpandableText({
  value,
  empty = 'No details',
}: {
  value: string | null | undefined
  empty?: string
}) {
  const [expanded, setExpanded] = useState(false)

  if (!value) return <span className="table-subtext">{empty}</span>

  return (
    <span className="report-expandable-cell">
      <span className={`report-expandable-text${expanded ? ' expanded' : ''}`}>{value}</span>
      {value.length > 80 && (
        <button type="button" className="report-expand-button" onClick={() => setExpanded((current) => !current)}>
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </span>
  )
}

function JsonSnippet({ value }: { value: string | null }) {
  const [expanded, setExpanded] = useState(false)
  if (!value) return <span className="table-subtext">No technical details</span>

  let formatted = value
  try {
    formatted = JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    // Keep non-JSON provider messages readable.
  }

  return (
    <span className="report-expandable-cell">
      <code className={`report-json-snippet${expanded ? ' expanded' : ''}`}>{formatted}</code>
      <button type="button" className="report-expand-button" onClick={() => setExpanded((current) => !current)}>
        {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        {expanded ? 'Hide details' : 'Technical details'}
      </button>
    </span>
  )
}

function formatMoneyTotals(totals: ActivityMoneyTotal[]) {
  if (totals.length === 0) return 'None'
  return totals.map((total) => formatMinorCurrency(total.amountCents, total.currency)).join(' · ')
}

function ActivityIcon({ category, actorType }: { category: string; actorType: string }) {
  if (actorType === 'Automation') return <Bot size={18} />
  if (actorType === 'Provider') return <CreditCard size={18} />
  if (category === 'Payment' || category === 'Refund') return <CircleDollarSign size={18} />
  if (category === 'Order') return <FileClock size={18} />
  if (category === 'Restaurant') return <Store size={18} />
  if (category === 'User' || category === 'Account') return <Users size={18} />
  return <Activity size={18} />
}

function ActivityFeed({
  items,
  loading,
}: {
  items: ActivityLog[]
  loading: boolean
}) {
  if (items.length === 0) {
    return (
      <div className="report-activity-empty">
        <FileClock size={24} />
        <strong>{loading ? 'Loading activity…' : 'No activity matches these filters.'}</strong>
        <span>Try a broader date range or clear one of the filters.</span>
      </div>
    )
  }

  return (
    <ol className="report-activity-feed" aria-label="Business activity" aria-busy={loading}>
      {items.map((item) => (
        <li key={item.id} className={`report-activity-item severity-${item.severity.toLowerCase()}`}>
          <div className="report-activity-icon" aria-hidden="true">
            <ActivityIcon category={item.category} actorType={item.actorType} />
          </div>
          <div className="report-activity-content">
            <div className="report-activity-heading">
              <p>
                <strong>{item.actorName}</strong>{' '}
                <span>{item.description}</span>
              </p>
              <time
                dateTime={item.occurredAt}
                title={`${formatReportDate(item.occurredAt, item.restaurantTimeZone)}${item.restaurantTimeZone ? ` (${item.restaurantTimeZone})` : ' (browser time)'}`}
              >
                {formatReportDate(item.occurredAt, item.restaurantTimeZone)}
              </time>
            </div>

            <div className="report-activity-badges">
              <Badge variant="outline">{item.category}</Badge>
              <Badge variant={item.severity === 'Error' ? 'destructive' : 'secondary'}>{item.actionLabel}</Badge>
              <span className="report-source-badge">{item.source}</span>
              {item.status && <span className="report-status-badge">{item.status}</span>}
            </div>

            <div className="report-activity-context">
              <span><UserRound size={14} /> {humanActorType(item.actorType)}{item.actorRoles ? ` · ${item.actorRoles}` : ''}</span>
              {item.restaurantName && <span><Store size={14} /> {item.restaurantName}</span>}
              {item.amountCents != null && (
                <strong>{formatMinorCurrency(item.amountCents, item.currency ?? 'AUD')}</strong>
              )}
              {item.orderNumber && (
                <Link to={`/admin/orders?q=${encodeURIComponent(item.orderNumber)}`}>
                  Order {item.orderNumber}
                </Link>
              )}
            </div>

            {item.technicalJson && (
              <details className="report-activity-technical">
                <summary>Technical details</summary>
                <code>{item.technicalJson}</code>
                {item.correlationId && <small>Correlation: {item.correlationId}</small>}
              </details>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

export function AdminReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState<ReportTab>(() => getReportTab(searchParams.get('section')))
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '')
  const [debouncedSearch, setDebouncedSearch] = useState(search)
  const [restaurantId, setRestaurantId] = useState(() => searchParams.get('restaurant') ?? '')
  const [typeFilter, setTypeFilter] = useState(() => searchParams.get('type') ?? '')
  const [category, setCategory] = useState(() => searchParams.get('category') ?? '')
  const [actorType, setActorType] = useState(() => searchParams.get('actor') ?? '')
  const [outcome, setOutcome] = useState(() => searchParams.get('outcome') ?? '')
  const [createdFrom, setCreatedFrom] = useState(() => searchParams.get('from') ?? '')
  const [createdTo, setCreatedTo] = useState(() => searchParams.get('to') ?? '')
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page') ?? 1) || 1))
  const [pageSize, setPageSize] = useState(() => [20, 50, 100].includes(Number(searchParams.get('pageSize')))
    ? Number(searchParams.get('pageSize'))
    : 20)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [reportSummaryExpanded, setReportSummaryExpanded] = useState(true)

  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [orderLogs, setOrderLogs] = useState<OrderEventLog[]>([])
  const [paymentLogs, setPaymentLogs] = useState<PaymentEventLog[]>([])
  const [activitySummary, setActivitySummary] = useState<ActivitySummary>(emptySummary)
  const [policy, setPolicy] = useState<ReportPolicy | null>(null)
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [totalItems, setTotalItems] = useState(0)
  const [totalPages, setTotalPages] = useState(0)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([
      getRestaurants(),
      getReportPolicy({ signal: controller.signal }),
    ]).then(([restaurantRows, reportPolicy]) => {
      setRestaurants(restaurantRows)
      setPolicy(reportPolicy)
    }).catch((error) => {
      if (!isAbortError(error)) {
        toast.error('Some report options could not be loaded', {
          description: error instanceof Error ? error.message : 'Supporting data is unavailable.',
        })
      }
    })
    return () => controller.abort()
  }, [])

  const createdFromUtc = useMemo(() => toUtcDateBoundary(createdFrom), [createdFrom])
  const createdToUtc = useMemo(() => toUtcDateBoundary(createdTo, true), [createdTo])

  const activityParams = useMemo<ActivityLogListParams>(() => ({
    page,
    pageSize,
    search: debouncedSearch || undefined,
    restaurantId: restaurantId || undefined,
    category: category || undefined,
    actorType: actorType || undefined,
    outcome: outcome || undefined,
    createdFrom: createdFromUtc,
    createdTo: createdToUtc,
  }), [
    actorType,
    category,
    createdFromUtc,
    createdToUtc,
    debouncedSearch,
    outcome,
    page,
    pageSize,
    restaurantId,
  ])

  const technicalParams = useMemo<ReportLogListParams>(() => ({
    page,
    pageSize,
    search: debouncedSearch || undefined,
    restaurantId: restaurantId || undefined,
    sortBy: 'createdAt',
    sortDirection: 'desc',
    createdFrom: createdFromUtc,
    createdTo: createdToUtc,
    ...(tab === 'audit'
      ? { action: typeFilter || undefined }
      : { eventType: typeFilter || undefined }),
  }), [
    createdFromUtc,
    createdToUtc,
    debouncedSearch,
    page,
    pageSize,
    restaurantId,
    tab,
    typeFilter,
  ])

  const loadReports = useCallback(async (signal: AbortSignal) => {
    setLoading(true)
    setLoadError(null)
    try {
      if (tab === 'activity') {
        const [response, summary] = await Promise.all([
          getActivityLogs(activityParams, { signal }),
          getActivitySummary(restaurantId || undefined, { signal }),
        ])
        setActivityLogs(response.items)
        setActivitySummary(summary)
        setTotalItems(response.totalItems)
        setTotalPages(response.totalPages)
      } else if (tab === 'audit') {
        const response = await getAuditLogs(technicalParams, { signal })
        setAuditLogs(response.items)
        setTotalItems(response.totalItems)
        setTotalPages(response.totalPages)
      } else if (tab === 'orders') {
        const response = await getOrderEventLogs(technicalParams, { signal })
        setOrderLogs(response.items)
        setTotalItems(response.totalItems)
        setTotalPages(response.totalPages)
      } else {
        const response = await getPaymentEventLogs(technicalParams, { signal })
        setPaymentLogs(response.items)
        setTotalItems(response.totalItems)
        setTotalPages(response.totalPages)
      }
    } catch (error) {
      if (!isAbortError(error)) {
        setLoadError(error instanceof Error ? error.message : 'Report loading failed.')
      }
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }, [activityParams, restaurantId, tab, technicalParams])

  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve().then(() => loadReports(controller.signal))
    return () => controller.abort()
  }, [loadReports, refreshVersion])

  useEffect(() => {
    const next = new URLSearchParams()
    if (tab !== 'activity') next.set('section', tab)
    if (search.trim()) next.set('q', search.trim())
    if (restaurantId) next.set('restaurant', restaurantId)
    if (tab === 'activity') {
      if (category) next.set('category', category)
      if (actorType) next.set('actor', actorType)
      if (outcome) next.set('outcome', outcome)
    } else if (typeFilter) {
      next.set('type', typeFilter)
    }
    if (createdFrom) next.set('from', createdFrom)
    if (createdTo) next.set('to', createdTo)
    if (page > 1) next.set('page', String(page))
    if (pageSize !== 20) next.set('pageSize', String(pageSize))

    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true })
    }
  }, [
    actorType,
    category,
    createdFrom,
    createdTo,
    outcome,
    page,
    pageSize,
    restaurantId,
    search,
    searchParams,
    setSearchParams,
    tab,
    typeFilter,
  ])

  const activeRows = tab === 'activity'
    ? activityLogs.length
    : tab === 'audit'
      ? auditLogs.length
      : tab === 'orders'
        ? orderLogs.length
        : paymentLogs.length
  const pageStart = totalItems === 0 ? 0 : (page - 1) * pageSize + 1
  const pageEnd = Math.min(page * pageSize, totalItems)
  const currentPage = totalPages === 0 ? 0 : page
  const currentTabLabel = tab === 'activity'
    ? 'Business activity'
    : tab === 'audit'
      ? 'Technical audit'
      : tab === 'orders'
        ? 'Order events'
        : 'Payment events'
  const hasActiveFilters = Boolean(
    search.trim() ||
    restaurantId ||
    typeFilter ||
    category ||
    actorType ||
    outcome ||
    createdFrom ||
    createdTo,
  )
  const activeDropdownFilterCount = [
    restaurantId,
    tab === 'activity' ? category : typeFilter,
    tab === 'activity' ? actorType : '',
    tab === 'activity' ? outcome : '',
    createdFrom,
    createdTo,
  ].filter(Boolean).length

  const resetReportFilters = () => {
    setPage(1)
    setSearch('')
    setRestaurantId('')
    setTypeFilter('')
    setCategory('')
    setActorType('')
    setOutcome('')
    setCreatedFrom('')
    setCreatedTo('')
  }

  const setReportTab = (value: string) => {
    setTab(getReportTab(value))
    setPage(1)
    setTypeFilter('')
    setCategory('')
    setActorType('')
    setOutcome('')
  }

  const exportReports = async () => {
    setExporting(true)
    try {
      const params = tab === 'activity'
        ? { ...activityParams, page: undefined, pageSize: undefined }
        : { ...technicalParams, page: undefined, pageSize: undefined }
      const result = await downloadReportLogsCsv(tab, params)
      const url = URL.createObjectURL(result.blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${tab}-report-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)

      if (result.truncated) {
        toast.warning(`CSV exported with the first ${result.rowLimit.toLocaleString('en-AU')} matching rows`, {
          description: 'Narrow the filters and export again for the remaining records.',
        })
      } else {
        toast.success('CSV exported')
      }
    } catch (error) {
      toast.error('Could not export CSV', {
        description: error instanceof Error ? error.message : 'Report export failed.',
      })
    } finally {
      setExporting(false)
    }
  }

  const restaurantTimezone = (id: string | null) =>
    restaurants.find((restaurant) => restaurant.id === id)?.timezone

  return (
    <main className="content-grid">
      <Card>
        <CardHeader>
          <div className="section-header">
            <div className="admin-page-title">
              <BarChart3 size={22} />
              <div>
                <h1 className="admin-reports-heading">Reports</h1>
                <CardDescription>
                  Understand who did what, follow order and payment outcomes, and retain technical evidence.
                </CardDescription>
              </div>
            </div>
            <div className="report-header-actions">
              <Button type="button" variant="outline" onClick={() => void exportReports()} disabled={exporting || loading}>
                <Download size={18} />
                {exporting ? 'Exporting' : 'Export CSV'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setRefreshVersion((current) => current + 1)}
                disabled={loading}
              >
                <RefreshCw size={18} />
                {loading ? 'Refreshing' : 'Refresh'}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="directory-stack">
          <Tabs value={tab} onValueChange={setReportTab} className="admin-reports-tabs">
            <TabsList className="admin-reports-tabs-list" aria-label="Report views">
              <TabsTrigger value="activity"><FileClock size={15} /> Activity</TabsTrigger>
              <TabsTrigger value="audit"><ShieldCheck size={15} /> Audit</TabsTrigger>
              <TabsTrigger value="orders"><Activity size={15} /> Orders</TabsTrigger>
              <TabsTrigger value="payments"><CreditCard size={15} /> Payments</TabsTrigger>
            </TabsList>

            <section className="admin-reports-summary-panel" aria-label="Report summary">
              <button
                type="button"
                className="admin-reports-summary-toggle"
                aria-expanded={reportSummaryExpanded}
                onClick={() => setReportSummaryExpanded((current) => !current)}
              >
                <span className="admin-reports-summary-title"><BarChart3 size={16} /> Report summary</span>
                <span className="admin-reports-summary-meta">{activeRows} visible / {totalItems} matches</span>
                {reportSummaryExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>

              {reportSummaryExpanded && tab === 'activity' && (
                <div className="report-business-summary-grid">
                  <div><Activity size={17} /><span>Activity today · {activitySummary.timeZone}</span><strong>{activitySummary.activityCountToday}</strong></div>
                  <div><CheckCircle2 size={17} /><span>Completed orders</span><strong>{activitySummary.completedOrdersToday}</strong></div>
                  <div><CircleDollarSign size={17} /><span>Payments received</span><strong>{formatMoneyTotals(activitySummary.paymentsReceivedToday)}</strong></div>
                  <div><CreditCard size={17} /><span>Refunded</span><strong>{formatMoneyTotals(activitySummary.refundsSucceededToday)}</strong></div>
                  <div className={activitySummary.failedPaymentsToday > 0 ? 'summary-has-errors' : ''}>
                    <AlertCircle size={17} /><span>Failed payments</span><strong>{activitySummary.failedPaymentsToday}</strong>
                  </div>
                </div>
              )}

              {reportSummaryExpanded && tab !== 'activity' && (
                <div className="placeholder-grid report-summary-grid admin-reports-summary-grid">
                  <div className="placeholder-item"><strong>Current view</strong><span>{currentTabLabel}</span></div>
                  <div className="placeholder-item"><strong>Total matches</strong><span>{totalItems}</span></div>
                  <div className="placeholder-item">
                    <strong>Retention</strong>
                    <span>
                      {policy
                        ? `${tab === 'orders' ? policy.orderEventRetentionDays : tab === 'payments' ? policy.paymentEventRetentionDays : policy.auditRetentionDays} days`
                        : 'Loading policy…'}
                    </span>
                  </div>
                  <div className="placeholder-item">
                    <strong>Integrity</strong>
                    <span>{policy?.logsAreImmutable ? 'Append-only / immutable' : 'Loading policy…'}</span>
                  </div>
                </div>
              )}
            </section>

            <div className="directory-tools admin-reports-tools restaurant-filter-tools">
              <div className="admin-reports-filter-row">
                <div className="restaurant-filter-search-row admin-reports-search-row">
                  <div className="directory-search">
                    <Search size={16} />
                    <Input
                      value={search}
                      onChange={(event) => { setPage(1); setSearch(event.target.value) }}
                      placeholder={tab === 'activity'
                        ? 'Search people, orders, payments, or actions'
                        : 'Search event, order, actor, provider, or message'}
                      aria-label="Search reports"
                    />
                  </div>

                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="restaurant-filter-trigger"
                        aria-label="Filter reports"
                      >
                        <SlidersHorizontal size={16} />
                        {activeDropdownFilterCount > 0 && (
                          <span className="restaurant-filter-count">{activeDropdownFilterCount}</span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="restaurant-filter-popover admin-reports-filter-popover" align="end">
                      <div className="restaurant-filter-popover-header">
                        <strong>Filters</strong>
                        <Button type="button" variant="ghost" size="xs" onClick={resetReportFilters} disabled={!hasActiveFilters}>
                          <X size={13} /> Clear all
                        </Button>
                      </div>
                      <div className="restaurant-filter-fields">
                        <label className="restaurant-filter-field">
                          <span>Restaurant</span>
                          <Select value={restaurantId || 'all'} onValueChange={(value) => { setPage(1); setRestaurantId(value === 'all' ? '' : value) }}>
                            <SelectTrigger aria-label="Filter reports by restaurant"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All restaurants</SelectItem>
                              {restaurants.map((restaurant) => (
                                <SelectItem key={restaurant.id} value={restaurant.id}>{restaurant.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </label>

                        {tab === 'activity' ? (
                          <>
                            <label className="restaurant-filter-field">
                              <span>Category</span>
                              <Select value={category || 'all'} onValueChange={(value) => { setPage(1); setCategory(value === 'all' ? '' : value) }}>
                                <SelectTrigger aria-label="Filter activity by category"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="all">All categories</SelectItem>
                                  {['Order', 'Payment', 'Refund', 'Account', 'User', 'Restaurant', 'Menu', 'System'].map((value) => (
                                    <SelectItem key={value} value={value}>{value}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </label>
                            <label className="restaurant-filter-field">
                              <span>Who</span>
                              <Select value={actorType || 'all'} onValueChange={(value) => { setPage(1); setActorType(value === 'all' ? '' : value) }}>
                                <SelectTrigger aria-label="Filter activity by actor type"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="all">Everyone and every system</SelectItem>
                                  <SelectItem value="User">Staff and administrators</SelectItem>
                                  <SelectItem value="Customer">Customers</SelectItem>
                                  <SelectItem value="Automation">DineFlow automation</SelectItem>
                                  <SelectItem value="Provider">Payment providers</SelectItem>
                                  <SelectItem value="System">System</SelectItem>
                                </SelectContent>
                              </Select>
                            </label>
                            <label className="restaurant-filter-field">
                              <span>Outcome</span>
                              <Select value={outcome || 'all'} onValueChange={(value) => { setPage(1); setOutcome(value === 'all' ? '' : value) }}>
                                <SelectTrigger aria-label="Filter activity by outcome"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="all">All outcomes</SelectItem>
                                  <SelectItem value="success">Successful</SelectItem>
                                  <SelectItem value="warning">Warnings</SelectItem>
                                  <SelectItem value="failed">Failed</SelectItem>
                                </SelectContent>
                              </Select>
                            </label>
                          </>
                        ) : (
                          <label className="restaurant-filter-field">
                            <span>{tab === 'audit' ? 'Action' : 'Event type'}</span>
                            <Input
                              value={typeFilter}
                              onChange={(event) => { setPage(1); setTypeFilter(event.target.value) }}
                              placeholder={tab === 'audit' ? 'e.g. User.Updated' : 'e.g. order.status_changed'}
                            />
                          </label>
                        )}

                        <div className="report-date-filter-grid">
                          <label className="restaurant-filter-field">
                            <span>From date</span>
                            <Input type="date" value={createdFrom} max={createdTo || undefined} onChange={(event) => { setPage(1); setCreatedFrom(event.target.value) }} />
                          </label>
                          <label className="restaurant-filter-field">
                            <span>Through date</span>
                            <Input type="date" value={createdTo} min={createdFrom || undefined} onChange={(event) => { setPage(1); setCreatedTo(event.target.value) }} />
                          </label>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {hasActiveFilters && (
                <div className="restaurant-filter-chips admin-reports-filter-chips" aria-label="Active report filters">
                  {search.trim() && <button type="button" className="restaurant-filter-chip" onClick={() => { setPage(1); setSearch('') }}><span>Search: {search.trim()}</span><X size={13} /></button>}
                  {restaurantId && <button type="button" className="restaurant-filter-chip" onClick={() => { setPage(1); setRestaurantId('') }}><span>Restaurant: {restaurants.find((item) => item.id === restaurantId)?.name ?? shortReportId(restaurantId)}</span><X size={13} /></button>}
                  {category && <button type="button" className="restaurant-filter-chip" onClick={() => { setPage(1); setCategory('') }}><span>Category: {category}</span><X size={13} /></button>}
                  {actorType && <button type="button" className="restaurant-filter-chip" onClick={() => { setPage(1); setActorType('') }}><span>Who: {humanActorType(actorType)}</span><X size={13} /></button>}
                  {outcome && <button type="button" className="restaurant-filter-chip" onClick={() => { setPage(1); setOutcome('') }}><span>Outcome: {outcome}</span><X size={13} /></button>}
                  {typeFilter && <button type="button" className="restaurant-filter-chip" onClick={() => { setPage(1); setTypeFilter('') }}><span>Event: {typeFilter}</span><X size={13} /></button>}
                  {createdFrom && <button type="button" className="restaurant-filter-chip" onClick={() => { setPage(1); setCreatedFrom('') }}><span>From: {createdFrom}</span><X size={13} /></button>}
                  {createdTo && <button type="button" className="restaurant-filter-chip" onClick={() => { setPage(1); setCreatedTo('') }}><span>Through: {createdTo}</span><X size={13} /></button>}
                  <button type="button" className="restaurant-filter-chip restaurant-filter-chip-clear" onClick={resetReportFilters}><X size={13} /><span>Clear all</span></button>
                </div>
              )}
            </div>

            {loadError && (
              <div className="admin-payments-error-banner report-error-banner" role="alert">
                <AlertCircle size={18} />
                <div><strong>Reports could not be loaded</strong><span>{loadError}</span></div>
                <Button type="button" variant="outline" size="sm" onClick={() => setRefreshVersion((current) => current + 1)}>Retry</Button>
              </div>
            )}

            <TabsContent value="activity" className="report-tab-content">
              <ActivityFeed items={activityLogs} loading={loading} />
            </TabsContent>

            <TabsContent value="audit" className="report-tab-content">
              <div className="report-table-wrap">
                <HorizontalTableScroll topScrollLabel="Scroll audit log table horizontally">
                  <table className="data-table report-log-table">
                    <caption className="sr-only">Technical audit events</caption>
                    <thead><tr><th>Action</th><th>Actor</th><th>Entity</th><th>Summary</th><th>Change</th><th>Time</th></tr></thead>
                    <tbody>
                      {auditLogs.map((log) => (
                        <tr key={log.id}>
                          <td><Badge variant="outline">{log.action}</Badge><span className="table-subtext">{log.source ?? 'DineFlow'}</span></td>
                          <td><strong>{log.actorEmail || (log.actorType === 'System' ? 'DineFlow' : 'Unknown actor')}</strong><span className="table-subtext">{log.actorRoles || log.actorType || log.actorUserId || 'System'}</span></td>
                          <td><strong>{log.entityType}</strong><span className="table-subtext">{shortReportId(log.entityId)}</span></td>
                          <td><ExpandableText value={log.summary} empty="No summary" /></td>
                          <td><JsonSnippet value={log.afterJson ?? log.beforeJson} /></td>
                          <td>{formatReportDate(log.createdAt, restaurantTimezone(log.restaurantId))}</td>
                        </tr>
                      ))}
                      {auditLogs.length === 0 && <tr><td colSpan={6} className="empty-cell">{loading ? 'Loading audit logs…' : 'No audit logs found.'}</td></tr>}
                    </tbody>
                  </table>
                </HorizontalTableScroll>
              </div>
              <div className="restaurant-mobile-list report-mobile-list" aria-label="Technical audit events">
                {auditLogs.map((log) => (
                  <article key={log.id} className="report-mobile-card">
                    <div className="report-mobile-card-heading"><Badge variant="outline">{log.action}</Badge><time>{formatReportDate(log.createdAt, restaurantTimezone(log.restaurantId))}</time></div>
                    <strong>{log.actorEmail || (log.actorType === 'System' ? 'DineFlow' : 'Unknown actor')}</strong>
                    <span>{log.summary || 'No summary'}</span>
                    <small>{log.entityType} · {shortReportId(log.entityId)}</small>
                    <JsonSnippet value={log.afterJson ?? log.beforeJson} />
                  </article>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="orders" className="report-tab-content">
              <div className="report-table-wrap">
                <HorizontalTableScroll topScrollLabel="Scroll order event table horizontally">
                  <table className="data-table report-log-table">
                    <caption className="sr-only">Order event timeline</caption>
                    <thead><tr><th>Event</th><th>Order</th><th>Actor</th><th>Message</th><th>Data</th><th>Time</th></tr></thead>
                    <tbody>
                      {orderLogs.map((log) => (
                        <tr key={log.id}>
                          <td><Badge variant="outline">{log.eventType}</Badge><span className="table-subtext">{log.source ?? 'DineFlow'}</span></td>
                          <td><Link to={`/admin/orders?q=${encodeURIComponent(log.orderNumber)}`}><strong>{log.orderNumber}</strong></Link><span className="table-subtext">{shortReportId(log.orderId)}</span></td>
                          <td><strong>{log.actorDisplayName || (log.actorType === 'Automation' ? 'DineFlow automation' : 'System')}</strong><span className="table-subtext">{log.actorRoles || log.actorType || log.actorUserId || 'System'}</span></td>
                          <td><ExpandableText value={log.message} /></td>
                          <td><JsonSnippet value={log.dataJson} /></td>
                          <td>{formatReportDate(log.createdAt, restaurantTimezone(log.restaurantId))}</td>
                        </tr>
                      ))}
                      {orderLogs.length === 0 && <tr><td colSpan={6} className="empty-cell">{loading ? 'Loading order events…' : 'No order events found.'}</td></tr>}
                    </tbody>
                  </table>
                </HorizontalTableScroll>
              </div>
              <div className="restaurant-mobile-list report-mobile-list" aria-label="Order event timeline">
                {orderLogs.map((log) => (
                  <article key={log.id} className="report-mobile-card">
                    <div className="report-mobile-card-heading"><Badge variant="outline">{log.eventType}</Badge><time>{formatReportDate(log.createdAt, restaurantTimezone(log.restaurantId))}</time></div>
                    <Link to={`/admin/orders?q=${encodeURIComponent(log.orderNumber)}`}><strong>{log.orderNumber}</strong></Link>
                    <span>{log.message}</span>
                    <small>{log.actorDisplayName || (log.actorType === 'Automation' ? 'DineFlow automation' : 'System')}</small>
                    <JsonSnippet value={log.dataJson} />
                  </article>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="payments" className="report-tab-content">
              <div className="report-table-wrap">
                <HorizontalTableScroll topScrollLabel="Scroll payment event table horizontally">
                  <table className="data-table report-log-table">
                    <caption className="sr-only">Payment and refund provider events</caption>
                    <thead><tr><th>Event</th><th>Order</th><th>Payment</th><th>Actor</th><th>Status</th><th>Message</th><th>Data</th><th>Time</th></tr></thead>
                    <tbody>
                      {paymentLogs.map((log) => (
                        <tr key={log.id}>
                          <td><Badge variant="outline">{log.eventType}</Badge><span className="table-subtext">{log.provider}</span></td>
                          <td>{log.orderNumber ? <Link to={`/admin/orders?q=${encodeURIComponent(log.orderNumber)}`}><strong>{log.orderNumber}</strong></Link> : <span>None</span>}<span className="table-subtext">{shortReportId(log.orderId)}</span></td>
                          <td><strong>{shortReportId(log.paymentId)}</strong><span className="table-subtext">{shortReportId(log.providerEventId)}</span></td>
                          <td><strong>{log.actorDisplayName || (log.actorType === 'Provider' ? log.provider : 'System')}</strong><span className="table-subtext">{log.actorRoles || log.actorType || log.source || 'System'}</span></td>
                          <td>{log.status ? <Badge variant="secondary">{log.status}</Badge> : <span className="table-subtext">None</span>}</td>
                          <td><ExpandableText value={log.message} /></td>
                          <td><JsonSnippet value={log.dataJson} /></td>
                          <td>{formatReportDate(log.createdAt, restaurantTimezone(log.restaurantId))}</td>
                        </tr>
                      ))}
                      {paymentLogs.length === 0 && <tr><td colSpan={8} className="empty-cell">{loading ? 'Loading payment events…' : 'No payment events found.'}</td></tr>}
                    </tbody>
                  </table>
                </HorizontalTableScroll>
              </div>
              <div className="restaurant-mobile-list report-mobile-list" aria-label="Payment and refund provider events">
                {paymentLogs.map((log) => (
                  <article key={log.id} className="report-mobile-card">
                    <div className="report-mobile-card-heading"><Badge variant="outline">{log.eventType}</Badge><time>{formatReportDate(log.createdAt, restaurantTimezone(log.restaurantId))}</time></div>
                    <strong>{log.actorDisplayName || (log.actorType === 'Provider' ? log.provider : 'System')}</strong>
                    <span>{log.message}</span>
                    <small>{log.orderNumber || shortReportId(log.paymentId)} · {log.status || 'No status'}</small>
                    <JsonSnippet value={log.dataJson} />
                  </article>
                ))}
              </div>
            </TabsContent>
          </Tabs>

          <div className="pagination-bar compact-pagination admin-reports-pagination">
            <span className="pagination-range">
              <span className="pagination-full">Showing {pageStart}-{pageEnd} of {totalItems}</span>
              <span className="pagination-compact">{pageStart}-{pageEnd} / {totalItems}</span>
            </span>
            <div className="pagination-actions">
              <Select value={String(pageSize)} onValueChange={(value) => { setPage(1); setPageSize(Number(value)) }}>
                <SelectTrigger className="page-size-select" aria-label="Report rows per page"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="20">20 / page</SelectItem>
                  <SelectItem value="50">50 / page</SelectItem>
                  <SelectItem value="100">100 / page</SelectItem>
                </SelectContent>
              </Select>
              <span className="pagination-page">
                <span className="pagination-full">Page {currentPage} of {totalPages}</span>
                <span className="pagination-compact">{currentPage} / {totalPages}</span>
              </span>
              <Button type="button" variant="outline" size="icon" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={loading || page <= 1} aria-label="Previous report page"><ChevronLeft size={16} /></Button>
              <Button type="button" variant="outline" size="icon" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={loading || page >= totalPages} aria-label="Next report page"><ChevronRight size={16} /></Button>
            </div>
          </div>

          <p className="report-policy-note">
            <ShieldCheck size={14} />
            Logs are append-only. Raw technical details and network identifiers are restricted to platform owners.
            {policy && ` CSV exports are limited to ${policy.maxExportRows.toLocaleString('en-AU')} rows.`}
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
