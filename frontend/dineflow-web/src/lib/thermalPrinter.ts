import qz from 'qz-tray'
import { getStoredToken, refreshAccessToken, type AdminOrder } from '@/api/auth'
import { recordPrinterDiagnostic } from '@/lib/printerDiagnostics'
import { formatServiceCode } from '@/lib/serviceCode'

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
const printerBridgeBaseUrl = (
  import.meta.env.VITE_PRINTER_BRIDGE_URL || 'http://127.0.0.1:17891'
).replace(/\/$/, '')

/** Official QZ Tray download page. Linked from the printer settings panel so staff
 * can install the desktop app. We link out rather than self-host the installer
 * (QZ Tray is separately licensed and versioned). */
export const QZ_TRAY_DOWNLOAD_URL = 'https://qz.io/download/'

export type ThermalPrinterMode = 'browser' | 'qz-tray' | 'web-serial' | 'web-usb' | 'web-bluetooth'

/** How QZ Tray reaches the printer: an OS print queue, a RAW network socket,
 * or a serial/Bluetooth COM port owned by QZ. */
export type QzTargetType = 'printer' | 'network' | 'serial'
export type QzPrintEncoding = 'UTF-8' | 'GBK' | 'GB2312' | 'CP1252' | 'ISO-8859-1'
export type ThermalPaperWidth = '58mm' | '80mm'

export type SystemPrinterConnectionKind =
  | 'bluetooth'
  | 'serial'
  | 'usb'
  | 'network'
  | 'network-wsd'
  | 'shared'
  | 'virtual'
  | 'unknown'

/** A QZ-visible Windows queue enriched with local spooler metadata. The queue
 * name remains the value sent to QZ; the remaining fields are presentation and
 * diagnostics only. */
export type QzTrayPrinterDescriptor = {
  name: string
  driverName: string | null
  portName: string | null
  connectionKind: SystemPrinterConnectionKind | null
  connectionLabel: string | null
  isVirtual: boolean
  isDefault: boolean
  sharedPortQueueCount: number
}

export type ThermalPrinterSettings = {
  mode: ThermalPrinterMode
  paperWidth: ThermalPaperWidth
  cutPaper: boolean
  /** ESC/POS routes: sound the printer buzzer (ESC B) before the ticket prints.
   * Pairs with auto-print so the kitchen hears new orders. Printers without a
   * buzzer ignore the command. */
  beepOnPrint: boolean
  /** QZ Tray mode only: print kitchen tickets automatically — pay-at-counter
   * orders as soon as they arrive, online orders once payment succeeds. */
  autoPrintNewOrders: boolean
  /** Which QZ connection the settings dialog has active; only that target's
   * fields are used when printing. */
  qzTargetType: QzTargetType
  /** Character encoding QZ uses when converting the ESC/POS string to bytes.
   * UTF-8 is safest for mixed-language tickets; legacy printers may need GBK. */
  qzEncoding: QzPrintEncoding
  qzPrinterName: string
  /** QZ network target: tickets go straight to host:port (RAW/9100) over the
   * LAN — no OS printer driver needed. */
  qzNetworkHost: string
  qzNetworkPort: number
  /** QZ serial target (e.g. a Bluetooth outgoing COM port). QZ Tray opens the
   * port itself and keeps it open between prints, avoiding the per-print
   * Bluetooth redial/beep/sleep problems. Uses `serialBaudRate`. */
  qzSerialPort: string
  /** Last selected Web Bluetooth (BLE) printer name — used to silently reconnect
   * via navigator.bluetooth.getDevices() after a page reload. */
  bleDeviceName: string
  serialBaudRate: number
  usbVendorId: string
  usbProductId: string
  usbInterfaceNumber: number
  usbEndpointNumber: number
}

export type KitchenTicket = {
  /** The called number (P2-007 / 007). Printed large — this is what the kitchen works from. */
  serviceCode: string
  orderNumber: string
  restaurantName: string
  orderScope: string
  status: string
  createdAt: Date
  printedAt: Date
  itemCount: number
  orderNote?: string | null
  items: Array<{
    quantity: number
    name: string
    note?: string | null
    optionGroups: Array<{
      groupName: string
      options: string[]
    }>
  }>
}

type SerialPortLike = {
  open: (options: { baudRate: number }) => Promise<void>
  close: () => Promise<void>
  writable: WritableStream<Uint8Array> | null
  readable: ReadableStream<Uint8Array> | null
  getInfo?: () => { usbVendorId?: number; usbProductId?: number }
}

type SerialNavigator = Navigator & {
  serial?: {
    requestPort: () => Promise<SerialPortLike>
    getPorts?: () => Promise<SerialPortLike[]>
  }
}

type UsbEndpointLike = {
  endpointNumber: number
  direction: 'in' | 'out'
  type?: string
}

type UsbInterfaceLike = {
  interfaceNumber: number
  alternates: Array<{
    endpoints: UsbEndpointLike[]
  }>
}

type UsbDeviceLike = {
  opened: boolean
  vendorId: number
  productId: number
  configuration: {
    interfaces: UsbInterfaceLike[]
  } | null
  productName?: string
  manufacturerName?: string
  open: () => Promise<void>
  selectConfiguration: (configurationValue: number) => Promise<void>
  claimInterface: (interfaceNumber: number) => Promise<void>
  releaseInterface: (interfaceNumber: number) => Promise<void>
  transferOut: (endpointNumber: number, data: BufferSource) => Promise<unknown>
  close: () => Promise<void>
}

type UsbNavigator = Navigator & {
  usb?: {
    requestDevice: (options: { filters: Array<{ vendorId?: number; productId?: number }> }) => Promise<UsbDeviceLike>
    getDevices?: () => Promise<UsbDeviceLike[]>
  }
}

const esc = '\x1b'
const gs = '\x1d'

export const defaultThermalPrinterSettings: ThermalPrinterSettings = {
  mode: 'browser',
  paperWidth: '80mm',
  cutPaper: true,
  beepOnPrint: false,
  autoPrintNewOrders: false,
  qzTargetType: 'printer',
  qzEncoding: 'UTF-8',
  qzPrinterName: '',
  qzNetworkHost: '',
  qzNetworkPort: 9100,
  qzSerialPort: '',
  bleDeviceName: '',
  serialBaudRate: 9600,
  usbVendorId: '',
  usbProductId: '',
  usbInterfaceNumber: 0,
  usbEndpointNumber: 1,
}

export function createKitchenTicket(order: AdminOrder, printedAt = new Date()): KitchenTicket {
  return {
    serviceCode: formatServiceCode(order),
    orderNumber: order.orderNumber,
    restaurantName: order.restaurantName ?? 'Assigned restaurant',
    orderScope: getTicketOrderScope(order),
    status: order.status,
    createdAt: new Date(order.createdAt),
    printedAt,
    itemCount: order.items.reduce((total, item) => total + item.quantity, 0),
    orderNote: order.customerNote,
    items: order.items.map((item) => ({
      quantity: item.quantity,
      name: item.itemNameSnapshot?.trim() || 'Unnamed item',
      note: item.note,
      optionGroups: groupTicketOptions(item),
    })),
  }
}

// ESC/POS building blocks. Every control byte stays <= 0x7f so the UTF-8
// TextEncoder used for Web Serial/USB emits them unchanged.
const escposInit = esc + '@'
const escposAlignCenter = esc + 'a' + '\x01'
const escposAlignLeft = esc + 'a' + '\x00'
const escposBoldOn = esc + 'E' + '\x01'
const escposBoldOff = esc + 'E' + '\x00'
const escposSizeNormal = gs + '!' + '\x00'
const escposSizeDoubleHeight = gs + '!' + '\x01'
const escposSizeDouble = gs + '!' + '\x11'
const escposReverseOn = gs + 'B' + '\x01'
const escposReverseOff = gs + 'B' + '\x00'
/** Buzzer (ESC B n t): 2 beeps of ~400ms. Common on POS80-style kitchen
 * printers; models without a buzzer ignore the command. */
export const escposBeep = esc + 'B' + '\x02' + '\x04'

export function buildEscPosKitchenTicket(
  ticket: KitchenTicket,
  settings: Pick<ThermalPrinterSettings, 'paperWidth' | 'cutPaper' | 'beepOnPrint'>,
): string {
  const columns = settings.paperWidth === '58mm' ? 32 : 42
  const separator = '-'.repeat(columns)

  const lines: string[] = [
    // Beep first so the kitchen hears the ticket before the paper moves.
    escposInit + (settings.beepOnPrint ? escposBeep : ''),
    // Header uses hardware centering: space-padding breaks on resized text.
    escposAlignCenter + escposBoldOn + 'KITCHEN TICKET' + escposBoldOff,
    escposSizeDouble + ticket.serviceCode + escposSizeNormal,
    ticket.restaurantName,
    escposReverseOn + escposBoldOn + ` ${ticket.orderScope.toUpperCase()} ` + escposBoldOff + escposReverseOff + escposAlignLeft,
    separator,
    // Kept small for reconciliation against payments and refunds, which key off the order number.
    // Skipped when the called number already fell back to it, so it never prints twice.
    ...(ticket.serviceCode === ticket.orderNumber
      ? []
      : [twoColumn('ORDER', ticket.orderNumber, columns)]),
    twoColumn('STATUS', ticket.status, columns),
    twoColumn('CREATED', formatTicketDateTime(ticket.createdAt), columns),
    twoColumn('PRINTED', formatTicketDateTime(ticket.printedAt), columns),
    twoColumn('ITEMS', String(ticket.itemCount), columns),
    separator,
  ]

  for (const item of ticket.items) {
    const itemPrefix = `${item.quantity}X`
    const itemIndent = ' '.repeat(Math.max(0, itemPrefix.length + 2))
    const wrappedName = wrapText(item.name, columns - itemIndent.length)

    // Double-height bold item lines stay readable from across the kitchen.
    lines.push(escposSizeDoubleHeight + escposBoldOn + `${itemPrefix}  ${wrappedName[0] ?? item.name}` + escposBoldOff + escposSizeNormal)
    for (const extraNameLine of wrappedName.slice(1)) {
      lines.push(escposSizeDoubleHeight + escposBoldOn + `${itemIndent}${extraNameLine}` + escposBoldOff + escposSizeNormal)
    }

    for (const group of item.optionGroups) {
      lines.push(`${itemIndent}${group.groupName.toUpperCase()}`)
      for (const optionLine of wrapText(group.options.join(', '), columns - itemIndent.length)) {
        lines.push(`${itemIndent}${optionLine}`)
      }
    }

    if (item.note) {
      // Notes carry allergies and modifications — bold so they cannot be missed.
      lines.push(escposBoldOn + `${itemIndent}ITEM NOTE` + escposBoldOff)
      for (const noteLine of wrapText(item.note, columns - itemIndent.length)) {
        lines.push(escposBoldOn + `${itemIndent}${noteLine}` + escposBoldOff)
      }
    }

    lines.push(separator)
  }

  if (ticket.orderNote) {
    lines.push(escposReverseOn + escposBoldOn + ' ORDER NOTE ' + escposBoldOff + escposReverseOff)
    for (const orderNoteLine of wrapText(ticket.orderNote, columns)) {
      lines.push(escposBoldOn + orderNoteLine + escposBoldOff)
    }
    lines.push(separator)
  }

  lines.push('\n\n')

  if (settings.cutPaper) {
    lines.push(gs + 'V' + '\x41' + '\x00')
  }

  return `${lines.join('\n')}\n`
}

export function encodeEscPosKitchenTicket(
  ticket: KitchenTicket,
  settings: Pick<ThermalPrinterSettings, 'paperWidth' | 'cutPaper' | 'beepOnPrint'>,
): Uint8Array {
  return new TextEncoder().encode(buildEscPosKitchenTicket(ticket, settings))
}

/** Why a QZ Tray operation failed, so the UI can show the right guidance
 * (e.g. a download link when the desktop app is missing) instead of a raw error. */
export type QzTrayErrorReason = 'not-loaded' | 'not-running' | 'no-printer' | 'printer-unavailable' | 'print-failed'

export class QzTrayError extends Error {
  readonly reason: QzTrayErrorReason

  constructor(reason: QzTrayErrorReason, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'QzTrayError'
    this.reason = reason
  }
}

/** Result of probing QZ Tray for the settings status indicator. */
export type QzTrayConnectionStatus = 'connected' | 'disconnected' | 'unavailable'
type QzTrayConnectionStatusListener = (status: QzTrayConnectionStatus) => void

function getQzClient(): typeof qz {
  // With the bundled npm package this is always present; guard anyway so a
  // bundling failure surfaces as a typed error the UI can explain.
  if (!qz || !qz.websocket) {
    throw new QzTrayError('not-loaded', 'The QZ Tray library failed to load in this browser.')
  }
  return qz
}

/** Whether a QZ Tray websocket connection is already open. Cheap and side-effect
 * free (does not open a connection or trigger the desktop allow-prompt). */
export function isQzTrayConnected(): boolean {
  try {
    return getQzClient().websocket.isActive() === true
  } catch {
    return false
  }
}

export async function getQzRuntimeInfo(): Promise<{
  connected: boolean
  version: string | null
}> {
  const client = getQzClient()
  if (!client.websocket.isActive()) return { connected: false, version: null }
  const version = await Promise.resolve(client.api.getVersion()).catch(() => null)
  return {
    connected: client.websocket.isActive() === true,
    version: typeof version === 'string' ? version : version == null ? null : String(version),
  }
}

const qzConnectedBeforeStorageKey = 'dineflow.qzTrayConnectedBefore'

/** Whether this browser has ever connected to QZ Tray successfully. Used to
 * auto-reconnect when the printer settings open, instead of requiring a manual
 * Test connection after every page reload. */
export function hasQzTrayConnectedBefore(): boolean {
  try {
    return window.localStorage.getItem(qzConnectedBeforeStorageKey) === '1'
  } catch {
    return false
  }
}

function rememberQzTrayConnected(): void {
  try {
    window.localStorage.setItem(qzConnectedBeforeStorageKey, '1')
  } catch {
    // Storage unavailable (private mode); auto-reconnect just won't trigger.
  }
}

let qzSecurityConfigured = false
let qzDiagnosticsConfigured = false
let qzConnectedAt: number | null = null
let lastQzHeartbeatDiagnosticAt = 0
const openQzNetworkSockets = new Set<string>()
let qzNetworkSocketDiagnosticsConfigured = false
let qzConnectionAttempt: Promise<void> | null = null
let qzKeepAliveTimer: number | null = null
let qzReconnectTimer: number | null = null
let qzKeepAliveEnabled = false
const qzConnectionStatusListeners = new Set<QzTrayConnectionStatusListener>()

export const qzKeepAliveIntervalMs = 20_000
export const qzWebsocketPingIntervalSeconds = 15

function notifyQzConnectionStatus(status: QzTrayConnectionStatus): void {
  for (const listener of qzConnectionStatusListeners) {
    listener(status)
  }
}

/** Subscribe to live QZ websocket transitions. This is the authoritative path
 * for UI indicators: `websocket.isActive()` can remain true briefly after the
 * desktop process exits, while the closed callback reflects the actual drop. */
export function subscribeQzTrayConnectionStatus(listener: QzTrayConnectionStatusListener): () => void {
  qzConnectionStatusListeners.add(listener)
  return () => qzConnectionStatusListeners.delete(listener)
}

function describeQzSocketEvent(event: unknown): string {
  if (event instanceof Error) return event.message
  if (event && typeof event === 'object' && 'message' in event && typeof event.message === 'string') {
    return event.message
  }
  return typeof event === 'string' ? event : 'No event detail'
}

function scheduleQzReconnect(trigger: string, delayMs = 1_000): void {
  if (!qzKeepAliveEnabled || document.visibilityState === 'hidden' || qzReconnectTimer !== null) return

  recordPrinterDiagnostic('qz_reconnect_scheduled', { trigger, delayMs })
  qzReconnectTimer = window.setTimeout(() => {
    qzReconnectTimer = null
    void connectQzTray(`reconnect:${trigger}`).catch((error) => {
      recordPrinterDiagnostic('qz_reconnect_failed', {
        trigger,
        message: error instanceof Error ? error.message : String(error),
      })
    })
  }, delayMs)
}

function configureQzDiagnostics(client: typeof qz): void {
  if (qzDiagnosticsConfigured) return
  qzDiagnosticsConfigured = true

  client.websocket.setErrorCallbacks((event) => {
    recordPrinterDiagnostic('qz_websocket_error', { message: describeQzSocketEvent(event) })
    if (!isQzTrayConnected()) {
      notifyQzConnectionStatus('disconnected')
    }
  })
  client.websocket.setClosedCallbacks((event) => {
    recordPrinterDiagnostic('qz_websocket_closed', {
      message: describeQzSocketEvent(event),
      connectionAgeMs: qzConnectedAt === null ? null : Date.now() - qzConnectedAt,
    })
    qzConnectedAt = null
    openQzNetworkSockets.clear()
    notifyQzConnectionStatus('disconnected')
    scheduleQzReconnect('websocket-closed')
  })
}

/** Wire QZ Tray's trust chain to the backend: the deployment certificate comes
 * from `GET /api/print/certificate` and each request is signed server-side via
 * `POST /api/print/sign`, so requests are no longer "anonymous" in QZ's prompt.
 * When the backend has no certificate configured, both hooks fall back to the
 * previous anonymous behaviour (QZ prompts, cannot be remembered). */
function configureQzSecurity(client: typeof qz): void {
  if (qzSecurityConfigured) {
    return
  }
  qzSecurityConfigured = true

  client.security.setCertificatePromise((resolve, reject) => {
    fetch(`${apiBaseUrl}/api/print/certificate`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Certificate request failed with HTTP ${response.status}`)
        }
        return response.text()
      })
      .then(resolve)
      .catch(reject)
  })

  client.security.setSignatureAlgorithm('SHA512')

  // NOTE: qz-tray 2.2.x requires the resolver-factory form here — it passes the
  // factory's return value to `new Promise(...)`, so returning a Promise directly
  // throws "Promise resolver is not a function" and every signature fails.
  client.security.setSignaturePromise((dataToSign: string) => (resolve) => {
    void requestSignature(dataToSign).then(resolve)
  })
}

async function requestSignature(dataToSign: string, hasRetried = false): Promise<string> {
  const token = getStoredToken()

  if (!token) {
    // No auth token → the sign endpoint (staff-only) would 401. Surface it so
    // the cause is obvious instead of a silent "Invalid Signature" in QZ.
    console.error('[QZ] Cannot sign print request: not signed in. Log in as staff, then reconnect QZ.')
    return ''
  }

  try {
    const response = await fetch(`${apiBaseUrl}/api/print/sign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ request: dataToSign }),
    })

    if (!response.ok) {
      // The access token had expired — this is exactly the "printed a moment
      // after the staff page had been idle" case that used to surface as a
      // confusing QZ "Invalid Signature" prompt. Silently refresh and sign
      // again once before giving up.
      if ((response.status === 401 || response.status === 403) && !hasRetried) {
        const refreshed = await refreshAccessToken()
        if (refreshed) {
          return requestSignature(dataToSign, true)
        }
      }

      const detail = response.status === 401 || response.status === 403
        ? 'not authorized — your session may have expired; log out and back in as staff.'
        : `HTTP ${response.status}.`
      throw new Error(`sign endpoint ${detail}`)
    }

    const payload = await response.json() as { signature?: string }
    if (!payload.signature) {
      console.error('[QZ] Sign endpoint returned no signature — check QZ_PRIVATE_KEY_PEM_B64 on the server.')
    }
    return payload.signature ?? ''
  } catch (error) {
    // Fall back to an unsigned request: QZ prompts instead of failing the print.
    console.error('[QZ] Signing request failed:', error instanceof Error ? error.message : error)
    return ''
  }
}

const qzOverrideCertFileName = 'override.crt'

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
}

/** Whether this browser can write/remove the QZ trust certificate directly
 * (File System Access API — Chrome/Edge on desktop). */
export function canManageQzTrustCertificate(): boolean {
  return typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function'
}

async function fetchQzCertificatePem(): Promise<string> {
  const response = await fetch(`${apiBaseUrl}/api/print/certificate`)

  if (!response.ok) {
    throw new Error('The QZ signing certificate is not configured on the server.')
  }

  return response.text()
}

async function pickQzInstallDirectory(): Promise<FileSystemDirectoryHandle> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker

  if (!picker) {
    throw new Error('This browser cannot write files directly. Use Chrome or Edge, or download override.crt instead.')
  }

  // Rejects with DOMException `AbortError` when the user cancels the picker.
  return picker.call(window, { id: 'qz-tray-install', mode: 'readwrite' })
}

/** One-click trust setup: the user picks the QZ Tray install folder and we write
 * the deployment certificate into it as `override.crt`. QZ Tray must be restarted
 * afterwards to load it. Returns the picked folder name for feedback. */
export async function installQzTrustCertificate(): Promise<string> {
  const certificatePem = await fetchQzCertificatePem()
  const directory = await pickQzInstallDirectory()

  const fileHandle = await directory.getFileHandle(qzOverrideCertFileName, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(certificatePem)
  await writable.close()

  return directory.name
}

/** Undo trust setup: delete `override.crt` from the picked QZ Tray install folder.
 * Rejects with DOMException `NotFoundError` when no override.crt exists there. */
export async function removeQzTrustCertificate(): Promise<string> {
  const directory = await pickQzInstallDirectory()
  await directory.removeEntry(qzOverrideCertFileName)
  return directory.name
}

/** Fallback for browsers without the File System Access API: download the
 * certificate as `override.crt` for the user to place manually. */
export async function downloadQzTrustCertificate(): Promise<void> {
  const certificatePem = await fetchQzCertificatePem()
  const blob = new Blob([certificatePem], { type: 'application/x-pem-file' })
  const url = URL.createObjectURL(blob)

  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = qzOverrideCertFileName
    anchor.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function connectQzTrayInternal(context: string): Promise<void> {
  const client = getQzClient()
  configureQzSecurity(client)
  configureQzDiagnostics(client)
  const checkStartedAt = Date.now()

  if (client.websocket.isActive()) {
    // QZ Tray idle-drops the websocket after inactivity while our local state can
    // still report "active". Verify with a cheap unsigned round-trip (getVersion,
    // ~ms when live); if it's stale, reconnect below — otherwise print() sends
    // into a dead socket and resolves as "success" without ever reaching the
    // printer (the classic "toast succeeded but nothing came out" after idle).
    const alive = await Promise.race([
      client.api.getVersion().then(() => true).catch(() => false),
      new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), 2_500)),
    ])
    if (alive) {
      rememberQzTrayConnected()
      notifyQzConnectionStatus('connected')
      if (context !== 'keepalive' || Date.now() - lastQzHeartbeatDiagnosticAt >= 5 * 60_000) {
        lastQzHeartbeatDiagnosticAt = Date.now()
        recordPrinterDiagnostic('qz_liveness_ok', {
          context,
          roundTripMs: Date.now() - checkStartedAt,
          connectionAgeMs: qzConnectedAt === null ? null : Date.now() - qzConnectedAt,
        })
      }
      return
    }
    console.warn('[QZ] Connection went stale (idle drop) — reconnecting.')
    recordPrinterDiagnostic('qz_connection_stale', {
      context,
      livenessTimeoutMs: Date.now() - checkStartedAt,
      connectionAgeMs: qzConnectedAt === null ? null : Date.now() - qzConnectedAt,
    })
    const disconnected = await Promise.race([
      client.websocket.disconnect().then(() => true).catch(() => false),
      new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), 2_500)),
    ])
    recordPrinterDiagnostic('qz_stale_disconnect_finished', { context, disconnected })
  }

  try {
    // QZ's own keepAlive sends websocket "ping" frames. Use a shorter interval
    // than the 60-second library default, plus retries for a Tray process that is
    // still waking up after Windows/browser sleep.
    recordPrinterDiagnostic('qz_connect_attempt', { context })
    await openQzWebsocketAfterIdle(client, context)
    qzConnectedAt = Date.now()
    rememberQzTrayConnected()
    notifyQzConnectionStatus('connected')
    // The desktop version determines whether SHA512 request signing is supported
    // (2.0.x forces SHA1 → "Invalid Signature" with our key).
    const version = await Promise.resolve(client.api.getVersion()).catch(() => null)
    recordPrinterDiagnostic('qz_connect_succeeded', {
      context,
      durationMs: Date.now() - checkStartedAt,
      version,
    })
  } catch (error) {
    notifyQzConnectionStatus('disconnected')
    recordPrinterDiagnostic('qz_connect_failed', {
      context,
      durationMs: Date.now() - checkStartedAt,
      message: error instanceof Error ? error.message : String(error),
    })
    throw new QzTrayError(
      'not-running',
      'Could not reach QZ Tray. Make sure the QZ Tray desktop app is installed and running.',
      { cause: error },
    )
  }
}

/** Open a QZ Tray connection if one is not already active. Concurrent callers
 * share one attempt so a wake event, keepalive tick and print cannot race three
 * websocket.connect() calls against each other. Throws a typed
 * {@link QzTrayError} with reason `not-running` when the desktop app cannot be reached. */
export function connectQzTray(context = 'operation'): Promise<void> {
  if (qzConnectionAttempt) {
    recordPrinterDiagnostic('qz_connect_joined', { context })
    return qzConnectionAttempt
  }

  const attempt = connectQzTrayInternal(context)
  qzConnectionAttempt = attempt
  void attempt.then(
    () => {
      if (qzConnectionAttempt === attempt) qzConnectionAttempt = null
    },
    () => {
      if (qzConnectionAttempt === attempt) qzConnectionAttempt = null
    },
  )
  return attempt
}

function runQzWakeRecovery(trigger: string): void {
  if (!qzKeepAliveEnabled || document.visibilityState === 'hidden') return

  recordPrinterDiagnostic('qz_wake_recovery_started', {
    trigger,
    visibilityState: document.visibilityState,
    wasActive: isQzTrayConnected(),
  })
  void connectQzTray(`wake:${trigger}`).catch((error) => {
    recordPrinterDiagnostic('qz_wake_recovery_failed', {
      trigger,
      message: error instanceof Error ? error.message : String(error),
    })
  })
}

function handleQzVisibilityChange(): void {
  if (document.visibilityState === 'visible') runQzWakeRecovery('visibilitychange')
}

function handleQzWindowWake(event: Event): void {
  runQzWakeRecovery(event.type)
}

function addQzWakeListeners(): void {
  document.addEventListener('visibilitychange', handleQzVisibilityChange)
  document.addEventListener('resume', handleQzWindowWake)
  window.addEventListener('focus', handleQzWindowWake)
  window.addEventListener('pageshow', handleQzWindowWake)
  window.addEventListener('online', handleQzWindowWake)
}

function removeQzWakeListeners(): void {
  document.removeEventListener('visibilitychange', handleQzVisibilityChange)
  document.removeEventListener('resume', handleQzWindowWake)
  window.removeEventListener('focus', handleQzWindowWake)
  window.removeEventListener('pageshow', handleQzWindowWake)
  window.removeEventListener('online', handleQzWindowWake)
}

async function openQzWebsocketAfterIdle(client: typeof qz, context: string): Promise<void> {
  let lastError: unknown

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await client.websocket.connect({
        keepAlive: qzWebsocketPingIntervalSeconds,
        retries: 3,
        delay: 1,
      })
      return
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      const previousSocketStillClosing =
        /previous disconnect|still closing|connection attempt has not returned|open connection.*already exists/i.test(message)

      if (!previousSocketStillClosing || attempt === 4) throw error

      const retryDelayMs = attempt * 500
      recordPrinterDiagnostic('qz_connect_waiting_for_stale_socket', {
        context,
        attempt,
        retryDelayMs,
        message,
      })
      await new Promise<void>((resolve) => window.setTimeout(resolve, retryDelayMs))
    }
  }

  throw lastError
}

/** Keep the QZ Tray websocket warm so it never hits QZ's idle timeout (which
 * drops the connection — the "connection idle" popup — and makes the first print
 * after the gap silently vanish even though print() resolves). It also recovers
 * immediately when a frozen/backgrounded browser tab becomes active again. */
export function startQzKeepAlive(intervalMs = qzKeepAliveIntervalMs): void {
  stopQzKeepAlive()
  qzKeepAliveEnabled = true
  addQzWakeListeners()
  recordPrinterDiagnostic('qz_keepalive_started', { intervalMs })

  // Do not wait for the first interval. This reconnects immediately after a
  // component remount and establishes QZ's native websocket ping loop.
  runQzWakeRecovery('keepalive-start')

  qzKeepAliveTimer = window.setInterval(() => {
    void connectQzTray('keepalive').catch((error) => {
      recordPrinterDiagnostic('qz_keepalive_failed', {
        message: error instanceof Error ? error.message : String(error),
      })
    })
  }, intervalMs)
}

export function stopQzKeepAlive(): void {
  qzKeepAliveEnabled = false
  removeQzWakeListeners()

  if (qzKeepAliveTimer !== null) {
    window.clearInterval(qzKeepAliveTimer)
    qzKeepAliveTimer = null
    recordPrinterDiagnostic('qz_keepalive_stopped')
  }
  if (qzReconnectTimer !== null) {
    window.clearTimeout(qzReconnectTimer)
    qzReconnectTimer = null
  }
}

// Per-printer (host:port) print queue. Cheap embedded WiFi thermal printers
// generally accept only ONE TCP connection at a time — firing prints back-to-
// back or concurrently (several order cards clicked quickly, or auto-print
// draining a backlog) can open overlapping connections that the printer's
// firmware silently drops, while QZ's print() still resolves as success
// because the TCP handshake/write itself completed fine. This serializes every
// print to a given printer into a strict one-at-a-time queue with a cool-down
// gap between turns, so the device's TCP stack has time to fully release the
// previous connection before the next one arrives.
//
// (An earlier "priming send" + periodic keep-alive traffic to the printer were
// tried here to work around an idle/cold-start theory, but they added MORE
// concurrent-connection risk than they solved and made real prints go missing
// more often — removed in favor of this simpler, verified-safer approach.)
const networkPrintChains = new Map<string, Promise<unknown>>()
const networkPrintQueueDepths = new Map<string, number>()
const lastNetworkPrintResolvedAt = new Map<string, number>()
export const networkPrinterCooldownMs = 5_000

type QzNetworkSocketEvent = {
  type?: string
  host?: string
  port?: number
  response?: string
  exception?: string
}

function qzSocketCallAsPromise(call: () => unknown): Promise<void> {
  return Promise.resolve(call() as Promise<void> | undefined)
}

function configureQzNetworkSocketDiagnostics(client: typeof qz): void {
  if (qzNetworkSocketDiagnosticsConfigured) return
  qzNetworkSocketDiagnosticsConfigured = true

  client.socket.setSocketCallbacks((rawEvent) => {
    const event = rawEvent as QzNetworkSocketEvent
    const target = event.host && event.port ? `${event.host}:${event.port}` : null
    const eventType = String(event.type ?? 'UNKNOWN').toUpperCase()

    if (eventType === 'ERROR' && target) {
      openQzNetworkSockets.delete(target)
    }

    recordPrinterDiagnostic('qz_network_socket_event', {
      eventType,
      target,
      exception: event.exception,
      responseBytes: typeof event.response === 'string' ? event.response.length : undefined,
    })
  })
}

async function ensureQzNetworkSocketOpen(
  client: typeof qz,
  host: string,
  port: number,
  encoding: QzPrintEncoding,
  timeoutMs = 5_000,
): Promise<boolean> {
  const target = `${host}:${port}`
  configureQzNetworkSocketDiagnostics(client)

  if (openQzNetworkSockets.has(target)) {
    return true
  }

  const startedAt = Date.now()
  recordPrinterDiagnostic('qz_network_socket_open_started', { target })

  await Promise.race([
    qzSocketCallAsPromise(() =>
      (client.socket.open as (socketHost: string, socketPort: number, options?: { encoding?: string }) => unknown)(
        host,
        port,
        { encoding },
      )),
    new Promise<void>((_, reject) =>
      window.setTimeout(() => reject(new Error(`Timed out opening ${target}`)), timeoutMs),
    ),
  ])

  openQzNetworkSockets.add(target)
  recordPrinterDiagnostic('qz_network_socket_opened', {
    target,
    durationMs: Date.now() - startedAt,
  })
  return false
}

async function closeQzNetworkSocket(client: typeof qz, host: string, port: number): Promise<void> {
  const target = `${host}:${port}`
  openQzNetworkSockets.delete(target)

  try {
    await qzSocketCallAsPromise(() =>
      (client.socket.close as (socketHost: string, socketPort: number) => unknown)(host, port),
    )
  } catch {
    // The socket may already have been closed by the printer.
  }
}

export async function closeQzNetworkSockets(): Promise<void> {
  const client = getQzClient()
  const targets = [...openQzNetworkSockets]

  await Promise.all(targets.map(async (target) => {
    const separator = target.lastIndexOf(':')
    const host = target.slice(0, separator)
    const port = Number(target.slice(separator + 1))
    if (host && Number.isFinite(port)) {
      await closeQzNetworkSocket(client, host, port)
    }
  }))
}

/** Exported for testing the serialization/cool-down behaviour in isolation; not
 * meant to be called directly by other application code. */
export function enqueueNetworkPrint<T>(
  host: string,
  port: number,
  task: () => Promise<T>,
  cooldownMs = networkPrinterCooldownMs,
): Promise<T> {
  const key = `${host}:${port}`
  const previous = networkPrintChains.get(key) ?? Promise.resolve()
  const enqueuedAt = Date.now()
  const queueDepth = (networkPrintQueueDepths.get(key) ?? 0) + 1
  networkPrintQueueDepths.set(key, queueDepth)
  recordPrinterDiagnostic('network_job_enqueued', { target: key, queueDepth })

  const run = previous.catch(() => undefined).then(async () => {
    recordPrinterDiagnostic('network_job_started', {
      target: key,
      queueWaitMs: Date.now() - enqueuedAt,
      queueDepth: networkPrintQueueDepths.get(key) ?? 1,
    })
    try {
      return await task()
    } finally {
      const remaining = Math.max((networkPrintQueueDepths.get(key) ?? 1) - 1, 0)
      if (remaining === 0) {
        networkPrintQueueDepths.delete(key)
      } else {
        networkPrintQueueDepths.set(key, remaining)
      }
    }
  })

  networkPrintChains.set(
    key,
    run
      .catch(() => undefined)
      .then(() => {
        recordPrinterDiagnostic('network_job_cooldown_started', { target: key, cooldownMs })
        return new Promise<void>((resolve) => window.setTimeout(resolve, cooldownMs))
      }),
  )

  return run
}

/** Close the QZ Tray connection if open. Never throws. */
export async function disconnectQzTray(): Promise<void> {
  try {
    const client = getQzClient()
    await closeQzNetworkSockets()
    if (client.websocket.isActive()) {
      await client.websocket.disconnect()
    }
  } catch {
    // Best-effort teardown; ignore failures.
  } finally {
    notifyQzConnectionStatus('disconnected')
  }
}

/** Probe QZ Tray availability for the settings status indicator. Never throws.
 * Note: when not already connected this opens a connection (with the signed trust
 * chain when the backend is configured), which may show the QZ Tray allow-prompt
 * on unsigned setups — call it from an explicit user action. */
export async function probeQzTrayStatus(): Promise<QzTrayConnectionStatus> {
  try {
    await connectQzTray('serial-print')
    return 'connected'
  } catch (error) {
    return error instanceof QzTrayError && error.reason === 'not-loaded' ? 'unavailable' : 'disconnected'
  }
}

/** List the printer names known to the connected QZ Tray instance so the settings
 * panel can offer a dropdown instead of free-text entry. Connects first if needed
 * (so it can throw {@link QzTrayError} with reason `not-running`). */
export async function listQzTrayPrinters(): Promise<string[]> {
  const client = getQzClient()
  await connectQzTray()

  const found = await client.printers.find()
  return (Array.isArray(found) ? found : [found]).filter(
    (name): name is string => typeof name === 'string' && name.trim().length > 0,
  )
}

type PrinterBridgeQueue = {
  name: string
  driverName?: string | null
  portName?: string | null
  connectionKind?: string | null
  connectionLabel?: string | null
  isVirtual?: boolean
  isDefault?: boolean
  sharedPortQueueCount?: number
}

const systemPrinterConnectionKinds = new Set<SystemPrinterConnectionKind>([
  'bluetooth',
  'serial',
  'usb',
  'network',
  'network-wsd',
  'shared',
  'virtual',
  'unknown',
])

function parsePrinterBridgeQueue(value: unknown): PrinterBridgeQueue | null {
  if (!value || typeof value !== 'object') return null
  const queue = value as Record<string, unknown>
  if (typeof queue.name !== 'string' || !queue.name.trim() || queue.name.length > 512) return null

  return {
    name: queue.name.trim(),
    driverName: typeof queue.driverName === 'string' ? queue.driverName : null,
    portName: typeof queue.portName === 'string' ? queue.portName : null,
    connectionKind: typeof queue.connectionKind === 'string' ? queue.connectionKind : null,
    connectionLabel: typeof queue.connectionLabel === 'string' ? queue.connectionLabel : null,
    isVirtual: queue.isVirtual === true,
    isDefault: queue.isDefault === true,
    sharedPortQueueCount:
      typeof queue.sharedPortQueueCount === 'number' && Number.isSafeInteger(queue.sharedPortQueueCount)
        ? Math.max(1, queue.sharedPortQueueCount)
        : 1,
  }
}

async function loadWindowsPrinterQueues(): Promise<PrinterBridgeQueue[]> {
  if (!printerBridgeBaseUrl || !window.navigator.userAgent.toLowerCase().includes('windows')) return []

  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 2_000)

  try {
    const response = await fetch(`${printerBridgeBaseUrl}/printers`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`Printer bridge returned HTTP ${response.status}`)
    }

    const payload = (await response.json()) as { printers?: unknown }
    const queues = Array.isArray(payload.printers)
      ? payload.printers.slice(0, 200).map(parsePrinterBridgeQueue).filter((queue): queue is PrinterBridgeQueue => queue !== null)
      : []

    recordPrinterDiagnostic('printer_bridge_discovery_succeeded', { queueCount: queues.length })
    return queues
  } catch (error) {
    recordPrinterDiagnostic('printer_bridge_discovery_failed', {
      message: error instanceof Error ? error.message : String(error),
    })
    return []
  } finally {
    window.clearTimeout(timer)
  }
}

function looksLikeVirtualPrinter(name: string): boolean {
  const normalized = name.toUpperCase()
  return (
    normalized.includes('PRINT TO PDF')
    || normalized.includes('MICROSOFT XPS')
    || normalized.includes('ONENOTE')
    || normalized === 'FAX'
    || normalized.includes('PDFCREATOR')
    || normalized.includes('CUTEPDF')
    || normalized.includes('ADOBE PDF')
  )
}

/** QZ supplies the queue names used for printing; the local Windows bridge adds
 * the transport behind each queue. If the optional bridge is not running, QZ
 * discovery still succeeds and the dropdown falls back to unlabelled names. */
export async function listQzTrayPrinterDescriptors(): Promise<QzTrayPrinterDescriptor[]> {
  const [names, windowsQueues] = await Promise.all([
    listQzTrayPrinters(),
    loadWindowsPrinterQueues(),
  ])
  const queuesByName = new Map(
    windowsQueues.map((queue) => [queue.name.toLocaleLowerCase(), queue] as const),
  )

  return names.map((name) => {
    const queue = queuesByName.get(name.toLocaleLowerCase())
    const connectionKind = queue?.connectionKind
    const validConnectionKind = connectionKind && systemPrinterConnectionKinds.has(connectionKind as SystemPrinterConnectionKind)
      ? connectionKind as SystemPrinterConnectionKind
      : null

    return {
      name,
      driverName: queue?.driverName ?? null,
      portName: queue?.portName ?? null,
      connectionKind: validConnectionKind,
      connectionLabel: queue?.connectionLabel ?? null,
      isVirtual: queue?.isVirtual ?? looksLikeVirtualPrinter(name),
      isDefault: queue?.isDefault ?? false,
      sharedPortQueueCount: queue?.sharedPortQueueCount ?? 1,
    }
  })
}

export function formatQzPrinterConnectionLabel(printer: QzTrayPrinterDescriptor): string | null {
  if (!printer.connectionLabel) {
    return printer.isVirtual ? 'Virtual printer' : null
  }

  return printer.sharedPortQueueCount > 1
    ? `${printer.connectionLabel} · shared by ${printer.sharedPortQueueCount} queues`
    : printer.connectionLabel
}

/** The OS default printer name according to QZ Tray, or null when unavailable.
 * Used to preselect a sensible printer the first time discovery succeeds. */
export async function getQzTrayDefaultPrinter(): Promise<string | null> {
  const client = getQzClient()
  await connectQzTray()

  try {
    const name = await client.printers.getDefault()
    return typeof name === 'string' && name.trim().length > 0 ? name : null
  } catch {
    return null
  }
}

/** Printer states in which the OS spooler would accept a job but not print it —
 * the exact mechanism behind "a pile of stale tickets bursts out once the
 * printer comes back": queued jobs replay on recovery. */
const queueingPrinterStatuses = new Set([
  'OFFLINE',
  'NOT_AVAILABLE',
  'ERROR',
  'PAPER_OUT',
  'MEDIA_EMPTY',
  'PAPER_JAM',
  'COVER_OPEN',
  'DOOR_OPEN',
  'USER_INTERVENTION',
  'OUT_OF_MEMORY',
  'OUTPUT_FULL',
  'PAUSED',
])

export type QzPrinterHealth = { ok: boolean; status: string }

/** Probe the printer's spooler status before submitting a job. Resolves
 * `ok: true` when no verdict arrives within the timeout, so drivers that never
 * report status cannot block printing. Never rejects. */
export async function checkQzPrinterHealth(printerName: string, timeoutMs = 2_500): Promise<QzPrinterHealth> {
  const client = getQzClient()
  await connectQzTray()

  return new Promise<QzPrinterHealth>((resolve) => {
    let settled = false

    const finish = (result: QzPrinterHealth) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      try {
        client.printers.setPrinterCallbacks(() => undefined)
        void client.printers.stopListening()
      } catch {
        // Cleanup is best-effort.
      }
      resolve(result)
    }

    const timer = window.setTimeout(() => finish({ ok: true, status: 'UNKNOWN' }), timeoutMs)

    try {
      client.printers.setPrinterCallbacks((eventData) => {
        const event = eventData as { eventType?: string; statusText?: string; severity?: string }
        if (event?.eventType !== 'PRINTER') return

        const status = String(event.statusText ?? '').toUpperCase()
        const severity = String(event.severity ?? '').toUpperCase()

        if (queueingPrinterStatuses.has(status) || severity === 'ERROR' || severity === 'FATAL') {
          finish({ ok: false, status: status || severity })
        }
      })

      client.printers
        .startListening(printerName)
        .then(() => client.printers.getStatus())
        .catch(() => finish({ ok: true, status: 'UNKNOWN' }))
    } catch {
      finish({ ok: true, status: 'UNKNOWN' })
    }
  })
}

/** Probe a network printer by opening a raw TCP socket through QZ Tray. Resolves
 * true when the host accepts a connection on `port` (RAW/9100) within the
 * timeout, false otherwise. Never throws — used for the settings "Test
 * connection" button so staff can verify an IP before saving.
 *
 * NOTE: `qz.socket.open` actually returns a Promise (the bundled @types wrongly
 * declare it `void`), which resolves once the printer accepts the connection and
 * rejects when it refuses — so we await it directly rather than watch callbacks. */
export async function probeQzNetworkPrinter(host: string, port: number, timeoutMs = 4_000): Promise<boolean> {
  const trimmedHost = host.trim()
  if (!trimmedHost) return false
  if (openQzNetworkSockets.has(`${trimmedHost}:${port}`)) return true

  const client = getQzClient()
  await connectQzTray()

  const openResult = (client.socket.open as (h: string, p: number) => unknown)(trimmedHost, port)

  try {
    await Promise.race([
      Promise.resolve(openResult as Promise<void> | undefined),
      new Promise<void>((_, reject) => window.setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ])
    return true
  } catch {
    return false
  } finally {
    try {
      void (client.socket.close as (h: string, p: number) => unknown)(trimmedHost, port)
    } catch {
      // Best-effort cleanup.
    }
  }
}

/** The IPv4 address and /24 subnet prefix of the machine running QZ Tray, so the
 * settings panel can hint/prefill the printer's network (e.g. "192.168.50."). */
export async function getQzHostNetwork(): Promise<{ ip: string; subnetPrefix: string } | null> {
  const client = getQzClient()
  await connectQzTray()

  try {
    const info = (await client.networking.device()) as { ip?: string; ipAddress?: string }
    const ip = info?.ip ?? info?.ipAddress
    if (typeof ip !== 'string' || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
      return null
    }
    return { ip, subnetPrefix: ip.replace(/\.\d+$/, '.') }
  } catch {
    return null
  }
}

/** COM ports QZ Tray can see on the machine it runs on (includes Bluetooth
 * outgoing ports). Connects first if needed. */
export async function listQzSerialPorts(): Promise<string[]> {
  const client = getQzClient()
  await connectQzTray()

  const ports = await client.serial.findPorts()
  return (Array.isArray(ports) ? ports : []).filter(
    (name): name is string => typeof name === 'string' && name.trim().length > 0,
  )
}

// Serial ports we have opened through QZ this session. QZ keeps them open until
// closed explicitly, which is exactly what flaky Bluetooth modules need: one
// dial-up, then a persistent link (no per-print beep/redial/sleep).
const openQzSerialPorts = new Set<string>()

async function ensureQzSerialPortOpen(
  client: typeof qz,
  portName: string,
  baudRate: number,
  encoding: QzPrintEncoding = defaultThermalPrinterSettings.qzEncoding,
): Promise<void> {
  if (openQzSerialPorts.has(portName)) {
    return
  }

  const openPort = () =>
    client.serial.openPort(portName, {
      baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: 'NONE',
      flowControl: 'NONE',
      encoding,
    })

  try {
    await openPort()
    openQzSerialPorts.add(portName)
    return
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    // "Already open" / "Port busy" usually means QZ Tray (a persistent process)
    // still holds the port from an earlier page load that our per-load bookkeeping
    // forgot. Force-close it through QZ and retry once. (If a *different* app holds
    // it, closePort is a no-op and the retry fails with clearer guidance.)
    if (/already open|busy|in use|access/i.test(message)) {
      await client.serial.closePort(portName).catch(() => undefined)
      await new Promise((resolve) => window.setTimeout(resolve, 300))

      try {
        await openPort()
        openQzSerialPorts.add(portName)
        return
      } catch (retryError) {
        const retryMessage = retryError instanceof Error ? retryError.message : String(retryError)
        throw new QzTrayError(
          'printer-unavailable',
          `Could not open ${portName} (${retryMessage}). For a Bluetooth COM port this usually means the printer's classic-Bluetooth link is down — power-cycle the printer, and do NOT also connect it over BLE (dual-mode modules can't serve both radios at once). Otherwise the port may be held by another browser tab running this page.`,
          { cause: retryError },
        )
      }
    }

    throw new QzTrayError(
      'printer-unavailable',
      `Could not open ${portName}: ${message} The ticket was NOT queued — wake the printer (power/FEED button) and try again.`,
      { cause: error },
    )
  }
}

/** Verify QZ can open and write to a serial/Bluetooth COM target without
 * printing. A successful port is deliberately kept open so the real ticket
 * does not have to redial the Bluetooth SPP link. */
export async function testQzSerialConnection(portName: string, baudRate: number): Promise<void> {
  const trimmedPort = portName.trim()
  if (!trimmedPort) {
    throw new QzTrayError('no-printer', 'Choose a serial/Bluetooth COM port before testing.')
  }

  const client = getQzClient()
  const startedAt = Date.now()
  recordPrinterDiagnostic('qz_serial_test_started', {
    portName: trimmedPort,
    baudRate,
  })

  try {
    await connectQzTray('serial-test')
    await ensureQzSerialPortOpen(client, trimmedPort, baudRate)
    // ESC/POS DLE EOT 1 requests status and does not print. QZ does not need a
    // reply for this test: a successful write proves the COM handle is usable.
    await client.serial.sendData(trimmedPort, '\x10\x04\x01')
    recordPrinterDiagnostic('qz_serial_test_succeeded', {
      portName: trimmedPort,
      baudRate,
      durationMs: Date.now() - startedAt,
      keptOpen: true,
    })
  } catch (error) {
    openQzSerialPorts.delete(trimmedPort)
    await client.serial.closePort(trimmedPort).catch(() => undefined)
    recordPrinterDiagnostic('qz_serial_test_failed', {
      portName: trimmedPort,
      baudRate,
      durationMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

/** Close any serial ports QZ Tray is holding open for us, so another owner
 * (e.g. the browser's Web Serial route) can open the same COM port. Never throws. */
export async function closeQzSerialPorts(): Promise<void> {
  if (openQzSerialPorts.size === 0) {
    return
  }

  let client: typeof qz
  try {
    client = getQzClient()
  } catch {
    openQzSerialPorts.clear()
    return
  }

  const ports = [...openQzSerialPorts]
  openQzSerialPorts.clear()
  await Promise.all(ports.map((portName) => client.serial.closePort(portName).catch(() => undefined)))
}

/** Cancel everything sitting in the printer's OS queue so a recovered printer
 * does not burst out stale tickets. Clears all printers when no name is given.
 * QZ's clearQueue requires a printer name, so "all" enumerates and clears each. */
export async function clearQzPrinterQueue(printerName?: string): Promise<void> {
  const client = getQzClient()
  await connectQzTray()

  const trimmed = printerName?.trim()
  if (trimmed) {
    await client.printers.clearQueue({ printerName: trimmed })
    return
  }

  const printers = await listQzTrayPrinters()
  if (printers.length === 0) {
    return
  }

  // Clear each queue independently so one failing printer does not abort the rest.
  await Promise.all(
    printers.map((name) => client.printers.clearQueue({ printerName: name }).catch(() => undefined)),
  )
}

export async function printKitchenTicketWithQzTray(ticket: KitchenTicket, settings: ThermalPrinterSettings): Promise<void> {
  const client = getQzClient()

  // Serial target (e.g. Bluetooth outgoing COM): QZ owns the connection and keeps
  // it open between prints, so there is no per-print redial. Bypasses the spooler,
  // so the stale-queue problem cannot occur either.
  if (settings.qzTargetType === 'serial') {
    const serialPort = settings.qzSerialPort.trim()

    if (!serialPort) {
      throw new QzTrayError('no-printer', 'Choose a serial/Bluetooth COM port in Kitchen printer settings before printing.')
    }

    await connectQzTray()

    const baudRate = settings.serialBaudRate || defaultThermalPrinterSettings.serialBaudRate
    const payload = buildEscPosKitchenTicket(ticket, settings)
    const sendOnce = async () => {
      await ensureQzSerialPortOpen(client, serialPort, baudRate, settings.qzEncoding)
      await client.serial.sendData(serialPort, payload)
    }

    try {
      await sendOnce()
    } catch {
      // A kept-alive Bluetooth/serial link goes dead after the printer sleeps or
      // drifts out of range, but our bookkeeping still thinks the port is open —
      // so the FIRST print after an idle gap writes into a dead connection. Reset
      // the handle, re-dial, and retry once so that first ticket still prints
      // instead of being lost (subsequent prints reuse the fresh link).
      openQzSerialPorts.delete(serialPort)
      await client.serial.closePort(serialPort).catch(() => undefined)
      await new Promise((resolve) => window.setTimeout(resolve, 400))

      try {
        await sendOnce()
      } catch (retryError) {
        openQzSerialPorts.delete(serialPort)
        await client.serial.closePort(serialPort).catch(() => undefined)
        throw new QzTrayError(
          'print-failed',
          retryError instanceof Error ? retryError.message : 'The QZ serial print request failed.',
          { cause: retryError },
        )
      }
    }
    return
  }

  // Network target (RAW host:port, typically 9100): bypasses OS drivers entirely;
  // a dead socket rejects immediately, so no spooler pile-up either.
  if (settings.qzTargetType === 'network') {
    const networkHost = settings.qzNetworkHost.trim()

    if (!networkHost) {
      throw new QzTrayError('no-printer', 'Enter the network printer IP in Kitchen printer settings before printing.')
    }

    await connectQzTray('network-print')

    const networkPort = settings.qzNetworkPort || defaultThermalPrinterSettings.qzNetworkPort
    const payload = buildEscPosKitchenTicket(ticket, settings)
    const printStartedAt = Date.now()

    // Queued so this printer only ever has one connection open at a time — see
    // enqueueNetworkPrint's comment for why that matters on cheap hardware.
    await enqueueNetworkPrint(networkHost, networkPort, async () => {
      const target = `${networkHost}:${networkPort}`
      const previousPrintResolvedAt = lastNetworkPrintResolvedAt.get(target)
      let reusedConnection = false
      recordPrinterDiagnostic('qz_network_print_started', {
        orderNumber: ticket.orderNumber,
        target,
        payloadBytes: new TextEncoder().encode(payload).byteLength,
        idleBeforePrintMs: previousPrintResolvedAt === undefined ? null : Date.now() - previousPrintResolvedAt,
        idleSinceTicketCreatedMs: Math.max(Date.now() - ticket.createdAt.getTime(), 0),
      })

      const sendOnce = async () => {
        reusedConnection = await ensureQzNetworkSocketOpen(
          client,
          networkHost,
          networkPort,
          settings.qzEncoding,
        )
        await qzSocketCallAsPromise(() =>
          (client.socket.sendData as (host: string, port: number, data: string) => unknown)(
            networkHost,
            networkPort,
            payload,
          ),
        )
      }

      try {
        await sendOnce()
      } catch (firstError) {
        recordPrinterDiagnostic('qz_network_socket_reconnecting', {
          orderNumber: ticket.orderNumber,
          target,
          message: firstError instanceof Error ? firstError.message : String(firstError),
        })
        await closeQzNetworkSocket(client, networkHost, networkPort)
        await new Promise((resolve) => window.setTimeout(resolve, 1_000))
        await sendOnce()
      }

      lastNetworkPrintResolvedAt.set(target, Date.now())
      recordPrinterDiagnostic('qz_network_print_resolved', {
        orderNumber: ticket.orderNumber,
        target,
        durationMs: Date.now() - printStartedAt,
        reusedConnection,
      })
    }).catch((error: unknown) => {
      recordPrinterDiagnostic('qz_network_print_failed', {
        orderNumber: ticket.orderNumber,
        target: `${networkHost}:${networkPort}`,
        durationMs: Date.now() - printStartedAt,
        message: error instanceof Error ? error.message : String(error),
      })
      throw new QzTrayError(
        'print-failed',
        error instanceof Error ? error.message : 'The QZ network print request failed.',
        { cause: error },
      )
    })
    return
  }

  // System printer target: goes through the OS spooler, which happily queues jobs
  // while the printer is offline/out of paper and replays them all on recovery.
  // Gate on live status so a dead printer means "not queued" instead of "queued
  // silently".
  const printerName = settings.qzPrinterName.trim()

  if (!printerName) {
    throw new QzTrayError('no-printer', 'Choose a QZ Tray printer in Kitchen printer settings before printing.')
  }

  await connectQzTray('system-print')

  const health = await checkQzPrinterHealth(printerName)
  if (!health.ok) {
    throw new QzTrayError(
      'printer-unavailable',
      `Printer "${printerName}" reports ${health.status}. The ticket was NOT queued — fix the printer, use Clear queue if jobs piled up, then print again.`,
    )
  }

  try {
    const config = client.configs.create(printerName, {
      jobName: `Kitchen ${ticket.orderNumber}`,
      encoding: settings.qzEncoding,
    })
    await client.print(config, [buildEscPosKitchenTicket(ticket, settings)])
  } catch (error) {
    throw new QzTrayError(
      'print-failed',
      error instanceof Error ? error.message : 'The QZ Tray print request failed.',
      { cause: error },
    )
  }
}

function describeSerialPort(port: SerialPortLike): string {
  const info = port.getInfo?.()

  if (info?.usbVendorId) {
    const product = info.usbProductId ? `:${formatUsbId(info.usbProductId)}` : ''
    return `USB serial ${formatUsbId(info.usbVendorId)}${product}`
  }

  return 'Serial port'
}

export type SerialProbeResult = 'responded' | 'silent' | 'open-failed' | 'skipped'

export type SelectedSerialPort = { label: string; probe: SerialProbeResult }

// The port picked via Select port this session. Preferred over getPorts()[0] so
// stale grants (e.g. a Bluetooth incoming port picked by mistake) cannot hijack prints.
let preferredSerialPort: SerialPortLike | null = null

type WebSerialSession = {
  port: SerialPortLike
  writer: WritableStreamDefaultWriter<Uint8Array>
  baudRate: number
}

// Keep-alive session: the port stays open between prints (one Bluetooth dial-up,
// then instant silent prints; the module cannot idle-sleep while connected).
// Stored on globalThis so a Vite HMR module swap cannot orphan an open port —
// an orphan would block every later open with InvalidStateError.
const webSerialStore = globalThis as typeof globalThis & { __dineflowSerialSession?: WebSerialSession | null }

/** Release the keep-alive Web Serial port so another owner (e.g. QZ Tray) can
 * open the same COM port. A COM port allows only one holder at a time. */
export async function releaseWebSerialSession(): Promise<void> {
  await teardownWebSerialSession()
}

async function teardownWebSerialSession(): Promise<void> {
  const session = webSerialStore.__dineflowSerialSession
  if (!session) {
    return
  }
  webSerialStore.__dineflowSerialSession = null

  try {
    session.writer.releaseLock()
  } catch {
    // Already released.
  }
  await session.port.close().catch(() => undefined)
}

/** Verify a picked port actually reaches a printer: open it, send the ESC/POS
 * real-time status request (DLE EOT 1) and wait briefly for a reply byte.
 * - `responded`: printer answered — definitely the right port.
 * - `silent`: port opened but nothing answered — typical for a Bluetooth
 *   *incoming* port or a printer that ignores DLE EOT.
 * - `open-failed`: the port cannot even be opened (e.g. Chrome's direct
 *   Bluetooth entry when Windows owns the SPP channel). */
async function probeSerialPort(port: SerialPortLike, baudRate: number): Promise<SerialProbeResult> {
  try {
    await port.open({ baudRate })
  } catch {
    return 'open-failed'
  }

  try {
    const writer = port.writable?.getWriter()
    if (!writer) {
      return 'silent'
    }
    try {
      await writer.write(new Uint8Array([0x10, 0x04, 0x01]))
    } finally {
      writer.releaseLock()
    }

    const reader = port.readable?.getReader()
    if (!reader) {
      return 'silent'
    }
    try {
      return await Promise.race([
        reader
          .read()
          .then((result): SerialProbeResult => (result.value && result.value.length > 0 ? 'responded' : 'silent')),
        new Promise<SerialProbeResult>((resolve) => {
          window.setTimeout(() => resolve('silent'), 1_500)
        }),
      ])
    } finally {
      await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
  } catch {
    return 'silent'
  } finally {
    await port.close().catch(() => undefined)
  }
}

/** Ask the browser for a serial port (native picker, requires a user gesture),
 * then probe it so the user learns immediately whether a printer answers there.
 * Bluetooth SPP printers paired with the OS show up as virtual COM ports — the
 * usable one is the *outgoing* port. A cancelled picker rejects with a
 * DOMException named `NotFoundError`. */
export async function selectWebSerialPort(
  baudRate?: number,
  options?: { probe?: boolean },
): Promise<SelectedSerialPort> {
  const serial = (navigator as SerialNavigator).serial

  if (!serial) {
    throw new Error('Web Serial is not available in this browser. Use Chrome or Edge over HTTPS or localhost.')
  }

  const port = await serial.requestPort()

  // A new choice replaces any live keep-alive session so the next print dials
  // the newly selected port instead of writing into the old one.
  await teardownWebSerialSession()

  // Probing (open + DLE EOT + read + close) is opt-in: the rapid open/close
  // cycle appears to wedge some cheap Bluetooth printer modules until they are
  // power-cycled, so by default selection only grants and remembers the port.
  if (!options?.probe) {
    preferredSerialPort = port
    return { label: describeSerialPort(port), probe: 'skipped' }
  }

  const probe = await probeSerialPort(port, baudRate || defaultThermalPrinterSettings.serialBaudRate)
  preferredSerialPort = probe === 'open-failed' ? null : port

  return { label: describeSerialPort(port), probe }
}

/** Open (or reuse) the keep-alive Web Serial session. `allowPicker` is false for
 * the background keep-alive so it never pops the port chooser on its own. */
async function ensureWebSerialSession(baudRate: number, allowPicker: boolean): Promise<WebSerialSession | null> {
  const serial = (navigator as SerialNavigator).serial
  if (!serial) {
    throw new Error('Web Serial is not available in this browser. Use Chrome or Edge over HTTPS or localhost.')
  }

  let session = webSerialStore.__dineflowSerialSession ?? null

  // A changed baud rate needs a fresh connection.
  if (session && session.baudRate !== baudRate) {
    await teardownWebSerialSession()
    session = null
  }
  if (session) {
    return session
  }

  // Prefer the port verified via Select port this session, then any previously
  // granted port; only fall back to the picker (a user gesture) when printing.
  const grantedPorts = serial.getPorts ? await serial.getPorts() : []
  const port = preferredSerialPort ?? grantedPorts[0] ?? (allowPicker ? await serial.requestPort() : null)
  if (!port) {
    return null
  }

  try {
    await port.open({ baudRate })
  } catch (error) {
    // Already open (e.g. a session orphaned by a dev hot-reload): reuse it.
    const alreadyOpen = error instanceof DOMException && error.name === 'InvalidStateError' && port.writable
    if (!alreadyOpen) {
      throw error
    }
  }

  const writer = port.writable?.getWriter()
  if (!writer) {
    await port.close().catch(() => undefined)
    throw new Error('Selected serial port is not writable.')
  }

  session = { port, writer, baudRate }
  webSerialStore.__dineflowSerialSession = session
  return session
}

/** Open the selected/granted Web Serial port, send one non-printing status
 * request, and keep the successful session open for later tickets. */
export async function testWebSerialConnection(
  baudRate = defaultThermalPrinterSettings.serialBaudRate,
): Promise<{ label: string }> {
  const startedAt = Date.now()
  recordPrinterDiagnostic('web_serial_test_started', { baudRate })

  try {
    const session = await ensureWebSerialSession(baudRate, true)
    if (!session) {
      throw new Error('No serial printer selected. Choose a port first.')
    }

    await session.writer.write(new Uint8Array([0x10, 0x04, 0x01]))
    preferredSerialPort = session.port
    const label = describeSerialPort(session.port)
    recordPrinterDiagnostic('web_serial_test_succeeded', {
      baudRate,
      label,
      durationMs: Date.now() - startedAt,
      keptOpen: true,
    })
    return { label }
  } catch (error) {
    await teardownWebSerialSession()
    recordPrinterDiagnostic('web_serial_test_failed', {
      baudRate,
      durationMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

export async function printKitchenTicketWithWebSerial(ticket: KitchenTicket, settings: ThermalPrinterSettings): Promise<void> {
  const baudRate = settings.serialBaudRate || defaultThermalPrinterSettings.serialBaudRate
  const session = await ensureWebSerialSession(baudRate, true)
  if (!session) {
    throw new Error('No serial printer connected. Use "Select port" in the Web Serial card first.')
  }

  try {
    await session.writer.write(encodeEscPosKitchenTicket(ticket, settings))
  } catch (error) {
    // The link died (printer slept, went out of range, or powered off). Tear the
    // session down so the next print dials a fresh connection instead of writing
    // into a dead pipe forever.
    await teardownWebSerialSession()

    const detail = error instanceof Error && error.message ? ` (${error.message})` : ''
    throw new Error(
      `Serial write failed${detail}. The connection was reset — print again to reconnect.`,
      { cause: error },
    )
  }
}

let webSerialKeepAliveTimer: number | null = null

/** Keep the Web Serial link warm so the printer's serial/Bluetooth module cannot
 * idle-sleep between prints (which otherwise makes the first print after a long
 * gap fail). Periodically writes a no-op ESC/POS init (ESC @ — resets state,
 * prints nothing). Never opens the port chooser; if the link is dead it tears
 * the session down so the next print re-dials. `getBaudRate` reads the current
 * setting each tick without recreating the timer. */
export function startWebSerialKeepAlive(getBaudRate: () => number, intervalMs = 20_000): void {
  stopWebSerialKeepAlive()
  webSerialKeepAliveTimer = window.setInterval(() => {
    void (async () => {
      try {
        const session = await ensureWebSerialSession(getBaudRate(), false)
        if (!session) return
        await session.writer.write(new Uint8Array([0x1b, 0x40])) // ESC @ — no output
      } catch {
        // Link is gone; reset so the next print re-dials a fresh connection.
        await teardownWebSerialSession()
      }
    })()
  }, intervalMs)
}

export function stopWebSerialKeepAlive(): void {
  if (webSerialKeepAliveTimer !== null) {
    window.clearInterval(webSerialKeepAliveTimer)
    webSerialKeepAliveTimer = null
  }
}

// ---------------------------------------------------------------------------
// Web Bluetooth (BLE) route. Classic-Bluetooth SPP is covered by the serial
// routes; this one is for dual-mode/BLE printer modules. The writable GATT
// characteristic is discovered dynamically, so common vendor conventions
// (0x18F0/0x2AF1, FFE0, ISSC transparent UART, Nordic UART…) all work.
// ---------------------------------------------------------------------------

type BleCharacteristicLike = {
  uuid: string
  properties: { write?: boolean; writeWithoutResponse?: boolean }
  writeValue?: (data: Uint8Array) => Promise<void>
  writeValueWithResponse?: (data: Uint8Array) => Promise<void>
  writeValueWithoutResponse?: (data: Uint8Array) => Promise<void>
}

type BleServiceLike = {
  uuid: string
  getCharacteristics: () => Promise<BleCharacteristicLike[]>
}

type BleGattLike = {
  connected: boolean
  connect: () => Promise<BleGattLike>
  disconnect: () => void
  getPrimaryServices: () => Promise<BleServiceLike[]>
}

type BleDeviceLike = {
  name?: string
  gatt?: BleGattLike
  addEventListener?: (type: string, listener: () => void) => void
}

type BluetoothNavigator = Navigator & {
  bluetooth?: {
    requestDevice: (options: {
      acceptAllDevices?: boolean
      optionalServices?: Array<string | number>
    }) => Promise<BleDeviceLike>
    getDevices?: () => Promise<BleDeviceLike[]>
  }
}

/** GATT services we request access to — covers the ESC/POS-over-BLE conventions
 * used by the vast majority of thermal printer modules. */
const bleCandidateServices: Array<string | number> = [
  0x18f0,
  0xffe0,
  0xff00,
  0xffb0,
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC/Microchip transparent UART
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // common Chinese printer module
]

/** BLE writes are MTU-limited; 180 bytes stays under every common negotiation. */
const bleChunkSize = 180

type BleSession = {
  device: BleDeviceLike
  characteristic: BleCharacteristicLike
  deviceName: string
}

// Keep-alive GATT session (BLE reconnects are slow). Survives HMR via globalThis.
const bleStore = globalThis as typeof globalThis & { __dineflowBleSession?: BleSession | null }

function clearBleSession(): void {
  bleStore.__dineflowBleSession = null
}

async function connectBleDevice(device: BleDeviceLike): Promise<BleSession> {
  if (!device.gatt) {
    throw new Error('The selected Bluetooth device does not expose a GATT server.')
  }

  const server = await device.gatt.connect()
  const services = await server.getPrimaryServices()

  let withResponse: BleCharacteristicLike | null = null
  let withoutResponse: BleCharacteristicLike | null = null

  for (const service of services) {
    const characteristics = await service.getCharacteristics().catch(() => [] as BleCharacteristicLike[])
    for (const characteristic of characteristics) {
      if (characteristic.properties.write && !withResponse) {
        withResponse = characteristic
      } else if (characteristic.properties.writeWithoutResponse && !withoutResponse) {
        withoutResponse = characteristic
      }
    }
  }

  // Prefer write-with-response: it self-paces, so the module buffer cannot overflow.
  const characteristic = withResponse ?? withoutResponse

  if (!characteristic) {
    device.gatt.disconnect()
    throw new Error('No writable characteristic found — this device may not accept raw ESC/POS over BLE.')
  }

  const session: BleSession = {
    device,
    characteristic,
    deviceName: device.name?.trim() || 'BLE printer',
  }

  device.addEventListener?.('gattserverdisconnected', clearBleSession)
  bleStore.__dineflowBleSession = session
  return session
}

/** Pick a BLE printer via the browser's device chooser (requires a user gesture),
 * connect, and discover its writable characteristic. Returns the device name for
 * settings/UI. A cancelled chooser rejects with DOMException `NotFoundError`. */
export async function selectWebBluetoothPrinter(): Promise<string> {
  const bluetooth = (navigator as BluetoothNavigator).bluetooth

  if (!bluetooth) {
    throw new Error('Web Bluetooth is not available in this browser. Use Chrome or Edge (not supported on iOS).')
  }

  clearBleSession()

  const device = await bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: bleCandidateServices,
  })

  const session = await connectBleDevice(device)
  return session.deviceName
}

async function writeBleChunk(characteristic: BleCharacteristicLike, chunk: Uint8Array): Promise<void> {
  if (characteristic.properties.write) {
    await (characteristic.writeValueWithResponse ?? characteristic.writeValue)?.call(characteristic, chunk)
    return
  }

  await (characteristic.writeValueWithoutResponse ?? characteristic.writeValue)?.call(characteristic, chunk)
  // Without link-layer acknowledgement pacing, give the module buffer breathing room.
  await new Promise((resolve) => window.setTimeout(resolve, 30))
}

export async function printKitchenTicketWithWebBluetooth(ticket: KitchenTicket, settings: ThermalPrinterSettings): Promise<void> {
  const bluetooth = (navigator as BluetoothNavigator).bluetooth

  if (!bluetooth) {
    throw new Error('Web Bluetooth is not available in this browser. Use Chrome or Edge (not supported on iOS).')
  }

  let session = bleStore.__dineflowBleSession ?? null

  if (session && session.device.gatt && !session.device.gatt.connected) {
    session = null
    clearBleSession()
  }

  if (!session) {
    // Silent reconnect to a previously granted device (no picker, no gesture).
    const knownDevices = bluetooth.getDevices ? await bluetooth.getDevices() : []
    const preferredName = settings.bleDeviceName.trim()
    const match =
      knownDevices.find((device) => preferredName && device.name === preferredName)
      ?? (knownDevices.length === 1 ? knownDevices[0] : undefined)

    if (!match) {
      throw new Error('No Bluetooth printer connected. Use "Select printer" in the Web Bluetooth card first.')
    }

    session = await connectBleDevice(match)
  }

  const payload = encodeEscPosKitchenTicket(ticket, settings)

  try {
    for (let offset = 0; offset < payload.byteLength; offset += bleChunkSize) {
      await writeBleChunk(session.characteristic, payload.slice(offset, offset + bleChunkSize))
    }
  } catch (error) {
    // The link died mid-job. Drop the session so the next print reconnects fresh.
    try {
      session.device.gatt?.disconnect()
    } catch {
      // Best-effort teardown.
    }
    clearBleSession()

    const detail = error instanceof Error && error.message ? ` (${error.message})` : ''
    throw new Error(
      `Bluetooth write failed${detail}. The connection was reset — print again to reconnect.`,
      { cause: error },
    )
  }
}

/** Settings values discovered from a user-picked USB device, plus a display label. */
export type DetectedWebUsbPrinter = {
  vendorId: string
  productId: string
  interfaceNumber: number
  endpointNumber: number
  label: string
}

/** Open the browser's native USB device picker (requires a user gesture), then
 * inspect the chosen device to find the interface and bulk-OUT endpoint used for
 * ESC/POS data. Returns ready-to-store settings so nobody has to type hex IDs.
 * A cancelled picker rejects with a DOMException named `NotFoundError`. */
export async function detectWebUsbPrinter(): Promise<DetectedWebUsbPrinter> {
  const usb = (navigator as UsbNavigator).usb

  if (!usb) {
    throw new Error('WebUSB is not available in this browser. Use Chrome or Edge over HTTPS or localhost.')
  }

  const device = await usb.requestDevice({ filters: [{}] })
  const label = [device.manufacturerName, device.productName].filter(Boolean).join(' ') || 'USB device'

  let interfaceNumber = defaultThermalPrinterSettings.usbInterfaceNumber
  let endpointNumber = defaultThermalPrinterSettings.usbEndpointNumber

  try {
    if (!device.opened) {
      await device.open()
    }
    if (!device.configuration) {
      await device.selectConfiguration(1)
    }

    const bulkOut = findBulkOutEndpoint(device)
    if (bulkOut) {
      interfaceNumber = bulkOut.interfaceNumber
      endpointNumber = bulkOut.endpointNumber
    }
  } catch {
    // Could not open/inspect the device (e.g. an OS driver holds it) — keep the
    // defaults; vendor/product IDs are still read without opening.
  } finally {
    await device.close().catch(() => undefined)
  }

  return {
    vendorId: formatUsbId(device.vendorId),
    productId: formatUsbId(device.productId),
    interfaceNumber,
    endpointNumber,
    label,
  }
}

function findBulkOutEndpoint(device: UsbDeviceLike): { interfaceNumber: number; endpointNumber: number } | null {
  let fallback: { interfaceNumber: number; endpointNumber: number } | null = null

  for (const usbInterface of device.configuration?.interfaces ?? []) {
    for (const alternate of usbInterface.alternates) {
      for (const endpoint of alternate.endpoints) {
        if (endpoint.direction !== 'out') continue

        const found = {
          interfaceNumber: usbInterface.interfaceNumber,
          endpointNumber: endpoint.endpointNumber,
        }
        if (endpoint.type === 'bulk') {
          return found
        }
        fallback = fallback ?? found
      }
    }
  }

  return fallback
}

function formatUsbId(value: number): string {
  return `0x${value.toString(16).padStart(4, '0')}`
}

function getWebUsbAccessError(error: unknown): Error {
  const detail = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  if (/access denied|securityerror|unable to claim|protected.*class|networkerror/i.test(detail)) {
    return new Error(
      'The operating system driver is holding this printer, so the browser cannot access it over WebUSB. '
      + 'This is expected when the device is installed as a system printer — use the QZ Tray route for it instead. '
      + '(Advanced: replacing its driver with WinUSB via Zadig enables WebUSB but removes it as a system printer.)',
    )
  }
  return error instanceof Error ? error : new Error(String(error))
}

/** Claim the configured USB interface and send one non-printing status request.
 * WebUSB releases the interface afterwards because the browser/OS USB stack is
 * designed around short exclusive claims rather than a background print daemon. */
export async function testWebUsbConnection(
  settings: ThermalPrinterSettings,
): Promise<{ label: string; interfaceNumber: number; endpointNumber: number }> {
  const usb = (navigator as UsbNavigator).usb
  if (!usb) {
    throw new Error('WebUSB is not available in this browser. Use Chrome or Edge over HTTPS or localhost.')
  }

  const vendorId = parseOptionalDeviceId(settings.usbVendorId, 'USB vendor ID')
  const productId = parseOptionalDeviceId(settings.usbProductId, 'USB product ID')
  const filter: { vendorId?: number; productId?: number } = {}
  if (vendorId !== undefined) filter.vendorId = vendorId
  if (productId !== undefined) filter.productId = productId
  const filters = Object.keys(filter).length > 0 ? [filter] : [{}]
  const grantedDevices = usb.getDevices ? await usb.getDevices() : []
  const grantedMatch = grantedDevices.find((candidate) =>
    (vendorId === undefined || candidate.vendorId === vendorId)
    && (productId === undefined || candidate.productId === productId))
  const device = grantedMatch ?? await usb.requestDevice({ filters })
  const label = [device.manufacturerName, device.productName].filter(Boolean).join(' ') || 'USB device'
  const interfaceNumber = Number.isFinite(settings.usbInterfaceNumber)
    ? Math.round(settings.usbInterfaceNumber)
    : defaultThermalPrinterSettings.usbInterfaceNumber
  const startedAt = Date.now()

  recordPrinterDiagnostic('web_usb_test_started', {
    label,
    vendorId: formatUsbId(device.vendorId),
    productId: formatUsbId(device.productId),
    interfaceNumber,
  })

  try {
    if (!device.opened) {
      await device.open()
    }
    if (!device.configuration) {
      await device.selectConfiguration(1)
    }
    await device.claimInterface(interfaceNumber)
    const endpointNumber = getUsbEndpointNumber(device, interfaceNumber, settings.usbEndpointNumber)
    await device.transferOut(endpointNumber, new Uint8Array([0x10, 0x04, 0x01]))
    recordPrinterDiagnostic('web_usb_test_succeeded', {
      label,
      vendorId: formatUsbId(device.vendorId),
      productId: formatUsbId(device.productId),
      interfaceNumber,
      endpointNumber,
      durationMs: Date.now() - startedAt,
    })
    return { label, interfaceNumber, endpointNumber }
  } catch (error) {
    const actionableError = getWebUsbAccessError(error)
    recordPrinterDiagnostic('web_usb_test_failed', {
      label,
      vendorId: formatUsbId(device.vendorId),
      productId: formatUsbId(device.productId),
      interfaceNumber,
      durationMs: Date.now() - startedAt,
      message: actionableError.message,
    })
    throw actionableError
  } finally {
    await device.releaseInterface(interfaceNumber).catch(() => undefined)
    await device.close().catch(() => undefined)
  }
}

export async function printKitchenTicketWithWebUsb(ticket: KitchenTicket, settings: ThermalPrinterSettings): Promise<void> {
  const usb = (navigator as UsbNavigator).usb

  if (!usb) {
    throw new Error('WebUSB is not available in this browser. Use Chrome or Edge over HTTPS or localhost.')
  }

  const vendorId = parseOptionalDeviceId(settings.usbVendorId, 'USB vendor ID')
  const productId = parseOptionalDeviceId(settings.usbProductId, 'USB product ID')
  const filter: { vendorId?: number; productId?: number } = {}
  if (vendorId !== undefined) filter.vendorId = vendorId
  if (productId !== undefined) filter.productId = productId
  const filters = Object.keys(filter).length > 0 ? [filter] : [{}]

  // Prefer a device this browser has already been granted — silent, no picker.
  const grantedDevices = usb.getDevices ? await usb.getDevices() : []
  const grantedMatch = grantedDevices.find((candidate) =>
    (vendorId === undefined || candidate.vendorId === vendorId)
    && (productId === undefined || candidate.productId === productId))

  const device = grantedMatch ?? await usb.requestDevice({ filters })
  const interfaceNumber = Number.isFinite(settings.usbInterfaceNumber) ? settings.usbInterfaceNumber : 0

  try {
    if (!device.opened) {
      await device.open()
    }

    if (!device.configuration) {
      await device.selectConfiguration(1)
    }

    await device.claimInterface(interfaceNumber)
  } catch (error) {
    // On Windows, "Access denied" / claim failures mean the OS printer driver owns
    // the device — the exact setup where the printer shows up as a system printer.
    // Translate the raw DOMException into actionable guidance.
    throw getWebUsbAccessError(error)
  }

  try {
    const endpointNumber = getUsbEndpointNumber(device, interfaceNumber, settings.usbEndpointNumber)
    const payload = encodeEscPosKitchenTicket(ticket, settings)

    for (let offset = 0; offset < payload.byteLength; offset += 64) {
      await device.transferOut(endpointNumber, payload.slice(offset, offset + 64))
    }
  } finally {
    await device.releaseInterface(interfaceNumber).catch(() => undefined)
    await device.close().catch(() => undefined)
  }
}

export function readStoredThermalPrinterSettings(): ThermalPrinterSettings {
  return readStoredPrinterSettings('dineflow.thermalPrinterSettings')
}

export function readStoredFrontCounterPrinterSettings(): ThermalPrinterSettings {
  return readStoredPrinterSettings('dineflow.frontCounterPrinterSettings')
}

function readStoredPrinterSettings(storageKey: string): ThermalPrinterSettings {
  if (typeof window === 'undefined') {
    return { ...defaultThermalPrinterSettings }
  }

  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return { ...defaultThermalPrinterSettings }
    const stored = JSON.parse(raw) as Partial<ThermalPrinterSettings>

    // Migration: settings saved before the QZ connection-type dropdown carry no
    // qzTargetType — infer it from whichever target field was in use.
    if (!('qzTargetType' in stored)) {
      stored.qzTargetType = stored.qzSerialPort?.trim()
        ? 'serial'
        : stored.qzNetworkHost?.trim()
          ? 'network'
          : 'printer'
    }

    return normalizePrinterSettings({ ...defaultThermalPrinterSettings, ...stored })
  } catch {
    return { ...defaultThermalPrinterSettings }
  }
}

export function storeThermalPrinterSettings(settings: ThermalPrinterSettings): void {
  window.localStorage.setItem('dineflow.thermalPrinterSettings', JSON.stringify(normalizePrinterSettings(settings)))
}

export function storeFrontCounterPrinterSettings(settings: ThermalPrinterSettings): void {
  window.localStorage.setItem(
    'dineflow.frontCounterPrinterSettings',
    JSON.stringify(normalizePrinterSettings({ ...settings, autoPrintNewOrders: false })),
  )
}

function normalizePrinterSettings(settings: ThermalPrinterSettings): ThermalPrinterSettings {
  return {
    ...defaultThermalPrinterSettings,
    ...settings,
    mode: ['browser', 'qz-tray', 'web-serial', 'web-usb', 'web-bluetooth'].includes(settings.mode)
      ? settings.mode
      : defaultThermalPrinterSettings.mode,
    paperWidth: settings.paperWidth === '58mm' ? '58mm' : '80mm',
    beepOnPrint: settings.beepOnPrint === true,
    autoPrintNewOrders: settings.autoPrintNewOrders === true,
    qzTargetType: ['printer', 'network', 'serial'].includes(settings.qzTargetType)
      ? settings.qzTargetType
      : defaultThermalPrinterSettings.qzTargetType,
    qzEncoding: ['UTF-8', 'GBK', 'GB2312', 'CP1252', 'ISO-8859-1'].includes(settings.qzEncoding)
      ? settings.qzEncoding
      : defaultThermalPrinterSettings.qzEncoding,
    qzNetworkHost: typeof settings.qzNetworkHost === 'string' ? settings.qzNetworkHost.trim() : '',
    qzNetworkPort: Number.isFinite(settings.qzNetworkPort) && settings.qzNetworkPort >= 1
      ? Math.round(settings.qzNetworkPort)
      : defaultThermalPrinterSettings.qzNetworkPort,
    qzSerialPort: typeof settings.qzSerialPort === 'string' ? settings.qzSerialPort.trim() : '',
    bleDeviceName: typeof settings.bleDeviceName === 'string' ? settings.bleDeviceName.trim() : '',
    serialBaudRate: Number.isFinite(settings.serialBaudRate) && settings.serialBaudRate > 0
      ? Math.round(settings.serialBaudRate)
      : defaultThermalPrinterSettings.serialBaudRate,
    usbInterfaceNumber: Number.isFinite(settings.usbInterfaceNumber) && settings.usbInterfaceNumber >= 0
      ? Math.round(settings.usbInterfaceNumber)
      : defaultThermalPrinterSettings.usbInterfaceNumber,
    usbEndpointNumber: Number.isFinite(settings.usbEndpointNumber) && settings.usbEndpointNumber >= 1
      ? Math.round(settings.usbEndpointNumber)
      : defaultThermalPrinterSettings.usbEndpointNumber,
  }
}

function getTicketOrderScope(order: AdminOrder): string {
  const orderType = order.orderType === 'DineIn'
    ? 'Dine in'
    : order.orderType === 'Takeaway'
      ? 'Takeaway'
      : order.orderType

  return order.tableNumber ? `${orderType} - Table ${order.tableNumber}` : orderType
}

function groupTicketOptions(item: AdminOrder['items'][number]): KitchenTicket['items'][number]['optionGroups'] {
  const grouped = new Map<string, string[]>()

  for (const option of item.selectedOptions ?? []) {
    const groupName = option.groupNameSnapshot || 'Options'
    const quantity = option.quantity ?? 1
    const label = `${option.optionNameSnapshot}${quantity > 1 ? ` x${quantity}` : ''}`
    grouped.set(groupName, [...(grouped.get(groupName) ?? []), label])
  }

  return Array.from(grouped, ([groupName, options]) => ({ groupName, options }))
}

function twoColumn(label: string, value: string, columns: number): string {
  const left = label.toUpperCase()
  const right = value.trim()
  const gap = Math.max(1, columns - left.length - right.length)
  return `${left}${' '.repeat(gap)}${right}`
}

function wrapText(value: string, columns: number): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''

  for (const word of words) {
    if (!line) {
      line = word
      continue
    }

    if (`${line} ${word}`.length <= columns) {
      line = `${line} ${word}`
    } else {
      lines.push(line)
      line = word
    }
  }

  if (line) lines.push(line)
  return lines.length > 0 ? lines : ['']
}

function formatTicketDateTime(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
}

function parseOptionalDeviceId(value: string, label: string): number | undefined {
  const normalized = value.trim()
  if (!normalized) return undefined

  const stripped = normalized.replace(/^0x/i, '')
  const parsed = normalized.toLowerCase().startsWith('0x') || /[a-f]/i.test(stripped)
    ? Number.parseInt(stripped, 16)
    : Number.parseInt(normalized, 10)

  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a decimal or hex number.`)
  }

  return parsed
}

function getUsbEndpointNumber(device: UsbDeviceLike, interfaceNumber: number, configuredEndpointNumber: number): number {
  if (Number.isFinite(configuredEndpointNumber) && configuredEndpointNumber > 0) {
    return Math.round(configuredEndpointNumber)
  }

  const selectedInterface = device.configuration?.interfaces.find((item) => item.interfaceNumber === interfaceNumber)
  const outEndpoint = selectedInterface?.alternates
    .flatMap((alternate) => alternate.endpoints)
    .find((endpoint) => endpoint.direction === 'out')

  if (!outEndpoint) {
    throw new Error('Could not find an OUT endpoint for the selected USB interface.')
  }

  return outEndpoint.endpointNumber
}
