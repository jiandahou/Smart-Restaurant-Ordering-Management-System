import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Banknote,
  ClipboardCheck,
  Clock3,
  CreditCard,
  DoorOpen,
  Hash,
  History,
  Loader2,
  Printer,
  RefreshCw,
  Search,
  ShoppingBag,
  Table2,
  Utensils,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  getFrontCounterTable,
  getFrontCounterTables,
  getFrontCounterTakeaway,
  getRestaurants,
  settleCompleteFrontCounterOrder,
  settleCompleteFrontCounterTableSession,
  type AdminOrder,
  type FrontCounterTableDetail,
  type FrontCounterTableSummary,
  type Restaurant,
} from '@/api/auth'
import { useAuth } from '@/auth/AuthContext'
import { OrderItemOptionBadges } from '@/components/orders/OrderItemOptionBadges'
import { OrderStatusBadge } from '@/components/orders/OrderStatusBadge'
import { PaymentStatusBadge } from '@/components/orders/PaymentStatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { createOrderRealtimeClient, type OrderRealtimeUpdate } from '@/realtime/orderConnection'
import { cn } from '@/lib/utils'

type FrontCounterTab = 'takeaway' | 'tables'
type ReceiptPrintTarget =
  | {
      kind: 'order'
      order: AdminOrder
      requestedAt: number
      settled?: boolean
    }
  | {
      kind: 'table'
      table: FrontCounterTableDetail
      requestedAt: number
      settled?: boolean
    }

type FrontCounterReceiptItem = {
  id: string
  quantity: number
  name: string
  unitPrice: number
  totalPrice: number
  note: string | null
  selectedOptions: AdminOrder['items'][number]['selectedOptions']
}

const unfinishedStatuses = new Set(['Pending', 'Accepted', 'Preparing', 'Ready'])

function formatMoney(amount: number, currencyCode?: string | null) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: (currencyCode || 'AUD').toUpperCase(),
  }).format(amount)
}

function formatDateTime(value: string | null) {
  if (!value) return '-'

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function getOrderDisplayCode(order: AdminOrder) {
  return order.pickupCode || order.orderNumber
}

function getOrderActionLabel(order: AdminOrder) {
  if (order.paymentStatus === 'Paid') {
    return 'Complete pickup'
  }

  if (order.paymentMethod === 'PayAtCounter') {
    return 'Settle & complete'
  }

  return 'Awaiting online payment'
}

function getOrderBlockReason(order: AdminOrder) {
  if (!unfinishedStatuses.has(order.status)) {
    return 'Only unfinished orders can be completed here.'
  }

  if (order.paymentStatus !== 'Paid' && order.paymentMethod !== 'PayAtCounter') {
    return 'This online order has not been paid yet.'
  }

  return null
}

function getRestaurantParam(isPlatformOwner: boolean, restaurantId: string) {
  return isPlatformOwner && restaurantId ? { restaurantId } : {}
}

function refreshReceiptTarget(target: ReceiptPrintTarget): ReceiptPrintTarget {
  if (target.kind === 'order') {
    return {
      kind: 'order',
      order: target.order,
      requestedAt: Date.now(),
      settled: target.settled,
    }
  }

  return {
    kind: 'table',
    table: target.table,
    requestedAt: Date.now(),
    settled: target.settled,
  }
}

export function FrontCounterPage() {
  const { user } = useAuth()
  const isPlatformOwner = user?.roles.includes('PlatformOwner') ?? false
  const [activeTab, setActiveTab] = useState<FrontCounterTab>('takeaway')
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [restaurantFilter, setRestaurantFilter] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [takeawayOrders, setTakeawayOrders] = useState<AdminOrder[]>([])
  const [tables, setTables] = useState<FrontCounterTableSummary[]>([])
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null)
  const [selectedTable, setSelectedTable] = useState<FrontCounterTableDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null)
  const [busySessionId, setBusySessionId] = useState<string | null>(null)
  const [receiptPrompt, setReceiptPrompt] = useState<ReceiptPrintTarget | null>(null)
  const [receiptPrintTarget, setReceiptPrintTarget] = useState<ReceiptPrintTarget | null>(null)
  const [lastReceiptTarget, setLastReceiptTarget] = useState<ReceiptPrintTarget | null>(null)
  const refreshRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const realtimeRefreshTimerRef = useRef<number | null>(null)
  const restaurantFilterRef = useRef(restaurantFilter)
  const isPlatformOwnerRef = useRef(isPlatformOwner)

  const restaurantParams = useMemo(
    () => getRestaurantParam(isPlatformOwner, restaurantFilter),
    [isPlatformOwner, restaurantFilter],
  )
  const needsRestaurantSelection = isPlatformOwner && !restaurantFilter

  const loadFrontCounter = useCallback(async (showToast = false) => {
    if (needsRestaurantSelection) {
      setLoading(false)
      setTakeawayOrders([])
      setTables([])
      setSelectedTableId(null)
      setSelectedTable(null)
      return
    }

    try {
      setError(null)
      const params = {
        ...restaurantParams,
        search: debouncedSearch || undefined,
      }
      const [takeawayResponse, tableResponse] = await Promise.all([
        getFrontCounterTakeaway(params),
        getFrontCounterTables(params),
      ])
      setTakeawayOrders(takeawayResponse.orders)
      setTables(tableResponse.tables)

      const nextSelectedTableId = selectedTableId && tableResponse.tables.some((table) => table.tableId === selectedTableId)
        ? selectedTableId
        : tableResponse.tables[0]?.tableId ?? null
      setSelectedTableId(nextSelectedTableId)
      if (nextSelectedTableId) {
        const tableDetail = await getFrontCounterTable(nextSelectedTableId, restaurantParams)
        setSelectedTable(tableDetail)
      } else {
        setSelectedTable(null)
      }
      setLastUpdated(new Date())
      if (showToast) toast.success('Front counter refreshed')
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Could not load front counter.'
      setError(message)
      if (showToast) toast.error('Could not refresh front counter', { description: message })
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, needsRestaurantSelection, restaurantParams, selectedTableId])

  useEffect(() => {
    refreshRef.current = () => loadFrontCounter()
  }, [loadFrontCounter])

  useEffect(() => {
    if (!receiptPrintTarget) return

    document.body.classList.add('front-counter-printing-receipt')

    const clearReceiptPrint = () => setReceiptPrintTarget(null)
    const printTimer = window.setTimeout(() => {
      window.print()
    }, 80)

    window.addEventListener('afterprint', clearReceiptPrint, { once: true })

    return () => {
      window.clearTimeout(printTimer)
      window.removeEventListener('afterprint', clearReceiptPrint)
      document.body.classList.remove('front-counter-printing-receipt')
    }
  }, [receiptPrintTarget])

  useEffect(() => {
    restaurantFilterRef.current = restaurantFilter
    isPlatformOwnerRef.current = isPlatformOwner
  }, [isPlatformOwner, restaurantFilter])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim())
    }, 250)

    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    if (!isPlatformOwner) return

    void getRestaurants()
      .then((items) => {
        setRestaurants(items)
        setRestaurantFilter((current) => current || items[0]?.id || '')
      })
      .catch((restaurantError) => {
        toast.error('Could not load restaurants', {
          description: restaurantError instanceof Error ? restaurantError.message : 'The request failed.',
        })
      })
  }, [isPlatformOwner])

  useEffect(() => {
    const initialLoadTimer = window.setTimeout(() => void loadFrontCounter(), 0)
    const refreshTimer = window.setInterval(() => void loadFrontCounter(), 15_000)

    return () => {
      window.clearTimeout(initialLoadTimer)
      window.clearInterval(refreshTimer)
    }
  }, [loadFrontCounter])

  const shouldHandleRealtimeUpdate = useCallback((update: OrderRealtimeUpdate) => {
    if (!isPlatformOwnerRef.current) {
      return true
    }

    return Boolean(restaurantFilterRef.current) && update.restaurantId === restaurantFilterRef.current
  }, [])

  const scheduleRealtimeRefresh = useCallback(() => {
    if (realtimeRefreshTimerRef.current !== null) {
      window.clearTimeout(realtimeRefreshTimerRef.current)
    }

    realtimeRefreshTimerRef.current = window.setTimeout(() => {
      realtimeRefreshTimerRef.current = null
      void refreshRef.current()
    }, 300)
  }, [])

  useEffect(() => {
    if (!user) return

    const client = createOrderRealtimeClient({
      onOrderCreated: (update) => {
        if (shouldHandleRealtimeUpdate(update)) {
          toast('New counter order received', {
            description: update.orderNumber,
          })
          scheduleRealtimeRefresh()
        }
      },
      onOrderUpdated: (update) => {
        if (shouldHandleRealtimeUpdate(update)) {
          scheduleRealtimeRefresh()
        }
      },
      onOrderPaymentUpdated: (update) => {
        if (shouldHandleRealtimeUpdate(update)) {
          scheduleRealtimeRefresh()
        }
      },
      onOrderDeleted: (update) => {
        if (shouldHandleRealtimeUpdate(update)) {
          scheduleRealtimeRefresh()
        }
      },
      onReconnected: () => {
        void refreshRef.current()
      },
    })

    void client.start().catch((realtimeError) => {
      console.warn('[SignalR] Front counter realtime connection failed.', realtimeError)
    })

    return () => {
      if (realtimeRefreshTimerRef.current !== null) {
        window.clearTimeout(realtimeRefreshTimerRef.current)
        realtimeRefreshTimerRef.current = null
      }
      void client.stop()
    }
  }, [scheduleRealtimeRefresh, shouldHandleRealtimeUpdate, user])

  const openTable = useCallback(async (tableId: string) => {
    setSelectedTableId(tableId)
    setSelectedTable(null)
    setDetailLoading(true)

    try {
      const detail = await getFrontCounterTable(tableId, restaurantParams)
      setSelectedTable(detail)
    } catch (detailError) {
      const message = detailError instanceof Error ? detailError.message : 'Could not load table.'
      toast.error('Could not open table', { description: message })
      setSelectedTableId(null)
    } finally {
      setDetailLoading(false)
    }
  }, [restaurantParams])

  const queueReceiptPrint = useCallback((target: ReceiptPrintTarget) => {
    const nextTarget = refreshReceiptTarget(target)
    setLastReceiptTarget(nextTarget)
    setReceiptPrintTarget(nextTarget)
  }, [])

  const promptForReceiptPrint = useCallback((target: ReceiptPrintTarget) => {
    const nextTarget = refreshReceiptTarget(target)
    setLastReceiptTarget(nextTarget)
    setReceiptPrompt(nextTarget)
  }, [])

  const settleOrder = useCallback(async (order: AdminOrder) => {
    const blockReason = getOrderBlockReason(order)
    if (blockReason) {
      toast.error('Order cannot be completed', { description: blockReason })
      return
    }

    setBusyOrderId(order.id)
    try {
      const response = await settleCompleteFrontCounterOrder(order.id, restaurantParams)
      toast.success('Order completed', {
        description: `${getOrderDisplayCode(order)} is settled.`,
      })
      promptForReceiptPrint({
        kind: 'order',
        order: response.order,
        requestedAt: Date.now(),
        settled: true,
      })
      await loadFrontCounter()
    } catch (settleError) {
      toast.error('Could not complete order', {
        description: settleError instanceof Error ? settleError.message : 'The request failed.',
      })
    } finally {
      setBusyOrderId(null)
    }
  }, [loadFrontCounter, promptForReceiptPrint, restaurantParams])

  const settleTable = useCallback(async (table: FrontCounterTableDetail) => {
    if (!table.activeSessionId) {
      toast.error('No active table session', {
        description: `Table ${table.tableNumber} has no active bill to settle.`,
      })
      return
    }

    setBusySessionId(table.activeSessionId)
    try {
      await settleCompleteFrontCounterTableSession(table.activeSessionId, restaurantParams)
      toast.success('Table settled', {
        description: `Table ${table.tableNumber} has been completed.`,
      })
      promptForReceiptPrint({
        kind: 'table',
        table,
        requestedAt: Date.now(),
        settled: true,
      })
      await loadFrontCounter()
    } catch (settleError) {
      toast.error('Could not settle table', {
        description: settleError instanceof Error ? settleError.message : 'The request failed.',
      })
    } finally {
      setBusySessionId(null)
    }
  }, [loadFrontCounter, promptForReceiptPrint, restaurantParams])

  const openTableCount = tables.filter((table) => table.activeSessionId).length
  const activeTableTotal = tables.reduce((total, table) => total + table.activeOrderCount, 0)
  const takeawayDue = takeawayOrders
    .filter((order) => order.paymentStatus !== 'Paid')
    .reduce((total, order) => total + order.totalAmount, 0)
  const selectedTableReceiptTarget = useMemo<ReceiptPrintTarget | null>(() => {
    if (!selectedTable) return null

    if (selectedTable.activeOrders.length > 0 || selectedTable.mergedItems.length > 0) {
      return {
        kind: 'table',
        table: selectedTable,
        requestedAt: Date.now(),
      }
    }

    if (lastReceiptTarget?.kind === 'table' && lastReceiptTarget.table.tableId === selectedTable.tableId) {
      return lastReceiptTarget
    }

    const latestHistoryOrder = selectedTable.historyOrders[0]
    if (latestHistoryOrder) {
      return {
        kind: 'order',
        order: latestHistoryOrder,
        requestedAt: Date.now(),
      }
    }

    return null
  }, [lastReceiptTarget, selectedTable])

  return (
    <div className="front-counter-page">
      <Card className="front-counter-hero">
        <CardHeader className="front-counter-hero-header">
          <div className="front-counter-title-row">
            <div className="front-counter-title-icon">
              <DoorOpen size={24} />
            </div>
            <div>
              <CardTitle>Front Counter</CardTitle>
              <CardDescription className="front-counter-description">
                <span>Takeaway pickup, counter payment, and table settlement.</span>
                {lastUpdated && <span>Updated {formatDateTime(lastUpdated.toISOString())}</span>}
              </CardDescription>
            </div>
          </div>
          <div className="front-counter-toolbar">
            {isPlatformOwner && (
              <Select value={restaurantFilter} onValueChange={setRestaurantFilter}>
                <SelectTrigger className="front-counter-restaurant-select" aria-label="Restaurant">
                  <SelectValue placeholder="Select restaurant" />
                </SelectTrigger>
                <SelectContent position="popper">
                  {restaurants.map((restaurant) => (
                    <SelectItem key={restaurant.id} value={restaurant.id}>
                      {restaurant.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="front-counter-search">
              <Search size={17} />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search pickup, table, item"
                aria-label="Search front counter"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="front-counter-refresh"
              onClick={() => void loadFrontCounter(true)}
              disabled={loading || needsRestaurantSelection}
            >
              <RefreshCw size={16} className={cn(loading && 'animate-spin')} />
              Refresh
            </Button>
            {lastReceiptTarget ? (
              <ReceiptPrintButton
                label="Reprint last receipt"
                onClick={() => queueReceiptPrint(lastReceiptTarget)}
              />
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="front-counter-summary-strip">
          <div>
            <span>Takeaway</span>
            <strong>{takeawayOrders.length}</strong>
          </div>
          <div>
            <span>Counter due</span>
            <strong>{formatMoney(takeawayDue, takeawayOrders[0]?.currency)}</strong>
          </div>
          <div>
            <span>Open tables</span>
            <strong>{openTableCount}</strong>
          </div>
          <div>
            <span>Table orders</span>
            <strong>{activeTableTotal}</strong>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="front-counter-error">
          <CardContent>{error}</CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as FrontCounterTab)} className="front-counter-tabs">
        <TabsList className="front-counter-tabs-list">
          <TabsTrigger value="takeaway">
            <ShoppingBag size={16} />
            Takeaway
          </TabsTrigger>
          <TabsTrigger value="tables">
            <Table2 size={16} />
            Tables
          </TabsTrigger>
        </TabsList>

        <TabsContent value="takeaway" className="front-counter-tab-panel">
          {loading ? (
            <FrontCounterLoading />
          ) : takeawayOrders.length === 0 ? (
            <FrontCounterEmpty
              icon={<ShoppingBag size={22} />}
              title="No active takeaway orders"
              description="New takeaway orders will appear here as soon as they are submitted."
            />
          ) : (
            <div className="front-counter-order-grid">
              {takeawayOrders.map((order) => {
                const blockReason = getOrderBlockReason(order)
                return (
                  <article key={order.id} className="front-counter-order-card">
                    <div className="front-counter-order-top">
                      <div>
                        <span className="front-counter-label">Pickup</span>
                        <strong className="front-counter-pickup-code">{getOrderDisplayCode(order)}</strong>
                      </div>
                      <div className="front-counter-order-badges">
                        <OrderStatusBadge status={order.status} />
                        <PaymentStatusBadge status={order.paymentStatus} />
                        <ReceiptPrintButton
                          label={`Print receipt for ${getOrderDisplayCode(order)}`}
                          onClick={() => queueReceiptPrint({
                            kind: 'order',
                            order,
                            requestedAt: Date.now(),
                          })}
                        />
                      </div>
                    </div>

                    <div className="front-counter-order-meta">
                      <span>
                        <Clock3 size={14} />
                        {formatDateTime(order.createdAt)}
                      </span>
                      <span>
                        {order.paymentMethod === 'PayAtCounter' ? <Banknote size={14} /> : <CreditCard size={14} />}
                        {order.paymentMethod === 'PayAtCounter' ? 'Pay at counter' : 'Online'}
                      </span>
                    </div>

                    <div className="front-counter-item-list">
                      {order.items.map((item) => (
                        <div key={item.id} className="front-counter-item-row">
                          <div>
                            <strong>
                              {item.quantity}x {item.itemNameSnapshot}
                            </strong>
                            {item.note && <span>{item.note}</span>}
                            <OrderItemOptionBadges options={item.selectedOptions} currency={order.currency} />
                          </div>
                          <span>{formatMoney(item.totalPrice, order.currency)}</span>
                        </div>
                      ))}
                    </div>

                    <div className="front-counter-card-footer">
                      <div>
                        <span>Total</span>
                        <strong>{formatMoney(order.totalAmount, order.currency)}</strong>
                      </div>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>
                              <Button
                                type="button"
                                className="front-counter-settle-button"
                                disabled={Boolean(blockReason) || busyOrderId === order.id}
                                onClick={() => void settleOrder(order)}
                              >
                                {busyOrderId === order.id ? <Loader2 size={16} className="animate-spin" /> : <ClipboardCheck size={16} />}
                                {getOrderActionLabel(order)}
                              </Button>
                            </span>
                          </TooltipTrigger>
                          {blockReason && <TooltipContent>{blockReason}</TooltipContent>}
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="tables" className="front-counter-tab-panel">
          {loading ? (
            <FrontCounterLoading />
          ) : tables.length === 0 ? (
            <FrontCounterEmpty
              icon={<Table2 size={22} />}
              title="No tables available"
              description="Active restaurant tables will appear here for front counter review."
            />
          ) : (
            <div className="front-counter-table-workspace">
              <div className="front-counter-table-grid">
                {tables.map((table) => {
                  const isSelected = selectedTableId === table.tableId
                  return (
                    <Fragment key={table.tableId}>
                    <button
                      type="button"
                      className={cn('front-counter-table-card', isSelected && 'is-selected', table.activeOrderCount === 0 && 'is-idle')}
                      onClick={() => void openTable(table.tableId)}
                    >
                      <div className="front-counter-table-top">
                        <div className="front-counter-table-icon">
                          <Utensils size={18} />
                        </div>
                        <div>
                          <span className="front-counter-label">Table</span>
                          <strong>{table.tableNumber}</strong>
                        </div>
                        <Badge variant={table.activeOrderCount > 0 ? 'default' : 'outline'}>
                          {table.activeOrderCount > 0 ? `${table.activeOrderCount} active` : 'Idle'}
                        </Badge>
                      </div>

                      <div className="front-counter-table-stats">
                        <div>
                          <span>Due</span>
                          <strong>{formatMoney(table.amountDue, table.currency)}</strong>
                        </div>
                        <div>
                          <span>Items</span>
                          <strong>{table.itemCount}</strong>
                        </div>
                        <div>
                          <span>History</span>
                          <strong>{table.historyOrderCount}</strong>
                        </div>
                      </div>

                      <div className="front-counter-table-card-details">
                        {table.activeOrders.length > 0 ? (
                          <div className="front-counter-table-order-strip">
                            {table.activeOrders.slice(0, 3).map((order) => (
                              <span key={order.id}>
                                {getOrderDisplayCode(order)}
                                <small>{formatMoney(order.totalAmount, order.currency)}</small>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="front-counter-table-idle-copy">No active bill</span>
                        )}

                        {table.mergedItems.length > 0 && (
                          <div className="front-counter-table-item-preview">
                            {table.mergedItems.slice(0, 3).map((item) => (
                              <span key={item.orderItemIds.join('-')}>
                                {item.quantity}x {item.itemName}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="front-counter-table-footer">
                        <span>{table.openedAt ? `Opened ${formatDateTime(table.openedAt)}` : 'Ready for dine-in orders'}</span>
                        <span>{formatMoney(table.totalAmount, table.currency)}</span>
                      </div>
                    </button>
                    {isSelected ? (
                      <SelectedTablePanel
                        selectedTable={selectedTable}
                        detailLoading={detailLoading}
                        selectedTableReceiptTarget={selectedTableReceiptTarget}
                        busySessionId={busySessionId}
                        onPrintReceipt={queueReceiptPrint}
                        onSettleTable={settleTable}
                      />
                    ) : null}
                    </Fragment>
                  )
                })}
              </div>

              <aside className="front-counter-selected-table">
                {detailLoading ? (
                  <FrontCounterLoading compact />
                ) : !selectedTable ? (
                  <FrontCounterEmpty
                    icon={<Table2 size={22} />}
                    title="Select a table"
                    description="Choose a table to review active orders and recent history."
                  />
                ) : (
                  <div className="front-counter-selected-table-panel">
                    <div className="front-counter-selected-table-header">
                      <div>
                        <span className="front-counter-label">Selected table</span>
                        <strong>Table {selectedTable.tableNumber}</strong>
                      </div>
                      <div className="front-counter-selected-table-actions">
                        <Badge variant={selectedTable.activeOrderCount > 0 ? 'default' : 'outline'}>
                          {selectedTable.activeOrderCount > 0 ? `${selectedTable.activeOrderCount} active` : 'Idle'}
                        </Badge>
                        {selectedTableReceiptTarget ? (
                          <ReceiptPrintButton
                            label={selectedTableReceiptTarget.kind === 'table' ? 'Print table receipt' : 'Print latest table order receipt'}
                            onClick={() => queueReceiptPrint(selectedTableReceiptTarget)}
                          />
                        ) : null}
                      </div>
                    </div>

                    <div className="front-counter-table-detail-grid">
                      <section className="front-counter-merged-items">
                        <div className="front-counter-section-heading">
                          <Hash size={16} />
                          <span>Current bill</span>
                        </div>
                        {selectedTable.mergedItems.length === 0 ? (
                          <div className="front-counter-muted-box">No active items remain for this table.</div>
                        ) : (
                          selectedTable.mergedItems.map((item) => (
                            <div key={item.orderItemIds.join('-')} className="front-counter-merged-row">
                              <div>
                                <strong>
                                  {item.quantity}x {item.itemName}
                                </strong>
                                {item.note && <span>{item.note}</span>}
                                <OrderItemOptionBadges options={item.selectedOptions} currency={selectedTable.currency} />
                              </div>
                              <span>{formatMoney(item.totalPrice, selectedTable.currency)}</span>
                            </div>
                          ))
                        )}
                      </section>

                      <aside className="front-counter-table-side">
                        <div className="front-counter-total-card">
                          <span>Amount due</span>
                          <strong>{formatMoney(selectedTable.amountDue, selectedTable.currency)}</strong>
                          <small>Total active bill: {formatMoney(selectedTable.totalAmount, selectedTable.currency)}</small>
                        </div>
                        <Button
                          type="button"
                          className="front-counter-settle-button"
                          disabled={!selectedTable.activeSessionId || selectedTable.activeOrderCount === 0 || busySessionId === selectedTable.activeSessionId}
                          onClick={() => void settleTable(selectedTable)}
                        >
                          {busySessionId && selectedTable.activeSessionId === busySessionId ? <Loader2 size={16} className="animate-spin" /> : <ClipboardCheck size={16} />}
                          Settle table
                        </Button>
                      </aside>
                    </div>

                    <div className="front-counter-table-order-sections">
                      <section className="front-counter-session-orders">
                        <div className="front-counter-section-heading">
                          <ClipboardCheck size={16} />
                          <span>Active orders</span>
                        </div>
                        {selectedTable.activeOrders.length === 0 ? (
                          <div className="front-counter-muted-box">No active orders for this table.</div>
                        ) : (
                          selectedTable.activeOrders.map((order) => (
                            <div key={order.id} className="front-counter-session-order">
                              <div>
                                <strong>{getOrderDisplayCode(order)}</strong>
                                <span>{formatMoney(order.totalAmount, order.currency)}</span>
                              </div>
                              <div className="front-counter-session-order-badges">
                                <OrderStatusBadge status={order.status} />
                                <PaymentStatusBadge status={order.paymentStatus} />
                              </div>
                            </div>
                          ))
                        )}
                      </section>

                      <section className="front-counter-session-orders">
                        <div className="front-counter-section-heading">
                          <History size={16} />
                          <span>History</span>
                        </div>
                        {selectedTable.historyOrders.length === 0 ? (
                          <div className="front-counter-muted-box">No recent history for this table.</div>
                        ) : (
                          selectedTable.historyOrders.map((order) => (
                            <div key={order.id} className="front-counter-session-order is-history">
                              <div>
                                <strong>{getOrderDisplayCode(order)}</strong>
                                <span>{formatDateTime(order.createdAt)} · {formatMoney(order.totalAmount, order.currency)}</span>
                              </div>
                              <OrderStatusBadge status={order.status} />
                            </div>
                          ))
                        )}
                      </section>
                    </div>
                  </div>
                )}
              </aside>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={receiptPrompt !== null} onOpenChange={(open) => {
        if (!open) setReceiptPrompt(null)
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Print receipt?</DialogTitle>
            <DialogDescription>
              {receiptPrompt ? getReceiptPromptDescription(receiptPrompt) : 'This counter action is complete.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReceiptPrompt(null)}>
              Not now
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (receiptPrompt) queueReceiptPrint(receiptPrompt)
                setReceiptPrompt(null)
              }}
            >
              <Printer size={16} />
              Print receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {receiptPrintTarget ? (
        <FrontCounterReceiptPrint
          target={receiptPrintTarget}
          printedAt={new Date(receiptPrintTarget.requestedAt)}
        />
      ) : null}
    </div>
  )
}

function FrontCounterLoading({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn('front-counter-loading', compact && 'is-compact')}>
      <Loader2 size={22} className="animate-spin" />
      <span>Loading counter data</span>
    </div>
  )
}

function FrontCounterEmpty({
  icon,
  title,
  description,
}: {
  icon: ReactNode
  title: string
  description: string
}) {
  return (
    <div className="front-counter-empty">
      <div className="front-counter-empty-icon">{icon}</div>
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  )
}

function SelectedTablePanel({
  selectedTable,
  detailLoading,
  selectedTableReceiptTarget,
  busySessionId,
  onPrintReceipt,
  onSettleTable,
}: {
  selectedTable: FrontCounterTableDetail | null
  detailLoading: boolean
  selectedTableReceiptTarget: ReceiptPrintTarget | null
  busySessionId: string | null
  onPrintReceipt: (target: ReceiptPrintTarget) => void
  onSettleTable: (table: FrontCounterTableDetail) => void
}) {
  return (
    <aside className="front-counter-selected-table is-expanded">
      {detailLoading ? (
        <FrontCounterLoading compact />
      ) : !selectedTable ? (
        <FrontCounterEmpty
          icon={<Table2 size={22} />}
          title="Select a table"
          description="Choose a table to review active orders and recent history."
        />
      ) : (
        <div className="front-counter-selected-table-panel">
          <div className="front-counter-selected-table-header">
            <div>
              <span className="front-counter-label">Selected table</span>
              <strong>Table {selectedTable.tableNumber}</strong>
            </div>
            <div className="front-counter-selected-table-actions">
              <Badge variant={selectedTable.activeOrderCount > 0 ? 'default' : 'outline'}>
                {selectedTable.activeOrderCount > 0 ? `${selectedTable.activeOrderCount} active` : 'Idle'}
              </Badge>
              {selectedTableReceiptTarget ? (
                <ReceiptPrintButton
                  label={selectedTableReceiptTarget.kind === 'table' ? 'Print table receipt' : 'Print latest table order receipt'}
                  onClick={() => onPrintReceipt(selectedTableReceiptTarget)}
                />
              ) : null}
            </div>
          </div>

          <div className="front-counter-table-detail-grid">
            <section className="front-counter-merged-items">
              <div className="front-counter-section-heading">
                <Hash size={16} />
                <span>Current bill</span>
              </div>
              {selectedTable.mergedItems.length === 0 ? (
                <div className="front-counter-muted-box">No active items remain for this table.</div>
              ) : (
                selectedTable.mergedItems.map((item) => (
                  <div key={item.orderItemIds.join('-')} className="front-counter-merged-row">
                    <div>
                      <strong>
                        {item.quantity}x {item.itemName}
                      </strong>
                      {item.note && <span>{item.note}</span>}
                      <OrderItemOptionBadges options={item.selectedOptions} currency={selectedTable.currency} />
                    </div>
                    <span>{formatMoney(item.totalPrice, selectedTable.currency)}</span>
                  </div>
                ))
              )}
            </section>

            <aside className="front-counter-table-side">
              <div className="front-counter-total-card">
                <span>Amount due</span>
                <strong>{formatMoney(selectedTable.amountDue, selectedTable.currency)}</strong>
                <small>Total active bill: {formatMoney(selectedTable.totalAmount, selectedTable.currency)}</small>
              </div>
              <Button
                type="button"
                className="front-counter-settle-button"
                disabled={!selectedTable.activeSessionId || selectedTable.activeOrderCount === 0 || busySessionId === selectedTable.activeSessionId}
                onClick={() => onSettleTable(selectedTable)}
              >
                {busySessionId && selectedTable.activeSessionId === busySessionId ? <Loader2 size={16} className="animate-spin" /> : <ClipboardCheck size={16} />}
                Settle table
              </Button>
            </aside>
          </div>

          <div className="front-counter-table-order-sections">
            <section className="front-counter-session-orders">
              <div className="front-counter-section-heading">
                <ClipboardCheck size={16} />
                <span>Active orders</span>
              </div>
              {selectedTable.activeOrders.length === 0 ? (
                <div className="front-counter-muted-box">No active orders for this table.</div>
              ) : (
                selectedTable.activeOrders.map((order) => (
                  <div key={order.id} className="front-counter-session-order">
                    <div>
                      <strong>{getOrderDisplayCode(order)}</strong>
                      <span>{formatMoney(order.totalAmount, order.currency)}</span>
                    </div>
                    <div className="front-counter-session-order-badges">
                      <OrderStatusBadge status={order.status} />
                      <PaymentStatusBadge status={order.paymentStatus} />
                    </div>
                  </div>
                ))
              )}
            </section>

            <section className="front-counter-session-orders">
              <div className="front-counter-section-heading">
                <History size={16} />
                <span>History</span>
              </div>
              {selectedTable.historyOrders.length === 0 ? (
                <div className="front-counter-muted-box">No recent history for this table.</div>
              ) : (
                selectedTable.historyOrders.map((order) => (
                  <div key={order.id} className="front-counter-session-order is-history">
                    <div>
                      <strong>{getOrderDisplayCode(order)}</strong>
                      <span>{formatDateTime(order.createdAt)} - {formatMoney(order.totalAmount, order.currency)}</span>
                    </div>
                    <OrderStatusBadge status={order.status} />
                  </div>
                ))
              )}
            </section>
          </div>
        </div>
      )}
    </aside>
  )
}

function ReceiptPrintButton({
  label,
  onClick,
}: {
  label: string
  onClick: () => void
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="front-counter-print-button"
            aria-label={label}
            onClick={(event) => {
              event.stopPropagation()
              onClick()
            }}
          >
            <Printer size={15} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" align="end" sideOffset={6}>
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function FrontCounterReceiptPrint({ target, printedAt }: { target: ReceiptPrintTarget; printedAt: Date }) {
  const receipt = buildReceipt(target, printedAt)

  return (
    <section className="front-counter-receipt-print" aria-label="Counter receipt">
      <header className="front-counter-receipt-header">
        <span>{receipt.title}</span>
        <h1>{receipt.code}</h1>
        <p>{receipt.restaurantName}</p>
      </header>

      <dl className="front-counter-receipt-meta">
        {receipt.meta.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>

      <div className="front-counter-receipt-items">
        {receipt.items.map((item) => {
          const optionGroups = groupReceiptOptions(item.selectedOptions)

          return (
            <article key={item.id} className="front-counter-receipt-item">
              <div className="front-counter-receipt-item-main">
                <strong>{item.quantity}x</strong>
                <span>{item.name}</span>
                <small>{formatMoney(item.totalPrice, receipt.currency)}</small>
              </div>

              {optionGroups.length > 0 ? (
                <div className="front-counter-receipt-options">
                  {optionGroups.map((group) => (
                    <div key={group.groupName}>
                      <strong>{group.groupName}</strong>
                      <span>
                        {group.options
                          .map((option) => {
                            const quantity = option.quantity ?? 1
                            const adjustment = option.priceAdjustmentSnapshot === 0
                              ? ''
                              : ` ${formatReceiptAdjustment(option.priceAdjustmentSnapshot, receipt.currency)}`
                            return `${option.optionNameSnapshot}${quantity > 1 ? ` x${quantity}` : ''}${adjustment}`
                          })
                          .join(', ')}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}

              {item.note ? (
                <p className="front-counter-receipt-note">
                  <strong>Note:</strong> {item.note}
                </p>
              ) : null}
            </article>
          )
        })}
      </div>

      <dl className="front-counter-receipt-total">
        <div>
          <dt>Total</dt>
          <dd>{formatMoney(receipt.totalAmount, receipt.currency)}</dd>
        </div>
        <div>
          <dt>Amount due</dt>
          <dd>{formatMoney(receipt.amountDue, receipt.currency)}</dd>
        </div>
      </dl>

      <footer className="front-counter-receipt-footer">
        <p>Thank you</p>
      </footer>
    </section>
  )
}

function buildReceipt(target: ReceiptPrintTarget, printedAt: Date) {
  if (target.kind === 'order') {
    const order = target.order
    const items: FrontCounterReceiptItem[] = order.items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      name: item.itemNameSnapshot?.trim() || 'Unnamed item',
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
      note: item.note,
      selectedOptions: item.selectedOptions,
    }))
    const isPaid = target.settled || order.paymentStatus === 'Paid'
    const code = order.orderType === 'DineIn' && order.tableNumber
      ? `Table ${order.tableNumber}`
      : getOrderDisplayCode(order)

    return {
      title: order.orderType === 'Takeaway' ? 'Pickup receipt' : 'Counter receipt',
      code,
      restaurantName: order.restaurantName ?? 'Assigned restaurant',
      currency: order.currency,
      items,
      totalAmount: order.totalAmount,
      amountDue: isPaid ? 0 : order.totalAmount,
      meta: [
        { label: 'Order', value: getOrderDisplayCode(order) },
        { label: 'Type', value: getOrderTypeLabel(order.orderType) },
        { label: 'Status', value: target.settled ? 'Completed' : order.status },
        { label: 'Payment', value: isPaid ? 'Paid' : `${order.paymentMethod} / ${order.paymentStatus}` },
        { label: 'Created', value: formatDateTime(order.createdAt) },
        { label: 'Printed', value: formatDateTime(printedAt.toISOString()) },
      ],
    }
  }

  const table = target.table
  const items: FrontCounterReceiptItem[] = table.mergedItems.map((item) => ({
    id: item.orderItemIds.join('-'),
    quantity: item.quantity,
    name: item.itemName,
    unitPrice: item.unitPrice,
    totalPrice: item.totalPrice,
    note: item.note,
    selectedOptions: item.selectedOptions,
  }))

  return {
    title: target.settled ? 'Table receipt' : 'Table bill',
    code: `Table ${table.tableNumber}`,
    restaurantName: table.restaurantName,
    currency: table.currency,
    items,
    totalAmount: table.totalAmount,
    amountDue: target.settled ? 0 : table.amountDue,
    meta: [
      { label: 'Orders', value: String(table.activeOrderCount) },
      { label: 'Items', value: String(table.itemCount) },
      { label: 'Status', value: target.settled ? 'Completed' : (table.activeOrderCount > 0 ? 'Open' : 'Idle') },
      { label: 'Payment', value: target.settled ? 'Paid at counter' : formatMoney(table.amountDue, table.currency) },
      { label: 'Opened', value: table.openedAt ? formatDateTime(table.openedAt) : '-' },
      { label: 'Printed', value: formatDateTime(printedAt.toISOString()) },
    ],
  }
}

function getReceiptPromptDescription(target: ReceiptPrintTarget) {
  if (target.kind === 'order') {
    return `${getOrderDisplayCode(target.order)} is complete. Print a customer receipt now?`
  }

  return `Table ${target.table.tableNumber} is settled. Print the merged table receipt now?`
}

function getOrderTypeLabel(orderType: AdminOrder['orderType']) {
  if (orderType === 'DineIn') return 'Dine in'
  if (orderType === 'Takeaway') return 'Takeaway'
  return 'Scheduled'
}

function groupReceiptOptions(options: AdminOrder['items'][number]['selectedOptions']) {
  const groups = new Map<string, typeof options>()

  for (const option of options) {
    const groupName = option.groupNameSnapshot || 'Options'
    groups.set(groupName, [...(groups.get(groupName) ?? []), option])
  }

  return Array.from(groups.entries()).map(([groupName, groupedOptions]) => ({
    groupName,
    options: groupedOptions,
  }))
}

function formatReceiptAdjustment(amount: number, currency: string) {
  const formatted = formatMoney(Math.abs(amount), currency)
  return amount > 0 ? `+${formatted}` : `-${formatted}`
}
