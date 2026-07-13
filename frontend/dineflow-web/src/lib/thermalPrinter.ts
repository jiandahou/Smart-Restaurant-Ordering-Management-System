import type { AdminOrder } from '@/api/auth'

export type ThermalPrinterMode = 'browser' | 'qz-tray' | 'web-serial' | 'web-usb'
export type ThermalPaperWidth = '58mm' | '80mm'

export type ThermalPrinterSettings = {
  mode: ThermalPrinterMode
  paperWidth: ThermalPaperWidth
  cutPaper: boolean
  qzPrinterName: string
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

type QzTrayApi = {
  websocket: {
    isActive?: () => boolean
    connect: () => Promise<void>
  }
  configs: {
    create: (printerName: string, options?: unknown) => unknown
  }
  print: (config: unknown, data: unknown[]) => Promise<void>
}

type SerialPortLike = {
  open: (options: { baudRate: number }) => Promise<void>
  close: () => Promise<void>
  writable: WritableStream<Uint8Array> | null
}

type SerialNavigator = Navigator & {
  serial?: {
    requestPort: () => Promise<SerialPortLike>
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
  }
}

const esc = '\x1b'
const gs = '\x1d'

export const defaultThermalPrinterSettings: ThermalPrinterSettings = {
  mode: 'browser',
  paperWidth: '80mm',
  cutPaper: true,
  qzPrinterName: '',
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

export function buildEscPosKitchenTicket(ticket: KitchenTicket, settings: Pick<ThermalPrinterSettings, 'paperWidth' | 'cutPaper'>): string {
  const columns = settings.paperWidth === '58mm' ? 32 : 42
  const separator = '-'.repeat(columns)

  const lines: string[] = [
    esc + '@',
    center('KITCHEN TICKET', columns),
    center(ticket.orderNumber, columns),
    center(ticket.restaurantName, columns),
    separator,
    twoColumn('ORDER', ticket.orderScope, columns),
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

    lines.push(`${itemPrefix}  ${wrappedName[0] ?? item.name}`)
    for (const extraNameLine of wrappedName.slice(1)) {
      lines.push(`${itemIndent}${extraNameLine}`)
    }

    for (const group of item.optionGroups) {
      lines.push(`${itemIndent}${group.groupName.toUpperCase()}`)
      for (const optionLine of wrapText(group.options.join(', '), columns - itemIndent.length)) {
        lines.push(`${itemIndent}${optionLine}`)
      }
    }

    if (item.note) {
      lines.push(`${itemIndent}ITEM NOTE`)
      for (const noteLine of wrapText(item.note, columns - itemIndent.length)) {
        lines.push(`${itemIndent}${noteLine}`)
      }
    }

    lines.push(separator)
  }

  if (ticket.orderNote) {
    lines.push('ORDER NOTE')
    lines.push(...wrapText(ticket.orderNote, columns))
    lines.push(separator)
  }

  lines.push('\n\n')

  if (settings.cutPaper) {
    lines.push(gs + 'V' + '\x41' + '\x00')
  }

  return `${lines.join('\n')}\n`
}

export function encodeEscPosKitchenTicket(ticket: KitchenTicket, settings: Pick<ThermalPrinterSettings, 'paperWidth' | 'cutPaper'>): Uint8Array {
  return new TextEncoder().encode(buildEscPosKitchenTicket(ticket, settings))
}

export async function printKitchenTicketWithQzTray(ticket: KitchenTicket, settings: ThermalPrinterSettings): Promise<void> {
  const qz = (window as Window & { qz?: QzTrayApi }).qz
  const printerName = settings.qzPrinterName.trim()

  if (!qz) {
    throw new Error('QZ Tray script is not loaded. Install QZ Tray and include qz-tray.js before using this printer route.')
  }

  if (!printerName) {
    throw new Error('Choose a QZ Tray printer name before printing.')
  }

  if (!qz.websocket.isActive?.()) {
    await qz.websocket.connect()
  }

  const config = qz.configs.create(printerName, { jobName: `Kitchen ${ticket.orderNumber}` })
  await qz.print(config, [buildEscPosKitchenTicket(ticket, settings)])
}

export async function printKitchenTicketWithWebSerial(ticket: KitchenTicket, settings: ThermalPrinterSettings): Promise<void> {
  const serial = (navigator as SerialNavigator).serial

  if (!serial) {
    throw new Error('Web Serial is not available in this browser. Use Chrome or Edge over HTTPS or localhost.')
  }

  const port = await serial.requestPort()
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
  const device = await usb.requestDevice({ filters })
  const interfaceNumber = Number.isFinite(settings.usbInterfaceNumber) ? settings.usbInterfaceNumber : 0

  if (!device.opened) {
    await device.open()
  }

  if (!device.configuration) {
    await device.selectConfiguration(1)
  }

  await device.claimInterface(interfaceNumber)

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

function center(value: string, columns: number): string {
  const normalized = value.trim()
  if (normalized.length >= columns) return normalized
  const left = Math.floor((columns - normalized.length) / 2)
  return `${' '.repeat(left)}${normalized}`
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
