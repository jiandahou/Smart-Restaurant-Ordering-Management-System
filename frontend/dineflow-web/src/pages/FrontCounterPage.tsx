import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Banknote,
  CalendarClock,
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
  ShieldAlert,
  ShoppingBag,
  Table2,
  Utensils,
  UserRound,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  completeFrontCounterOrder,
  getFrontCounterTable,
  getFrontCounterTables,
  getFrontCounterTakeaway,
  getRestaurants,
  recordFrontCounterPayment,
  settleCompleteFrontCounterTableSession,
  type AdminOrder,
  type FrontCounterTender,
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
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { createOrderRealtimeClient, type OrderRealtimeUpdate } from '@/realtime/orderConnection'
import { useRestaurantPrinting } from '@/printing/RestaurantPrintingContext'
import type { KitchenTicket } from '@/lib/thermalPrinter'
import {
  getFrontCounterActionLabel,
  getFrontCounterAmountDue,
  getFrontCounterBlockReason,
  getFrontCounterOrderAction,
  isFrontCounterCarriedOver,
  matchesFrontCounterQueue,
  type FrontCounterOrderAction,
  type FrontCounterQueue,
} from '@/lib/frontCounterManagement'
import { hasSafetyNote, isSafetyNoteText } from '@/lib/staffOrderManagement'
import { cn } from '@/lib/utils'

type FrontCounterTab = 'takeaway' | 'tables'
type FrontCounterTypeFilter = 'all' | 'takeaway' | 'dineIn'
type PickupDayKind = 'today' | 'carried-over' | 'upcoming' | 'unassigned'
type PendingSettlement =
  | { kind: 'order'; order: AdminOrder; action: Exclude<FrontCounterOrderAction, null> }
  | { kind: 'table'; table: FrontCounterTableDetail }

type PickupDateGroup = {
  key: string
  heading: string
  dayLabel: string | null
  kind: PickupDayKind
  orders: AdminOrder[]
}
type ReceiptPrintTarget =
  | {
      kind: 'order'
      order: AdminOrder
      requestedAt: number
      paid?: boolean
      completed?: boolean
      tender?: FrontCounterTender
      amountReceived?: number
      changeDue?: number
    }
  | {
      kind: 'table'
      table: FrontCounterTableDetail
      requestedAt: number
      paid?: boolean
      completed?: boolean
      tender?: FrontCounterTender
      amountReceived?: number
      changeDue?: number
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

const unassignedPickupKey = 'unassigned'
const typeFilterOptions: { value: FrontCounterTypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'takeaway', label: 'Takeaway' },
  { value: 'dineIn', label: 'Dine in' },
]
const queueLabels: Record<FrontCounterQueue, string> = {
  ready: 'Ready pickup',
  paymentDue: 'Payment due',
  paymentIssue: 'Payment issues',
  carried: 'Carried over',
  all: 'All active',
}

function formatMoney(amount: number, currencyCode?: string | null) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: (currencyCode || 'AUD').toUpperCase(),
  }).format(amount)
}

function formatDateTime(value: string | null) {
  if (!value) return '-'

  return new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function getOrderDisplayCode(order: AdminOrder) {
  return order.pickupCode || order.orderNumber
}

function shiftIsoDate(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return shifted.toISOString().slice(0, 10)
}

function formatBusinessDay(isoDate: string) {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(year, month - 1, day))
}

/**
 * Groups the list by pickup date so a carried-over #003 can never be mistaken for today's #003.
 * Dates are compared against the restaurant's business date, not the browser's.
 */
function buildPickupDateGroups(orders: AdminOrder[], businessDate: string | null): PickupDateGroup[] {
  const groups = new Map<string, PickupDateGroup>()
  const now = new Date()

  for (const order of orders) {
    const carriedOver = isFrontCounterCarriedOver(order, businessDate, now)
    const key = order.pickupDate ?? (carriedOver ? 'carried-unassigned' : unassignedPickupKey)
    let group = groups.get(key)

    if (!group) {
      group = carriedOver && !order.pickupDate
        ? {
            key,
            heading: 'Carried over · no pickup number',
            dayLabel: null,
            kind: 'carried-over',
            orders: [],
          }
        : { key, ...describePickupDay(order.pickupDate, businessDate), orders: [] }
      groups.set(key, group)
    }

    group.orders.push(order)
  }

  const priority: Record<PickupDayKind, number> = {
    today: 0,
    upcoming: 1,
    unassigned: 2,
    'carried-over': 3,
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      orders: [...group.orders].sort((first, second) => {
        if (first.status === 'Ready' && second.status !== 'Ready') return -1
        if (first.status !== 'Ready' && second.status === 'Ready') return 1
        return (first.pickupNumber ?? Number.MAX_SAFE_INTEGER)
          - (second.pickupNumber ?? Number.MAX_SAFE_INTEGER)
      }),
    }))
    .sort((first, second) =>
      priority[first.kind] - priority[second.kind]
      || second.key.localeCompare(first.key),
    )
}

function describePickupDay(
  pickupDate: string | null,
  businessDate: string | null,
): Omit<PickupDateGroup, 'key' | 'orders'> {
  if (!pickupDate) {
    return { heading: 'Awaiting number', dayLabel: null, kind: 'unassigned' }
  }

  const dayLabel = formatBusinessDay(pickupDate)

  if (!businessDate || pickupDate === businessDate) {
    return { heading: 'Today', dayLabel, kind: 'today' }
  }

  if (pickupDate < businessDate) {
    const heading = pickupDate === shiftIsoDate(businessDate, -1) ? 'Yesterday' : dayLabel
    return { heading, dayLabel, kind: 'carried-over' }
  }

  const heading = pickupDate === shiftIsoDate(businessDate, 1) ? 'Tomorrow' : dayLabel
  return { heading, dayLabel, kind: 'upcoming' }
}

function getRestaurantParam(isPlatformOwner: boolean, restaurantId: string) {
  return isPlatformOwner && restaurantId ? { restaurantId } : {}
}

function getTableSettlementBlockReason(table: FrontCounterTableDetail) {
  if (!table.activeSessionId || table.activeOrders.length === 0) {
    return 'This table has no active bill to settle.'
  }

  if (table.activeOrders.some((order) => order.status !== 'Ready')) {
    return 'Every active order must be marked Ready before closing the table.'
  }

  if (table.activeOrders.some((order) => getFrontCounterOrderAction(order) === null)) {
    return 'Resolve refunded or online payment issues before closing the table.'
  }

  return null
}

function refreshReceiptTarget(target: ReceiptPrintTarget): ReceiptPrintTarget {
  if (target.kind === 'order') {
    return {
      kind: 'order',
      order: target.order,
      requestedAt: Date.now(),
      paid: target.paid,
      completed: target.completed,
      tender: target.tender,
      amountReceived: target.amountReceived,
      changeDue: target.changeDue,
    }
  }

  return {
    kind: 'table',
    table: target.table,
    requestedAt: Date.now(),
    paid: target.paid,
    completed: target.completed,
    tender: target.tender,
    amountReceived: target.amountReceived,
    changeDue: target.changeDue,
  }
}

export function FrontCounterPage() {
  const { user } = useAuth()
  const { printFrontCounterTicket } = useRestaurantPrinting()
  const isPlatformOwner = user?.roles.includes('PlatformOwner') ?? false
  const [activeTab, setActiveTab] = useState<FrontCounterTab>('takeaway')
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [restaurantFilter, setRestaurantFilter] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [takeawayOrders, setTakeawayOrders] = useState<AdminOrder[]>([])
  const [businessDate, setBusinessDate] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<FrontCounterTypeFilter>('all')
  const [queueFilter, setQueueFilter] = useState<FrontCounterQueue>('ready')
  const [totalOrderCount, setTotalOrderCount] = useState(0)
  const [orderLimit, setOrderLimit] = useState(100)
  const [tables, setTables] = useState<FrontCounterTableSummary[]>([])
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null)
  const [selectedTable, setSelectedTable] = useState<FrontCounterTableDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null)
  const [busySessionId, setBusySessionId] = useState<string | null>(null)
  const [receiptPrompt, setReceiptPrompt] = useState<ReceiptPrintTarget | null>(null)
  const [receiptPrintTarget, setReceiptPrintTarget] = useState<ReceiptPrintTarget | null>(null)
  const [lastReceiptTarget, setLastReceiptTarget] = useState<ReceiptPrintTarget | null>(null)
  const [pendingSettlement, setPendingSettlement] = useState<PendingSettlement | null>(null)
  const [tender, setTender] = useState<FrontCounterTender>('Card')
  const [cashReceived, setCashReceived] = useState('')
  const refreshRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const realtimeRefreshTimerRef = useRef<number | null>(null)
  const loadRequestIdRef = useRef(0)
  const tableRequestIdRef = useRef(0)
  const restaurantFilterRef = useRef(restaurantFilter)
  const isPlatformOwnerRef = useRef(isPlatformOwner)
  const selectedTableIdRef = useRef(selectedTableId)

  const restaurantParams = useMemo(
    () => getRestaurantParam(isPlatformOwner, restaurantFilter),
    [isPlatformOwner, restaurantFilter],
  )
  const needsRestaurantSelection = isPlatformOwner && !restaurantFilter

  const loadFrontCounter = useCallback(async (showToast = false) => {
    const requestId = loadRequestIdRef.current + 1
    loadRequestIdRef.current = requestId

    if (needsRestaurantSelection) {
      setLoading(false)
      setRefreshing(false)
      setTakeawayOrders([])
      setTotalOrderCount(0)
      setTables([])
      setSelectedTableId(null)
      setSelectedTable(null)
      return
    }

    try {
      setRefreshing(true)
      setError(null)
      const params = {
        ...restaurantParams,
        search: debouncedSearch || undefined,
        pageSize: orderLimit,
      }
      const [takeawayResponse, tableResponse] = await Promise.all([
        getFrontCounterTakeaway(params),
        getFrontCounterTables(params),
      ])
      if (requestId !== loadRequestIdRef.current) return

      setTakeawayOrders(takeawayResponse.orders)
      setBusinessDate(takeawayResponse.businessDate)
      setTotalOrderCount(takeawayResponse.totalOrders)
      setTables(tableResponse.tables)

      const currentSelectedTableId = selectedTableIdRef.current
      const nextSelectedTableId = currentSelectedTableId && tableResponse.tables.some((table) => table.tableId === currentSelectedTableId)
        ? currentSelectedTableId
        : tableResponse.tables[0]?.tableId ?? null
      setSelectedTableId(nextSelectedTableId)
      selectedTableIdRef.current = nextSelectedTableId
      if (nextSelectedTableId) {
        const tableDetail = await getFrontCounterTable(nextSelectedTableId, restaurantParams)
        if (requestId !== loadRequestIdRef.current) return
        setSelectedTable(tableDetail)
      } else {
        setSelectedTable(null)
      }
      setLastUpdated(new Date())
      if (showToast) toast.success('Front counter refreshed')
    } catch (loadError) {
      if (requestId !== loadRequestIdRef.current) return
      const message = loadError instanceof Error ? loadError.message : 'Could not load front counter.'
      setError(message)
      if (showToast) toast.error('Could not refresh front counter', { description: message })
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [debouncedSearch, needsRestaurantSelection, orderLimit, restaurantParams])

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
    selectedTableIdRef.current = selectedTableId
  }, [selectedTableId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim())
      setOrderLimit(100)
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

    let disposed = false
    let reconnectTimer: number | null = null
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
      onClosed: () => {
        if (!disposed) {
          reconnectTimer = window.setTimeout(() => void connect(), 2_000)
        }
      },
    })

    const connect = async () => {
      try {
        await client.start()
      } catch (realtimeError) {
        if (disposed) return
        console.warn('[SignalR] Front counter realtime connection failed; retrying.', realtimeError)
        reconnectTimer = window.setTimeout(() => void connect(), 2_000)
      }
    }

    const initialConnectTimer = window.setTimeout(() => void connect(), 150)

    return () => {
      disposed = true
      window.clearTimeout(initialConnectTimer)
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer)
      }
      if (realtimeRefreshTimerRef.current !== null) {
        window.clearTimeout(realtimeRefreshTimerRef.current)
        realtimeRefreshTimerRef.current = null
      }
      void client.stop()
    }
  }, [scheduleRealtimeRefresh, shouldHandleRealtimeUpdate, user])

  const openTable = useCallback(async (tableId: string) => {
    const requestId = tableRequestIdRef.current + 1
    tableRequestIdRef.current = requestId
    setSelectedTableId(tableId)
    selectedTableIdRef.current = tableId
    setSelectedTable(null)
    setDetailLoading(true)

    try {
      const detail = await getFrontCounterTable(tableId, restaurantParams)
      if (requestId !== tableRequestIdRef.current) return
      setSelectedTable(detail)
    } catch (detailError) {
      if (requestId !== tableRequestIdRef.current) return
      const message = detailError instanceof Error ? detailError.message : 'Could not load table.'
      toast.error('Could not open table', { description: message })
      setSelectedTableId(null)
    } finally {
      if (requestId === tableRequestIdRef.current) {
        setDetailLoading(false)
      }
    }
  }, [restaurantParams])

  const queueReceiptPrint = useCallback((target: ReceiptPrintTarget) => {
    const nextTarget = refreshReceiptTarget(target)
    setLastReceiptTarget(nextTarget)
    const printedAt = new Date()
    void printFrontCounterTicket(createFrontCounterThermalTicket(nextTarget, printedAt))
      .then((result) => {
        if (result === 'browser') {
          setReceiptPrintTarget(nextTarget)
        }
      })
  }, [printFrontCounterTicket])

  const promptForReceiptPrint = useCallback((target: ReceiptPrintTarget) => {
    const nextTarget = refreshReceiptTarget(target)
    setLastReceiptTarget(nextTarget)
    setReceiptPrompt(nextTarget)
  }, [])

  const requestOrderSettlement = useCallback((order: AdminOrder) => {
    const action = getFrontCounterOrderAction(order)
    if (!action) {
      toast.error('Order is not ready for a counter action', {
        description: getFrontCounterBlockReason(order) ?? 'No action is available.',
      })
      return
    }

    setTender('Card')
    setCashReceived('')
    setPendingSettlement({ kind: 'order', order, action })
  }, [])

  const requestTableSettlement = useCallback((table: FrontCounterTableDetail) => {
    if (!table.activeSessionId) {
      toast.error('No active table session', {
        description: `Table ${table.tableNumber} has no active bill to settle.`,
      })
      return
    }

    setTender('Card')
    setCashReceived('')
    setPendingSettlement({ kind: 'table', table })
  }, [])

  const confirmSettlement = useCallback(async () => {
    if (!pendingSettlement) return

    const amountDue = pendingSettlement.kind === 'order'
      ? getFrontCounterAmountDue(pendingSettlement.order)
      : pendingSettlement.table.amountDue
    const amountReceived = tender === 'Cash'
      ? Number.parseFloat(cashReceived)
      : amountDue
    const payload = {
      tender,
      amountReceived: Number.isFinite(amountReceived) ? amountReceived : undefined,
    }

    if (pendingSettlement.kind === 'order') {
      const { order, action } = pendingSettlement
      setBusyOrderId(order.id)
      try {
        let updatedOrder = order
        let receiptAmountReceived: number | undefined
        let receiptChangeDue: number | undefined
        if (action === 'recordPayment' || action === 'payAndComplete') {
          const paymentResponse = await recordFrontCounterPayment(order.id, payload, restaurantParams)
          updatedOrder = paymentResponse.order
          receiptAmountReceived = paymentResponse.amountReceived
          receiptChangeDue = paymentResponse.changeDue
          if (paymentResponse.changeDue > 0) {
            toast.success(`Change due: ${formatMoney(paymentResponse.changeDue, order.currency)}`)
          }
        }

        if (action === 'complete' || action === 'payAndComplete') {
          const completionResponse = await completeFrontCounterOrder(order.id, restaurantParams)
          updatedOrder = completionResponse.order
        }

        const completed = action === 'complete' || action === 'payAndComplete'
        setPendingSettlement(null)
        toast.success(completed ? 'Pickup completed' : 'Payment recorded', {
          description: getOrderDisplayCode(order),
        })
        promptForReceiptPrint({
          kind: 'order',
          order: updatedOrder,
          requestedAt: Date.now(),
          paid: action !== 'complete'
            || updatedOrder.paymentStatus === 'Paid'
            || updatedOrder.paymentStatus === 'PartiallyRefunded'
            || updatedOrder.paymentStatus === 'NotRequired',
          completed,
          tender: action === 'recordPayment' || action === 'payAndComplete' ? tender : undefined,
          amountReceived: receiptAmountReceived,
          changeDue: receiptChangeDue,
        })
        await loadFrontCounter()
      } catch (settleError) {
        toast.error('Counter action failed', {
          description: settleError instanceof Error ? settleError.message : 'The request failed.',
        })
      } finally {
        setBusyOrderId(null)
      }
      return
    }

    const { table } = pendingSettlement
    setBusySessionId(table.activeSessionId)
    try {
      const response = await settleCompleteFrontCounterTableSession(
        table.activeSessionId!,
        payload,
        restaurantParams,
      )
      setPendingSettlement(null)
      toast.success('Table settled', {
        description: `Table ${table.tableNumber} has been completed.`,
      })
      if (response.changeDue > 0) {
        toast.success(`Change due: ${formatMoney(response.changeDue, table.currency)}`)
      }
      promptForReceiptPrint({
        kind: 'table',
        table,
        requestedAt: Date.now(),
        paid: true,
        completed: true,
        tender: table.amountDue > 0 ? tender : undefined,
        amountReceived: response.amountReceived,
        changeDue: response.changeDue,
      })
      await loadFrontCounter()
    } catch (settleError) {
      toast.error('Could not settle table', {
        description: settleError instanceof Error ? settleError.message : 'The request failed.',
      })
    } finally {
      setBusySessionId(null)
    }
  }, [
    cashReceived,
    loadFrontCounter,
    pendingSettlement,
    promptForReceiptPrint,
    restaurantParams,
    tender,
  ])

  const openTableCount = tables.filter((table) => table.activeSessionId).length
  const activeTableTotal = tables.reduce((total, table) => total + table.activeOrderCount, 0)
  const dineInOrders = takeawayOrders.filter((order) => order.orderType === 'DineIn')
  const counterOrders = takeawayOrders.filter((order) => order.orderType !== 'DineIn')
  const sumCounterDue = (orders: AdminOrder[]) =>
    orders.reduce((total, order) => total + getFrontCounterAmountDue(order), 0)
  const takeawayDue = sumCounterDue(counterOrders)
  const dineInDue = sumCounterDue(dineInOrders)
  const currencyCode = takeawayOrders[0]?.currency
  const queueCounts = useMemo(() => Object.fromEntries(
    (Object.keys(queueLabels) as FrontCounterQueue[]).map((value) => [
      value,
      takeawayOrders.filter((order) =>
        matchesFrontCounterQueue(order, value, businessDate),
      ).length,
    ]),
  ) as Record<FrontCounterQueue, number>, [businessDate, takeawayOrders])
  const visibleOrders = useMemo(() => {
    const typeFiltered = typeFilter === 'takeaway'
      ? takeawayOrders.filter((order) => order.orderType !== 'DineIn')
      : typeFilter === 'dineIn'
        ? takeawayOrders.filter((order) => order.orderType === 'DineIn')
        : takeawayOrders

    return typeFiltered.filter((order) =>
      matchesFrontCounterQueue(order, queueFilter, businessDate),
    )
  }, [businessDate, queueFilter, takeawayOrders, typeFilter])
  const pickupGroups = useMemo(
    () => buildPickupDateGroups(visibleOrders, businessDate),
    [businessDate, visibleOrders],
  )
  const openTableForOrder = useCallback((order: AdminOrder) => {
    if (!order.tableId) return

    setActiveTab('tables')
    void openTable(order.tableId)
  }, [openTable])
  const selectedTableReceiptTarget = useMemo<ReceiptPrintTarget | null>(() => {
    if (!selectedTable) return null

    if (selectedTable.activeOrders.length > 0 || selectedTable.mergedItems.length > 0) {
      return {
        kind: 'table',
        table: selectedTable,
        requestedAt: 0,
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
        requestedAt: 0,
      }
    }

    return null
  }, [lastReceiptTarget, selectedTable])

  const pendingAmountDue = pendingSettlement?.kind === 'order'
    ? getFrontCounterAmountDue(pendingSettlement.order)
    : pendingSettlement?.table.amountDue ?? 0
  const parsedCashReceived = Number.parseFloat(cashReceived)
  const cashEntryValid = tender !== 'Cash'
    || (Number.isFinite(parsedCashReceived) && parsedCashReceived >= pendingAmountDue)
  const changeDue = tender === 'Cash' && cashEntryValid
    ? Math.max(0, parsedCashReceived - pendingAmountDue)
    : 0

  return (
    <main className="front-counter-page">
      <Card className="front-counter-hero">
        <CardHeader className="front-counter-hero-header">
          <div className="front-counter-title-row">
            <div className="front-counter-title-icon">
              <DoorOpen size={24} />
            </div>
            <div>
              <h1 className="font-heading text-xl font-medium">Front Counter</h1>
              <CardDescription className="front-counter-description">
                <span>Takeaway pickup, counter payment, and table settlement.</span>
                {lastUpdated && <span>Updated {formatDateTime(lastUpdated.toISOString())}</span>}
              </CardDescription>
            </div>
          </div>
          <div className="front-counter-toolbar">
            {isPlatformOwner && (
              <Select
                value={restaurantFilter}
                onValueChange={(value) => {
                  setRestaurantFilter(value)
                  setOrderLimit(100)
                }}
              >
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
              {refreshing && search.trim()
                ? <Loader2 size={17} className="animate-spin" />
                : <Search size={17} />}
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Order, pickup, customer, table, or item"
                aria-label="Search front counter"
              />
              {search.trim() ? (
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Clear counter search" onClick={() => setSearch('')}>
                  <X size={14} />
                </Button>
              ) : null}
            </div>
            <Button
              type="button"
              variant="outline"
              className="front-counter-refresh"
              onClick={() => void loadFrontCounter(true)}
              disabled={refreshing || needsRestaurantSelection}
            >
              <RefreshCw size={16} className={cn(refreshing && 'animate-spin')} />
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
            <span>Pickup orders</span>
            <strong>{counterOrders.length}</strong>
          </div>
          <div>
            <span>Dine in</span>
            <strong>{dineInOrders.length}</strong>
          </div>
          <div title="Unpaid pay-at-counter takeaway orders.">
            <span>Takeaway due</span>
            <strong>{formatMoney(takeawayDue, currencyCode)}</strong>
          </div>
          <div title="Unpaid pay-at-counter dine-in orders. Orders without a table remain in Pickup queue.">
            <span>Dine-in due</span>
            <strong>{formatMoney(dineInDue, currencyCode)}</strong>
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

      {totalOrderCount > takeawayOrders.length ? (
        <div className="front-counter-durable-warning">
          <AlertCircle size={17} />
          <span>
            Showing {takeawayOrders.length} of {totalOrderCount} matching active orders.
          </span>
          {orderLimit < 500 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={refreshing}
              onClick={() => setOrderLimit((current) => Math.min(500, current + 100))}
            >
              Load 100 more
            </Button>
          ) : (
            <small>Use search to locate older records.</small>
          )}
        </div>
      ) : null}

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as FrontCounterTab)} className="front-counter-tabs">
        <TabsList className="front-counter-tabs-list">
          <TabsTrigger value="takeaway">
            <ShoppingBag size={16} />
            Pickup queue
          </TabsTrigger>
          <TabsTrigger value="tables">
            <Table2 size={16} />
            Tables
          </TabsTrigger>
        </TabsList>

        <TabsContent value="takeaway" className="front-counter-tab-panel">
          <div className="front-counter-type-filter" role="group" aria-label="Filter by order type">
            {typeFilterOptions.map((option) => (
              <Button
                key={option.value}
                type="button"
                size="sm"
                variant={typeFilter === option.value ? 'default' : 'outline'}
                aria-pressed={typeFilter === option.value}
                onClick={() => setTypeFilter(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>

          <div className="front-counter-queue-filter" role="group" aria-label="Filter counter orders by workflow">
            {(Object.keys(queueLabels) as FrontCounterQueue[]).map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={queueFilter === value ? 'default' : 'outline'}
                aria-pressed={queueFilter === value}
                onClick={() => setQueueFilter(value)}
              >
                {queueLabels[value]}
                <Badge variant="secondary">{queueCounts[value]}</Badge>
              </Button>
            ))}
          </div>

          {loading ? (
            <FrontCounterLoading />
          ) : visibleOrders.length === 0 ? (
            <FrontCounterEmpty
              icon={<ShoppingBag size={22} />}
              title={queueFilter === 'ready' ? 'No pickups are ready' : 'No orders match these filters'}
              description={
                queueFilter === 'ready'
                  ? 'Orders will appear here after the kitchen marks them Ready.'
                  : 'Try All active or clear the order-type filter.'
              }
            />
          ) : (
            <div className="front-counter-pickup-groups">
              {pickupGroups.map((group) => (
                <section key={group.key} className="front-counter-pickup-group">
                  <header
                    className={cn(
                      'front-counter-pickup-group-header',
                      group.kind !== 'today' && 'is-off-day',
                    )}
                  >
                    <h3>{group.heading}</h3>
                    {group.dayLabel && group.dayLabel !== group.heading && <span>{group.dayLabel}</span>}
                    <Badge variant="outline">
                      {group.orders.length} {group.orders.length === 1 ? 'order' : 'orders'}
                    </Badge>
                  </header>

                  <div className="front-counter-order-grid">
                    {group.orders.map((order) => (
                      <FrontCounterOrderCard
                        key={order.id}
                        order={order}
                        group={group}
                        busy={busyOrderId === order.id}
                        onSettle={() => requestOrderSettlement(order)}
                        onOpenTable={() => openTableForOrder(order)}
                        onPrint={() => queueReceiptPrint({
                          kind: 'order',
                          order,
                          requestedAt: Date.now(),
                        })}
                      />
                    ))}
                  </div>
                </section>
              ))}
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
                        onSettleTable={requestTableSettlement}
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
                          disabled={Boolean(getTableSettlementBlockReason(selectedTable)) || busySessionId === selectedTable.activeSessionId}
                          onClick={() => requestTableSettlement(selectedTable)}
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

      <Dialog open={pendingSettlement !== null} onOpenChange={(open) => {
        if (!open && busyOrderId === null && busySessionId === null) {
          setPendingSettlement(null)
        }
      }}>
        <DialogContent className="front-counter-settlement-dialog">
          <DialogHeader>
            <DialogTitle>
              {pendingSettlement?.kind === 'table'
                ? `Confirm Table ${pendingSettlement.table.tableNumber} settlement`
                : pendingSettlement?.action === 'recordPayment'
                  ? 'Confirm counter payment'
                  : 'Confirm pickup completion'}
            </DialogTitle>
            <DialogDescription>
              Review the amount and workflow effect before recording this counter action.
            </DialogDescription>
          </DialogHeader>

          {pendingSettlement ? (
            <div className="front-counter-settlement-review">
              <div className="front-counter-settlement-summary">
                <span>{pendingSettlement.kind === 'table' ? 'Table bill' : getOrderDisplayCode(pendingSettlement.order)}</span>
                <strong>{formatMoney(
                  pendingSettlement.kind === 'table'
                    ? pendingSettlement.table.totalAmount
                    : pendingSettlement.order.totalAmount,
                  pendingSettlement.kind === 'table'
                    ? pendingSettlement.table.currency
                    : pendingSettlement.order.currency,
                )}</strong>
                <small>
                  Amount due: {formatMoney(
                    pendingAmountDue,
                    pendingSettlement.kind === 'table'
                      ? pendingSettlement.table.currency
                      : pendingSettlement.order.currency,
                  )}
                </small>
              </div>

              {pendingSettlement.kind === 'order' ? (
                <div className="front-counter-settlement-effect">
                  <OrderStatusBadge status={pendingSettlement.order.status} />
                  <span>→</span>
                  <strong>
                    {pendingSettlement.action === 'recordPayment'
                      ? `${pendingSettlement.order.status} · payment recorded`
                      : 'Completed'}
                  </strong>
                </div>
              ) : (
                <div className="front-counter-settlement-effect">
                  <Badge variant="outline">{pendingSettlement.table.activeOrderCount} orders</Badge>
                  <span>→</span>
                  <strong>Completed · table closed</strong>
                </div>
              )}

              {pendingAmountDue > 0 ? (
                <div className="front-counter-tender-grid">
                  <div className="space-y-2">
                    <Label htmlFor="front-counter-tender">Tender</Label>
                    <Select value={tender} onValueChange={(value) => setTender(value as FrontCounterTender)}>
                      <SelectTrigger id="front-counter-tender" aria-label="Counter payment tender">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectItem value="Card">Card</SelectItem>
                        <SelectItem value="Cash">Cash</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {tender === 'Cash' ? (
                    <div className="space-y-2">
                      <Label htmlFor="front-counter-cash-received">Cash received</Label>
                      <Input
                        id="front-counter-cash-received"
                        type="number"
                        min={pendingAmountDue}
                        step="0.01"
                        inputMode="decimal"
                        value={cashReceived}
                        onChange={(event) => setCashReceived(event.target.value)}
                        aria-invalid={!cashEntryValid}
                        placeholder={pendingAmountDue.toFixed(2)}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}

              {tender === 'Cash' && cashEntryValid && pendingAmountDue > 0 ? (
                <div className="front-counter-change-due">
                  <span>Change due</span>
                  <strong>{formatMoney(
                    changeDue,
                    pendingSettlement.kind === 'table'
                      ? pendingSettlement.table.currency
                      : pendingSettlement.order.currency,
                  )}</strong>
                </div>
              ) : null}

              <div className="front-counter-confirm-warning">
                <AlertTriangle size={17} />
                <span>
                  {pendingSettlement.kind === 'order' && pendingSettlement.action === 'recordPayment'
                    ? 'This records payment only. The kitchen workflow will not be skipped.'
                    : 'Completion removes these orders from the active counter queue.'}
                </span>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={busyOrderId !== null || busySessionId !== null} onClick={() => setPendingSettlement(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!cashEntryValid || busyOrderId !== null || busySessionId !== null}
              onClick={() => void confirmSettlement()}
            >
              {busyOrderId !== null || busySessionId !== null
                ? <Loader2 size={16} className="animate-spin" />
                : <ClipboardCheck size={16} />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
    </main>
  )
}

function FrontCounterOrderCard({
  order,
  group,
  busy,
  onSettle,
  onOpenTable,
  onPrint,
}: {
  order: AdminOrder
  group: PickupDateGroup
  busy: boolean
  onSettle: () => void
  onOpenTable: () => void
  onPrint: () => void
}) {
  const blockReason = getFrontCounterBlockReason(order)
  const action = getFrontCounterOrderAction(order)
  const isDineIn = order.orderType === 'DineIn'
  const safetyNote = hasSafetyNote(order)
  const customerSafetyNote = isSafetyNoteText(order.customerNote)
  const showDayChip = group.kind === 'carried-over' || group.kind === 'upcoming'
  const tableHint = isDineIn && order.tableId
    ? 'This acts on this order only. Use Open table to settle the whole table at once.'
    : null

  return (
    <article
      aria-labelledby={`front-counter-order-${order.id}`}
      className={cn(
        'front-counter-order-card',
        isDineIn && 'is-dine-in',
        group.kind === 'carried-over' && 'is-carried-over',
        safetyNote && 'has-safety-note',
      )}
    >
      <div className="front-counter-order-top">
        <div>
          <span className="front-counter-label">{isDineIn ? 'Order' : 'Pickup'}</span>
          <h2 id={`front-counter-order-${order.id}`} className="front-counter-pickup-code">{getOrderDisplayCode(order)}</h2>
          <span className="front-counter-order-number">{order.orderNumber}</span>
          <div className="front-counter-order-tags">
            <Badge variant="outline" className={cn('front-counter-type-badge', isDineIn && 'is-dine-in')}>
              {isDineIn ? <Utensils size={12} /> : <ShoppingBag size={12} />}
              {getOrderTypeLabel(order.orderType)}
              {order.tableNumber ? ` · Table ${order.tableNumber}` : ''}
            </Badge>
            {showDayChip && (
              <Badge className={cn('front-counter-day-chip', `is-${group.kind}`)}>
                <History size={12} />
                {group.heading}
              </Badge>
            )}
            {order.customerName ? (
              <Badge variant="outline">
                <UserRound size={12} />
                {order.customerName}
              </Badge>
            ) : null}
            {order.scheduledTime ? (
              <Badge variant="outline">
                <CalendarClock size={12} />
                {formatDateTime(order.scheduledTime)}
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="front-counter-order-badges">
          <OrderStatusBadge status={order.status} />
          <PaymentStatusBadge status={order.paymentStatus} />
          <ReceiptPrintButton label={`Print receipt for ${getOrderDisplayCode(order)}`} onClick={onPrint} />
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

      {order.customerNote ? (
        <div className={cn('front-counter-order-note', customerSafetyNote && 'is-safety-note')}>
          {customerSafetyNote ? <ShieldAlert size={17} /> : null}
          <div>
            <strong>{customerSafetyNote ? 'Safety note' : 'Order note'}</strong>
            <span>{order.customerNote}</span>
          </div>
        </div>
      ) : null}

      <div className="front-counter-item-list">
        {order.items.map((item) => (
          <div key={item.id} className="front-counter-item-row">
            <div>
              <strong>
                {item.quantity}x {item.itemNameSnapshot}
              </strong>
              {item.note && (
                <span className={cn(isSafetyNoteText(item.note) && 'front-counter-item-safety-note')}>
                  {isSafetyNoteText(item.note) ? <ShieldAlert size={13} /> : null}
                  {item.note}
                </span>
              )}
              <OrderItemOptionBadges options={item.selectedOptions} currency={order.currency} />
            </div>
            <span>{formatMoney(item.totalPrice, order.currency)}</span>
          </div>
        ))}
      </div>

      {blockReason ? (
        <div className={cn(
          'front-counter-order-block',
          order.paymentStatus === 'Refunded' && 'is-refunded',
        )}>
          <AlertCircle size={16} />
          <span>{blockReason}</span>
        </div>
      ) : null}

      <div className="front-counter-card-footer">
        <div>
          <span>Total</span>
          <strong>{formatMoney(order.totalAmount, order.currency)}</strong>
        </div>
        <div className="front-counter-card-actions">
          {/* Only offered when the order actually belongs to a table; many dine-in orders don't. */}
          {isDineIn && order.tableId && (
            <Button type="button" variant="outline" onClick={onOpenTable}>
              <Table2 size={16} />
              Open table
            </Button>
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    type="button"
                    className="front-counter-settle-button"
                    disabled={!action || busy}
                    onClick={onSettle}
                  >
                    {busy ? <Loader2 size={16} className="animate-spin" /> : <ClipboardCheck size={16} />}
                    {getFrontCounterActionLabel(order)}
                  </Button>
                </span>
              </TooltipTrigger>
              {(blockReason || tableHint) && <TooltipContent>{blockReason ?? tableHint}</TooltipContent>}
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </article>
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
  const settlementBlockReason = selectedTable
    ? getTableSettlementBlockReason(selectedTable)
    : null

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
                disabled={Boolean(settlementBlockReason) || busySessionId === selectedTable.activeSessionId}
                onClick={() => onSettleTable(selectedTable)}
              >
                {busySessionId && selectedTable.activeSessionId === busySessionId ? <Loader2 size={16} className="animate-spin" /> : <ClipboardCheck size={16} />}
                Settle table
              </Button>
              {settlementBlockReason ? (
                <small className="front-counter-settlement-hint">{settlementBlockReason}</small>
              ) : null}
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
    const isPaid = target.paid
      || order.paymentStatus === 'Paid'
      || order.paymentStatus === 'PartiallyRefunded'
      || order.paymentStatus === 'NotRequired'
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
        { label: 'Status', value: target.completed ? 'Completed' : order.status },
        { label: 'Payment', value: isPaid ? 'Paid' : `${order.paymentMethod} / ${order.paymentStatus}` },
        ...(target.tender ? [{ label: 'Tender', value: target.tender }] : []),
        ...(target.amountReceived !== undefined
          ? [{ label: 'Received', value: formatMoney(target.amountReceived, order.currency) }]
          : []),
        ...(target.changeDue !== undefined
          ? [{ label: 'Change', value: formatMoney(target.changeDue, order.currency) }]
          : []),
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
    title: target.completed ? 'Table receipt' : 'Table bill',
    code: `Table ${table.tableNumber}`,
    restaurantName: table.restaurantName,
    currency: table.currency,
    items,
    totalAmount: table.totalAmount,
    amountDue: target.paid ? 0 : table.amountDue,
    meta: [
      { label: 'Orders', value: String(table.activeOrderCount) },
      { label: 'Items', value: String(table.itemCount) },
      { label: 'Status', value: target.completed ? 'Completed' : (table.activeOrderCount > 0 ? 'Open' : 'Idle') },
      { label: 'Payment', value: target.paid ? 'Paid at counter' : formatMoney(table.amountDue, table.currency) },
      ...(target.tender ? [{ label: 'Tender', value: target.tender }] : []),
      ...(target.amountReceived !== undefined
        ? [{ label: 'Received', value: formatMoney(target.amountReceived, table.currency) }]
        : []),
      ...(target.changeDue !== undefined
        ? [{ label: 'Change', value: formatMoney(target.changeDue, table.currency) }]
        : []),
      { label: 'Opened', value: table.openedAt ? formatDateTime(table.openedAt) : '-' },
      { label: 'Printed', value: formatDateTime(printedAt.toISOString()) },
    ],
  }
}

function createFrontCounterThermalTicket(
  target: ReceiptPrintTarget,
  printedAt: Date,
): KitchenTicket {
  const receipt = buildReceipt(target, printedAt)
  const status = receipt.meta.find((item) => item.label === 'Status')?.value ?? 'RECEIPT'
  const createdAtValue = target.kind === 'order'
    ? target.order.createdAt
    : target.table.openedAt
  const createdAt = createdAtValue ? new Date(createdAtValue) : printedAt

  return {
    orderNumber: receipt.code,
    restaurantName: receipt.restaurantName,
    orderScope: receipt.title,
    status,
    createdAt,
    printedAt,
    itemCount: receipt.items.reduce((total, item) => total + item.quantity, 0),
    orderNote: [
      ...receipt.meta.map((item) => `${item.label}: ${item.value}`),
      `TOTAL: ${formatMoney(receipt.totalAmount, receipt.currency)}`,
      `AMOUNT DUE: ${formatMoney(receipt.amountDue, receipt.currency)}`,
      'Thank you',
    ].join('\n'),
    items: receipt.items.map((item) => ({
      quantity: item.quantity,
      name: `${item.name}  ${formatMoney(item.totalPrice, receipt.currency)}`,
      note: item.note,
      optionGroups: groupReceiptOptions(item.selectedOptions).map((group) => ({
        groupName: group.groupName,
        options: group.options.map((option) => {
          const quantity = option.quantity ?? 1
          const adjustment = option.priceAdjustmentSnapshot === 0
            ? ''
            : ` ${formatReceiptAdjustment(option.priceAdjustmentSnapshot, receipt.currency)}`
          return `${option.optionNameSnapshot}${quantity > 1 ? ` x${quantity}` : ''}${adjustment}`
        }),
      })),
    })),
  }
}

function getReceiptPromptDescription(target: ReceiptPrintTarget) {
  if (target.kind === 'order') {
    return `${getOrderDisplayCode(target.order)} ${target.completed ? 'is complete' : 'has been paid'}. Print a customer receipt now?`
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
