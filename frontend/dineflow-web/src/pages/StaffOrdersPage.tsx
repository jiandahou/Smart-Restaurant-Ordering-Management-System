import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Bluetooth, Cable, CheckCircle2, ChefHat, CircleHelp, Clock3, Copy, CreditCard, Download, ListChecks, Printer, RefreshCw, Search, Settings2, ShieldCheck, ShieldOff, ShoppingBag, Trash2, Usb, Utensils, Volume2, VolumeX, X } from 'lucide-react'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import {
  getAdminOrders,
  getRestaurants,
  getStaffOrders,
  recordCounterPayment,
  transitionAdminOrder,
  type AdminOrder,
  type OrderTransitionAction,
  type Restaurant,
} from '@/api/auth'
import {
  claimPrintJobs,
  getPrintJobs,
  requestOrderReprint,
  retryPrintJob,
  updatePrintJobStatus,
  upsertPrintStation,
  type PrintJobList,
} from '@/api/printing'
import { useAuth } from '@/auth/AuthContext'
import { OrderStatusBadge } from '@/components/orders/OrderStatusBadge'
import { OrderTransitionReasonField } from '@/components/orders/OrderTransitionReasonField'
import { PaymentStatusBadge } from '@/components/orders/PaymentStatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  markOrderPrinted,
  setAutoPrintEnabled,
} from '@/lib/autoPrintLedger'
import { getBackgroundBrowserGuidance } from '@/lib/backgroundBrowser'
import {
  getPrintStationIdentity,
  hasPrintJobTransportReceipt,
  markPrintJobTransportAccepted,
  withPrintStationLeadership,
} from '@/lib/printStation'
import { downloadPrinterDiagnostics, recordPrinterDiagnostic } from '@/lib/printerDiagnostics'
import { createOrderRealtimeClient, type OrderRealtimeUpdate } from '@/realtime/orderConnection'
import {
  canManageQzTrustCertificate,
  checkQzPrinterHealth,
  clearQzPrinterQueue,
  closeQzNetworkSockets,
  closeQzSerialPorts,
  createKitchenTicket,
  defaultThermalPrinterSettings,
  detectWebUsbPrinter,
  downloadQzTrustCertificate,
  getQzHostNetwork,
  getQzRuntimeInfo,
  getQzTrayDefaultPrinter,
  hasQzTrayConnectedBefore,
  installQzTrustCertificate,
  isQzTrayConnected,
  formatQzPrinterConnectionLabel,
  listQzSerialPorts,
  listQzTrayPrinterDescriptors,
  probeQzNetworkPrinter,
  removeQzTrustCertificate,
  selectWebSerialPort,
  printKitchenTicketWithQzTray,
  printKitchenTicketWithWebBluetooth,
  printKitchenTicketWithWebSerial,
  printKitchenTicketWithWebUsb,
  selectWebBluetoothPrinter,
  probeQzTrayStatus,
  QZ_TRAY_DOWNLOAD_URL,
  QzTrayError,
  readStoredThermalPrinterSettings,
  releaseWebSerialSession,
  startQzKeepAlive,
  startWebSerialKeepAlive,
  stopQzKeepAlive,
  stopWebSerialKeepAlive,
  storeThermalPrinterSettings,
  subscribeQzTrayConnectionStatus,
  testQzSerialConnection,
  testWebSerialConnection,
  testWebUsbConnection,
  type QzTargetType,
  type QzPrintEncoding,
  type QzTrayConnectionStatus,
  type QzTrayErrorReason,
  type QzTrayPrinterDescriptor,
  type ThermalPaperWidth,
  type ThermalPrinterMode,
  type ThermalPrinterSettings,
} from '@/lib/thermalPrinter'
import { cn } from '@/lib/utils'

type Queue = 'active' | 'new' | 'kitchen' | 'ready' | 'closed'
type StaffOrdersViewMode = 'orders' | 'kitchen'
type KitchenLane = 'new' | 'preparing' | 'ready'
type SortOption = 'oldest' | 'newest' | 'recentlyUpdated' | 'amountHigh' | 'amountLow' | 'orderNumber'
type OrderSignalTone = 'new' | 'ready' | 'kitchen' | 'blocked' | 'closed' | 'neutral'
type PrintTicketRequest = {
  order: AdminOrder
  requestedAt: number
}
type ConnectionTestStatus = 'untested' | 'testing' | 'succeeded' | 'failed'

const autoPrintPollIntervalMs = 5_000

const sortRequests: Record<SortOption, { sortBy: string; sortDirection: 'asc' | 'desc' }> = {
  oldest: { sortBy: 'createdAt', sortDirection: 'asc' },
  newest: { sortBy: 'createdAt', sortDirection: 'desc' },
  recentlyUpdated: { sortBy: 'updatedAt', sortDirection: 'desc' },
  amountHigh: { sortBy: 'totalAmount', sortDirection: 'desc' },
  amountLow: { sortBy: 'totalAmount', sortDirection: 'asc' },
  orderNumber: { sortBy: 'orderNumber', sortDirection: 'asc' },
}

const actionLabels: Record<OrderTransitionAction, string> = {
  Accept: 'Accept',
  StartPreparing: 'Start preparing',
  MarkReady: 'Mark ready',
  Complete: 'Complete',
  Reject: 'Reject',
  Cancel: 'Cancel',
  Reopen: 'Reopen',
}

const reasonRequiredActions = new Set<OrderTransitionAction>(['Reject', 'Cancel', 'Reopen'])

const queueStatuses: Record<Queue, Set<string>> = {
  active: new Set(['Pending', 'Accepted', 'Preparing', 'Ready']),
  new: new Set(['Pending']),
  kitchen: new Set(['Accepted', 'Preparing']),
  ready: new Set(['Ready']),
  closed: new Set(['Completed', 'Cancelled', 'Rejected']),
}

const kitchenLaneLabels: Record<KitchenLane, string> = {
  new: 'New',
  preparing: 'Preparing',
  ready: 'Ready',
}

const kitchenLaneDescriptions: Record<KitchenLane, string> = {
  new: 'Needs acceptance',
  preparing: 'Accepted or cooking',
  ready: 'Waiting pickup',
}

const kitchenLaneStatuses: Record<KitchenLane, Set<string>> = {
  new: new Set(['Pending']),
  preparing: new Set(['Accepted', 'Preparing']),
  ready: new Set(['Ready']),
}

const printerModeLabels: Record<ThermalPrinterMode, string> = {
  browser: 'Browser',
  'qz-tray': 'QZ Tray',
  'web-serial': 'Web Serial',
  'web-usb': 'WebUSB',
  'web-bluetooth': 'Web Bluetooth',
}

// Maps a typed QZ Tray failure to staff-friendly guidance. `offerDownload` adds a
// one-click link to the QZ Tray installer for the cases the user can fix by installing/launching it.
const qzErrorGuidance: Record<QzTrayErrorReason, { title: string; description: string; offerDownload: boolean }> = {
  'not-loaded': {
    title: 'QZ Tray could not start',
    description: 'The QZ Tray helper failed to load. Reload the page, or install QZ Tray if you have not yet.',
    offerDownload: true,
  },
  'not-running': {
    title: 'QZ Tray is not running',
    description: 'Install the QZ Tray desktop app and make sure it is running, then print again.',
    offerDownload: true,
  },
  'no-printer': {
    title: 'No QZ Tray printer selected',
    description: 'Pick a printer, enter a network printer IP, or choose a serial port in Kitchen printer settings before printing.',
    offerDownload: false,
  },
  'printer-unavailable': {
    title: 'Printer is not ready — ticket not queued',
    description: 'Check power, paper and cover. If old jobs piled up while it was down, use Clear queue in printer settings, then print again.',
    offerDownload: false,
  },
  'print-failed': {
    title: 'QZ Tray could not print',
    description: 'The printer rejected the job. Check the printer name and that the device is online.',
    offerDownload: false,
  },
}

const orderTypeLabels: Record<AdminOrder['orderType'], string> = {
  DineIn: 'Dine in',
  Takeaway: 'Takeaway',
  Scheduled: 'Scheduled',
}

function getOrderTypeLabel(orderType: AdminOrder['orderType']) {
  return orderTypeLabels[orderType] ?? orderType
}

function getOrderScope(order: AdminOrder) {
  if (order.orderType === 'DineIn') {
    return order.tableNumber ? `Dine in · Table ${order.tableNumber}` : 'Dine in'
  }

  if (order.orderType === 'Scheduled') {
    return order.tableNumber ? `Scheduled · Table ${order.tableNumber}` : 'Scheduled'
  }

  return getOrderTypeLabel(order.orderType)
}

function groupSelectedOptions(item: AdminOrder['items'][number]) {
  const grouped = new Map<string, AdminOrder['items'][number]['selectedOptions']>()

  for (const option of item.selectedOptions ?? []) {
    const groupName = option.groupNameSnapshot || 'Options'
    grouped.set(groupName, [...(grouped.get(groupName) ?? []), option])
  }

  return Array.from(grouped, ([groupName, options]) => ({ groupName, options }))
}

function isClosedOrder(order: AdminOrder) {
  return queueStatuses.closed.has(order.status)
}

function isOnlinePaymentBlocked(order: AdminOrder) {
  return order.paymentMethod === 'Online' && order.paymentStatus !== 'Paid'
}

function needsCounterPayment(order: AdminOrder) {
  return order.paymentMethod === 'PayAtCounter' && order.paymentStatus !== 'Paid'
}

function getOrderAgeMinutes(order: AdminOrder, now: Date) {
  const createdAt = new Date(order.createdAt).getTime()
  return Math.max(0, Math.floor((now.getTime() - createdAt) / 60_000))
}

function formatElapsedTime(order: AdminOrder, now: Date) {
  const minutes = getOrderAgeMinutes(order, now)

  if (minutes < 1) return '<1 min'
  if (minutes < 60) return `${minutes} min`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

function getOrderSignal(order: AdminOrder, now: Date): {
  label: string
  tone: OrderSignalTone
  isLate: boolean
} {
  const isLate = getOrderAgeMinutes(order, now) >= 20 && !isClosedOrder(order) && !isOnlinePaymentBlocked(order)

  if (isClosedOrder(order)) {
    return { label: 'Closed', tone: 'closed', isLate: false }
  }

  if (isOnlinePaymentBlocked(order)) {
    return { label: 'Waiting payment', tone: 'blocked', isLate: false }
  }

  if (order.status === 'Ready') {
    return { label: 'Ready now', tone: 'ready', isLate }
  }

  if (order.status === 'Pending') {
    return { label: isLate ? 'Needs accept now' : 'Needs accept', tone: 'new', isLate }
  }

  if (order.status === 'Accepted') {
    return { label: 'Start cooking', tone: 'kitchen', isLate }
  }

  if (order.status === 'Preparing') {
    return { label: 'In kitchen', tone: 'kitchen', isLate }
  }

  return { label: 'Review order', tone: 'neutral', isLate }
}

function playNewOrderSound(ctx: AudioContext): void {
  const now = ctx.currentTime

  // First tone: C6 (1047 Hz)
  const osc1 = ctx.createOscillator()
  const gain1 = ctx.createGain()
  osc1.connect(gain1)
  gain1.connect(ctx.destination)
  osc1.type = 'sine'
  osc1.frequency.setValueAtTime(1046.5, now)
  gain1.gain.setValueAtTime(0, now)
  gain1.gain.linearRampToValueAtTime(0.42, now + 0.012)
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.28)
  osc1.start(now)
  osc1.stop(now + 0.3)

  // Second tone: E6 (1319 Hz), offset 220 ms
  const osc2 = ctx.createOscillator()
  const gain2 = ctx.createGain()
  osc2.connect(gain2)
  gain2.connect(ctx.destination)
  osc2.type = 'sine'
  osc2.frequency.setValueAtTime(1318.5, now + 0.22)
  gain2.gain.setValueAtTime(0, now + 0.22)
  gain2.gain.linearRampToValueAtTime(0.42, now + 0.232)
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.65)
  osc2.start(now + 0.22)
  osc2.stop(now + 0.65)
}

export function StaffOrdersPage() {
  const { user } = useAuth()
  const isPlatformOwner = user?.roles.includes('PlatformOwner') ?? false
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [restaurantFilter, setRestaurantFilter] = useState('all')
  const [sortOption, setSortOption] = useState<SortOption>('newest')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [queue, setQueue] = useState<Queue>('active')
  const [viewMode, setViewMode] = useState<StaffOrdersViewMode>('orders')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null)
  const [pendingTransition, setPendingTransition] = useState<{
    order: AdminOrder
    action: OrderTransitionAction
  } | null>(null)
  const [reason, setReason] = useState('')
  const loadOrdersRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const autoPrintSweepRef = useRef<((orders: AdminOrder[]) => Promise<void>) | null>(null)
  const restaurantFilterRef = useRef(restaurantFilter)
  const isPlatformOwnerRef = useRef(isPlatformOwner)
  const realtimeRefreshTimerRef = useRef<number | null>(null)
  const [audioEnabled, setAudioEnabled] = useState(true)
  const audioEnabledRef = useRef(true)
  const audioContextRef = useRef<AudioContext | null>(null)
  const [printTicket, setPrintTicket] = useState<PrintTicketRequest | null>(null)
  const [printerSettingsOpen, setPrinterSettingsOpen] = useState(false)
  const [printerSettings, setPrinterSettings] = useState<ThermalPrinterSettings>(() => readStoredThermalPrinterSettings())
  const printerSettingsRef = useRef(printerSettings)
  const [printingOrderId, setPrintingOrderId] = useState<string | null>(null)
  const printStationIdentityRef = useRef(getPrintStationIdentity())
  const [printJobs, setPrintJobs] = useState<PrintJobList>({
    jobs: [],
    pendingCount: 0,
    failedCount: 0,
    deadLetterCount: 0,
  })
  const [printJobsLoading, setPrintJobsLoading] = useState(false)
  const [printStationLeaseHeld, setPrintStationLeaseHeld] = useState(false)
  const lastPrintErrorRef = useRef<string | null>(null)
  const printDispatchChainRef = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    audioEnabledRef.current = audioEnabled
  }, [audioEnabled])

  useEffect(() => {
    storeThermalPrinterSettings(printerSettings)
  }, [printerSettings])

  // Keep the QZ Tray websocket (or the Web Serial port) warm so it never
  // idle-drops. Network (9100) printers are deliberately NOT kept warm with
  // background traffic here — that was tried and made real prints go missing
  // more often on this hardware (see enqueueNetworkPrint in thermalPrinter.ts);
  // reliability for that route now comes from strict one-at-a-time queuing
  // instead.
  useEffect(() => {
    stopQzKeepAlive()
    stopWebSerialKeepAlive()

    if (printerSettings.mode === 'qz-tray') {
      startQzKeepAlive()
      return () => stopQzKeepAlive()
    }
    if (printerSettings.mode === 'web-serial') {
      startWebSerialKeepAlive(() => printerSettingsRef.current.serialBaudRate || 9600)
      return () => stopWebSerialKeepAlive()
    }
  }, [printerSettings.mode])

  // A COM port allows only one holder at a time. Release the port held by
  // whichever route is NOT active so the active route can open it — otherwise
  // switching between Web Serial and QZ serial fails with a "port busy" error.
  useEffect(() => {
    const usingQzSerial = printerSettings.mode === 'qz-tray' && printerSettings.qzTargetType === 'serial'
    const usingQzNetwork = printerSettings.mode === 'qz-tray' && printerSettings.qzTargetType === 'network'
    if (printerSettings.mode !== 'web-serial') {
      void releaseWebSerialSession()
    }
    if (!usingQzSerial) {
      void closeQzSerialPorts()
    }
    if (!usingQzNetwork) {
      void closeQzNetworkSockets()
    }
  }, [printerSettings.mode, printerSettings.qzTargetType])

  // QZ applies encoding/serial options when the raw transport opens. Reopen the
  // handle after those settings change so the next test/print uses the new
  // values instead of silently reusing an old connection configuration.
  useEffect(() => {
    if (printerSettings.qzTargetType === 'serial') {
      void closeQzSerialPorts()
    }
    if (printerSettings.qzTargetType === 'network') {
      void closeQzNetworkSockets()
    }
  }, [
    printerSettings.qzEncoding,
    printerSettings.qzNetworkHost,
    printerSettings.qzNetworkPort,
    printerSettings.qzSerialPort,
    printerSettings.qzTargetType,
    printerSettings.serialBaudRate,
  ])

  useEffect(() => {
    if (!printTicket) return

    document.body.classList.add('staff-printing-order')

    const clearPrintTicket = () => setPrintTicket(null)
    const printTimer = window.setTimeout(() => {
      window.print()
    }, 80)

    window.addEventListener('afterprint', clearPrintTicket, { once: true })

    return () => {
      window.clearTimeout(printTimer)
      window.removeEventListener('afterprint', clearPrintTicket)
      document.body.classList.remove('staff-printing-order')
    }
  }, [printTicket])

  // Auto-create AudioContext on mount; resume on first user gesture (browser autoplay policy)
  useEffect(() => {
    try {
      audioContextRef.current = new AudioContext()
    } catch {
      return
    }
    const resume = () => {
      if (audioContextRef.current?.state === 'suspended') {
        void audioContextRef.current.resume()
      }
    }
    window.addEventListener('pointerdown', resume, { once: true })
    return () => window.removeEventListener('pointerdown', resume)
  }, [])

  const loadOrders = useCallback(async (showToast = false) => {
    try {
      setError(null)
      const sort = sortRequests[sortOption]
      const normalizedSearch = debouncedSearch.trim()
      const request = {
        page: 1,
        pageSize: 100,
        search: normalizedSearch || undefined,
        sortBy: sort.sortBy,
        sortDirection: sort.sortDirection,
        restaurantId: isPlatformOwner && restaurantFilter !== 'all' ? restaurantFilter : undefined,
      } as const
      const response = isPlatformOwner
        ? await getAdminOrders(request)
        : await getStaffOrders(request)
      setOrders(response.items)
      ordersRef.current = response.items
      setLastUpdated(new Date())
      // Drive auto-print from the refreshed list (realtime or the 15s poll), so a
      // missed SignalR event cannot drop a ticket. Via ref because the sweep is
      // defined later in the component body.
      void autoPrintSweepRef.current?.(response.items)
      if (showToast) toast.success('Staff order queue refreshed')
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Could not load orders.'
      setError(message)
      if (showToast) toast.error('Could not refresh orders', { description: message })
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, isPlatformOwner, restaurantFilter, sortOption])

  useEffect(() => {
    loadOrdersRef.current = () => loadOrders()
  }, [loadOrders])

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

  const shouldHandleRealtimeUpdate = useCallback((update: OrderRealtimeUpdate) => {
    if (!isPlatformOwnerRef.current) {
      return true
    }

    const activeRestaurantFilter = restaurantFilterRef.current
    return activeRestaurantFilter === 'all' || update.restaurantId === activeRestaurantFilter
  }, [])

  const scheduleRealtimeRefresh = useCallback(() => {
    if (realtimeRefreshTimerRef.current !== null) {
      window.clearTimeout(realtimeRefreshTimerRef.current)
    }

    realtimeRefreshTimerRef.current = window.setTimeout(() => {
      realtimeRefreshTimerRef.current = null
      void loadOrdersRef.current()
    }, 300)
  }, [])

  const toggleAudio = useCallback(async () => {
    if (audioEnabled) {
      setAudioEnabled(false)
      return
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext()
    } else if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume()
    }

    setAudioEnabled(true)
    playNewOrderSound(audioContextRef.current)
  }, [audioEnabled])

  const updatePrinterSettings = useCallback((updates: Partial<ThermalPrinterSettings>) => {
    const current = printerSettingsRef.current
    if (
      typeof updates.autoPrintNewOrders === 'boolean'
      && updates.autoPrintNewOrders !== current.autoPrintNewOrders
    ) {
      setAutoPrintEnabled(updates.autoPrintNewOrders)
      recordPrinterDiagnostic('auto_print_toggled', { enabled: updates.autoPrintNewOrders })
    }

    const next = { ...current, ...updates }
    printerSettingsRef.current = next
    setPrinterSettings(next)
  }, [])

  const printOrderTicket = useCallback(async (order: AdminOrder): Promise<boolean> => {
    const printedAt = new Date()

    if (printerSettings.mode === 'browser') {
      setPrintTicket({ order, requestedAt: printedAt.getTime() })
      return true
    }

    const ticket = createKitchenTicket(order, printedAt)
    setPrintingOrderId(order.id)

    try {
      lastPrintErrorRef.current = null
      if (printerSettings.mode === 'qz-tray') {
        await printKitchenTicketWithQzTray(ticket, printerSettings)
      } else if (printerSettings.mode === 'web-serial') {
        await printKitchenTicketWithWebSerial(ticket, printerSettings)
      } else if (printerSettings.mode === 'web-usb') {
        await printKitchenTicketWithWebUsb(ticket, printerSettings)
      } else if (printerSettings.mode === 'web-bluetooth') {
        await printKitchenTicketWithWebBluetooth(ticket, printerSettings)
      }

      toast.success('Kitchen ticket sent', {
        description: `${order.orderNumber} via ${printerModeLabels[printerSettings.mode]}.`,
      })
      markOrderPrinted(order.id, printedAt)
      autoPrintedOrderIdsRef.current.add(order.id)
      recordPrinterDiagnostic('hardware_print_succeeded', {
        orderId: order.id,
        orderNumber: order.orderNumber,
        mode: printerSettings.mode,
        target: printerSettings.mode === 'qz-tray' ? printerSettings.qzTargetType : printerSettings.mode,
        durationMs: Date.now() - printedAt.getTime(),
      })
      return true
    } catch (printError) {
      lastPrintErrorRef.current = printError instanceof Error ? printError.message : String(printError)
      recordPrinterDiagnostic('hardware_print_failed', {
        orderId: order.id,
        orderNumber: order.orderNumber,
        mode: printerSettings.mode,
        target: printerSettings.mode === 'qz-tray' ? printerSettings.qzTargetType : printerSettings.mode,
        reason: printError instanceof QzTrayError ? printError.reason : 'unknown',
        message: printError instanceof Error ? printError.message : String(printError),
        durationMs: Date.now() - printedAt.getTime(),
      })
      if (printError instanceof QzTrayError) {
        const guidance = qzErrorGuidance[printError.reason]
        toast.error(guidance.title, {
          // Prefer the error's own message: it is crafted per connection type
          // (system printer / network / serial) and is more specific than the
          // canned guidance, which is fallback for reasons without a message.
          description: printError.message || guidance.description,
          ...(guidance.offerDownload
            ? {
                action: {
                  label: 'Download QZ Tray',
                  onClick: () => window.open(QZ_TRAY_DOWNLOAD_URL, '_blank', 'noopener,noreferrer'),
                },
              }
            : {}),
        })
      } else {
        toast.error('Kitchen ticket could not be printed', {
          description: printError instanceof Error ? printError.message : 'The print request failed.',
        })
      }
      return false
    } finally {
      setPrintingOrderId(null)
    }
  }, [printerSettings])

  // Every source (manual print, automatic print, retry) passes through the same
  // in-page FIFO. QZ/COM devices are single-writer transports; overlapping sends
  // are a common cause of truncated tickets and "port busy" failures.
  const dispatchOrderTicket = useCallback((order: AdminOrder): Promise<boolean> => {
    const operation = printDispatchChainRef.current
      .catch(() => undefined)
      .then(() => printOrderTicket(order))
    printDispatchChainRef.current = operation.then(() => undefined, () => undefined)
    return operation
  }, [printOrderTicket])

  // Latest print handler + settings for realtime callbacks, without rebuilding
  // the SignalR connection whenever printer settings change.
  const printOrderTicketRef = useRef(dispatchOrderTicket)
  useEffect(() => {
    printOrderTicketRef.current = dispatchOrderTicket
  }, [dispatchOrderTicket])

  useEffect(() => {
    printerSettingsRef.current = printerSettings
  }, [printerSettings])

  const autoPrintedOrderIdsRef = useRef<Set<string>>(new Set())
  const autoPrintNotifiedIdsRef = useRef<Set<string>>(new Set())
  const ordersRef = useRef<AdminOrder[]>([])
  const autoPrintSweepRunningRef = useRef(false)

  const activePrintRestaurantId = user?.restaurantId
    ?? (isPlatformOwner && restaurantFilter !== 'all' ? restaurantFilter : undefined)

  const refreshPrintJobs = useCallback(async (showError = false) => {
    if (!activePrintRestaurantId) return
    setPrintJobsLoading(true)
    try {
      setPrintJobs(await getPrintJobs({ restaurantId: activePrintRestaurantId, take: 30 }))
    } catch (jobsError) {
      if (showError) {
        toast.error('Could not load print jobs', {
          description: jobsError instanceof Error ? jobsError.message : 'The request failed.',
        })
      }
    } finally {
      setPrintJobsLoading(false)
    }
  }, [activePrintRestaurantId])

  // Server-backed auto-print. The server owns the durable queue, retry schedule,
  // deduplication key, and station lease. Web Locks only avoids needless races
  // between tabs; a second computer still cannot claim this station's jobs.
  const runAutoPrintSweep = useCallback(async (force = false) => {
    const settings = printerSettingsRef.current
    if (settings.mode !== 'qz-tray' || (!settings.autoPrintNewOrders && !force)) return
    if (!activePrintRestaurantId) {
      recordPrinterDiagnostic('auto_print_skipped', {
        reason: 'restaurant_not_selected',
        isPlatformOwner,
      })
      return
    }
    if (autoPrintSweepRunningRef.current) return
    autoPrintSweepRunningRef.current = true

    try {
      const identity = printStationIdentityRef.current
      await withPrintStationLeadership(identity.stationKey, identity.clientInstanceId, async () => {
        const runtime = await getQzRuntimeInfo().catch(() => ({ connected: false, version: null }))
        const connectionType = settings.qzTargetType
        const printerName = settings.qzTargetType === 'printer'
          ? settings.qzPrinterName
          : settings.qzTargetType === 'network'
            ? `${settings.qzNetworkHost}:${settings.qzNetworkPort}`
            : settings.qzSerialPort

        const station = await upsertPrintStation(identity.stationKey, identity.stationName, {
          autoPrintEnabled: settings.autoPrintNewOrders,
          restaurantId: activePrintRestaurantId,
          clientInstanceId: identity.clientInstanceId,
          qzStatus: runtime.connected ? 'connected' : 'disconnected',
          printerStatus: 'unknown',
          printerName,
          connectionType,
          qzVersion: runtime.version ?? undefined,
          lastError: lastPrintErrorRef.current ?? undefined,
        })
        setPrintStationLeaseHeld(station.leaseHeldByAnotherClient)
        if (station.leaseHeldByAnotherClient) return

        const claimed = await claimPrintJobs({
          stationKey: identity.stationKey,
          clientInstanceId: identity.clientInstanceId,
          restaurantId: activePrintRestaurantId,
          maxJobs: 5,
        })
        setPrintStationLeaseHeld(false)
        setPrintJobs((current) => ({
          ...current,
          pendingCount: claimed.pendingCount,
          failedCount: claimed.failedCount,
        }))

        for (const job of claimed.jobs) {
          if (!job.leaseToken) continue
          const leaseToken = job.leaseToken

          if (hasPrintJobTransportReceipt(job.id)) {
            await updatePrintJobStatus(job.id, leaseToken, 'Completed', {
              detail: 'Recovered a durable client receipt; ticket was already accepted by the print transport.',
            })
            recordPrinterDiagnostic('auto_print_job_receipt_recovered', {
              jobId: job.id,
              orderId: job.orderId,
            })
            continue
          }

          if (!autoPrintNotifiedIdsRef.current.has(job.orderId)) {
            autoPrintNotifiedIdsRef.current.add(job.orderId)
            if (audioEnabledRef.current && audioContextRef.current) {
              playNewOrderSound(audioContextRef.current)
            }
          }

          recordPrinterDiagnostic('auto_print_job_claimed', {
            jobId: job.id,
            orderId: job.orderId,
            orderNumber: job.order.orderNumber,
            attempt: job.attempts,
            stationKey: identity.stationKey,
          })

          await updatePrintJobStatus(job.id, leaseToken, 'Sending', {
            detail: `${connectionType} send started`,
          })

          const printed = await printOrderTicketRef.current(job.order)
          if (printed) {
            markPrintJobTransportAccepted(job.id)
            await updatePrintJobStatus(job.id, leaseToken, 'Completed', {
              detail: `${connectionType} transport accepted the ticket; physical paper output is not confirmed`,
            })
            recordPrinterDiagnostic('auto_print_job_completed', {
              jobId: job.id,
              orderId: job.orderId,
              attempt: job.attempts,
            })
          } else {
            await updatePrintJobStatus(job.id, leaseToken, 'Failed', {
              detail: `${connectionType} send failed`,
              error: lastPrintErrorRef.current ?? 'The print transport rejected the ticket.',
            })
          }
        }
      })
      await refreshPrintJobs()
    } catch (sweepError) {
      if (sweepError instanceof Error && /another browser tab or computer|station_lease_held/i.test(sweepError.message)) {
        setPrintStationLeaseHeld(true)
      }
      recordPrinterDiagnostic('auto_print_sweep_failed', {
        message: sweepError instanceof Error ? sweepError.message : String(sweepError),
        stationKey: printStationIdentityRef.current.stationKey,
      })
    } finally {
      autoPrintSweepRunningRef.current = false
    }
  }, [activePrintRestaurantId, isPlatformOwner, refreshPrintJobs])

  useEffect(() => {
    autoPrintSweepRef.current = () => runAutoPrintSweep()
  }, [runAutoPrintSweep])

  useEffect(() => {
    if (printerSettings.mode === 'qz-tray' && printerSettings.autoPrintNewOrders) {
      const initialTimer = window.setTimeout(() => void runAutoPrintSweep(), 0)
      const timer = window.setInterval(() => void runAutoPrintSweep(), autoPrintPollIntervalMs)
      return () => {
        window.clearTimeout(initialTimer)
        window.clearInterval(timer)
      }
    }
  }, [printerSettings.autoPrintNewOrders, printerSettings.mode, runAutoPrintSweep])

  useEffect(() => {
    if (!activePrintRestaurantId) return
    const identity = printStationIdentityRef.current
    void (async () => {
      const runtime = await getQzRuntimeInfo().catch(() => ({ connected: false, version: null }))
      await upsertPrintStation(identity.stationKey, identity.stationName, {
        autoPrintEnabled: printerSettings.mode === 'qz-tray' && printerSettings.autoPrintNewOrders,
        restaurantId: activePrintRestaurantId,
        clientInstanceId: identity.clientInstanceId,
        qzStatus: runtime.connected ? 'connected' : 'disconnected',
        printerStatus: 'unknown',
        connectionType: printerSettings.mode === 'qz-tray' ? printerSettings.qzTargetType : printerSettings.mode,
        qzVersion: runtime.version ?? undefined,
      })
      await refreshPrintJobs()
    })().catch((stationError) => {
      recordPrinterDiagnostic('print_station_registration_failed', {
        message: stationError instanceof Error ? stationError.message : String(stationError),
      })
    })
  }, [
    activePrintRestaurantId,
    printerSettings.autoPrintNewOrders,
    printerSettings.mode,
    printerSettings.qzTargetType,
    refreshPrintJobs,
  ])

  useEffect(() => {
    if (!isPlatformOwner) return

    void getRestaurants()
      .then(setRestaurants)
      .catch((restaurantError) => {
        toast.error('Could not load restaurant filter', {
          description: restaurantError instanceof Error ? restaurantError.message : 'The request failed.',
        })
      })
  }, [isPlatformOwner])

  useEffect(() => {
    const initialLoadTimer = window.setTimeout(() => void loadOrders(), 0)
    const refreshTimer = window.setInterval(() => void loadOrders(), 15_000)
    return () => {
      window.clearTimeout(initialLoadTimer)
      window.clearInterval(refreshTimer)
    }
  }, [loadOrders])

  useEffect(() => {
    if (!user) return

    const client = createOrderRealtimeClient({
      onOrderCreated: (update) => {
        if (!shouldHandleRealtimeUpdate(update)) {
          return
        }

        setQueue('active')
        toast('New order received', {
          description: `${update.orderNumber} is waiting in the staff queue.`,
        })
        // Refresh fast; the sweep after the refresh handles sound + auto-print
        // (driven by order state, so it also survives a missed realtime event).
        scheduleRealtimeRefresh()
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
      onConnected: () => {
        recordPrinterDiagnostic('staff_signalr_connected', {
          visibilityState: document.visibilityState,
        })
      },
      onReconnecting: (realtimeError) => {
        recordPrinterDiagnostic('staff_signalr_reconnecting', {
          visibilityState: document.visibilityState,
          message: realtimeError?.message,
        })
      },
      onReconnected: () => {
        recordPrinterDiagnostic('staff_signalr_reconnected', {
          visibilityState: document.visibilityState,
        })
        void loadOrdersRef.current()
      },
      onClosed: (realtimeError) => {
        recordPrinterDiagnostic('staff_signalr_closed', {
          visibilityState: document.visibilityState,
          message: realtimeError?.message,
        })
      },
    })

    void client.start().catch((realtimeError) => {
      console.warn('[SignalR] Staff order realtime connection failed.', realtimeError)
      recordPrinterDiagnostic('staff_signalr_start_failed', {
        visibilityState: document.visibilityState,
        message: realtimeError instanceof Error ? realtimeError.message : String(realtimeError),
      })
    })

    let hiddenAt = document.hidden ? Date.now() : null
    let lastRecoveryAt = 0

    const recoverFromBackground = (trigger: string) => {
      const now = Date.now()
      if (now - lastRecoveryAt < 1_000) return
      lastRecoveryAt = now

      const hiddenDurationMs = hiddenAt === null ? null : now - hiddenAt
      hiddenAt = null
      recordPrinterDiagnostic('staff_page_recovering', {
        trigger,
        hiddenDurationMs,
        signalRState: client.connection.state,
        audioState: audioContextRef.current?.state,
      })

      void (async () => {
        if (audioContextRef.current?.state === 'suspended') {
          await audioContextRef.current.resume().catch((audioError) => {
            recordPrinterDiagnostic('staff_audio_resume_failed', {
              trigger,
              message: audioError instanceof Error ? audioError.message : String(audioError),
            })
          })
        }

        await client.start().catch((realtimeError) => {
          recordPrinterDiagnostic('staff_signalr_resume_failed', {
            trigger,
            state: client.connection.state,
            message: realtimeError instanceof Error ? realtimeError.message : String(realtimeError),
          })
        })
        await loadOrdersRef.current()

        recordPrinterDiagnostic('staff_page_recovered', {
          trigger,
          signalRState: client.connection.state,
          audioState: audioContextRef.current?.state,
        })
      })()
    }

    const handleVisibilityChange = () => {
      if (document.hidden) {
        hiddenAt = Date.now()
        recordPrinterDiagnostic('staff_page_hidden', {
          signalRState: client.connection.state,
          audioState: audioContextRef.current?.state,
        })
        return
      }

      recoverFromBackground('visibilitychange')
    }
    const handleFocus = () => {
      if (!document.hidden) recoverFromBackground('focus')
    }
    const handleFreeze = () => {
      recordPrinterDiagnostic('staff_page_frozen', {
        hiddenDurationMs: hiddenAt === null ? null : Date.now() - hiddenAt,
        signalRState: client.connection.state,
      })
    }
    const handleResume = () => recoverFromBackground('resume')
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) recoverFromBackground('pageshow')
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    document.addEventListener('freeze', handleFreeze)
    document.addEventListener('resume', handleResume)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('pageshow', handlePageShow)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      document.removeEventListener('freeze', handleFreeze)
      document.removeEventListener('resume', handleResume)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('pageshow', handlePageShow)

      if (realtimeRefreshTimerRef.current !== null) {
        window.clearTimeout(realtimeRefreshTimerRef.current)
        realtimeRefreshTimerRef.current = null
      }

      void client.stop()
    }
  }, [scheduleRealtimeRefresh, shouldHandleRealtimeUpdate, user])

  const visibleOrders = useMemo(
    () => orders.filter((order) => queueStatuses[queue].has(order.status)),
    [orders, queue],
  )

  const kitchenLanes = useMemo(() => {
    const now = lastUpdated ?? new Date()

    return (['new', 'preparing', 'ready'] as KitchenLane[]).map((lane) => ({
      lane,
      orders: orders
        .filter((order) => kitchenLaneStatuses[lane].has(order.status))
        .sort((first, second) => {
          const firstAge = getOrderAgeMinutes(first, now)
          const secondAge = getOrderAgeMinutes(second, now)
          return secondAge - firstAge
        }),
    }))
  }, [lastUpdated, orders])

  const kitchenOrderCount = useMemo(
    () => kitchenLanes.reduce((total, lane) => total + lane.orders.length, 0),
    [kitchenLanes],
  )

  const queueCounts = useMemo(() => ({
    active: orders.filter((order) => queueStatuses.active.has(order.status)).length,
    new: orders.filter((order) => queueStatuses.new.has(order.status)).length,
    kitchen: orders.filter((order) => queueStatuses.kitchen.has(order.status)).length,
    ready: orders.filter((order) => queueStatuses.ready.has(order.status)).length,
    closed: orders.filter((order) => queueStatuses.closed.has(order.status)).length,
  }), [orders])

  const priorityCounts = useMemo(() => {
    const now = lastUpdated ?? new Date()
    const activeOrders = orders.filter((order) => queueStatuses.active.has(order.status))

    return {
      needsAction: activeOrders.filter((order) => {
        const signal = getOrderSignal(order, now)
        return signal.tone !== 'blocked' && signal.tone !== 'closed'
      }).length,
      ready: activeOrders.filter((order) => order.status === 'Ready').length,
      late: activeOrders.filter((order) => getOrderSignal(order, now).isLate).length,
      waitingPayment: activeOrders.filter(isOnlinePaymentBlocked).length,
    }
  }, [lastUpdated, orders])

  const selectedRestaurant = restaurants.find((restaurant) => restaurant.id === restaurantFilter)
  const restaurantName = isPlatformOwner
    ? selectedRestaurant?.name ?? 'All restaurants'
    : orders[0]?.restaurantName ?? 'Your restaurant'

  const replaceOrder = (updatedOrder: AdminOrder) => {
    setOrders((current) => current.map((order) => order.id === updatedOrder.id ? updatedOrder : order))
  }

  const submitTransition = async (
    order: AdminOrder,
    action: OrderTransitionAction,
    transitionReason?: string,
  ) => {
    setBusyOrderId(order.id)
    try {
      const updatedOrder = await transitionAdminOrder(order.id, action, transitionReason)
      replaceOrder(updatedOrder)
      setPendingTransition(null)
      setReason('')
      toast.success(`${order.orderNumber}: ${actionLabels[action]}`, {
        description: `Order is now ${updatedOrder.status}.`,
      })
    } catch (transitionError) {
      toast.error('Order could not be processed', {
        description: transitionError instanceof Error ? transitionError.message : 'The request failed.',
      })
    } finally {
      setBusyOrderId(null)
    }
  }

  const beginTransition = (order: AdminOrder, action: OrderTransitionAction) => {
    if (reasonRequiredActions.has(action)) {
      setPendingTransition({ order, action })
      setReason('')
      return
    }

    void submitTransition(order, action)
  }

  const markCounterPayment = async (order: AdminOrder) => {
    setBusyOrderId(order.id)
    try {
      const updatedOrder = await recordCounterPayment(order.id)
      replaceOrder(updatedOrder)
      toast.success('Counter payment recorded', { description: order.orderNumber })
    } catch (paymentError) {
      toast.error('Counter payment could not be recorded', {
        description: paymentError instanceof Error ? paymentError.message : 'The request failed.',
      })
    } finally {
      setBusyOrderId(null)
    }
  }

  const retryQueuedPrint = useCallback(async (jobId: string) => {
    try {
      await retryPrintJob(jobId, 'Retried by staff from the print task centre.')
      toast.success('Print job queued again')
      await refreshPrintJobs()
      void runAutoPrintSweep(true)
    } catch (retryError) {
      toast.error('Could not retry print job', {
        description: retryError instanceof Error ? retryError.message : 'The request failed.',
      })
    }
  }, [refreshPrintJobs, runAutoPrintSweep])

  const printOrQueueOrder = useCallback(async (order: AdminOrder) => {
    if (printerSettings.mode !== 'qz-tray' || !activePrintRestaurantId) {
      await dispatchOrderTicket(order)
      return
    }

    try {
      const identity = printStationIdentityRef.current
      await upsertPrintStation(identity.stationKey, identity.stationName, {
        autoPrintEnabled: printerSettings.autoPrintNewOrders,
        restaurantId: activePrintRestaurantId,
        clientInstanceId: identity.clientInstanceId,
        qzStatus: isQzTrayConnected() ? 'connected' : 'disconnected',
        printerStatus: 'unknown',
        printerName: printerSettings.qzPrinterName || undefined,
        connectionType: printerSettings.qzTargetType,
      })
      await requestOrderReprint(order.id, {
        stationKey: identity.stationKey,
        restaurantId: activePrintRestaurantId,
        reason: 'Manual print requested from the staff order card.',
      })
      toast.success('Print job queued', { description: order.orderNumber })
      await refreshPrintJobs()
      await runAutoPrintSweep(true)
    } catch (queueError) {
      toast.error('Could not queue the print job', {
        description: queueError instanceof Error ? queueError.message : 'The request failed.',
      })
    }
  }, [
    activePrintRestaurantId,
    dispatchOrderTicket,
    printerSettings.mode,
    printerSettings.autoPrintNewOrders,
    printerSettings.qzPrinterName,
    printerSettings.qzTargetType,
    refreshPrintJobs,
    runAutoPrintSweep,
  ])

  const printTestTicket = useCallback(async () => {
    const now = new Date()
    const operation = printDispatchChainRef.current
      .catch(() => undefined)
      .then(() => printKitchenTicketWithQzTray({
        orderNumber: 'TEST-001',
        restaurantName: restaurantName === 'All restaurants' ? 'DineFlow' : restaurantName,
        orderScope: 'Printer diagnostics',
        status: 'TEST',
        createdAt: now,
        printedAt: now,
        itemCount: 2,
        orderNote: 'English + 中文 encoding check',
        items: [
          {
            quantity: 1,
            name: 'TEST ITEM / 测试项目',
            note: 'If this line is readable, encoding is correct.',
            optionGroups: [{ groupName: 'Connection', options: [printerSettings.qzTargetType] }],
          },
          {
            quantity: 1,
            name: '0123456789 !@#$%',
            optionGroups: [],
          },
        ],
      }, printerSettings))
    printDispatchChainRef.current = operation.then(() => undefined, () => undefined)

    try {
      await operation
      toast.success('Test ticket sent')
      recordPrinterDiagnostic('test_ticket_succeeded', {
        target: printerSettings.qzTargetType,
        encoding: printerSettings.qzEncoding,
      })
    } catch (testError) {
      toast.error('Test ticket failed', {
        description: testError instanceof Error ? testError.message : 'The print request failed.',
      })
      recordPrinterDiagnostic('test_ticket_failed', {
        target: printerSettings.qzTargetType,
        encoding: printerSettings.qzEncoding,
        message: testError instanceof Error ? testError.message : String(testError),
      })
    }
  }, [printerSettings, restaurantName])

  return (
    <main className="content-grid">
      <Card>
        <CardHeader className="section-header">
          <div className="admin-page-title">
            <Utensils size={22} />
            <div>
              <CardTitle>Staff Orders</CardTitle>
              <CardDescription>
                {restaurantName} · {isPlatformOwner ? 'Platform-wide order queue.' : 'Restaurant-scoped live order queue.'}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated ? (
              <span className="text-xs text-muted-foreground">
                Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            ) : null}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Kitchen printer settings"
                  onClick={() => setPrinterSettingsOpen(true)}
                >
                  <Settings2 size={17} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end" sideOffset={6}>
                Printer: {printerModeLabels[printerSettings.mode]}
              </TooltipContent>
            </Tooltip>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={audioEnabled ? 'Mute new order sound' : 'Enable new order sound'}
              title={audioEnabled ? 'Sound on - click to mute' : 'Sound off - click to enable'}
              onClick={() => void toggleAudio()}
            >
              {audioEnabled
                ? <Volume2 size={17} />
                : <VolumeX size={17} className="text-muted-foreground" />}
            </Button>
            <Button type="button" variant="secondary" disabled={loading} onClick={() => void loadOrders(true)}>
              <RefreshCw className={loading ? 'animate-spin' : ''} size={17} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        {printJobs.failedCount + printJobs.deadLetterCount > 0 ? (
          <div className="mx-6 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive">
            <span className="flex items-center gap-2 text-sm">
              <AlertCircle className="size-4 shrink-0" />
              {printJobs.failedCount + printJobs.deadLetterCount} print job
              {printJobs.failedCount + printJobs.deadLetterCount === 1 ? '' : 's'} need attention.
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => setPrinterSettingsOpen(true)}>
              Open print tasks
            </Button>
          </div>
        ) : null}
        {printStationLeaseHeld ? (
          <div className="mx-6 mb-3 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            <AlertCircle className="size-4 shrink-0" />
            Another tab or computer currently owns this print station. This page is standing by to prevent duplicate tickets.
          </div>
        ) : null}
        <CardContent className="space-y-5">
          <Tabs value={viewMode} onValueChange={(value) => setViewMode(value as StaffOrdersViewMode)} className="staff-orders-view-tabs">
            <TabsList aria-label="Staff order display mode">
              <TabsTrigger value="orders">
                <ListChecks size={16} />
                Orders
              </TabsTrigger>
              <TabsTrigger value="kitchen">
                <ChefHat size={16} />
                Kitchen
                <Badge variant="secondary" className="ml-1 h-5 min-w-5 justify-center px-1.5 leading-none">
                  {kitchenOrderCount}
                </Badge>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="staff-orders-priority-strip" aria-label="Staff order priority summary">
            <div className="staff-orders-priority-pill is-action">
              <strong>{priorityCounts.needsAction}</strong>
              <span>Need action</span>
            </div>
            <div className="staff-orders-priority-pill is-ready">
              <strong>{priorityCounts.ready}</strong>
              <span>Ready now</span>
            </div>
            <div className="staff-orders-priority-pill is-late">
              <strong>{priorityCounts.late}</strong>
              <span>Over 20 min</span>
            </div>
            <div className="staff-orders-priority-pill is-blocked">
              <strong>{priorityCounts.waitingPayment}</strong>
              <span>Waiting payment</span>
            </div>
          </div>

          <div className="staff-orders-toolbar">
            {isPlatformOwner ? (
              <div className="staff-orders-filter space-y-1.5">
                <span className="text-sm font-medium">Restaurant</span>
                <Select value={restaurantFilter} onValueChange={setRestaurantFilter}>
                  <SelectTrigger aria-label="Filter staff orders by restaurant">
                    <SelectValue placeholder="Select restaurant" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="all">All restaurants</SelectItem>
                    {restaurants.map((restaurant) => (
                      <SelectItem key={restaurant.id} value={restaurant.id}>{restaurant.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="staff-orders-search space-y-1.5">
              <span className="text-sm font-medium">Search orders</span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  className="h-10 pl-9 pr-9"
                  placeholder="Order, table, or item"
                  aria-label="Search staff orders"
                  onChange={(event) => setSearch(event.target.value)}
                />
                {search.trim() ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Clear order search"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2"
                    onClick={() => setSearch('')}
                  >
                    <X className="size-3.5" />
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="staff-orders-sort space-y-1.5">
              <span className="text-sm font-medium">Sort orders</span>
              <Select value={sortOption} onValueChange={(value) => setSortOption(value as SortOption)}>
                <SelectTrigger aria-label="Sort staff orders">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="newest">Newest first</SelectItem>
                  <SelectItem value="oldest">Oldest first</SelectItem>
                  <SelectItem value="recentlyUpdated">Recently updated</SelectItem>
                  <SelectItem value="amountHigh">Amount: high to low</SelectItem>
                  <SelectItem value="amountLow">Amount: low to high</SelectItem>
                  <SelectItem value="orderNumber">Order number</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {viewMode === 'orders' ? (
            <Tabs value={queue} onValueChange={(value) => setQueue(value as Queue)}>
              <TabsList className="grid h-11 w-full grid-cols-5">
                {(['active', 'new', 'kitchen', 'ready', 'closed'] as Queue[]).map((value) => (
                  <TabsTrigger
                    key={value}
                    value={value}
                    className="h-full min-w-0 gap-1 px-1 py-1 capitalize sm:gap-2 sm:px-3"
                  >
                    {value}
                    <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1.5 leading-none">
                      {queueCounts[value]}
                    </Badge>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ) : null}

          {error ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          ) : null}

          {loading && orders.length === 0 ? (
            <div className="dashboard-empty-state">Loading restaurant orders...</div>
          ) : viewMode === 'orders' && visibleOrders.length === 0 ? (
            <div className="dashboard-empty-state">
              {debouncedSearch ? `No orders match "${debouncedSearch}" in this queue.` : 'No orders in this queue.'}
            </div>
          ) : viewMode === 'kitchen' && kitchenOrderCount === 0 ? (
            <div className="dashboard-empty-state">
              {debouncedSearch ? `No kitchen orders match "${debouncedSearch}".` : 'No active kitchen orders.'}
            </div>
          ) : viewMode === 'kitchen' ? (
            <div className="staff-kitchen-board" aria-label="Kitchen order board">
              {kitchenLanes.map(({ lane, orders: laneOrders }) => (
                <section key={lane} className={cn('staff-kitchen-lane', `is-${lane}`)}>
                  <header className="staff-kitchen-lane-header">
                    <div>
                      <h3>{kitchenLaneLabels[lane]}</h3>
                      <span>{kitchenLaneDescriptions[lane]}</span>
                    </div>
                    <Badge variant="secondary">{laneOrders.length}</Badge>
                  </header>

                  {laneOrders.length === 0 ? (
                    <div className="staff-kitchen-empty">Clear</div>
                  ) : (
                    <div className="staff-kitchen-card-list">
                      {laneOrders.map((order) => {
                        const now = lastUpdated ?? new Date()
                        const signal = getOrderSignal(order, now)
                        const onlinePaymentBlocked = isOnlinePaymentBlocked(order)
                        const counterPaymentNeeded = needsCounterPayment(order)
                        const isBusy = busyOrderId === order.id
                        const itemCount = order.items.reduce((total, item) => total + item.quantity, 0)

                        return (
                          <article key={order.id} className={cn('staff-kitchen-card', `staff-kitchen-card-${signal.tone}`, signal.isLate && 'is-late')}>
                            <div className="staff-kitchen-card-header">
                              <div className="staff-kitchen-card-title">
                                <span className="staff-kitchen-order-number">{order.orderNumber}</span>
                                <strong>{order.tableNumber ? `Table ${order.tableNumber}` : getOrderTypeLabel(order.orderType)}</strong>
                              </div>
                              <div className="staff-kitchen-card-tools">
                                <span className={cn('staff-kitchen-timer', signal.isLate && 'is-late')}>
                                  <Clock3 size={15} />
                                  {formatElapsedTime(order, now)}
                                </span>
                                <PrintTicketButton
                                  disabled={printingOrderId === order.id}
                                  modeLabel={printerModeLabels[printerSettings.mode]}
                                  onClick={() => void printOrQueueOrder(order)}
                                />
                              </div>
                            </div>

                            <div className="staff-kitchen-meta">
                              <Badge variant="outline">{itemCount} item{itemCount === 1 ? '' : 's'}</Badge>
                              <OrderStatusBadge status={order.status} />
                              <PaymentStatusBadge status={order.paymentStatus} />
                              {counterPaymentNeeded ? <Badge variant="outline" className="staff-order-counter-badge">Counter due</Badge> : null}
                            </div>

                            {onlinePaymentBlocked ? (
                              <div className="staff-kitchen-warning">
                                <AlertCircle size={16} />
                                Awaiting online payment
                              </div>
                            ) : null}

                            <div className="staff-kitchen-items">
                              {order.items.map((item) => {
                                const optionGroups = groupSelectedOptions(item)
                                const itemName = item.itemNameSnapshot?.trim() || 'Unnamed item'

                                return (
                                  <div key={item.id} className="staff-kitchen-item">
                                    <div className="staff-kitchen-item-main">
                                      <span>{item.quantity}x</span>
                                      <strong>{itemName}</strong>
                                    </div>
                                    {optionGroups.length > 0 ? (
                                      <div className="staff-kitchen-options">
                                        {optionGroups.map((group) => (
                                          <div key={group.groupName}>
                                            <span>{group.groupName}</span>
                                            <p>{group.options.map((option) => `${option.optionNameSnapshot}${(option.quantity ?? 1) > 1 ? ` x${option.quantity ?? 1}` : ''}`).join(', ')}</p>
                                          </div>
                                        ))}
                                      </div>
                                    ) : null}
                                    {item.note ? (
                                      <div className="staff-kitchen-note">
                                        <strong>Item note</strong>
                                        <span>{item.note}</span>
                                      </div>
                                    ) : null}
                                  </div>
                                )
                              })}
                            </div>

                            {order.customerNote ? (
                              <div className="staff-kitchen-note is-order-note">
                                <strong>Order note</strong>
                                <span>{order.customerNote}</span>
                              </div>
                            ) : null}

                            <div className="staff-kitchen-actions">
                              {order.paymentMethod === 'PayAtCounter' && order.paymentStatus !== 'Paid' ? (
                                <Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={() => void markCounterPayment(order)}>
                                  Mark paid
                                </Button>
                              ) : null}
                              {(order.availableActions ?? [])
                                .filter((action) => ['Accept', 'StartPreparing', 'MarkReady', 'Complete'].includes(action))
                                .map((action) => (
                                  <Button
                                    key={action}
                                    type="button"
                                    size="sm"
                                    className="staff-order-primary-action"
                                    disabled={isBusy || onlinePaymentBlocked}
                                    onClick={() => beginTransition(order, action)}
                                  >
                                    {isBusy ? 'Updating' : actionLabels[action]}
                                  </Button>
                                ))}
                              {(order.availableActions ?? [])
                                .filter((action) => action === 'Reject' || action === 'Cancel')
                                .map((action) => (
                                  <Button
                                    key={action}
                                    type="button"
                                    size="sm"
                                    variant="destructive"
                                    disabled={isBusy}
                                    onClick={() => beginTransition(order, action)}
                                  >
                                    {actionLabels[action]}
                                  </Button>
                                ))}
                              {(order.availableActions ?? []).length === 0 && !onlinePaymentBlocked ? (
                                <span>No kitchen action available.</span>
                              ) : null}
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  )}
                </section>
              ))}
            </div>
          ) : (
            <div className="staff-orders-grid">
              {visibleOrders.map((order, index) => {
                const now = lastUpdated ?? new Date()
                const signal = getOrderSignal(order, now)
                const onlinePaymentBlocked = isOnlinePaymentBlocked(order)
                const counterPaymentNeeded = needsCounterPayment(order)
                const isBusy = busyOrderId === order.id

                return (
                  <motion.article
                    key={order.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, delay: Math.min(index * 0.025, 0.15) }}
                  >
                    <Card className={cn(
                      'staff-order-card',
                      `staff-order-card-${signal.tone}`,
                      signal.isLate && 'staff-order-card-late',
                    )}>
                      <CardHeader className="space-y-3 pb-3">
                        <div className="staff-order-signal-row">
                          <Badge
                            variant="outline"
                            className={cn('staff-order-signal-badge', `is-${signal.tone}`)}
                          >
                            {signal.label}
                          </Badge>
                          <div className="staff-order-card-tools">
                            <span className={cn('staff-order-wait-time', signal.isLate && 'is-late')}>
                              <Clock3 size={13} />
                              Waiting {formatElapsedTime(order, now)}
                            </span>
                            <PrintTicketButton
                              disabled={printingOrderId === order.id}
                              modeLabel={printerModeLabels[printerSettings.mode]}
                              onClick={() => void printOrQueueOrder(order)}
                            />
                          </div>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <CardTitle className="text-base">{order.orderNumber}</CardTitle>
                            <CardDescription className="mt-1 flex items-center gap-1.5">
                              {order.orderType === 'DineIn' ? <Utensils size={14} /> : <ShoppingBag size={14} />}
                              {getOrderScope(order)}
                              <span>·</span>
                              <Clock3 size={14} />
                              {formatTime(order.createdAt)}
                            </CardDescription>
                          </div>
                          <strong>{formatMoney(order.totalAmount, order.currency)}</strong>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline" className="staff-order-type-badge">
                            {order.orderType === 'DineIn' ? <Utensils size={12} /> : <ShoppingBag size={12} />}
                            {getOrderTypeLabel(order.orderType)}
                          </Badge>
                          {order.tableNumber ? (
                            <Badge variant="secondary">Table {order.tableNumber}</Badge>
                          ) : null}
                          <OrderStatusBadge status={order.status} />
                          <PaymentStatusBadge status={order.paymentStatus} />
                          <Badge variant="secondary">{order.restaurantName ?? 'Assigned restaurant'}</Badge>
                          {counterPaymentNeeded ? (
                            <Badge variant="outline" className="staff-order-counter-badge">
                              Counter payment due
                            </Badge>
                          ) : null}
                          <Badge variant="outline">
                            <CreditCard size={12} />
                            {order.paymentMethod === 'PayAtCounter' ? 'Counter' : 'Online'}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="space-y-2">
                          {order.items.map((item) => {
                            const optionGroups = groupSelectedOptions(item)
                            const itemName = item.itemNameSnapshot?.trim() || 'Unnamed item'

                            return (
                              <div key={item.id} className="rounded-lg border bg-muted/20 p-3">
                                <div className="flex justify-between gap-3 text-sm">
                                  <span className="font-medium text-foreground">
                                    <strong>{item.quantity}x</strong> {itemName}
                                  </span>
                                  <span className="font-medium">{formatMoney(item.totalPrice, order.currency)}</span>
                                </div>

                                {optionGroups.length > 0 ? (
                                  <div className="mt-2 space-y-1.5 border-l pl-3">
                                    {optionGroups.map((group) => (
                                      <div key={group.groupName} className="flex flex-wrap items-center gap-1.5 text-xs">
                                        <span className="font-semibold text-muted-foreground">{group.groupName}</span>
                                        {group.options.map((option) => (
                                          <Badge key={option.id} variant="outline" className="h-auto rounded-md px-2 py-0.5 text-[11px] font-medium">
                                            {option.optionNameSnapshot}
                                            {(option.quantity ?? 1) > 1 ? ` ×${option.quantity ?? 1}` : ''}
                                            {option.priceAdjustmentSnapshot !== 0 ? (
                                              <span className="ml-1 text-muted-foreground">
                                                {formatOptionAdjustment(option.priceAdjustmentSnapshot * (option.quantity ?? 1), order.currency)}
                                              </span>
                                            ) : null}
                                          </Badge>
                                        ))}
                                      </div>
                                    ))}
                                  </div>
                                ) : null}

                                {item.note ? (
                                  <div className="mt-2 rounded-md bg-background/80 px-2 py-1 text-xs text-muted-foreground">
                                    <strong>Item note: </strong>{item.note}
                                  </div>
                                ) : null}
                              </div>
                            )
                          })}
                        </div>

                        {order.customerNote ? (
                          <div className="rounded-lg bg-muted/60 p-3 text-sm">
                            <strong>Note: </strong>{order.customerNote}
                          </div>
                        ) : null}

                        {onlinePaymentBlocked ? (
                          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                            <AlertCircle className="mt-0.5 size-4 shrink-0" />
                            <span className="text-sm">Awaiting online payment. Processing is locked by the server.</span>
                          </div>
                        ) : null}

                        <div className="staff-order-action-row">
                          {order.paymentMethod === 'PayAtCounter' && order.paymentStatus !== 'Paid' ? (
                            <Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={() => void markCounterPayment(order)}>
                              Mark paid
                            </Button>
                          ) : null}
                          {(order.availableActions ?? []).map((action) => (
                            <Button
                              key={action}
                              type="button"
                              size="sm"
                              variant={action === 'Reject' || action === 'Cancel' ? 'destructive' : 'default'}
                              className={cn(action !== 'Reject' && action !== 'Cancel' && 'staff-order-primary-action')}
                              disabled={isBusy}
                              onClick={() => beginTransition(order, action)}
                            >
                              {isBusy ? 'Updating' : actionLabels[action]}
                            </Button>
                          ))}
                          {(order.availableActions ?? []).length === 0 && !onlinePaymentBlocked ? (
                            <span className="text-sm text-muted-foreground">No action available.</span>
                          ) : null}
                        </div>
                      </CardContent>
                    </Card>
                  </motion.article>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {printTicket ? (
        <OrderPrintTicket
          order={printTicket.order}
          paperWidth={printerSettings.paperWidth}
          printedAt={new Date(printTicket.requestedAt)}
        />
      ) : null}

      <PrinterSettingsDialog
        open={printerSettingsOpen}
        settings={printerSettings}
        printJobs={printJobs}
        printJobsLoading={printJobsLoading}
        onOpenChange={setPrinterSettingsOpen}
        onSettingsChange={updatePrinterSettings}
        onRefreshPrintJobs={() => void refreshPrintJobs(true)}
        onRetryPrintJob={(jobId) => void retryQueuedPrint(jobId)}
        onPrintTestTicket={() => void printTestTicket()}
      />

      <Dialog open={pendingTransition !== null} onOpenChange={(open) => {
        if (!open && busyOrderId === null) {
          setPendingTransition(null)
          setReason('')
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pendingTransition ? actionLabels[pendingTransition.action] : 'Update order'}</DialogTitle>
            <DialogDescription>
              {pendingTransition ? `${pendingTransition.order.orderNumber}: explain this status change.` : 'Explain this status change.'}
            </DialogDescription>
          </DialogHeader>
          {pendingTransition ? (
            <OrderTransitionReasonField
              key={`${pendingTransition.order.id}-${pendingTransition.action}`}
              action={pendingTransition.action}
              value={reason}
              onChange={setReason}
            />
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busyOrderId !== null} onClick={() => setPendingTransition(null)}>
              Keep current status
            </Button>
            <Button
              type="button"
              variant={pendingTransition?.action === 'Reject' || pendingTransition?.action === 'Cancel' ? 'destructive' : 'default'}
              disabled={!reason.trim() || busyOrderId !== null || pendingTransition === null}
              onClick={() => {
                if (pendingTransition) void submitTransition(pendingTransition.order, pendingTransition.action, reason.trim())
              }}
            >
              {busyOrderId ? 'Updating' : 'Confirm change'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}

function ConnectionTestBadge({ status }: { status: ConnectionTestStatus }) {
  if (status === 'testing') {
    return (
      <Badge role="status" aria-live="polite" variant="outline" className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
        <RefreshCw className="animate-spin" />
        Testing…
      </Badge>
    )
  }

  if (status === 'succeeded') {
    return (
      <Badge role="status" aria-live="polite" variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
        <CheckCircle2 />
        Passed
      </Badge>
    )
  }

  if (status === 'failed') {
    return (
      <Badge role="status" aria-live="polite" variant="destructive">
        <AlertCircle />
        Failed
      </Badge>
    )
  }

  return (
    <Badge role="status" aria-live="polite" variant="secondary">
      <CircleHelp />
      Not tested
    </Badge>
  )
}

const qzSettingsProbeTimeoutMs = 10_000

async function withSettingsTimeout<T>(operation: Promise<T>, message: string): Promise<T> {
  let timeoutId: number | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error(message)), qzSettingsProbeTimeoutMs)
      }),
    ])
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId)
  }
}

function PrinterSettingsDialog({
  open,
  settings,
  printJobs,
  printJobsLoading,
  onOpenChange,
  onSettingsChange,
  onRefreshPrintJobs,
  onRetryPrintJob,
  onPrintTestTicket,
}: {
  open: boolean
  settings: ThermalPrinterSettings
  printJobs: PrintJobList
  printJobsLoading: boolean
  onOpenChange: (open: boolean) => void
  onSettingsChange: (updates: Partial<ThermalPrinterSettings>) => void
  onRefreshPrintJobs: () => void
  onRetryPrintJob: (jobId: string) => void
  onPrintTestTicket: () => void
}) {
  const [qzStatus, setQzStatus] = useState<QzTrayConnectionStatus | 'checking' | 'unknown'>('unknown')
  const [qzVersion, setQzVersion] = useState<string | null>(null)
  const [qzPrinters, setQzPrinters] = useState<QzTrayPrinterDescriptor[]>([])
  const [qzSerialPorts, setQzSerialPorts] = useState<string[]>([])
  const [qzPrintersLoading, setQzPrintersLoading] = useState(false)
  const [qzHostSubnet, setQzHostSubnet] = useState<string | null>(null)
  const qzDiscoveryGenerationRef = useRef(0)
  const [qzPrinterTestStatus, setQzPrinterTestStatus] = useState<ConnectionTestStatus>('untested')
  const [qzNetworkTestStatus, setQzNetworkTestStatus] = useState<ConnectionTestStatus>('untested')
  const [qzSerialTestStatus, setQzSerialTestStatus] = useState<ConnectionTestStatus>('untested')
  const [webSerialTestStatus, setWebSerialTestStatus] = useState<ConnectionTestStatus>('untested')
  const [webUsbTestStatus, setWebUsbTestStatus] = useState<ConnectionTestStatus>('untested')
  const netTesting = qzNetworkTestStatus === 'testing'
  const qzSerialTesting = qzSerialTestStatus === 'testing'
  const serialTesting = webSerialTestStatus === 'testing'
  const usbTesting = webUsbTestStatus === 'testing'
  const qzPrinterOptions = useMemo(() => {
    const selectedName = settings.qzPrinterName.trim()
    if (!selectedName || qzPrinters.some((printer) => printer.name === selectedName)) {
      return qzPrinters
    }

    return [
      {
        name: selectedName,
        driverName: null,
        portName: null,
        connectionKind: null,
        connectionLabel: null,
        isVirtual: false,
        isDefault: false,
        sharedPortQueueCount: 1,
      } satisfies QzTrayPrinterDescriptor,
      ...qzPrinters,
    ]
  }, [qzPrinters, settings.qzPrinterName])
  const selectedQzPrinter = qzPrinterOptions.find((printer) => printer.name === settings.qzPrinterName) ?? null
  const backgroundBrowser = useMemo(
    () => getBackgroundBrowserGuidance(window.navigator.userAgent),
    [],
  )

  const showBackgroundBrowserGuidance = useCallback(async () => {
    const origin = window.location.origin

    if (!backgroundBrowser.supportsSiteException || !backgroundBrowser.settingsPath) {
      const description = backgroundBrowser.kind === 'firefox'
        ? 'Firefox may unload inactive tabs when memory is low. Use about:unloads to inspect unloaded tabs; for an unattended printing station, Edge or Chrome with a site exception is the safer setup.'
        : 'For unattended printing, use a dedicated Edge or Chrome window and add this site to “Always keep these sites active”.'

      recordPrinterDiagnostic('background_browser_guidance_used', {
        browser: backgroundBrowser.kind,
        action: 'advice',
      })
      toast.info(`${backgroundBrowser.browserLabel} background printing`, { description })
      return
    }

    let copied: boolean
    try {
      await window.navigator.clipboard.writeText(origin)
      copied = true
    } catch {
      const textArea = document.createElement('textarea')
      textArea.value = origin
      textArea.setAttribute('readonly', '')
      textArea.style.position = 'fixed'
      textArea.style.opacity = '0'
      document.body.appendChild(textArea)
      textArea.select()
      copied = document.execCommand('copy')
      textArea.remove()
    }

    recordPrinterDiagnostic('background_browser_guidance_used', {
      browser: backgroundBrowser.kind,
      action: 'copy_site',
      copied,
    })

    if (copied) {
      toast.success('Printing site copied', {
        description: `Open ${backgroundBrowser.settingsPath}, choose Add, then paste ${origin}.`,
      })
    } else {
      toast.error('Could not copy the site address', {
        description: `Copy ${origin}, then add it under ${backgroundBrowser.settingsPath}.`,
      })
    }
  }, [backgroundBrowser])

  // Verify a network printer answers on IP:port before saving — a raw socket
  // probe through QZ, no need to print a real ticket to find out.
  const testNetworkPrinter = useCallback(async () => {
    const host = settings.qzNetworkHost.trim()
    if (!host) {
      toast.error('Enter the printer IP first')
      return
    }
    setQzNetworkTestStatus('testing')
    try {
      const port = settings.qzNetworkPort || defaultThermalPrinterSettings.qzNetworkPort
      const reachable = await probeQzNetworkPrinter(host, port)
      if (reachable) {
        setQzNetworkTestStatus('succeeded')
        toast.success('Printer reachable', { description: `${host}:${port} accepted a connection.` })
      } else {
        setQzNetworkTestStatus('failed')
        toast.error('No response', {
          description: `${host}:${port} did not answer. Check the IP, that the printer is on the network, and that RAW/9100 is enabled.`,
        })
      }
    } catch (error) {
      setQzNetworkTestStatus('failed')
      toast.error('Could not test the printer', {
        description: error instanceof Error ? error.message : 'The connection test failed.',
      })
    }
  }, [settings.qzNetworkHost, settings.qzNetworkPort])

  // Track the latest printer name without making the discovery callback depend on
  // it (which would refetch the printer list on every keystroke).
  const qzPrinterNameRef = useRef(settings.qzPrinterName)
  useEffect(() => {
    qzPrinterNameRef.current = settings.qzPrinterName
  }, [settings.qzPrinterName])

  // Discover the printers QZ Tray can see and preselect the OS default when the
  // user has not chosen one yet. Safe to call only when connected (or from an
  // explicit user action, since connecting may show the QZ allow-prompt).
  const loadQzPrinters = useCallback(async () => {
    const generation = ++qzDiscoveryGenerationRef.current
    setQzPrintersLoading(true)
    setQzStatus('checking')
    try {
      const [printers, serialPorts, hostNetwork] = await withSettingsTimeout(
        Promise.all([
          listQzTrayPrinterDescriptors(),
          listQzSerialPorts().catch(() => [] as string[]),
          getQzHostNetwork().catch(() => null),
        ]),
        'QZ Tray did not respond within 10 seconds.',
      )
      if (generation !== qzDiscoveryGenerationRef.current) return

      setQzPrinters(printers)
      setQzSerialPorts(serialPorts)
      setQzHostSubnet(hostNetwork?.subnetPrefix ?? null)
      setQzStatus('connected')
      void getQzRuntimeInfo().then((runtime) => setQzVersion(runtime.version))

      if (!qzPrinterNameRef.current.trim() && printers.length > 0) {
        const defaultPrinter = await getQzTrayDefaultPrinter()
        onSettingsChange({
          qzPrinterName:
            defaultPrinter && printers.some((printer) => printer.name === defaultPrinter)
              ? defaultPrinter
              : printers[0].name,
        })
      }
    } catch (error) {
      if (generation !== qzDiscoveryGenerationRef.current) return

      setQzStatus(error instanceof QzTrayError && error.reason === 'not-loaded' ? 'unavailable' : 'disconnected')
      setQzPrinters([])
      setQzSerialPorts([])
      setQzHostSubnet(null)
      setQzVersion(null)
      recordPrinterDiagnostic('qz_settings_discovery_failed', {
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      if (generation === qzDiscoveryGenerationRef.current) {
        setQzPrintersLoading(false)
      }
    }
  }, [onSettingsChange])

  // On open, show whether a connection is already active (cheap, no prompt) and
  // refresh the printer list for the dropdown. If this browser has connected
  // before (e.g. the websocket dropped on a page reload), auto-reconnect instead
  // of requiring a manual Test connection — silent when QZ has remembered the site.
  useEffect(() => {
    if (!open) return
    let cancelled = false

    const unsubscribe = subscribeQzTrayConnectionStatus((status) => {
      if (cancelled) return
      setQzStatus(status)
      if (status !== 'connected') {
        setQzVersion(null)
        qzDiscoveryGenerationRef.current += 1
        setQzPrintersLoading(false)
      }
    })

    void Promise.resolve().then(() => {
      if (cancelled) return
      if (isQzTrayConnected() || hasQzTrayConnectedBefore()) {
        void loadQzPrinters()
      } else {
        setQzStatus('unknown')
      }
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [open, loadQzPrinters])

  // Explicit user-triggered probe: may open a connection (and show the QZ Tray
  // allow-prompt on unsigned setups), so it never runs automatically.
  const testQzConnection = useCallback(async () => {
    setQzStatus('checking')
    let status: QzTrayConnectionStatus
    try {
      status = await withSettingsTimeout(
        probeQzTrayStatus(),
        'QZ Tray did not respond within 10 seconds.',
      )
    } catch (error) {
      status = 'disconnected'
      recordPrinterDiagnostic('qz_settings_probe_timed_out', {
        message: error instanceof Error ? error.message : String(error),
      })
    }
    setQzStatus(status)
    if (status === 'connected') {
      await loadQzPrinters()
    }
  }, [loadQzPrinters])

  const [usbDetecting, setUsbDetecting] = useState(false)
  const [usbDeviceLabel, setUsbDeviceLabel] = useState<string | null>(null)
  const [serialSelecting, setSerialSelecting] = useState(false)
  const [serialPortLabel, setSerialPortLabel] = useState<string | null>(null)
  const [trustBusy, setTrustBusy] = useState(false)
  const [clearingQueue, setClearingQueue] = useState(false)
  const [bleSelecting, setBleSelecting] = useState(false)

  const resetQzTargetTests = useCallback(() => {
    setQzPrinterTestStatus('untested')
    setQzNetworkTestStatus('untested')
    setQzSerialTestStatus('untested')
  }, [])

  const resetAllConnectionTests = useCallback(() => {
    resetQzTargetTests()
    setWebSerialTestStatus('untested')
    setWebUsbTestStatus('untested')
  }, [resetQzTargetTests])

  const testSelectedQzPrinter = useCallback(async () => {
    const printerName = settings.qzPrinterName.trim()
    if (!printerName) {
      toast.error('Choose a system printer first')
      return
    }

    setQzPrinterTestStatus('testing')
    try {
      const printers = await listQzTrayPrinterDescriptors()
      const printer = printers.find((candidate) => candidate.name === printerName)
      if (!printer) {
        throw new QzTrayError('no-printer', `${printerName} is no longer available in Windows.`)
      }

      setQzPrinters(printers)
      const health = await checkQzPrinterHealth(printerName)
      if (!health.ok) {
        throw new QzTrayError(
          'printer-unavailable',
          `${printerName} reported ${health.status.replaceAll('_', ' ').toLowerCase()}.`,
        )
      }

      setQzPrinterTestStatus('succeeded')
      toast.success('System printer test completed', {
        description: health.status === 'UNKNOWN'
          ? `${printerName} is available to QZ and Windows. Its driver did not expose physical device status, so only a real test ticket can fully verify the USB cable and printer.`
          : `${printerName} is available and reported ${health.status.replaceAll('_', ' ').toLowerCase()}.`,
      })
    } catch (error) {
      setQzPrinterTestStatus('failed')
      toast.error('System printer test failed', {
        description: error instanceof Error ? error.message : 'The selected Windows printer could not be verified.',
      })
    }
  }, [settings.qzPrinterName])

  // BLE picker (user gesture) → connect + discover the writable characteristic.
  // The GATT connection then stays open between prints.
  const selectBlePrinter = useCallback(async () => {
    setBleSelecting(true)
    try {
      const name = await selectWebBluetoothPrinter()
      onSettingsChange({ bleDeviceName: name })
      toast.success('Bluetooth printer connected', {
        description: `${name} — the connection stays open between prints.`,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        return // User closed the chooser without picking.
      }
      toast.error('Could not connect Bluetooth printer', {
        description: error instanceof Error ? error.message : 'The device request failed.',
      })
    } finally {
      setBleSelecting(false)
    }
  }, [onSettingsChange])

  const testSelectedQzSerialPort = useCallback(async () => {
    const portName = settings.qzSerialPort.trim()
    if (!portName) {
      toast.error('Choose a COM port first')
      return
    }

    setQzSerialTestStatus('testing')
    try {
      await testQzSerialConnection(portName, settings.serialBaudRate)
      setQzSerialTestStatus('succeeded')
      toast.success('Bluetooth COM connection verified', {
        description: `${portName} opened through QZ and accepted a non-printing status request. The connection will stay open.`,
      })
    } catch (error) {
      setQzSerialTestStatus('failed')
      toast.error('Could not open the Bluetooth COM port', {
        description: error instanceof Error ? error.message : 'The QZ serial connection test failed.',
      })
    }
  }, [settings.qzSerialPort, settings.serialBaudRate])

  const testSelectedWebSerialPort = useCallback(async () => {
    setWebSerialTestStatus('testing')
    try {
      const { label } = await testWebSerialConnection(settings.serialBaudRate)
      setSerialPortLabel(label)
      setWebSerialTestStatus('succeeded')
      toast.success('Serial connection verified', {
        description: `${label} opened and accepted a non-printing status request. The connection will stay open.`,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        setWebSerialTestStatus('untested')
        return
      }
      setWebSerialTestStatus('failed')
      toast.error('Could not test the serial connection', {
        description: error instanceof Error ? error.message : 'The Web Serial connection test failed.',
      })
    }
  }, [settings.serialBaudRate])

  const testSelectedWebUsbPrinter = useCallback(async () => {
    setWebUsbTestStatus('testing')
    try {
      const result = await testWebUsbConnection(settings)
      setUsbDeviceLabel(result.label)
      if (
        result.interfaceNumber !== settings.usbInterfaceNumber
        || result.endpointNumber !== settings.usbEndpointNumber
      ) {
        onSettingsChange({
          usbInterfaceNumber: result.interfaceNumber,
          usbEndpointNumber: result.endpointNumber,
        })
      }
      setWebUsbTestStatus('succeeded')
      toast.success('USB connection verified', {
        description: `${result.label} accepted a non-printing status request on interface ${result.interfaceNumber}, endpoint ${result.endpointNumber}.`,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        setWebUsbTestStatus('untested')
        return
      }
      setWebUsbTestStatus('failed')
      toast.error('Could not test the USB connection', {
        description: error instanceof Error ? error.message : 'The WebUSB connection test failed.',
      })
    }
  }, [onSettingsChange, settings])

  // Recovery tool for the classic spooler pile-up: cancel jobs that queued while
  // the printer was down, so bringing it back does not burst out stale tickets.
  // `allPrinters` clears every OS queue (used from Browser mode, where the page
  // has no idea which printer the OS sent jobs to and cannot touch the spooler
  // itself); otherwise just the selected QZ printer. Both go through QZ Tray, so
  // when QZ is not installed we fall back to Windows manual instructions.
  const clearQueue = useCallback(async (allPrinters = false) => {
    setClearingQueue(true)
    try {
      await clearQzPrinterQueue(allPrinters ? undefined : qzPrinterNameRef.current)
      toast.success('Print queue cleared', {
        description: 'Stale queued tickets were cancelled. Safe to bring the printer back now.',
      })
    } catch (error) {
      const qzMissing = error instanceof QzTrayError && (error.reason === 'not-running' || error.reason === 'not-loaded')
      toast.error('Could not clear the print queue', {
        description: qzMissing
          ? 'No web API can clear browser-print jobs directly. Clear them in Windows: Settings → Bluetooth & devices → Printers → your printer → Open print queue → Cancel all. (Installing QZ Tray adds a one-click Clear queue here.)'
          : error instanceof Error
            ? error.message
            : 'The clear request failed.',
      })
    } finally {
      setClearingQueue(false)
    }
  }, [])

  // One-time serial port grant (browser picker), immediately probed with an
  // ESC/POS status query so the user learns right away whether a printer
  // actually answers on the picked port (Bluetooth pairs create an outgoing
  // AND an incoming COM port — only the outgoing one reaches the printer).
  const selectSerialPort = useCallback(async () => {
    setSerialSelecting(true)
    try {
      // Probe disabled while we isolate a Bluetooth-module wedge: selection only
      // grants + remembers the port, exactly like the pre-probe behaviour.
      const { label, probe } = await selectWebSerialPort(settings.serialBaudRate, { probe: false })

      if (probe === 'skipped') {
        setSerialPortLabel(label)
        setWebSerialTestStatus('untested')
        toast.success('Serial port selected', { description: `${label} — later prints reuse it without asking.` })
        return
      }

      if (probe === 'open-failed') {
        setSerialPortLabel(null)
        // Chrome's direct-Bluetooth entries (device name, no COM number) are the
        // primary path on macOS/Android/ChromeOS but often lose to the OS-owned
        // COM ports on Windows — so the guidance differs per platform.
        const isWindows = navigator.userAgent.includes('Windows')
        toast.error('Could not open that port', {
          description: isWindows
            ? 'On Windows, prefer the entry with a COM number (the Bluetooth "outgoing" port, usually named like "Serial Port…"). The device-name entry sometimes works — retrying is fine — but the COM port is the reliable one.'
            : 'Make sure the printer is powered on, paired and in range, then try again — direct Bluetooth connections can fail transiently.',
        })
        return
      }

      setSerialPortLabel(label)

      if (probe === 'responded') {
        toast.success('Printer verified on this port', {
          description: `${label} answered the status query — prints will reuse it silently.`,
        })
      } else {
        toast.warning('Port opened, but no printer replied', {
          description: 'This may be the Bluetooth "incoming" port — if printing produces nothing, re-select and pick the other COM. (Some printers simply ignore status queries.)',
        })
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        return // User closed the picker without choosing.
      }
      toast.error('Could not select serial port', {
        description: error instanceof Error ? error.message : 'The port request failed.',
      })
    } finally {
      setSerialSelecting(false)
    }
  }, [settings.serialBaudRate])
  const qzTrustSupported = canManageQzTrustCertificate()

  // Quick trust setup: user picks the QZ Tray install folder in the system picker
  // and we write override.crt there — the one file that makes QZ stop prompting.
  const installTrust = useCallback(async () => {
    setTrustBusy(true)
    try {
      const folder = await installQzTrustCertificate()
      toast.success('Trust certificate installed', {
        description: `override.crt written to "${folder}". Restart QZ Tray (tray icon → exit, reopen) to apply.`,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return // User closed the folder picker.
      }
      toast.error('Could not install trust certificate', {
        description: error instanceof Error ? error.message : 'Writing override.crt failed.',
      })
    } finally {
      setTrustBusy(false)
    }
  }, [])

  const removeTrust = useCallback(async () => {
    setTrustBusy(true)
    try {
      const folder = await removeQzTrustCertificate()
      toast.success('Trust certificate removed', {
        description: `override.crt deleted from "${folder}". Restart QZ Tray to apply.`,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        toast.info('Nothing to remove', { description: 'No override.crt was found in that folder.' })
        return
      }
      toast.error('Could not remove trust certificate', {
        description: error instanceof Error ? error.message : 'Deleting override.crt failed.',
      })
    } finally {
      setTrustBusy(false)
    }
  }, [])

  const downloadTrustCert = useCallback(async () => {
    try {
      await downloadQzTrustCertificate()
    } catch (error) {
      toast.error('Could not download certificate', {
        description: error instanceof Error ? error.message : 'The certificate request failed.',
      })
    }
  }, [])

  // Browser-native USB picker (user gesture) → auto-fill vendor/product IDs and
  // the detected bulk-OUT interface/endpoint, instead of hand-typed hex values.
  const selectUsbPrinter = useCallback(async () => {
    setUsbDetecting(true)
    try {
      const detected = await detectWebUsbPrinter()
      onSettingsChange({
        usbVendorId: detected.vendorId,
        usbProductId: detected.productId,
        usbInterfaceNumber: detected.interfaceNumber,
        usbEndpointNumber: detected.endpointNumber,
      })
      setUsbDeviceLabel(detected.label)
      setWebUsbTestStatus('untested')
      toast.success('USB printer selected', { description: detected.label })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        return // User closed the picker without choosing — not an error.
      }
      toast.error('Could not select USB printer', {
        description: error instanceof Error ? error.message : 'The device request failed.',
      })
    } finally {
      setUsbDetecting(false)
    }
  }, [onSettingsChange])

  const qzConnected = qzStatus === 'connected'
  const qzStatusLabel =
    qzStatus === 'connected'
      ? 'QZ Tray connected'
      : qzStatus === 'checking'
        ? 'Checking QZ Tray…'
        : qzStatus === 'unavailable'
          ? 'QZ Tray helper unavailable'
          : 'QZ Tray not detected'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="staff-printer-dialog">
        <DialogHeader>
          <DialogTitle>Kitchen printer</DialogTitle>
          <DialogDescription>
            Select the route used by the print icon on staff order cards.
          </DialogDescription>
        </DialogHeader>

        <div className="staff-printer-settings">
          <div className="staff-printer-grid">
            <div className="staff-printer-field">
              <span>Route</span>
              <Select
                value={settings.mode}
                onValueChange={(value) => {
                  resetAllConnectionTests()
                  onSettingsChange({ mode: value as ThermalPrinterMode })
                }}
              >
                <SelectTrigger aria-label="Kitchen printer route">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="browser">Browser print</SelectItem>
                  <SelectItem value="qz-tray">QZ Tray</SelectItem>
                  <SelectItem value="web-serial">Web Serial</SelectItem>
                  <SelectItem value="web-usb">WebUSB</SelectItem>
                  <SelectItem value="web-bluetooth">Web Bluetooth (BLE)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="staff-printer-field">
              <span>Paper</span>
              <Select
                value={settings.paperWidth}
                onValueChange={(value) => onSettingsChange({ paperWidth: value as ThermalPaperWidth })}
              >
                <SelectTrigger aria-label="Thermal paper width">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="80mm">80mm</SelectItem>
                  <SelectItem value="58mm">58mm</SelectItem>
                </SelectContent>
              </Select>
            </div>

          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="staff-printer-switch">
              <span>Cut paper</span>
              <Switch
                checked={settings.cutPaper}
                onCheckedChange={(checked) => onSettingsChange({ cutPaper: checked })}
              />
            </label>

            <label className="staff-printer-switch">
              <span>Beep on print</span>
              <Switch
                checked={settings.beepOnPrint}
                onCheckedChange={(checked) => onSettingsChange({ beepOnPrint: checked })}
              />
            </label>
          </div>

          {settings.mode === 'browser' ? (
            <section className="staff-printer-route-card active">
              <header>
                <strong>Browser print</strong>
              </header>
              <p className="text-[0.7rem] leading-snug text-muted-foreground">
                Prints through the system print dialog — works with any installed printer, but shows a dialog for
                every ticket. Pick another route for silent printing.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => void clearQueue(true)}
                disabled={clearingQueue}
              >
                <Trash2 size={14} className={cn(clearingQueue && 'animate-pulse')} />
                Clear print queue
              </Button>
              <p className="text-[0.7rem] leading-snug text-muted-foreground">
                Cancels stale jobs stuck in every printer's Windows queue (needs QZ Tray installed). Use it before
                bringing a recovered printer back so it does not spew a backlog.
              </p>
            </section>
          ) : null}

          {settings.mode === 'qz-tray' ? (
            <section className="staff-printer-route-card active">
              <header>
                <div className="flex min-w-0 items-center gap-2.5">
                  <strong>QZ Tray</strong>
                  <label className="flex cursor-pointer items-center gap-1.5 text-[0.68rem] font-medium text-muted-foreground">
                    <span>Auto-print</span>
                    <Switch
                      size="sm"
                      aria-label="Auto-print new orders"
                      checked={settings.autoPrintNewOrders}
                      onCheckedChange={(checked) => onSettingsChange({ autoPrintNewOrders: checked })}
                    />
                  </label>
                </div>
                <span className="flex items-center gap-2 text-xs">
                  <span
                    className={cn(
                      'inline-block size-2 shrink-0 rounded-full',
                      qzConnected ? 'bg-emerald-500' : qzStatus === 'checking' ? 'bg-amber-500' : 'bg-muted-foreground/40',
                    )}
                  />
                  <span className="text-muted-foreground">
                    {qzStatusLabel}{qzVersion ? ` · v${qzVersion}` : ''}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={qzConnected ? 'Refresh printers' : 'Test connection'}
                    title={qzConnected ? 'Refresh printers' : 'Test connection'}
                    onClick={() => void testQzConnection()}
                    disabled={qzStatus === 'checking' || qzPrintersLoading}
                  >
                    <RefreshCw size={14} className={cn((qzStatus === 'checking' || qzPrintersLoading) && 'animate-spin')} />
                  </Button>
                </span>
              </header>

              {!qzConnected ? (
                <div className="flex flex-col gap-2">
                  <Button asChild type="button" variant="outline" size="sm" className="self-start">
                    <a href={QZ_TRAY_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">
                      <Download size={14} />
                      Download QZ Tray
                    </a>
                  </Button>
                  <p className="text-[0.7rem] leading-snug text-muted-foreground">
                    QZ Tray is a small desktop app for silent printing. Install and launch it, then use the refresh
                    button above to connect. If QZ is running but remains unavailable in Edge/Chrome, open this
                    site's permissions and allow <strong>Local network access</strong>, then reload.
                  </p>
                </div>
              ) : null}

              <div
                className={cn(
                  'grid grid-cols-1 gap-3',
                  settings.qzTargetType === 'printer' && 'lg:grid-cols-2 lg:items-start',
                )}
              >
                <div className="staff-printer-field">
                  <span>Connection</span>
                  <Select
                    value={settings.qzTargetType}
                    onValueChange={(value) => {
                      resetQzTargetTests()
                      onSettingsChange({ qzTargetType: value as QzTargetType })
                    }}
                  >
                    <SelectTrigger aria-label="QZ connection type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectItem value="printer">System printer</SelectItem>
                      <SelectItem value="network">Network (IP:9100)</SelectItem>
                      <SelectItem value="serial">Serial / Bluetooth COM</SelectItem>
                    </SelectContent>
                  </Select>
                  {settings.qzTargetType === 'printer' ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void testSelectedQzPrinter()}
                        disabled={qzPrinterTestStatus === 'testing' || !settings.qzPrinterName.trim()}
                      >
                        {qzPrinterTestStatus === 'testing'
                          ? <RefreshCw size={14} className="animate-spin" />
                          : <Cable size={14} />}
                        Test connection
                      </Button>
                      <ConnectionTestBadge status={qzPrinterTestStatus} />
                    </div>
                  ) : null}
                </div>

                {settings.qzTargetType === 'printer' ? (
                  <div className="staff-printer-field lg:justify-items-end">
                    <span>Printer name</span>
                    {qzPrinterOptions.length > 0 ? (
                      <Select
                        value={settings.qzPrinterName || undefined}
                        onValueChange={(value) => {
                          setQzPrinterTestStatus('untested')
                          onSettingsChange({ qzPrinterName: value })
                        }}
                      >
                        <SelectTrigger aria-label="QZ Tray printer">
                          <SelectValue placeholder="Choose a printer">
                            {selectedQzPrinter ? (
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="truncate">{selectedQzPrinter.name}</span>
                                {selectedQzPrinter.connectionLabel ? (
                                  <span className="shrink-0 text-xs text-muted-foreground">
                                    {selectedQzPrinter.connectionLabel}
                                  </span>
                                ) : null}
                              </span>
                            ) : null}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent position="popper">
                          {qzPrinterOptions.map((printer) => {
                            const connectionLabel = formatQzPrinterConnectionLabel(printer)
                            return (
                              <SelectItem
                                key={printer.name}
                                value={printer.name}
                                className="py-2"
                                title={[printer.driverName, printer.portName].filter(Boolean).join(' · ') || undefined}
                              >
                                <span className="flex min-w-0 flex-col pr-2 text-left">
                                  <span className="truncate">{printer.name}</span>
                                  {connectionLabel ? (
                                    <span
                                      className={cn(
                                        'truncate text-xs text-muted-foreground',
                                        printer.isVirtual && 'text-amber-700 dark:text-amber-400',
                                      )}
                                    >
                                      {connectionLabel}
                                    </span>
                                  ) : null}
                                </span>
                              </SelectItem>
                            )
                          })}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={settings.qzPrinterName}
                        placeholder={qzPrintersLoading ? 'Detecting printers…' : 'Epson TM-T88VI'}
                        onChange={(event) => {
                          setQzPrinterTestStatus('untested')
                          onSettingsChange({ qzPrinterName: event.target.value })
                        }}
                      />
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="justify-self-start lg:justify-self-end"
                      onClick={() => void clearQueue()}
                      disabled={clearingQueue}
                    >
                      <Trash2 size={14} className={cn(clearingQueue && 'animate-pulse')} />
                      Clear queue
                    </Button>
                  </div>
                ) : null}
              </div>

              {settings.qzTargetType === 'printer' ? (
                <p className="text-[0.7rem] leading-snug text-muted-foreground">
                  Prints via the OS print queue. If jobs piled up while the printer was down, Clear queue cancels
                  them before you bring it back.
                </p>
              ) : null}

              {settings.qzTargetType === 'network' ? (
                <>
                  <div className="staff-printer-usb-grid">
                    <div className="staff-printer-field">
                      <span>Printer IP</span>
                      <Input
                        value={settings.qzNetworkHost}
                        placeholder={qzHostSubnet ? `${qzHostSubnet}50` : '192.168.1.50'}
                        onChange={(event) => {
                          setQzNetworkTestStatus('untested')
                          onSettingsChange({ qzNetworkHost: event.target.value })
                        }}
                      />
                    </div>
                    <div className="staff-printer-field">
                      <span>Port</span>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        value={settings.qzNetworkPort}
                        onChange={(event) => {
                          setQzNetworkTestStatus('untested')
                          onSettingsChange({ qzNetworkPort: Number(event.target.value) })
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void testNetworkPrinter()}
                      disabled={netTesting || !settings.qzNetworkHost.trim()}
                    >
                      {netTesting ? <RefreshCw size={14} className="animate-spin" /> : <Cable size={14} />}
                      Test connection
                    </Button>
                    <ConnectionTestBadge status={qzNetworkTestStatus} />
                    {qzHostSubnet ? (
                      <button
                        type="button"
                        className="text-[0.7rem] text-muted-foreground underline-offset-2 hover:underline"
                        onClick={() => {
                          if (!settings.qzNetworkHost.trim()) onSettingsChange({ qzNetworkHost: qzHostSubnet })
                        }}
                      >
                        Detected network: {qzHostSubnet}x
                      </button>
                    ) : null}
                  </div>
                  <p className="text-[0.7rem] leading-snug text-muted-foreground">
                    RAW network printing straight to the printer — no Windows driver needed. Give the printer a fixed
                    IP on the router first, then Test connection to confirm it answers on port {settings.qzNetworkPort || 9100}.
                  </p>
                </>
              ) : null}

              {settings.qzTargetType === 'serial' ? (
                <>
                  <div className="staff-printer-field">
                    <span>COM port</span>
                    <div className="flex flex-wrap items-center gap-2">
                      {qzSerialPorts.length > 0 ? (
                        <Select
                          value={settings.qzSerialPort || undefined}
                          onValueChange={(value) => {
                            setQzSerialTestStatus('untested')
                            onSettingsChange({ qzSerialPort: value })
                          }}
                        >
                          <SelectTrigger aria-label="QZ serial port">
                            <SelectValue placeholder="Choose a COM port" />
                          </SelectTrigger>
                          <SelectContent position="popper">
                            {(settings.qzSerialPort && !qzSerialPorts.includes(settings.qzSerialPort)
                              ? [settings.qzSerialPort, ...qzSerialPorts]
                              : qzSerialPorts
                            ).map((portName) => (
                              <SelectItem key={portName} value={portName}>
                                {portName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          className="w-32"
                          value={settings.qzSerialPort}
                          placeholder="COM4"
                          onChange={(event) => {
                            setQzSerialTestStatus('untested')
                            onSettingsChange({ qzSerialPort: event.target.value })
                          }}
                        />
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void testSelectedQzSerialPort()}
                        disabled={qzSerialTesting || !settings.qzSerialPort.trim()}
                      >
                        {qzSerialTesting ? <RefreshCw size={14} className="animate-spin" /> : <Cable size={14} />}
                        Test connection
                      </Button>
                      <ConnectionTestBadge status={qzSerialTestStatus} />
                    </div>
                  </div>
                  <p className="text-[0.7rem] leading-snug text-muted-foreground">
                    QZ keeps the connection open between prints (one dial-up, no per-print beep/reconnect) — best
                    route for Bluetooth printers. Baud rate: {settings.serialBaudRate}.
                  </p>
                </>
              ) : null}

              <div className="flex flex-wrap items-end justify-between gap-2 rounded-md border border-border/70 p-2">
                <div className="staff-printer-field min-w-44">
                  <span>Text encoding</span>
                  <Select
                    value={settings.qzEncoding}
                    onValueChange={(value) => onSettingsChange({ qzEncoding: value as QzPrintEncoding })}
                  >
                    <SelectTrigger aria-label="QZ print encoding">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectItem value="UTF-8">UTF-8</SelectItem>
                      <SelectItem value="GBK">GBK (简体中文)</SelectItem>
                      <SelectItem value="GB2312">GB2312</SelectItem>
                      <SelectItem value="CP1252">CP1252 (Western)</SelectItem>
                      <SelectItem value="ISO-8859-1">ISO-8859-1</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={onPrintTestTicket}>
                  <Printer size={14} />
                  Print test ticket
                </Button>
              </div>

              {settings.autoPrintNewOrders ? (
                <div className="flex flex-col items-start gap-2 rounded-md border border-amber-300/70 bg-amber-50/70 p-2 dark:border-amber-700/70 dark:bg-amber-950/30">
                  <p className="text-[0.7rem] leading-snug text-amber-800 dark:text-amber-200">
                    <strong>{backgroundBrowser.browserLabel}:</strong> {backgroundBrowser.notice}
                    {backgroundBrowser.settingsPath ? (
                      <> Add <strong>{window.location.origin}</strong> under {backgroundBrowser.settingsPath}.</>
                    ) : null}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void showBackgroundBrowserGuidance()}
                  >
                    <Copy size={14} />
                    {backgroundBrowser.actionLabel}
                  </Button>
                </div>
              ) : null}

              <details className="rounded-md border border-border bg-background/60 p-2">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-medium">
                  <span className="flex items-center gap-2">
                    <ListChecks size={14} />
                    Print tasks
                    {printJobs.pendingCount > 0 ? (
                      <Badge variant="secondary">{printJobs.pendingCount} waiting</Badge>
                    ) : null}
                    {printJobs.failedCount + printJobs.deadLetterCount > 0 ? (
                      <Badge variant="destructive">
                        {printJobs.failedCount + printJobs.deadLetterCount} failed
                      </Badge>
                    ) : null}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Refresh print tasks"
                    onClick={(event) => {
                      event.preventDefault()
                      onRefreshPrintJobs()
                    }}
                    disabled={printJobsLoading}
                  >
                    <RefreshCw size={14} className={cn(printJobsLoading && 'animate-spin')} />
                  </Button>
                </summary>
                <div className="mt-2 max-h-52 space-y-1.5 overflow-y-auto">
                  {printJobs.jobs.length === 0 ? (
                    <p className="text-[0.7rem] text-muted-foreground">No print jobs recorded for this restaurant.</p>
                  ) : printJobs.jobs.map((job) => (
                    <div
                      key={job.id}
                      className="flex items-start justify-between gap-2 rounded-md border border-border/70 px-2 py-1.5"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          <strong>{job.order.orderNumber}</strong>
                          <Badge
                            variant={
                              job.state === 'Completed'
                                ? 'secondary'
                                : job.state === 'Failed' || job.state === 'DeadLetter'
                                  ? 'destructive'
                                  : 'outline'
                            }
                          >
                            {job.state}
                          </Badge>
                          <span className="text-muted-foreground">attempt {job.attempts}</span>
                        </div>
                        {job.lastError || job.lastStatusDetail ? (
                          <p className="mt-0.5 truncate text-[0.68rem] text-muted-foreground" title={job.lastError ?? job.lastStatusDetail ?? undefined}>
                            {job.lastError ?? job.lastStatusDetail}
                          </p>
                        ) : null}
                      </div>
                      {job.state === 'Failed' || job.state === 'DeadLetter' ? (
                        <Button type="button" variant="outline" size="sm" onClick={() => onRetryPrintJob(job.id)}>
                          Retry
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </details>

              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={downloadPrinterDiagnostics}
                >
                  <Download size={14} />
                  Download diagnostics
                </Button>
                <p className="text-[0.7rem] leading-snug text-muted-foreground">
                  Saves the latest connection checks, queue timing, print results, failures and auto-print retries as JSON.
                </p>
              </div>

              <details className="mt-1 border-t border-border pt-2">
                <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground">
                  One-time setup: silent printing (trust certificate)
                </summary>
                <div className="mt-2 flex flex-col gap-2">
                {qzTrustSupported ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void installTrust()}
                      disabled={trustBusy}
                    >
                      <ShieldCheck size={14} />
                      Install trust cert
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void removeTrust()}
                      disabled={trustBusy}
                    >
                      <ShieldOff size={14} />
                      Remove
                    </Button>
                  </div>
                ) : (
                  <Button type="button" variant="outline" size="sm" onClick={() => void downloadTrustCert()}>
                    <Download size={14} />
                    Download override.crt
                  </Button>
                )}
                <p className="text-[0.7rem] leading-snug text-muted-foreground">
                  {qzTrustSupported
                    ? 'Pick the QZ Tray install folder (e.g. D:\\QZ tray) when asked, then restart QZ Tray. Install stops the security prompt on this machine; Remove undoes it.'
                    : 'Place the downloaded override.crt in the QZ Tray install folder, then restart QZ Tray.'}
                </p>
                </div>
              </details>
            </section>
          ) : null}

          {settings.mode === 'web-serial' ? (
            <section className="staff-printer-route-card active">
              <header>
                <strong>Web Serial</strong>
              </header>
              <div className="mb-2 flex flex-col gap-1">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void selectSerialPort()}
                    disabled={serialSelecting || serialTesting}
                  >
                    {serialSelecting ? <RefreshCw size={14} className="animate-spin" /> : <Cable size={14} />}
                    Select port
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void testSelectedWebSerialPort()}
                    disabled={serialSelecting || serialTesting}
                  >
                    {serialTesting ? <RefreshCw size={14} className="animate-spin" /> : <Cable size={14} />}
                    Test connection
                  </Button>
                  <ConnectionTestBadge status={webSerialTestStatus} />
                </div>
                <span className="text-[0.7rem] leading-snug text-muted-foreground">
                  {serialPortLabel
                    ? `Selected: ${serialPortLabel}`
                    : 'Grant a port once — the connection then stays open between prints. Bluetooth printers paired with Windows appear as COM ports (pick the outgoing one).'}
                </span>
              </div>
              <div className="staff-printer-field">
                <span>Baud rate</span>
                <Select
                  value={String(settings.serialBaudRate)}
                  onValueChange={(value) => {
                    setQzSerialTestStatus('untested')
                    setWebSerialTestStatus('untested')
                    onSettingsChange({ serialBaudRate: Number(value) })
                  }}
                >
                  <SelectTrigger aria-label="Serial baud rate">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {(['9600', '19200', '38400', '57600', '115200'].includes(String(settings.serialBaudRate))
                      ? ['9600', '19200', '38400', '57600', '115200']
                      : [String(settings.serialBaudRate), '9600', '19200', '38400', '57600', '115200']
                    ).map((rate) => (
                      <SelectItem key={rate} value={rate}>
                        {rate}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-[0.7rem] leading-snug text-muted-foreground">
                Only matters for real RS-232 serial cables (must match the printer's DIP switches). Bluetooth and USB
                ports ignore it — leave 9600.
              </p>
            </section>
          ) : null}

          {settings.mode === 'web-usb' ? (
            <section className="staff-printer-route-card active">
              <header>
                <strong>WebUSB</strong>
              </header>
              <div className="mb-2 flex flex-col gap-1">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void selectUsbPrinter()}
                    disabled={usbDetecting || usbTesting}
                  >
                    {usbDetecting ? <RefreshCw size={14} className="animate-spin" /> : <Usb size={14} />}
                    Select printer
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void testSelectedWebUsbPrinter()}
                    disabled={usbDetecting || usbTesting}
                  >
                    {usbTesting ? <RefreshCw size={14} className="animate-spin" /> : <Usb size={14} />}
                    Test connection
                  </Button>
                  <ConnectionTestBadge status={webUsbTestStatus} />
                </div>
                <span className="text-[0.7rem] leading-snug text-muted-foreground">
                  {usbDeviceLabel
                    ? `Selected: ${usbDeviceLabel}`
                    : 'Pick your printer from the browser list — IDs below fill in automatically. For driver-free USB devices; if Windows holds the device, use QZ Tray instead.'}
                </span>
              </div>
              <div className="staff-printer-usb-grid">
                <div className="staff-printer-field">
                  <span>Vendor ID</span>
                  <Input
                    value={settings.usbVendorId}
                    placeholder="0x04b8"
                    onChange={(event) => {
                      setWebUsbTestStatus('untested')
                      onSettingsChange({ usbVendorId: event.target.value })
                    }}
                  />
                </div>
                <div className="staff-printer-field">
                  <span>Product ID</span>
                  <Input
                    value={settings.usbProductId}
                    placeholder="optional"
                    onChange={(event) => {
                      setWebUsbTestStatus('untested')
                      onSettingsChange({ usbProductId: event.target.value })
                    }}
                  />
                </div>
                <div className="staff-printer-field">
                  <span>Interface</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={settings.usbInterfaceNumber}
                    onChange={(event) => {
                      setWebUsbTestStatus('untested')
                      onSettingsChange({ usbInterfaceNumber: Number(event.target.value) })
                    }}
                  />
                </div>
                <div className="staff-printer-field">
                  <span>Endpoint</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={settings.usbEndpointNumber}
                    onChange={(event) => {
                      setWebUsbTestStatus('untested')
                      onSettingsChange({ usbEndpointNumber: Number(event.target.value) })
                    }}
                  />
                </div>
              </div>
            </section>
          ) : null}

          {settings.mode === 'web-bluetooth' ? (
            <section className="staff-printer-route-card active">
              <header>
                <strong>Web Bluetooth</strong>
              </header>
              <div className="mb-2 flex flex-col gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void selectBlePrinter()}
                  disabled={bleSelecting}
                >
                  {bleSelecting ? <RefreshCw size={14} className="animate-spin" /> : <Bluetooth size={14} />}
                  Select printer
                </Button>
                <span className="text-[0.7rem] leading-snug text-muted-foreground">
                  {settings.bleDeviceName
                    ? `Selected: ${settings.bleDeviceName}`
                    : 'For printers with a BLE mode (dual-mode modules). Connection is discovered automatically and stays open.'}
                </span>
                <span className="text-[0.7rem] leading-snug text-muted-foreground">
                  BLE is slower than serial/USB (a ticket takes a few seconds). Chrome/Edge only; not available on iOS.
                </span>
              </div>
            </section>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onSettingsChange(defaultThermalPrinterSettings)}
          >
            Reset
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function OrderPrintTicket({ order, paperWidth, printedAt }: { order: AdminOrder; paperWidth: ThermalPaperWidth; printedAt: Date }) {
  const itemCount = order.items.reduce((total, item) => total + item.quantity, 0)

  return (
    <section className={cn('staff-order-print-ticket', paperWidth === '58mm' && 'is-58mm')} aria-label="Kitchen print ticket">
      <header className="staff-order-print-header">
        <span>Kitchen ticket</span>
        <h1>{order.orderNumber}</h1>
        <p>{order.restaurantName ?? 'Assigned restaurant'}</p>
      </header>

      <dl className="staff-order-print-meta">
        <div>
          <dt>Order</dt>
          <dd>{getPrintOrderScope(order)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{order.status}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{formatDateTime(order.createdAt)}</dd>
        </div>
        <div>
          <dt>Printed</dt>
          <dd>{formatDateTime(printedAt)}</dd>
        </div>
        <div>
          <dt>Items</dt>
          <dd>{itemCount}</dd>
        </div>
      </dl>

      <div className="staff-order-print-items">
        {order.items.map((item) => {
          const optionGroups = groupSelectedOptions(item)
          const itemName = item.itemNameSnapshot?.trim() || 'Unnamed item'

          return (
            <article key={item.id} className="staff-order-print-item">
              <div className="staff-order-print-item-main">
                <strong>{item.quantity}x</strong>
                <span>{itemName}</span>
              </div>

              {optionGroups.length > 0 ? (
                <div className="staff-order-print-options">
                  {optionGroups.map((group) => (
                    <div key={group.groupName}>
                      <strong>{group.groupName}</strong>
                      <span>
                        {group.options
                          .map((option) => `${option.optionNameSnapshot}${(option.quantity ?? 1) > 1 ? ` x${option.quantity ?? 1}` : ''}`)
                          .join(', ')}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}

              {item.note ? (
                <p className="staff-order-print-note">
                  <strong>Item note:</strong> {item.note}
                </p>
              ) : null}
            </article>
          )
        })}
      </div>

      {order.customerNote ? (
        <section className="staff-order-print-order-note">
          <strong>Order note</strong>
          <p>{order.customerNote}</p>
        </section>
      ) : null}
    </section>
  )
}

function PrintTicketButton({ disabled, modeLabel, onClick }: { disabled: boolean; modeLabel: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="staff-order-print-button"
          aria-label="Print kitchen ticket"
          disabled={disabled}
          onClick={onClick}
        >
          {disabled ? <RefreshCw className="animate-spin" size={15} /> : <Printer size={15} />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" align="end" sideOffset={6}>
        Print kitchen ticket via {modeLabel}
      </TooltipContent>
    </Tooltip>
  )
}

function getPrintOrderScope(order: AdminOrder) {
  const label = getOrderTypeLabel(order.orderType)
  return order.tableNumber ? `${label} - Table ${order.tableNumber}` : label
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency || 'AUD',
  }).format(amount)
}

function formatOptionAdjustment(amount: number, currency: string) {
  const formattedAmount = formatMoney(Math.abs(amount), currency)
  return amount > 0 ? `+${formattedAmount}` : `-${formattedAmount}`
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatDateTime(value: string | Date) {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value instanceof Date ? value : new Date(value))
}
