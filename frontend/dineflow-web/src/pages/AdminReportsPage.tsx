import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, BarChart3, ChevronDown, ChevronUp, CreditCard, Download, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'

type ReportTab = 'audit' | 'orders' | 'payments'

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

function JsonSnippet({ value }: { value: string | null }) {
  const [expanded, setExpanded] = useState(false)

  if (!value) {
    return <span className="table-subtext">No details</span>
  }

  return (
    <span className="report-expandable-cell">
      <code className={`report-json-snippet${expanded ? ' expanded' : ''}`}>{value}</code>
      <button type="button" className="report-expand-button" onClick={() => setExpanded((current) => !current)}>
        {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        {expanded ? 'Show less' : 'Show more'}
      </button>
    </span>
  )
}

export function AdminReportsPage() {
  const [tab, setTab] = useState<ReportTab>('audit')
  const [search, setSearch] = useState('')
  const [restaurantId, setRestaurantId] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [orderLogs, setOrderLogs] = useState<OrderEventLog[]>([])
  const [paymentLogs, setPaymentLogs] = useState<PaymentEventLog[]>([])
  const [totalItems, setTotalItems] = useState(0)
  const [totalPages, setTotalPages] = useState(0)

  const pageStart = totalItems === 0 ? 0 : (page - 1) * pageSize + 1
  const pageEnd = Math.min(page * pageSize, totalItems)
  const typeFilterPlaceholder = tab === 'audit' ? 'Action filter' : 'Event type filter'

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
    void loadReports()
  }, [loadReports])

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
          <div className="placeholder-grid report-summary-grid">
            <div className="placeholder-item">
              <strong>Current tab</strong>
              <span>{tab === 'audit' ? 'Audit' : tab === 'orders' ? 'Order timeline' : 'Payment events'}</span>
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

          <div className="directory-tools admin-reports-tools">
            <div className="directory-search">
              <Search size={16} />
              <Input
                value={search}
                onChange={(event) => { setPage(1); setSearch(event.target.value) }}
                placeholder="Search action, order, provider event, actor, or message"
              />
            </div>
            <Input
              value={restaurantId}
              onChange={(event) => { setPage(1); setRestaurantId(event.target.value) }}
              placeholder="Restaurant id"
              className="report-filter-input"
            />
            <Input
              value={typeFilter}
              onChange={(event) => { setPage(1); setTypeFilter(event.target.value) }}
              placeholder={typeFilterPlaceholder}
              className="report-filter-input"
            />
          </div>

          <Tabs
            value={tab}
            onValueChange={(value) => {
              setTab(value as ReportTab)
              setPage(1)
              setTypeFilter('')
            }}
          >
            <TabsList>
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

            <TabsContent value="audit">
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
            </TabsContent>

            <TabsContent value="orders">
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
            </TabsContent>

            <TabsContent value="payments">
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
            </TabsContent>
          </Tabs>

          <div className="pagination-bar">
            <span>{pageStart}-{pageEnd} of {totalItems}</span>
            <div className="pagination-actions">
              <Select value={String(pageSize)} onValueChange={(value) => { setPage(1); setPageSize(Number(value)) }}>
                <SelectTrigger className="page-size-select" aria-label="Report rows per page">
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
