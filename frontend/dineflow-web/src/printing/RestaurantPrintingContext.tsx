/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { toast } from 'sonner'
import {
  getRestaurants,
  getRestaurantOperations,
  updateRestaurantAutoAccept,
  type AdminOrder,
  type Restaurant,
  type RestaurantOperations,
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
import { markOrderPrinted, setAutoPrintEnabled } from '@/lib/autoPrintLedger'
import { subscribeOperationalStatusInvalidated } from '@/lib/operationalNotifications'
import {
  loadNotificationSoundPreferences,
  storeNotificationSoundPreferences,
} from '@/lib/notificationSoundPreferences'
import {
  getPrintStationIdentity,
  hasPrintJobTransportReceipt,
  markPrintJobTransportAccepted,
  withPrintStationLeadership,
} from '@/lib/printStation'
import { recordPrinterDiagnostic } from '@/lib/printerDiagnostics'
import {
  closeQzNetworkSockets,
  closeQzSerialPorts,
  createKitchenTicket,
  getQzRuntimeInfo,
  isQzTrayConnected,
  printThermalDocumentWithQzTray,
  printThermalDocumentWithWebBluetooth,
  printThermalDocumentWithWebSerial,
  printThermalDocumentWithWebUsb,
  QZ_TRAY_DOWNLOAD_URL,
  QzTrayError,
  readStoredFrontCounterPrinterSettings,
  readStoredThermalPrinterSettings,
  releaseWebSerialSession,
  startQzKeepAlive,
  startWebSerialKeepAlive,
  stopQzKeepAlive,
  stopWebSerialKeepAlive,
  storeFrontCounterPrinterSettings,
  storeThermalPrinterSettings,
  probePrinterReadiness,
  subscribeQzTrayConnectionStatus,
  type KitchenTicket,
  type PrinterReadiness,
  type ThermalDocument,
  type QzTrayErrorReason,
  type QzTrayConnectionStatus,
  type ThermalPrinterMode,
  type ThermalPrinterSettings,
} from '@/lib/thermalPrinter'
import type { ReceiptDocument } from '@/lib/receipt'
import { shouldSoundKitchenAlert, type KitchenAlertOrder } from '@/lib/kitchenAlertPolicy'
import { createOrderRealtimeClient } from '@/realtime/orderConnection'

const autoPrintPollIntervalMs = 5_000
/** Often enough that a printer lost mid-service is noticed before the next order needs it, rare
 *  enough that the probe does not itself become traffic on a shop's network. Paused while the tab
 *  is hidden — a background tab cannot be read, and waking to a fresh probe is what matters. */
const printerReadinessIntervalMs = 30_000
const platformRestaurantStorageKey = 'dineflow.globalPrintRestaurant.v1'
const staffRoles = new Set(['PlatformOwner', 'RestaurantOwner', 'Admin', 'Staff'])

export const printerModeLabels: Record<ThermalPrinterMode, string> = {
  browser: 'Browser',
  'qz-tray': 'QZ Tray',
  'web-serial': 'Web Serial',
  'web-usb': 'WebUSB',
  'web-bluetooth': 'Web Bluetooth',
}

const qzErrorGuidance: Record<QzTrayErrorReason, {
  title: string
  description: string
  offerDownload: boolean
}> = {
  'not-loaded': {
    title: 'QZ Tray could not start',
    description: 'Reload the page, or install QZ Tray if it is not installed.',
    offerDownload: true,
  },
  'not-running': {
    title: 'QZ Tray is not running',
    description: 'Launch the QZ Tray desktop app, then print again.',
    offerDownload: true,
  },
  'no-printer': {
    title: 'No printer selected',
    description: 'Choose a printer, network address, or COM port in printer settings.',
    offerDownload: false,
  },
  'printer-unavailable': {
    title: 'Printer is not ready — ticket not queued',
    description: 'Check power, paper and cover, then try again.',
    offerDownload: false,
  },
  'print-failed': {
    title: 'QZ Tray could not print',
    description: 'The selected print transport rejected the ticket.',
    offerDownload: false,
  },
  // Said here rather than by QZ. An unsigned request makes QZ raise its own "Cannot verify trust"
  // dialog, which names neither DineFlow nor the reason and cannot be dismissed for good; the
  // request is now dropped before it reaches QZ, so this is the only thing staff see.
  'not-signed': {
    title: 'Printing is not authorised right now',
    description: 'DineFlow could not sign the request. Sign in again as staff, then print.',
    offerDownload: false,
  },
}

/**
 * Two rising notes: something new has arrived. Kept deliberately bright and short.
 */
function playNewOrderSound(context: AudioContext): void {
  const now = context.currentTime
  const first = context.createOscillator()
  const firstGain = context.createGain()
  first.connect(firstGain)
  firstGain.connect(context.destination)
  first.type = 'sine'
  first.frequency.setValueAtTime(1046.5, now)
  firstGain.gain.setValueAtTime(0, now)
  firstGain.gain.linearRampToValueAtTime(0.42, now + 0.012)
  firstGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28)
  first.start(now)
  first.stop(now + 0.3)

  const second = context.createOscillator()
  const secondGain = context.createGain()
  second.connect(secondGain)
  secondGain.connect(context.destination)
  second.type = 'sine'
  second.frequency.setValueAtTime(1318.5, now + 0.22)
  secondGain.gain.setValueAtTime(0, now + 0.22)
  secondGain.gain.linearRampToValueAtTime(0.42, now + 0.232)
  secondGain.gain.exponentialRampToValueAtTime(0.001, now + 0.65)
  second.start(now + 0.22)
  second.stop(now + 0.65)
}

/**
 * Three falling notes: something already here has been waiting too long.
 *
 * Deliberately unlike the new-order chime on every axis a person can hear without thinking about
 * it — falling instead of rising, lower, three pulses instead of two, and a squarer timbre.
 * Replaying the arrival sound would have told the kitchen the opposite of the truth: that another
 * order had come in, rather than that one already on the screen is being left unattended.
 */
function playOverdueOrderSound(context: AudioContext): void {
  const now = context.currentTime
  // Descending, so it reads as an alarm rather than an arrival.
  const notes = [880, 739.99, 622.25]
  const pulse = 0.26

  notes.forEach((frequency, index) => {
    const startAt = now + index * pulse
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.connect(gain)
    gain.connect(context.destination)
    // Triangle carries more edge than the sine used for arrivals without becoming shrill in a
    // room that already has extraction fans running.
    oscillator.type = 'triangle'
    oscillator.frequency.setValueAtTime(frequency, startAt)
    gain.gain.setValueAtTime(0, startAt)
    gain.gain.linearRampToValueAtTime(0.38, startAt + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.001, startAt + pulse - 0.03)
    oscillator.start(startAt)
    oscillator.stop(startAt + pulse)
  })
}

function readPlatformRestaurantId(): string | undefined {
  try {
    return window.localStorage.getItem(platformRestaurantStorageKey) || undefined
  } catch {
    return undefined
  }
}

export type GlobalPrintResult = 'browser' | 'queued' | 'sent' | 'failed'
export type OrderRealtimeState = 'connecting' | 'connected' | 'reconnecting' | 'offline'

type RestaurantPrintingContextValue = {
  settings: ThermalPrinterSettings
  updateSettings: (updates: Partial<ThermalPrinterSettings>) => void
  frontCounterSettings: ThermalPrinterSettings
  updateFrontCounterSettings: (updates: Partial<ThermalPrinterSettings>) => void
  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
  /**
   * Opens the printer settings already showing the print task list.
   *
   * <p>
   * The attention banner sent people to a settings dialog where the failed task — its order, its
   * reason, its Retry button — sat inside a collapsed disclosure with nothing saying so. All of it
   * had been built; what was missing was arriving at it. Someone answering an alert should land on
   * the thing the alert is about.
   * </p>
   */
  openPrintTasks: () => void
  /** True while the settings dialog should show the task list open. Cleared once it has. */
  printTasksRequested: boolean
  acknowledgePrintTasksRequest: () => void
  audioEnabled: boolean
  toggleAudio: () => Promise<void>
  /** Independent of the arrival chime: a kitchen may well want the new-order sound off during a
   *  rush while still being told that a paid order is going unanswered. */
  overdueAlertEnabled: boolean
  toggleOverdueAlert: () => Promise<void>
  printJobs: PrintJobList
  printJobsLoading: boolean
  printStationLeaseHeld: boolean
  printingOrderId: string | null
  orderEventRevision: number
  orderRealtimeState: OrderRealtimeState
  isPlatformOwner: boolean
  activeRestaurantId?: string
  activeRestaurantOperations: RestaurantOperations | null
  printRestaurants: Restaurant[]
  qzConnectionStatus: QzTrayConnectionStatus | 'checking'
  /** Whether the printer itself answered its last probe — distinct from the QZ Tray websocket,
   *  which stays connected even when the printer has gone. */
  printerReadiness: PrinterReadiness | null
  /** When a ticket last actually reached a printer. The only positive proof there is. */
  lastSuccessfulPrintAt: number | null
  checkPrinterReadiness: () => Promise<PrinterReadiness>
  setPlatformRestaurantId: (restaurantId?: string) => void
  autoAcceptOrders: boolean
  autoAcceptUpdating: boolean
  setAutoAcceptOrders: (enabled: boolean) => Promise<void>
  refreshPrintJobs: (showError?: boolean) => Promise<void>
  retryQueuedPrint: (jobId: string) => Promise<void>
  printOrder: (order: AdminOrder) => Promise<GlobalPrintResult>
  printFrontCounterReceipt: (receipt: ReceiptDocument) => Promise<GlobalPrintResult>
  printTestTicket: (target: 'kitchen' | 'front-counter', restaurantName: string) => Promise<void>
  /** Sounds the overdue alert — a falling three-note pattern, distinct from the arrival chime so
   *  staff can tell "an order is being left waiting" from "a new order came in". Silent while the
   *  staff audio toggle is off. */
  playOverdueAlertSound: () => void
}

const RestaurantPrintingContext = createContext<RestaurantPrintingContextValue | null>(null)

export function RestaurantPrintingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const canUseRestaurantPrinting = user?.roles.some((role) => staffRoles.has(role)) ?? false
  const isPlatformOwner = user?.roles.includes('PlatformOwner') ?? false
  const [platformRestaurantId, setPlatformRestaurantIdState] = useState<string | undefined>(
    readPlatformRestaurantId,
  )
  const [printRestaurants, setPrintRestaurants] = useState<Restaurant[]>([])
  const [autoAcceptOrders, setAutoAcceptOrdersState] = useState(false)
  const [autoAcceptUpdating, setAutoAcceptUpdating] = useState(false)
  const [activeRestaurantOperations, setActiveRestaurantOperations] = useState<RestaurantOperations | null>(null)
  const [printerReadiness, setPrinterReadiness] = useState<PrinterReadiness | null>(null)
  const [lastSuccessfulPrintAt, setLastSuccessfulPrintAt] = useState<number | null>(null)
  const activeRestaurantId = user?.restaurantId
    ?? (isPlatformOwner ? platformRestaurantId : undefined)

  const [settings, setSettings] = useState<ThermalPrinterSettings>(readStoredThermalPrinterSettings)
  const settingsRef = useRef(settings)
  const [frontCounterSettings, setFrontCounterSettings] = useState<ThermalPrinterSettings>(
    readStoredFrontCounterPrinterSettings,
  )
  const frontCounterSettingsRef = useRef(frontCounterSettings)

  // Identifies *which* printer the readiness verdict is about, so changing the target re-probes
  // instead of leaving the old printer's answer on screen.
  const printerTargetKey = [
    settings.mode,
    settings.qzTargetType,
    settings.qzPrinterName,
    settings.qzNetworkHost,
    settings.qzNetworkPort,
    settings.qzSerialPort,
  ].join('|')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [printTasksRequested, setPrintTasksRequested] = useState(false)
  // Read once, before either alert loop can consult the refs. Muting that comes back on by itself
  // after a refresh is worse than no mute control at all: it gets solved at the volume knob.
  const [storedSoundPreferences] = useState(loadNotificationSoundPreferences)
  const [audioEnabled, setAudioEnabled] = useState(storedSoundPreferences.newOrderSound)
  const audioEnabledRef = useRef(storedSoundPreferences.newOrderSound)
  const [overdueAlertEnabled, setOverdueAlertEnabled] = useState(storedSoundPreferences.unacceptedOrderAlert)
  const overdueAlertEnabledRef = useRef(storedSoundPreferences.unacceptedOrderAlert)
  const audioContextRef = useRef<AudioContext | null>(null)
  const [printJobs, setPrintJobs] = useState<PrintJobList>({
    jobs: [],
    pendingCount: 0,
    failedCount: 0,
    deadLetterCount: 0,
  })
  const [printJobsLoading, setPrintJobsLoading] = useState(false)
  const [printStationLeaseHeld, setPrintStationLeaseHeld] = useState(false)
  const [printingOrderId, setPrintingOrderId] = useState<string | null>(null)
  const [orderEventRevision, setOrderEventRevision] = useState(0)
  const [orderRealtimeState, setOrderRealtimeState] = useState<OrderRealtimeState>('offline')
  const [qzConnectionStatus, setQzConnectionStatus] = useState<QzTrayConnectionStatus | 'checking'>(
    isQzTrayConnected() ? 'connected' : 'checking',
  )
  const stationIdentityRef = useRef(getPrintStationIdentity())
  const lastPrintErrorRef = useRef<string | null>(null)
  const dispatchChainRef = useRef<Promise<void>>(Promise.resolve())
  const frontCounterDispatchChainRef = useRef<Promise<void>>(Promise.resolve())
  const sweepRunningRef = useRef(false)
  const notifiedOrderIdsRef = useRef(new Set<string>())
  const runSweepRef = useRef<(force?: boolean) => Promise<void>>(() => Promise.resolve())

  // Opening the dialog and asking it to show the tasks are two things, because the dialog owns
  // which section it shows. The flag is consumed on arrival so a later reopen behaves normally.
  const openPrintTasks = useCallback(() => {
    setPrintTasksRequested(true)
    setSettingsOpen(true)
  }, [])

  const acknowledgePrintTasksRequest = useCallback(() => setPrintTasksRequested(false), [])

  const setPlatformRestaurantId = useCallback((restaurantId?: string) => {
    setPlatformRestaurantIdState(restaurantId)
    try {
      if (restaurantId) {
        window.localStorage.setItem(platformRestaurantStorageKey, restaurantId)
      } else {
        window.localStorage.removeItem(platformRestaurantStorageKey)
      }
    } catch {
      // A platform owner can select the restaurant again when storage is unavailable.
    }
  }, [])

  useEffect(() => {
    if (!isPlatformOwner) return
    let cancelled = false

    const loadRestaurants = () => {
      void getRestaurants()
        .then((restaurants) => {
          if (!cancelled) setPrintRestaurants(restaurants)
        })
        .catch((error) => {
          recordPrinterDiagnostic('global_print_restaurants_load_failed', {
            message: error instanceof Error ? error.message : String(error),
          })
        })
    }

    loadRestaurants()
    const refreshTimer = window.setInterval(loadRestaurants, 60_000)
    const unsubscribeStatus = subscribeOperationalStatusInvalidated(() => loadRestaurants())
    window.addEventListener('focus', loadRestaurants)

    return () => {
      cancelled = true
      unsubscribeStatus()
      window.clearInterval(refreshTimer)
      window.removeEventListener('focus', loadRestaurants)
    }
  }, [isPlatformOwner])

  useEffect(() => {
    if (!canUseRestaurantPrinting || !activeRestaurantId) {
      // Clears stale operations when the active restaurant changes or access is lost. One extra render on mount, not a stale value.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveRestaurantOperations(null)
      return
    }

    let cancelled = false
    const loadOperations = () => {
      void getRestaurantOperations(activeRestaurantId)
        .then((operations) => {
          if (cancelled) return
          setActiveRestaurantOperations(operations)
          setAutoAcceptOrdersState(operations.autoAcceptOrders)
        })
        .catch((error) => {
          recordPrinterDiagnostic('restaurant_operations_load_failed', {
            restaurantId: activeRestaurantId,
            message: error instanceof Error ? error.message : String(error),
          })
        })
    }

    loadOperations()
    const refreshTimer = window.setInterval(loadOperations, 60_000)
    const unsubscribeStatus = subscribeOperationalStatusInvalidated((restaurantId) => {
      if (!restaurantId || restaurantId === activeRestaurantId) loadOperations()
    })
    const handleFocus = () => loadOperations()
    window.addEventListener('focus', handleFocus)

    return () => {
      cancelled = true
      unsubscribeStatus()
      window.clearInterval(refreshTimer)
      window.removeEventListener('focus', handleFocus)
    }
  }, [activeRestaurantId, canUseRestaurantPrinting])

  useEffect(() => subscribeQzTrayConnectionStatus((status) => {
    setQzConnectionStatus(status)
    if (status !== 'connected') {
      setPrinterReadiness(null)
    }
  }), [])

  const setAutoAcceptOrders = useCallback(async (enabled: boolean) => {
    if (!activeRestaurantId || autoAcceptUpdating) return
    setAutoAcceptUpdating(true)
    try {
      const response = await updateRestaurantAutoAccept(activeRestaurantId, enabled)
      setAutoAcceptOrdersState(response.autoAcceptOrders)
      setActiveRestaurantOperations(response)
      setPrintRestaurants((restaurants) => restaurants.map((restaurant) => (
        restaurant.id === response.id
          ? { ...restaurant, autoAcceptOrders: response.autoAcceptOrders }
          : restaurant
      )))
      toast.success(enabled ? 'Automatic acceptance enabled' : 'Manual acceptance enabled', {
        description: enabled
          ? 'Eligible new orders will move to Accepted automatically.'
          : 'New orders will wait for a staff member to accept them.',
      })
    } catch (error) {
      toast.error('Could not update automatic acceptance', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    } finally {
      setAutoAcceptUpdating(false)
    }
  }, [activeRestaurantId, autoAcceptUpdating])

  useEffect(() => {
    audioEnabledRef.current = audioEnabled
    overdueAlertEnabledRef.current = overdueAlertEnabled
    storeNotificationSoundPreferences({
      newOrderSound: audioEnabled,
      unacceptedOrderAlert: overdueAlertEnabled,
    })
  }, [audioEnabled, overdueAlertEnabled])

  useEffect(() => {
    settingsRef.current = settings
    storeThermalPrinterSettings(settings)
  }, [settings])

  useEffect(() => {
    frontCounterSettingsRef.current = frontCounterSettings
    storeFrontCounterPrinterSettings(frontCounterSettings)
  }, [frontCounterSettings])

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
    window.addEventListener('pointerdown', resume)
    window.addEventListener('keydown', resume)
    return () => {
      window.removeEventListener('pointerdown', resume)
      window.removeEventListener('keydown', resume)
      void audioContextRef.current?.close()
      audioContextRef.current = null
    }
  }, [])

  const toggleAudio = useCallback(async () => {
    if (audioEnabledRef.current) {
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
  }, [])

  const checkPrinterReadiness = useCallback(async () => {
    const readiness = await probePrinterReadiness(settingsRef.current)
    setPrinterReadiness(readiness)
    return readiness
  }, [])

  // FS-021. Probed on a schedule rather than only when a ticket is sent, so a printer that went
  // away is discovered while the kitchen is idle instead of at the moment an order needs to print.
  //
  // The timer alone is not enough: a kitchen screen that has been asleep, or a tab someone just
  // came back to, would show whatever was true a minute ago and look like it needs a refresh. So
  // the same probe also runs whenever the tab becomes visible or regains focus, and whenever the
  // printer settings change — the three moments a person is most likely to be reading the status.
  useEffect(() => {
    if (!canUseRestaurantPrinting) {
      return
    }

    // QZ reconnects asynchronously after a page refresh. Do not turn that normal startup window
    // into a printer failure, and do not retain a verdict produced by the previous websocket.
    // Once QZ reports connected this effect runs again and probes the selected printer immediately.
    if (settingsRef.current.mode === 'qz-tray' && qzConnectionStatus !== 'connected') {
      // Clears stale readiness after a real disconnect. One extra render, not derived state.
      setPrinterReadiness(null)
      return
    }

    let cancelled = false
    const probe = async () => {
      const readiness = await probePrinterReadiness(settingsRef.current)
      if (!cancelled) {
        setPrinterReadiness(readiness)
      }
    }

    const probeIfVisible = () => {
      if (document.visibilityState === 'visible') {
        void probe()
      }
    }

    void probe()
    const timer = window.setInterval(probeIfVisible, printerReadinessIntervalMs)
    document.addEventListener('visibilitychange', probeIfVisible)
    window.addEventListener('focus', probeIfVisible)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', probeIfVisible)
      window.removeEventListener('focus', probeIfVisible)
    }
  }, [canUseRestaurantPrinting, printerTargetKey, qzConnectionStatus])

  const playOverdueAlertSound = useCallback(() => {
    if (!overdueAlertEnabledRef.current || !audioContextRef.current) {
      return
    }

    playOverdueOrderSound(audioContextRef.current)
  }, [])

  const toggleOverdueAlert = useCallback(async () => {
    if (overdueAlertEnabledRef.current) {
      setOverdueAlertEnabled(false)
      return
    }

    audioContextRef.current ??= new AudioContext()

    // The click is the gesture browsers require before audio may start.
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume()
    }

    setOverdueAlertEnabled(true)
    // Plays on enable so staff hear which sound they just switched on — it is otherwise rare
    // enough that the first time they hear it would be during a real incident.
    playOverdueOrderSound(audioContextRef.current)
  }, [])

  const updateSettings = useCallback((updates: Partial<ThermalPrinterSettings>) => {
    const current = settingsRef.current
    if (
      typeof updates.autoPrintNewOrders === 'boolean'
      && updates.autoPrintNewOrders !== current.autoPrintNewOrders
    ) {
      setAutoPrintEnabled(updates.autoPrintNewOrders)
      recordPrinterDiagnostic('auto_print_toggled', { enabled: updates.autoPrintNewOrders })
    }
    const next = { ...current, ...updates }
    settingsRef.current = next
    setSettings(next)
  }, [])

  const updateFrontCounterSettings = useCallback((updates: Partial<ThermalPrinterSettings>) => {
    const next = {
      ...frontCounterSettingsRef.current,
      ...updates,
      autoPrintNewOrders: false,
    }
    frontCounterSettingsRef.current = next
    setFrontCounterSettings(next)
  }, [])

  useEffect(() => {
    stopQzKeepAlive()
    stopWebSerialKeepAlive()
    if (!canUseRestaurantPrinting) return

    if (settings.mode === 'qz-tray' || frontCounterSettings.mode === 'qz-tray') {
      startQzKeepAlive()
      return () => stopQzKeepAlive()
    }
    if (settings.mode === 'web-serial' || frontCounterSettings.mode === 'web-serial') {
      startWebSerialKeepAlive(() => (
        settingsRef.current.mode === 'web-serial'
          ? settingsRef.current.serialBaudRate
          : frontCounterSettingsRef.current.serialBaudRate
      ) || 9600)
      return () => stopWebSerialKeepAlive()
    }
  }, [canUseRestaurantPrinting, frontCounterSettings.mode, settings.mode])

  useEffect(() => {
    const usingQzSerial =
      (settings.mode === 'qz-tray' && settings.qzTargetType === 'serial')
      || (frontCounterSettings.mode === 'qz-tray' && frontCounterSettings.qzTargetType === 'serial')
    const usingQzNetwork =
      (settings.mode === 'qz-tray' && settings.qzTargetType === 'network')
      || (frontCounterSettings.mode === 'qz-tray' && frontCounterSettings.qzTargetType === 'network')
    if (settings.mode !== 'web-serial' && frontCounterSettings.mode !== 'web-serial') {
      void releaseWebSerialSession()
    }
    if (!usingQzSerial) void closeQzSerialPorts()
    if (!usingQzNetwork) void closeQzNetworkSockets()
  }, [
    frontCounterSettings.mode,
    frontCounterSettings.qzTargetType,
    settings.mode,
    settings.qzTargetType,
  ])

  useEffect(() => {
    if (settings.qzTargetType === 'serial') void closeQzSerialPorts()
    if (settings.qzTargetType === 'network') void closeQzNetworkSockets()
  }, [
    settings.qzEncoding,
    settings.qzNetworkHost,
    settings.qzNetworkPort,
    settings.qzSerialPort,
    settings.qzTargetType,
    settings.serialBaudRate,
  ])

  const refreshPrintJobs = useCallback(async (showError = false) => {
    if (!activeRestaurantId || !canUseRestaurantPrinting) return
    setPrintJobsLoading(true)
    try {
      setPrintJobs(await getPrintJobs({ restaurantId: activeRestaurantId, take: 30 }))
    } catch (error) {
      if (showError) {
        toast.error('Could not load print jobs', {
          description: error instanceof Error ? error.message : 'The request failed.',
        })
      }
    } finally {
      setPrintJobsLoading(false)
    }
  }, [activeRestaurantId, canUseRestaurantPrinting])

  const sendOrderTicket = useCallback(async (order: AdminOrder): Promise<boolean> => {
    const currentSettings = settingsRef.current
    const printedAt = new Date()
    const ticket = createKitchenTicket(order, printedAt)
    setPrintingOrderId(order.id)
    lastPrintErrorRef.current = null

    try {
      if (currentSettings.mode === 'qz-tray') {
        await printThermalDocumentWithQzTray({ kind: 'kitchen', ticket }, currentSettings)
      } else if (currentSettings.mode === 'web-serial') {
        await printThermalDocumentWithWebSerial({ kind: 'kitchen', ticket }, currentSettings)
      } else if (currentSettings.mode === 'web-usb') {
        await printThermalDocumentWithWebUsb({ kind: 'kitchen', ticket }, currentSettings)
      } else if (currentSettings.mode === 'web-bluetooth') {
        await printThermalDocumentWithWebBluetooth({ kind: 'kitchen', ticket }, currentSettings)
      } else {
        return false
      }

      setLastSuccessfulPrintAt(Date.now())
      toast.success('Kitchen ticket sent', {
        description: `${order.orderNumber} via ${printerModeLabels[currentSettings.mode]}.`,
      })
      markOrderPrinted(order.id, printedAt)
      recordPrinterDiagnostic('hardware_print_succeeded', {
        orderId: order.id,
        orderNumber: order.orderNumber,
        mode: currentSettings.mode,
        target: currentSettings.mode === 'qz-tray' ? currentSettings.qzTargetType : currentSettings.mode,
        durationMs: Date.now() - printedAt.getTime(),
      })
      return true
    } catch (error) {
      lastPrintErrorRef.current = error instanceof Error ? error.message : String(error)
      recordPrinterDiagnostic('hardware_print_failed', {
        orderId: order.id,
        orderNumber: order.orderNumber,
        mode: currentSettings.mode,
        target: currentSettings.mode === 'qz-tray' ? currentSettings.qzTargetType : currentSettings.mode,
        reason: error instanceof QzTrayError ? error.reason : 'unknown',
        message: lastPrintErrorRef.current,
        durationMs: Date.now() - printedAt.getTime(),
      })
      if (error instanceof QzTrayError) {
        const guidance = qzErrorGuidance[error.reason]
        toast.error(guidance.title, {
          description: error.message || guidance.description,
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
          description: error instanceof Error ? error.message : 'The print request failed.',
        })
      }
      // A failed send is the strongest evidence available that the printer's state has changed,
      // so refresh the verdict rather than leaving a stale "ready" next to a failure toast.
      void probePrinterReadiness(settingsRef.current).then(setPrinterReadiness)
      return false
    } finally {
      setPrintingOrderId(null)
    }
  }, [])

  const dispatchOrderTicket = useCallback((order: AdminOrder): Promise<boolean> => {
    const operation = dispatchChainRef.current
      .catch(() => undefined)
      .then(() => sendOrderTicket(order))
    dispatchChainRef.current = operation.then(() => undefined, () => undefined)
    return operation
  }, [sendOrderTicket])

  const runPrintSweep = useCallback(async (force = false) => {
    const currentSettings = settingsRef.current
    if (!canUseRestaurantPrinting || currentSettings.mode !== 'qz-tray') return
    if (!currentSettings.autoPrintNewOrders && !force) return
    if (!activeRestaurantId || sweepRunningRef.current) return
    sweepRunningRef.current = true

    try {
      const identity = stationIdentityRef.current
      await withPrintStationLeadership(identity.stationKey, identity.clientInstanceId, async () => {
        const runtime = await getQzRuntimeInfo().catch(() => ({ connected: false, version: null }))
        const connectionType = currentSettings.qzTargetType
        const printerName = connectionType === 'printer'
          ? currentSettings.qzPrinterName
          : connectionType === 'network'
            ? `${currentSettings.qzNetworkHost}:${currentSettings.qzNetworkPort}`
            : currentSettings.qzSerialPort

        const station = await upsertPrintStation(identity.stationKey, identity.stationName, {
          autoPrintEnabled: currentSettings.autoPrintNewOrders,
          restaurantId: activeRestaurantId,
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
          restaurantId: activeRestaurantId,
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
              detail: 'Recovered a durable client receipt; transport had already accepted this ticket.',
            })
            continue
          }

          if (!notifiedOrderIdsRef.current.has(job.orderId)) {
            notifiedOrderIdsRef.current.add(job.orderId)
            if (audioEnabledRef.current && audioContextRef.current) {
              playNewOrderSound(audioContextRef.current)
            }
          }

          await updatePrintJobStatus(job.id, leaseToken, 'Sending', {
            detail: `${connectionType} send started`,
          })
          const printed = await dispatchOrderTicket(job.order)
          if (printed) {
            markPrintJobTransportAccepted(job.id)
            await updatePrintJobStatus(job.id, leaseToken, 'Completed', {
              detail: `${connectionType} transport accepted the ticket; physical paper output is not confirmed`,
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
    } catch (error) {
      if (error instanceof Error && /another browser tab or computer|station_lease_held/i.test(error.message)) {
        setPrintStationLeaseHeld(true)
      }
      recordPrinterDiagnostic('global_print_sweep_failed', {
        message: error instanceof Error ? error.message : String(error),
        stationKey: stationIdentityRef.current.stationKey,
      })
    } finally {
      sweepRunningRef.current = false
    }
  }, [activeRestaurantId, canUseRestaurantPrinting, dispatchOrderTicket, refreshPrintJobs])

  useEffect(() => {
    runSweepRef.current = runPrintSweep
  }, [runPrintSweep])

  useEffect(() => {
    if (!canUseRestaurantPrinting || !activeRestaurantId) return
    const identity = stationIdentityRef.current
    void (async () => {
      const runtime = await getQzRuntimeInfo().catch(() => ({ connected: false, version: null }))
      await upsertPrintStation(identity.stationKey, identity.stationName, {
        autoPrintEnabled: settings.mode === 'qz-tray' && settings.autoPrintNewOrders,
        restaurantId: activeRestaurantId,
        clientInstanceId: identity.clientInstanceId,
        qzStatus: runtime.connected ? 'connected' : 'disconnected',
        printerStatus: 'unknown',
        connectionType: settings.mode === 'qz-tray' ? settings.qzTargetType : settings.mode,
        qzVersion: runtime.version ?? undefined,
      })
      await refreshPrintJobs()
    })().catch((error) => {
      recordPrinterDiagnostic('global_print_station_registration_failed', {
        message: error instanceof Error ? error.message : String(error),
      })
    })
  }, [
    activeRestaurantId,
    canUseRestaurantPrinting,
    refreshPrintJobs,
    settings.autoPrintNewOrders,
    settings.mode,
    settings.qzTargetType,
  ])

  useEffect(() => {
    if (
      !canUseRestaurantPrinting
      || settings.mode !== 'qz-tray'
      || !settings.autoPrintNewOrders
      || !activeRestaurantId
    ) return

    const initialTimer = window.setTimeout(() => void runSweepRef.current(), 0)
    const interval = window.setInterval(() => void runSweepRef.current(), autoPrintPollIntervalMs)
    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(interval)
    }
  }, [activeRestaurantId, canUseRestaurantPrinting, settings.autoPrintNewOrders, settings.mode])

  useEffect(() => {
    if (!canUseRestaurantPrinting || !user) return
    void Promise.resolve().then(() => setOrderRealtimeState('connecting'))
    let hiddenAt = document.hidden ? Date.now() : null
    let recoveryTimer: number | null = null

    const notifyOrderActivity = (
      event: string,
      restaurantId?: string,
      orderNumber?: string,
      orderId?: string,
      alertable?: KitchenAlertOrder,
    ) => {
      setOrderEventRevision((current) => current + 1)
      const matchesPrintRestaurant = !isPlatformOwner
        || !activeRestaurantId
        || restaurantId === activeRestaurantId
      if (!matchesPrintRestaurant) return

      // Only once per order, and only when somebody could actually start cooking it. The id guard
      // is what stops the payment event ringing a second time for a counter order that already rang
      // when it was placed.
      if (
        orderId
        && alertable
        && shouldSoundKitchenAlert(alertable)
        && !notifiedOrderIdsRef.current.has(orderId)
      ) {
        notifiedOrderIdsRef.current.add(orderId)
        if (audioEnabledRef.current && audioContextRef.current) {
          playNewOrderSound(audioContextRef.current)
        }
      }
      if (event === 'created') {
        toast('New order received', {
          description: orderNumber ? `${orderNumber} is waiting in the staff queue.` : undefined,
        })
      }
      if (recoveryTimer !== null) window.clearTimeout(recoveryTimer)
      recoveryTimer = window.setTimeout(() => {
        recoveryTimer = null
        void runSweepRef.current()
      }, 250)
    }

    const client = createOrderRealtimeClient({
      onOrderCreated: (update) => notifyOrderActivity(
        'created',
        update.restaurantId ?? undefined,
        update.orderNumber,
        update.orderId,
        update,
      ),
      onOrderUpdated: (update) => notifyOrderActivity('updated', update.restaurantId ?? undefined),
      // Carries the order id so a payment landing can ring. Previously only creation did, which
      // meant an online order rang while unpayable and stayed silent once the money arrived.
      onOrderPaymentUpdated: (update) => notifyOrderActivity(
        'payment',
        update.restaurantId ?? undefined,
        update.orderNumber,
        update.orderId,
        update,
      ),
      onOrderDeleted: (update) => notifyOrderActivity('deleted', update.restaurantId ?? undefined),
      onConnected: () => {
        setOrderRealtimeState('connected')
        recordPrinterDiagnostic('global_signalr_connected')
      },
      onReconnecting: (error) => {
        setOrderRealtimeState('reconnecting')
        recordPrinterDiagnostic('global_signalr_reconnecting', {
          message: error?.message,
        })
      },
      onReconnected: () => {
        setOrderRealtimeState('connected')
        recordPrinterDiagnostic('global_signalr_reconnected')
        notifyOrderActivity('reconnected', activeRestaurantId)
      },
      onClosed: (error) => {
        setOrderRealtimeState('offline')
        recordPrinterDiagnostic('global_signalr_closed', {
          message: error?.message,
        })
      },
    })
    let disposed = false
    let inFlightStart: Promise<void> | null = null
    const startRealtime = (reportFailure: boolean) => {
      if (inFlightStart) return inFlightStart

      const attempt = client.start()
        .catch((error) => {
          setOrderRealtimeState('offline')
          if (reportFailure) {
            recordPrinterDiagnostic('global_signalr_start_failed', {
              message: error instanceof Error ? error.message : String(error),
            })
          }
        })
        .finally(() => {
          if (inFlightStart === attempt) inFlightStart = null
        })
      inFlightStart = attempt
      return attempt
    }
    const startTimer = window.setTimeout(() => {
      if (disposed) return
      void startRealtime(true)
    }, 150)

    const recover = (trigger: string) => {
      if (disposed) return
      const hiddenDurationMs = hiddenAt === null ? null : Date.now() - hiddenAt
      hiddenAt = null
      recordPrinterDiagnostic('global_printing_recovering', {
        trigger,
        hiddenDurationMs,
        visibilityState: document.visibilityState,
      })
      setOrderEventRevision((current) => current + 1)
      void startRealtime(false)
      void runSweepRef.current()
    }
    const onVisibilityChange = () => {
      if (document.hidden) {
        hiddenAt = Date.now()
      } else {
        recover('visibility')
      }
    }
    const onFocus = () => recover('focus')
    const onOnline = () => recover('online')
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onOnline)

    return () => {
      disposed = true
      window.clearTimeout(startTimer)
      if (recoveryTimer !== null) window.clearTimeout(recoveryTimer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onOnline)
      if (inFlightStart) {
        void inFlightStart.finally(() => client.stop())
      } else {
        void client.stop()
      }
    }
  }, [activeRestaurantId, canUseRestaurantPrinting, isPlatformOwner, user])

  const retryQueuedPrint = useCallback(async (jobId: string) => {
    try {
      await retryPrintJob(jobId, 'Retried by staff from the print task centre.')
      toast.success('Print job queued again')
      await refreshPrintJobs()
      await runPrintSweep(true)
    } catch (error) {
      toast.error('Could not retry print job', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    }
  }, [refreshPrintJobs, runPrintSweep])

  const printOrder = useCallback(async (order: AdminOrder): Promise<GlobalPrintResult> => {
    const currentSettings = settingsRef.current
    if (currentSettings.mode === 'browser') return 'browser'

    if (currentSettings.mode !== 'qz-tray' || !activeRestaurantId) {
      return await dispatchOrderTicket(order) ? 'sent' : 'failed'
    }

    try {
      const identity = stationIdentityRef.current
      await upsertPrintStation(identity.stationKey, identity.stationName, {
        autoPrintEnabled: currentSettings.autoPrintNewOrders,
        restaurantId: activeRestaurantId,
        clientInstanceId: identity.clientInstanceId,
        qzStatus: isQzTrayConnected() ? 'connected' : 'disconnected',
        printerStatus: 'unknown',
        printerName: currentSettings.qzPrinterName || undefined,
        connectionType: currentSettings.qzTargetType,
      })
      await requestOrderReprint(order.id, {
        stationKey: identity.stationKey,
        restaurantId: activeRestaurantId,
        reason: 'Manual print requested from the staff order card.',
      })
      toast.success('Print job queued', { description: order.orderNumber })
      await refreshPrintJobs()
      await runPrintSweep(true)
      return 'queued'
    } catch (error) {
      toast.error('Could not queue the print job', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
      return 'failed'
    }
  }, [activeRestaurantId, dispatchOrderTicket, refreshPrintJobs, runPrintSweep])

  const printFrontCounterReceipt = useCallback(async (
    receipt: ReceiptDocument,
  ): Promise<GlobalPrintResult> => {
    const currentSettings = frontCounterSettingsRef.current
    if (currentSettings.mode === 'browser') return 'browser'

    const job: ThermalDocument = { kind: 'receipt', receipt }
    const operation = frontCounterDispatchChainRef.current
      .catch(() => undefined)
      .then(async () => {
        if (currentSettings.mode === 'qz-tray') {
          await printThermalDocumentWithQzTray(job, currentSettings)
        } else if (currentSettings.mode === 'web-serial') {
          await printThermalDocumentWithWebSerial(job, currentSettings)
        } else if (currentSettings.mode === 'web-usb') {
          await printThermalDocumentWithWebUsb(job, currentSettings)
        } else {
          await printThermalDocumentWithWebBluetooth(job, currentSettings)
        }
      })
    frontCounterDispatchChainRef.current = operation.then(() => undefined, () => undefined)

    try {
      await operation
      setLastSuccessfulPrintAt(Date.now())
      toast.success('Front counter receipt sent', {
        description: `${receipt.code} via ${printerModeLabels[currentSettings.mode]}.`,
      })
      recordPrinterDiagnostic('front_counter_print_succeeded', {
        orderNumber: receipt.code,
        mode: currentSettings.mode,
      })
      return 'sent'
    } catch (error) {
      recordPrinterDiagnostic('front_counter_print_failed', {
        orderNumber: receipt.code,
        mode: currentSettings.mode,
        message: error instanceof Error ? error.message : String(error),
      })
      toast.error('Front counter receipt could not be printed', {
        description: error instanceof Error ? error.message : 'The print request failed.',
      })
      return 'failed'
    }
  }, [])

  const printTestTicket = useCallback(async (
    target: 'kitchen' | 'front-counter',
    restaurantName: string,
  ) => {
    const now = new Date()
    const currentSettings = target === 'kitchen'
      ? settingsRef.current
      : frontCounterSettingsRef.current
    const chainRef = target === 'kitchen' ? dispatchChainRef : frontCounterDispatchChainRef
    const operation = chainRef.current
      .catch(() => undefined)
      .then(async () => {
        const ticket: KitchenTicket = {
          serviceCode: 'TEST-001',
          orderNumber: 'TEST-001',
          restaurantName: restaurantName === 'All restaurants' ? 'DineFlow' : restaurantName,
          orderScope: target === 'kitchen' ? 'Kitchen printer diagnostics' : 'Front counter diagnostics',
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
              optionGroups: [{ groupName: 'Connection', options: [currentSettings.qzTargetType] }],
            },
            { quantity: 1, name: '0123456789 !@#$%', optionGroups: [] },
          ],
        }
        if (currentSettings.mode === 'qz-tray') {
          await printThermalDocumentWithQzTray({ kind: 'kitchen', ticket }, currentSettings)
        } else if (currentSettings.mode === 'web-serial') {
          await printThermalDocumentWithWebSerial({ kind: 'kitchen', ticket }, currentSettings)
        } else if (currentSettings.mode === 'web-usb') {
          await printThermalDocumentWithWebUsb({ kind: 'kitchen', ticket }, currentSettings)
        } else if (currentSettings.mode === 'web-bluetooth') {
          await printThermalDocumentWithWebBluetooth({ kind: 'kitchen', ticket }, currentSettings)
        } else {
          throw new Error('Browser printing does not support a direct test ticket.')
        }
      })
    chainRef.current = operation.then(() => undefined, () => undefined)
    try {
      await operation
      toast.success('Test ticket sent')
    } catch (error) {
      toast.error('Test ticket failed', {
        description: error instanceof Error ? error.message : 'The print request failed.',
      })
    }
  }, [])

  const value = useMemo<RestaurantPrintingContextValue>(() => ({
    settings,
    updateSettings,
    frontCounterSettings,
    updateFrontCounterSettings,
    settingsOpen,
    setSettingsOpen,
    openPrintTasks,
    printTasksRequested,
    acknowledgePrintTasksRequest,
    audioEnabled,
    overdueAlertEnabled,
    toggleAudio,
    printJobs,
    printJobsLoading,
    printStationLeaseHeld,
    printingOrderId,
    orderEventRevision,
    orderRealtimeState,
    isPlatformOwner,
    activeRestaurantId,
    activeRestaurantOperations,
    printRestaurants,
    qzConnectionStatus,
    printerReadiness,
    lastSuccessfulPrintAt,
    checkPrinterReadiness,
    setPlatformRestaurantId,
    autoAcceptOrders,
    autoAcceptUpdating,
    setAutoAcceptOrders,
    refreshPrintJobs,
    retryQueuedPrint,
    printOrder,
    printFrontCounterReceipt,
    printTestTicket,
    playOverdueAlertSound,
    toggleOverdueAlert,
  }), [
    acknowledgePrintTasksRequest,
    openPrintTasks,
    printTasksRequested,
    activeRestaurantId,
    activeRestaurantOperations,
    autoAcceptOrders,
    autoAcceptUpdating,
    audioEnabled,
    overdueAlertEnabled,
    isPlatformOwner,
    orderEventRevision,
    orderRealtimeState,
    printJobs,
    printJobsLoading,
    printOrder,
    printFrontCounterReceipt,
    printRestaurants,
    qzConnectionStatus,
    printerReadiness,
    lastSuccessfulPrintAt,
    checkPrinterReadiness,
    printStationLeaseHeld,
    printTestTicket,
    playOverdueAlertSound,
    toggleOverdueAlert,
    printingOrderId,
    refreshPrintJobs,
    retryQueuedPrint,
    setPlatformRestaurantId,
    setAutoAcceptOrders,
    settings,
    frontCounterSettings,
    settingsOpen,
    toggleAudio,
    updateSettings,
    updateFrontCounterSettings,
  ])

  return (
    <RestaurantPrintingContext.Provider value={value}>
      {children}
    </RestaurantPrintingContext.Provider>
  )
}

export function useRestaurantPrinting(): RestaurantPrintingContextValue {
  const value = useContext(RestaurantPrintingContext)
  if (!value) throw new Error('useRestaurantPrinting must be used inside RestaurantPrintingProvider.')
  return value
}
