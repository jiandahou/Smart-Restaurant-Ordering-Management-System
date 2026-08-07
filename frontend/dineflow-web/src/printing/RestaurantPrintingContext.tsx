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
  printKitchenTicketWithQzTray,
  printKitchenTicketWithWebBluetooth,
  printKitchenTicketWithWebSerial,
  printKitchenTicketWithWebUsb,
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
  type KitchenTicket,
  type QzTrayErrorReason,
  type ThermalPrinterMode,
  type ThermalPrinterSettings,
} from '@/lib/thermalPrinter'
import { createOrderRealtimeClient } from '@/realtime/orderConnection'

const autoPrintPollIntervalMs = 5_000
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
}

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
  audioEnabled: boolean
  toggleAudio: () => Promise<void>
  printJobs: PrintJobList
  printJobsLoading: boolean
  printStationLeaseHeld: boolean
  printingOrderId: string | null
  orderEventRevision: number
  orderRealtimeState: OrderRealtimeState
  isPlatformOwner: boolean
  activeRestaurantId?: string
  printRestaurants: Restaurant[]
  setPlatformRestaurantId: (restaurantId?: string) => void
  autoAcceptOrders: boolean
  autoAcceptUpdating: boolean
  setAutoAcceptOrders: (enabled: boolean) => Promise<void>
  refreshPrintJobs: (showError?: boolean) => Promise<void>
  retryQueuedPrint: (jobId: string) => Promise<void>
  printOrder: (order: AdminOrder) => Promise<GlobalPrintResult>
  printFrontCounterTicket: (ticket: KitchenTicket) => Promise<GlobalPrintResult>
  printTestTicket: (target: 'kitchen' | 'front-counter', restaurantName: string) => Promise<void>
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
  const activeRestaurantId = user?.restaurantId
    ?? (isPlatformOwner ? platformRestaurantId : undefined)

  const [settings, setSettings] = useState<ThermalPrinterSettings>(readStoredThermalPrinterSettings)
  const settingsRef = useRef(settings)
  const [frontCounterSettings, setFrontCounterSettings] = useState<ThermalPrinterSettings>(
    readStoredFrontCounterPrinterSettings,
  )
  const frontCounterSettingsRef = useRef(frontCounterSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [audioEnabled, setAudioEnabled] = useState(true)
  const audioEnabledRef = useRef(true)
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
  const stationIdentityRef = useRef(getPrintStationIdentity())
  const lastPrintErrorRef = useRef<string | null>(null)
  const dispatchChainRef = useRef<Promise<void>>(Promise.resolve())
  const frontCounterDispatchChainRef = useRef<Promise<void>>(Promise.resolve())
  const sweepRunningRef = useRef(false)
  const notifiedOrderIdsRef = useRef(new Set<string>())
  const runSweepRef = useRef<(force?: boolean) => Promise<void>>(() => Promise.resolve())

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

    void getRestaurants()
      .then((restaurants) => {
        if (!cancelled) setPrintRestaurants(restaurants)
      })
      .catch((error) => {
        recordPrinterDiagnostic('global_print_restaurants_load_failed', {
          message: error instanceof Error ? error.message : String(error),
        })
      })

    return () => {
      cancelled = true
    }
  }, [isPlatformOwner])

  useEffect(() => {
    if (!canUseRestaurantPrinting || !activeRestaurantId) return

    let cancelled = false
    void getRestaurantOperations(activeRestaurantId)
      .then((operations) => {
        if (!cancelled) setAutoAcceptOrdersState(operations.autoAcceptOrders)
      })
      .catch((error) => {
        recordPrinterDiagnostic('restaurant_operations_load_failed', {
          restaurantId: activeRestaurantId,
          message: error instanceof Error ? error.message : String(error),
        })
      })

    return () => {
      cancelled = true
    }
  }, [activeRestaurantId, canUseRestaurantPrinting])

  const setAutoAcceptOrders = useCallback(async (enabled: boolean) => {
    if (!activeRestaurantId || autoAcceptUpdating) return
    setAutoAcceptUpdating(true)
    try {
      const response = await updateRestaurantAutoAccept(activeRestaurantId, enabled)
      setAutoAcceptOrdersState(response.autoAcceptOrders)
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
  }, [audioEnabled])

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
        await printKitchenTicketWithQzTray(ticket, currentSettings)
      } else if (currentSettings.mode === 'web-serial') {
        await printKitchenTicketWithWebSerial(ticket, currentSettings)
      } else if (currentSettings.mode === 'web-usb') {
        await printKitchenTicketWithWebUsb(ticket, currentSettings)
      } else if (currentSettings.mode === 'web-bluetooth') {
        await printKitchenTicketWithWebBluetooth(ticket, currentSettings)
      } else {
        return false
      }

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
    ) => {
      setOrderEventRevision((current) => current + 1)
      const matchesPrintRestaurant = !isPlatformOwner
        || !activeRestaurantId
        || restaurantId === activeRestaurantId
      if (!matchesPrintRestaurant) return

      if (orderId && !notifiedOrderIdsRef.current.has(orderId)) {
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
      ),
      onOrderUpdated: (update) => notifyOrderActivity('updated', update.restaurantId ?? undefined),
      onOrderPaymentUpdated: (update) => notifyOrderActivity('payment', update.restaurantId ?? undefined),
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

  const printFrontCounterTicket = useCallback(async (
    ticket: KitchenTicket,
  ): Promise<GlobalPrintResult> => {
    const currentSettings = frontCounterSettingsRef.current
    if (currentSettings.mode === 'browser') return 'browser'

    const operation = frontCounterDispatchChainRef.current
      .catch(() => undefined)
      .then(async () => {
        if (currentSettings.mode === 'qz-tray') {
          await printKitchenTicketWithQzTray(ticket, currentSettings)
        } else if (currentSettings.mode === 'web-serial') {
          await printKitchenTicketWithWebSerial(ticket, currentSettings)
        } else if (currentSettings.mode === 'web-usb') {
          await printKitchenTicketWithWebUsb(ticket, currentSettings)
        } else {
          await printKitchenTicketWithWebBluetooth(ticket, currentSettings)
        }
      })
    frontCounterDispatchChainRef.current = operation.then(() => undefined, () => undefined)

    try {
      await operation
      toast.success('Front counter receipt sent', {
        description: `${ticket.orderNumber} via ${printerModeLabels[currentSettings.mode]}.`,
      })
      recordPrinterDiagnostic('front_counter_print_succeeded', {
        orderNumber: ticket.orderNumber,
        mode: currentSettings.mode,
      })
      return 'sent'
    } catch (error) {
      recordPrinterDiagnostic('front_counter_print_failed', {
        orderNumber: ticket.orderNumber,
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
          await printKitchenTicketWithQzTray(ticket, currentSettings)
        } else if (currentSettings.mode === 'web-serial') {
          await printKitchenTicketWithWebSerial(ticket, currentSettings)
        } else if (currentSettings.mode === 'web-usb') {
          await printKitchenTicketWithWebUsb(ticket, currentSettings)
        } else if (currentSettings.mode === 'web-bluetooth') {
          await printKitchenTicketWithWebBluetooth(ticket, currentSettings)
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
    audioEnabled,
    toggleAudio,
    printJobs,
    printJobsLoading,
    printStationLeaseHeld,
    printingOrderId,
    orderEventRevision,
    orderRealtimeState,
    isPlatformOwner,
    activeRestaurantId,
    printRestaurants,
    setPlatformRestaurantId,
    autoAcceptOrders,
    autoAcceptUpdating,
    setAutoAcceptOrders,
    refreshPrintJobs,
    retryQueuedPrint,
    printOrder,
    printFrontCounterTicket,
    printTestTicket,
  }), [
    activeRestaurantId,
    autoAcceptOrders,
    autoAcceptUpdating,
    audioEnabled,
    isPlatformOwner,
    orderEventRevision,
    orderRealtimeState,
    printJobs,
    printJobsLoading,
    printOrder,
    printFrontCounterTicket,
    printRestaurants,
    printStationLeaseHeld,
    printTestTicket,
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
