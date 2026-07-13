import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  BarChart3,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CreditCard,
  Database,
  Download,
  FileText,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useSearchParams } from 'react-router-dom'
import {
  getAuditLogs,
  downloadReportLogsCsv,
  getOrderEventLogs,
  getPaymentEventLogs,
  type AuditLog,
  type OrderEventLog,
  type PaymentEventLog,
} from '../api/auth'
import { HorizontalTableScroll } from '../components/HorizontalTableScroll'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
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

type ReportTab = 'audit' | 'orders' | 'payments'
const reportTabs = ['audit', 'orders', 'payments'] as const satisfies readonly ReportTab[]

function getReportTab(value: string | null): ReportTab {
  return reportTabs.includes(value as ReportTab) ? (value as ReportTab) : 'audit'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function shortId(value: string | null | undefined) {
  if (!value) {
    return 'None'
  }

  return value.length <= 12 ? value : `${value.slice(0, 8)}...${value.slice(-4)}`
}

function ExpandableText({
  value,
  empty = 'No details',
}: {
  value: string | null | undefined
  empty?: string
}) {
  const [expanded, setExpanded] = useState(false)

  if (!value) {
    return <span className="table-subtext">{empty}</span>
  }

  return (
    <span className="report-expandable-cell">
      <span className={`report-expandable-text${expanded ? ' expanded' : ''}`}>{value}</span>
      <button type="button" className="report-expand-button" onClick={() => setExpanded((current) => !current)}>
        {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        {expanded ? 'Show less' : 'Show more'}
      </button>
    </span>
  )
}

const JSON_TOKEN_RE = /("(?:[^"\\]|\\.)*")\s*:|("(?:[^"\\]|\\.)*")|(true|false|null)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g

function formatJsonNodes(raw: string): ReactNode {
  let formatted: string
  try {
    formatted = JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    formatted = raw
  }

  const nodes: ReactNode[] = []
  let lastIndex = 0
  let m: RegExpExecArray | null
  JSON_TOKEN_RE.lastIndex = 0

  while ((m = JSON_TOKEN_RE.exec(formatted)) !== null) {
    if (m.index > lastIndex) nodes.push(formatted.slice(lastIndex, m.index))
    const full = m[0]
    const key = m[1]
    const str = m[2]
    const kw = m[3]
    const num = m[4]
    if (key !== undefined) {
      nodes.push(<span key={m.index} className="json-hl-key">{key}</span>)
      nodes.push(full.slice(key.length))
    } else if (str !== undefined) {
      nodes.push(<span key={m.index} className="json-hl-str">{str}</span>)
    } else if (kw === 'true' || kw === 'false') {
      nodes.push(<span key={m.index} className="json-hl-bool">{kw}</span>)
    } else if (kw === 'null') {
      nodes.push(<span key={m.index} className="json-hl-null">{kw}</span>)
    } else if (num !== undefined) {
      nodes.push(<span key={m.index} className="json-hl-num">{num}</span>)
    }
    lastIndex = m.index + full.length
  }
  if (lastIndex < formatted.length) nodes.push(formatted.slice(lastIndex))
  return <>{nodes}</>
}

function JsonSnippet({ value }: { value: string | null }) {
  const [expanded, setExpanded] = useState(false)

  if (!value) {
    return <span className="table-subtext">No details</span>
  }

  return (
    <span className="report-expandable-cell">
      <code className={`report-json-snippet${expanded ? ' expanded' : ''}`}>
        {formatJsonNodes(value)}
      </code>
      <button type="button" className="report-expand-button" onClick={() => setExpanded((current) => !current)}>
        {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        {expanded ? 'Show less' : 'Show more'}
      </button>
    </span>
  )
}

export function AdminReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState<ReportTab>(() => getReportTab(searchParams.get('section')))
  const [search, setSearch] = useState('')
  const [restaurantId, setRestaurantId] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [reportSummaryExpanded, setReportSummaryExpanded] = useState(false)

  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [orderLogs, setOrderLogs] = useState<OrderEventLog[]>([])
  const [paymentLogs, setPaymentLogs] = useState<PaymentEventLog[]>([])
  const [totalItems, setTotalItems] = useState(0)
  const [totalPages, setTotalPages] = useState(0)

  const pageStart = totalItems === 0 ? 0 : (page - 1) * pageSize + 1
  const pageEnd = Math.min(page * pageSize, totalItems)
  const typeFilterPlaceholder = tab === 'audit' ? 'Action filter' : 'Event type filter'
  const currentPage = totalPages === 0 ? 0 : page
  const currentTabLabel = tab === 'audit' ? 'Audit' : tab === 'orders' ? 'Order timeline' : 'Payment events'
  const hasActiveFilters = search.trim() !== '' || restaurantId.trim() !== '' || typeFilter.trim() !== ''
  const activeDropdownFilterCount = [restaurantId.trim() !== '', typeFilter.trim() !== ''].filter(Boolean).length

  const activeCount = useMemo(() => {
    if (tab === 'audit') return auditLogs.length
    if (tab === 'orders') return orderLogs.length
    return paymentLogs.length
  }, [auditLogs.length, orderLogs.length, paymentLogs.length, tab])

  const buildReportParams = useCallback((includePaging: boolean) => {
    const baseParams = {
      ...(includePaging ? { page, pageSize } : {}),
      search: search.trim() || undefined,
      restaurantId: restaurantId.trim() || undefined,
      sortBy: 'createdAt',
      sortDirection: 'desc' as const,
    }

    return tab === 'audit'
      ? {
        ...baseParams,
        action: typeFilter.trim() || undefined,
      }
      : {
        ...baseParams,
        eventType: typeFilter.trim() || undefined,
      }
  }, [page, pageSize, restaurantId, search, tab, typeFilter])

  const loadReports = useCallback(async (showToast = false) => {
    setLoading(true)

    try {
      const params = buildReportParams(true)

      if (tab === 'audit') {
        const response = await getAuditLogs(params)
        setAuditLogs(response.items)
        setTotalItems(response.totalItems)
        setTotalPages(response.totalPages)
      } else if (tab === 'orders') {
        const response = await getOrderEventLogs(params)
        setOrderLogs(response.items)
        setTotalItems(response.totalItems)
        setTotalPages(response.totalPages)
      } else {
        const response = await getPaymentEventLogs(params)
        setPaymentLogs(response.items)
        setTotalItems(response.totalItems)
        setTotalPages(response.totalPages)
      }

      if (showToast) {
        toast.success('Reports refreshed')
      }
    } catch (error) {
      toast.error('Could not load reports', {
        description: error instanceof Error ? error.message : 'Report loading failed.',
      })
    } finally {
      setLoading(false)
    }
  }, [buildReportParams, tab])

  const exportReports = useCallback(async () => {
    setExporting(true)

    try {
      const blob = await downloadReportLogsCsv(tab, buildReportParams(false))
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const date = new Date().toISOString().slice(0, 10)

      link.href = url
      link.download = `${tab}-report-${date}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      toast.success('CSV exported')
    } catch (error) {
      toast.error('Could not export CSV', {
        description: error instanceof Error ? error.message : 'Report export failed.',
      })
    } finally {
      setExporting(false)
    }
  }, [buildReportParams, tab])

  useEffect(() => {
    void Promise.resolve().then(() => loadReports())
  }, [loadReports])

  useEffect(() => {
    const nextTab = getReportTab(searchParams.get('section'))
    void Promise.resolve().then(() => {
      setTab((current) => current === nextTab ? current : nextTab)
    })
  }, [searchParams])

  const setReportTab = (value: string) => {
    const nextTab = getReportTab(value)
    setTab(nextTab)
    setPage(1)
    setTypeFilter('')

    setSearchParams((current) => {
      const next = new URLSearchParams(current)

      if (nextTab === 'audit') {
        next.delete('section')
      } else {
        next.set('section', nextTab)
      }

      return next
    }, { replace: true })
  }

  const resetReportFilters = () => {
    setPage(1)
    setSearch('')
    setRestaurantId('')
    setTypeFilter('')
  }

  return (
    <main className="content-grid">
      <Card>
        <CardHeader>
          <div className="section-header">
            <div className="admin-page-title">
              <BarChart3 size={22} />
              <div>
                <CardTitle>Reports</CardTitle>
                <CardDescription>
                  Audit trail, order timeline, and payment events for business-critical actions.
                </CardDescription>
              </div>
            </div>
            <div className="report-header-actions">
              <Button type="button" variant="outline" onClick={() => void exportReports()} disabled={exporting || loading}>
                <Download size={18} />
                {exporting ? 'Exporting' : 'Export CSV'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => void loadReports(true)} disabled={loading}>
                <RefreshCw size={18} />
                {loading ? 'Refreshing' : 'Refresh'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="directory-stack">
          <Tabs
            value={tab}
            onValueChange={setReportTab}
            className="admin-reports-tabs"
          >
            <TabsList className="admin-reports-tabs-list" aria-label="Report views">
              <TabsTrigger value="audit">
                <ShieldCheck size={15} />
                Audit
              </TabsTrigger>
              <TabsTrigger value="orders">
                <Activity size={15} />
                Orders
              </TabsTrigger>
              <TabsTrigger value="payments">
                <CreditCard size={15} />
                Payments
              </TabsTrigger>
            </TabsList>

            <section className="admin-reports-summary-panel" aria-label="Report summary">
              <button
                type="button"
                className="admin-reports-summary-toggle"
                aria-expanded={reportSummaryExpanded}
                onClick={() => setReportSummaryExpanded((current) => !current)}
              >
                <span className="admin-reports-summary-title">
                  <BarChart3 size={16} />
                  Report summary
                </span>
                <span className="admin-reports-summary-meta">
                  {activeCount} visible / {totalItems} matches
                </span>
                {reportSummaryExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>

              {reportSummaryExpanded && (
                <div className="placeholder-grid report-summary-grid admin-reports-summary-grid">
                  <div className="placeholder-item">
                    <strong>Current tab</strong>
                    <span>{currentTabLabel}</span>
                  </div>
                  <div className="placeholder-item">
                    <strong>Visible rows</strong>
                    <span>{activeCount}</span>
                  </div>
                  <div className="placeholder-item">
                    <strong>Total matches</strong>
                    <span>{totalItems}</span>
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
                      placeholder="Search action, order, provider event, actor, or message"
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
                          <X size={13} />
                          Clear all
                        </Button>
                      </div>
                      <div className="restaurant-filter-fields">
                        <div className="restaurant-filter-field">
                          <span>Restaurant id</span>
                          <Input
                            value={restaurantId}
                            onChange={(event) => { setPage(1); setRestaurantId(event.target.value) }}
                            placeholder="Restaurant id"
                          />
                        </div>
                        <div className="restaurant-filter-field">
                          <span>{tab === 'audit' ? 'Action' : 'Event type'}</span>
                          <Input
                            value={typeFilter}
                            onChange={(event) => { setPage(1); setTypeFilter(event.target.value) }}
                            placeholder={typeFilterPlaceholder}
                          />
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {hasActiveFilters && (
                <div className="restaurant-filter-chips admin-reports-filter-chips" aria-label="Active report filters">
                  {search.trim() && (
                    <button type="button" className="restaurant-filter-chip" onClick={() => { setPage(1); setSearch('') }} title={`Search: ${search.trim()}`}>
                      <span>Search: {search.trim()}</span>
                      <X size={13} />
                    </button>
                  )}
                  {restaurantId.trim() && (
                    <button type="button" className="restaurant-filter-chip" onClick={() => { setPage(1); setRestaurantId('') }} title={`Restaurant: ${restaurantId.trim()}`}>
                      <span>Restaurant: {restaurantId.trim()}</span>
                      <X size={13} />
                    </button>
                  )}
                  {typeFilter.trim() && (
                    <button type="button" className="restaurant-filter-chip" onClick={() => { setPage(1); setTypeFilter('') }} title={`${tab === 'audit' ? 'Action' : 'Event'}: ${typeFilter.trim()}`}>
                      <span>{tab === 'audit' ? 'Action' : 'Event'}: {typeFilter.trim()}</span>
                      <X size={13} />
                    </button>
                  )}
                  <button type="button" className="restaurant-filter-chip restaurant-filter-chip-clear" onClick={resetReportFilters}>
                    <X size={13} />
                    <span>Clear all</span>
                  </button>
                </div>
              )}
            </div>

            <TabsContent value="audit" className="report-tab-content">
              <div className="report-table-wrap">
                <HorizontalTableScroll topScrollLabel="Scroll audit log table horizontally">
                  <table className="data-table report-log-table">
                  <thead>
                    <tr>
                      <th className="report-col-event">Action</th>
                      <th className="report-col-actor">Actor</th>
                      <th className="report-col-entity">Entity</th>
                      <th className="report-col-text">Summary</th>
                      <th className="report-col-details">After</th>
                      <th className="report-col-time">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="report-event-cell"><Badge variant="outline">{log.action}</Badge></td>
                        <td className="report-actor-cell">
                          <strong>{log.actorEmail || 'System / guest'}</strong>
                          <span className="table-subtext">{log.actorRoles || log.actorUserId || 'No actor id'}</span>
                        </td>
                        <td className="report-entity-cell">
                          <strong>{log.entityType}</strong>
                          <span className="table-subtext">{shortId(log.entityId)}</span>
                        </td>
                        <td className="report-text-cell"><ExpandableText value={log.summary} empty="No summary" /></td>
                        <td className="report-detail-cell"><JsonSnippet value={log.afterJson} /></td>
                        <td className="report-time-cell">{formatDate(log.createdAt)}</td>
                      </tr>
                    ))}
                    {auditLogs.length === 0 && (
                      <tr><td colSpan={6} className="empty-cell">{loading ? 'Loading audit logs...' : 'No audit logs found.'}</td></tr>
                    )}
                  </tbody>
                  </table>
                </HorizontalTableScroll>
              </div>

              <div className="restaurant-mobile-list report-mobile-list audit-report-mobile-list" aria-label="Audit logs">
                {auditLogs.map((log) => (
                  <article className="restaurant-mobile-card report-mobile-card" key={log.id}>
                    <header className="restaurant-mobile-card-header report-mobile-card-header">
                      <span className="restaurant-mobile-avatar">
                        <ShieldCheck size={18} />
                      </span>
                      <div className="restaurant-mobile-primary">
                        <strong title={log.action}>{log.action}</strong>
                        <span title={`${log.entityType} ${shortId(log.entityId)}`}>
                          {log.entityType} - {shortId(log.entityId)}
                        </span>
                      </div>
                      <Badge variant="outline">{log.action}</Badge>
                    </header>

                    <div className="restaurant-mobile-meta-grid report-mobile-meta-grid">
                      <div className="restaurant-mobile-meta">
                        <UserRound size={15} />
                        <div>
                          <span>Actor</span>
                          <strong title={log.actorEmail || undefined}>{log.actorEmail || 'System / guest'}</strong>
                          <small title={log.actorRoles || log.actorUserId || undefined}>{log.actorRoles || log.actorUserId || 'No actor id'}</small>
                        </div>
                      </div>
                      <div className="restaurant-mobile-meta">
                        <Database size={15} />
                        <div>
                          <span>Entity</span>
                          <strong title={log.entityType}>{log.entityType}</strong>
                          <small title={log.entityId || undefined}>{shortId(log.entityId)}</small>
                        </div>
                      </div>
                      <div className="restaurant-mobile-meta report-mobile-meta-wide">
                        <FileText size={15} />
                        <div>
                          <span>Summary</span>
                          <div className="report-mobile-copy">
                            <ExpandableText value={log.summary} empty="No summary" />
                          </div>
                        </div>
                      </div>
                      <div className="restaurant-mobile-meta report-mobile-meta-wide">
                        <Database size={15} />
                        <div>
                          <span>After</span>
                          <div className="report-mobile-copy">
                            <JsonSnippet value={log.afterJson} />
                          </div>
                        </div>
                      </div>
                      <div className="restaurant-mobile-meta">
                        <CalendarClock size={15} />
                        <div>
                          <span>Time</span>
                          <strong>{formatDate(log.createdAt)}</strong>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
                {auditLogs.length === 0 && (
                  <div className="restaurant-mobile-empty">{loading ? 'Loading audit logs...' : 'No audit logs found.'}</div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="orders" className="report-tab-content">
              <div className="report-table-wrap">
                <HorizontalTableScroll topScrollLabel="Scroll order event table horizontally">
                  <table className="data-table report-log-table">
                  <thead>
                    <tr>
                      <th className="report-col-event">Event</th>
                      <th className="report-col-order">Order</th>
                      <th className="report-col-actor">Actor</th>
                      <th className="report-col-text">Message</th>
                      <th className="report-col-details">Data</th>
                      <th className="report-col-time">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="report-event-cell"><Badge variant="outline">{log.eventType}</Badge></td>
                        <td className="report-entity-cell">
                          <strong>{log.orderNumber}</strong>
                          <span className="table-subtext">{shortId(log.orderId)}</span>
                        </td>
                        <td className="report-actor-cell">
                          <strong>{log.actorDisplayName || 'System / guest'}</strong>
                          <span className="table-subtext">{log.actorRoles || log.actorUserId || 'No actor id'}</span>
                        </td>
                        <td className="report-text-cell"><ExpandableText value={log.message} /></td>
                        <td className="report-detail-cell"><JsonSnippet value={log.dataJson} /></td>
                        <td className="report-time-cell">{formatDate(log.createdAt)}</td>
                      </tr>
                    ))}
                    {orderLogs.length === 0 && (
                      <tr><td colSpan={6} className="empty-cell">{loading ? 'Loading order events...' : 'No order events found.'}</td></tr>
                    )}
                  </tbody>
                  </table>
                </HorizontalTableScroll>
              </div>

              <div className="restaurant-mobile-list report-mobile-list order-report-mobile-list" aria-label="Order event logs">
                {orderLogs.map((log) => (
                  <article className="restaurant-mobile-card report-mobile-card" key={log.id}>
                    <header className="restaurant-mobile-card-header report-mobile-card-header">
                      <span className="restaurant-mobile-avatar">
                        <Activity size={18} />
                      </span>
                      <div className="restaurant-mobile-primary">
                        <strong title={log.orderNumber}>{log.orderNumber}</strong>
                        <span title={log.eventType}>{log.eventType}</span>
                      </div>
                      <Badge variant="outline">{log.eventType}</Badge>
                    </header>

                    <div className="restaurant-mobile-meta-grid report-mobile-meta-grid">
                      <div className="restaurant-mobile-meta">
                        <Database size={15} />
                        <div>
                          <span>Order</span>
                          <strong title={log.orderNumber}>{log.orderNumber}</strong>
                          <small title={log.orderId}>{shortId(log.orderId)}</small>
                        </div>
                      </div>
                      <div className="restaurant-mobile-meta">
                        <UserRound size={15} />
                        <div>
                          <span>Actor</span>
                          <strong title={log.actorDisplayName || undefined}>{log.actorDisplayName || 'System / guest'}</strong>
                          <small title={log.actorRoles || log.actorUserId || undefined}>{log.actorRoles || log.actorUserId || 'No actor id'}</small>
                        </div>
                      </div>
                      <div className="restaurant-mobile-meta report-mobile-meta-wide">
                        <FileText size={15} />
                        <div>
                          <span>Message</span>
                          <div className="report-mobile-copy">
                            <ExpandableText value={log.message} />
                          </div>
                        </div>
                      </div>
                      <div className="restaurant-mobile-meta report-mobile-meta-wide">
                        <Database size={15} />
                        <div>
                          <span>Data</span>
                          <div className="report-mobile-copy">
                            <JsonSnippet value={log.dataJson} />
                          </div>
                        </div>
                      </div>
                      <div className="restaurant-mobile-meta">
                        <CalendarClock size={15} />
                        <div>
                          <span>Time</span>
                          <strong>{formatDate(log.createdAt)}</strong>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
                {orderLogs.length === 0 && (
                  <div className="restaurant-mobile-empty">{loading ? 'Loading order events...' : 'No order events found.'}</div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="payments" className="report-tab-content">
              <div className="report-table-wrap">
                <HorizontalTableScroll topScrollLabel="Scroll payment event table horizontally">
                  <table className="data-table report-log-table">
                  <thead>
                    <tr>
                      <th className="report-col-event">Event</th>
                      <th className="report-col-order">Order</th>
                      <th className="report-col-payment">Payment</th>
                      <th className="report-col-status">Status</th>
                      <th className="report-col-text">Message</th>
                      <th className="report-col-details">Data</th>
                      <th className="report-col-time">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="report-event-cell">
                          <Badge variant="outline">{log.eventType}</Badge>
                          <span className="table-subtext">{log.provider}</span>
                        </td>
                        <td className="report-entity-cell">
                          <strong>{log.orderNumber || 'No order'}</strong>
                          <span className="table-subtext">{shortId(log.orderId)}</span>
                        </td>
                        <td className="report-entity-cell">
                          <strong>{shortId(log.paymentId)}</strong>
                          <span className="table-subtext">{log.providerEventId || shortId(log.paymentRefundId)}</span>
                        </td>
                        <td className="report-status-cell">{log.status ? <Badge variant="secondary">{log.status}</Badge> : 'None'}</td>
                        <td className="report-text-cell"><ExpandableText value={log.message} /></td>
                        <td className="report-detail-cell"><JsonSnippet value={log.dataJson} /></td>
                        <td className="report-time-cell">{formatDate(log.createdAt)}</td>
                      </tr>
                    ))}
                    {paymentLogs.length === 0 && (
                      <tr><td colSpan={7} className="empty-cell">{loading ? 'Loading payment events...' : 'No payment events found.'}</td></tr>
                    )}
                  </tbody>
                  </table>
                </HorizontalTableScroll>
              </div>

              <div className="restaurant-mobile-list report-mobile-list payment-report-mobile-list" aria-label="Payment event logs">
                {paymentLogs.map((log) => (
                  <article className="restaurant-mobile-card report-mobile-card" key={log.id}>
                    <header className="restaurant-mobile-card-header report-mobile-card-header">
                      <span className="restaurant-mobile-avatar">
                        <CreditCard size={18} />
                      </span>
                      <div className="restaurant-mobile-primary">
                        <strong title={log.eventType}>{log.eventType}</strong>
                        <span title={log.provider}>{log.provider}</span>
                      </div>
                      {log.status ? <Badge variant="secondary">{log.status}</Badge> : <Badge variant="outline">None</Badge>}
                    </header>

                    <div className="restaurant-mobile-meta-grid report-mobile-meta-grid">
                      <div className="restaurant-mobile-meta">
                        <Activity size={15} />
                        <div>
                          <span>Order</span>
                          <strong title={log.orderNumber || undefined}>{log.orderNumber || 'No order'}</strong>
                          <small title={log.orderId || undefined}>{shortId(log.orderId)}</small>
                        </div>
                      </div>
                      <div className="restaurant-mobile-meta">
                        <CreditCard size={15} />
                        <div>
                          <span>Payment</span>
                          <strong title={log.paymentId || undefined}>{shortId(log.paymentId)}</strong>
                          <small title={log.providerEventId || log.paymentRefundId || undefined}>{log.providerEventId || shortId(log.paymentRefundId)}</small>
                        </div>
                      </div>
                      <div className="restaurant-mobile-meta report-mobile-meta-wide">
                        <FileText size={15} />
                        <div>
                          <span>Message</span>
                          <div className="report-mobile-copy">
                            <ExpandableText value={log.message} />
                          </div>
                        </div>
                      </div>
                      <div className="restaurant-mobile-meta report-mobile-meta-wide">
                        <Database size={15} />
                        <div>
                          <span>Data</span>
                          <div className="report-mobile-copy">
                            <JsonSnippet value={log.dataJson} />
                          </div>
                        </div>
                      </div>
                      <div className="restaurant-mobile-meta">
                        <CalendarClock size={15} />
                        <div>
                          <span>Time</span>
                          <strong>{formatDate(log.createdAt)}</strong>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
                {paymentLogs.length === 0 && (
                  <div className="restaurant-mobile-empty">{loading ? 'Loading payment events...' : 'No payment events found.'}</div>
                )}
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
                <SelectTrigger className="page-size-select" aria-label="Report rows per page">
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
              <Button type="button" variant="outline" size="icon" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={loading || page <= 1} aria-label="Previous report page"><ChevronLeft size={16} /></Button>
              <Button type="button" variant="outline" size="icon" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={loading || page >= totalPages} aria-label="Next report page"><ChevronRight size={16} /></Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
