import qz from 'qz-tray'
import { getStoredToken, type AdminOrder } from '@/api/auth'

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

/** Official QZ Tray download page. Linked from the printer settings panel so staff
 * can install the desktop app. We link out rather than self-host the installer
 * (QZ Tray is separately licensed and versioned). */
export const QZ_TRAY_DOWNLOAD_URL = 'https://qz.io/download/'

export type ThermalPrinterMode = 'browser' | 'qz-tray' | 'web-serial' | 'web-usb'
export type ThermalPaperWidth = '58mm' | '80mm'

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
  qzPrinterName: string
  /** Optional QZ network target: when set, tickets go straight to host:port
   * (RAW/9100) over the LAN — no OS printer driver needed; printer name is ignored. */
  qzNetworkHost: string
  qzNetworkPort: number
  serialBaudRate: number
  usbVendorId: string
  usbProductId: string
  usbInterfaceNumber: number
  usbEndpointNumber: number
}

export type KitchenTicket = {
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
  qzPrinterName: '',
  qzNetworkHost: '',
  qzNetworkPort: 9100,
  serialBaudRate: 9600,
  usbVendorId: '',
  usbProductId: '',
  usbInterfaceNumber: 0,
  usbEndpointNumber: 1,
}

export function createKitchenTicket(order: AdminOrder, printedAt = new Date()): KitchenTicket {
  return {
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
    escposSizeDouble + ticket.orderNumber + escposSizeNormal,
    ticket.restaurantName,
    escposReverseOn + escposBoldOn + ` ${ticket.orderScope.toUpperCase()} ` + escposBoldOff + escposReverseOff + escposAlignLeft,
    separator,
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
export type QzTrayErrorReason = 'not-loaded' | 'not-running' | 'no-printer' | 'print-failed'

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
    const token = getStoredToken()

    fetch(`${apiBaseUrl}/api/print/sign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ request: dataToSign }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Signing request failed with HTTP ${response.status}`)
        }
        return response.json() as Promise<{ signature?: string }>
      })
      .then((payload) => resolve(payload.signature ?? ''))
      // Fall back to an unsigned request: QZ prompts instead of failing the print.
      .catch(() => resolve(''))
  })
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

/** Open a QZ Tray connection if one is not already active. Throws a typed
 * {@link QzTrayError} with reason `not-running` when the desktop app cannot be reached. */
export async function connectQzTray(): Promise<void> {
  const client = getQzClient()
  configureQzSecurity(client)

  if (client.websocket.isActive()) {
    rememberQzTrayConnected()
    return
  }

  try {
    await client.websocket.connect()
    rememberQzTrayConnected()
  } catch (error) {
    throw new QzTrayError(
      'not-running',
      'Could not reach QZ Tray. Make sure the QZ Tray desktop app is installed and running.',
      { cause: error },
    )
  }
}

/** Close the QZ Tray connection if open. Never throws. */
export async function disconnectQzTray(): Promise<void> {
  try {
    const client = getQzClient()
    if (client.websocket.isActive()) {
      await client.websocket.disconnect()
    }
  } catch {
    // Best-effort teardown; ignore failures.
  }
}

/** Probe QZ Tray availability for the settings status indicator. Never throws.
 * Note: when not already connected this opens a connection (with the signed trust
 * chain when the backend is configured), which may show the QZ Tray allow-prompt
 * on unsigned setups — call it from an explicit user action. */
export async function probeQzTrayStatus(): Promise<QzTrayConnectionStatus> {
  try {
    await connectQzTray()
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

export async function printKitchenTicketWithQzTray(ticket: KitchenTicket, settings: ThermalPrinterSettings): Promise<void> {
  const client = getQzClient()
  const printerName = settings.qzPrinterName.trim()
  const networkHost = settings.qzNetworkHost.trim()

  if (!printerName && !networkHost) {
    throw new QzTrayError('no-printer', 'Choose a QZ Tray printer, or enter a network printer address, before printing.')
  }

  await connectQzTray()

  try {
    // A network target (RAW host:port, typically 9100) bypasses OS drivers entirely
    // and takes precedence over the printer name when configured.
    const target = networkHost
      ? { host: networkHost, port: String(settings.qzNetworkPort || defaultThermalPrinterSettings.qzNetworkPort) }
      : printerName
    const config = client.configs.create(target, { jobName: `Kitchen ${ticket.orderNumber}` })
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

/** Ask the browser for a serial port (native picker, requires a user gesture) so
 * later prints can reuse the grant silently. Bluetooth SPP printers paired with
 * the OS show up here as virtual COM ports. Returns a label for feedback.
 * A cancelled picker rejects with a DOMException named `NotFoundError`. */
export async function selectWebSerialPort(): Promise<string> {
  const serial = (navigator as SerialNavigator).serial

  if (!serial) {
    throw new Error('Web Serial is not available in this browser. Use Chrome or Edge over HTTPS or localhost.')
  }

  const port = await serial.requestPort()
  return describeSerialPort(port)
}

export async function printKitchenTicketWithWebSerial(ticket: KitchenTicket, settings: ThermalPrinterSettings): Promise<void> {
  const serial = (navigator as SerialNavigator).serial

  if (!serial) {
    throw new Error('Web Serial is not available in this browser. Use Chrome or Edge over HTTPS or localhost.')
  }

  // Reuse a previously granted port so repeat prints stay silent; only fall back
  // to the picker (which needs a user gesture) when nothing has been granted yet.
  const grantedPorts = serial.getPorts ? await serial.getPorts() : []
  const port = grantedPorts[0] ?? await serial.requestPort()
  await port.open({ baudRate: settings.serialBaudRate || defaultThermalPrinterSettings.serialBaudRate })

  const writer = port.writable?.getWriter()

  if (!writer) {
    await port.close().catch(() => undefined)
    throw new Error('Selected serial port is not writable.')
  }

  try {
    await writer.write(encodeEscPosKitchenTicket(ticket, settings))
  } finally {
    writer.releaseLock()
    await port.close().catch(() => undefined)
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
    const detail = error instanceof Error ? `${error.name} ${error.message}` : ''
    if (/access denied|securityerror|unable to claim|protected.*class|networkerror/i.test(detail)) {
      throw new Error(
        'The operating system driver is holding this printer, so the browser cannot access it over WebUSB. '
        + 'This is expected when the device is installed as a system printer — use the QZ Tray route for it instead. '
        + '(Advanced: replacing its driver with WinUSB via Zadig enables WebUSB but removes it as a system printer.)',
      )
    }
    throw error
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
  if (typeof window === 'undefined') {
    return defaultThermalPrinterSettings
  }

  try {
    const raw = window.localStorage.getItem('dineflow.thermalPrinterSettings')
    if (!raw) return defaultThermalPrinterSettings
    const stored = JSON.parse(raw) as Partial<ThermalPrinterSettings>
    return normalizePrinterSettings({ ...defaultThermalPrinterSettings, ...stored })
  } catch {
    return defaultThermalPrinterSettings
  }
}

export function storeThermalPrinterSettings(settings: ThermalPrinterSettings): void {
  window.localStorage.setItem('dineflow.thermalPrinterSettings', JSON.stringify(normalizePrinterSettings(settings)))
}

function normalizePrinterSettings(settings: ThermalPrinterSettings): ThermalPrinterSettings {
  return {
    ...defaultThermalPrinterSettings,
    ...settings,
    mode: ['browser', 'qz-tray', 'web-serial', 'web-usb'].includes(settings.mode)
      ? settings.mode
      : defaultThermalPrinterSettings.mode,
    paperWidth: settings.paperWidth === '58mm' ? '58mm' : '80mm',
    beepOnPrint: settings.beepOnPrint === true,
    autoPrintNewOrders: settings.autoPrintNewOrders === true,
    qzNetworkHost: typeof settings.qzNetworkHost === 'string' ? settings.qzNetworkHost.trim() : '',
    qzNetworkPort: Number.isFinite(settings.qzNetworkPort) && settings.qzNetworkPort >= 1
      ? Math.round(settings.qzNetworkPort)
      : defaultThermalPrinterSettings.qzNetworkPort,
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
