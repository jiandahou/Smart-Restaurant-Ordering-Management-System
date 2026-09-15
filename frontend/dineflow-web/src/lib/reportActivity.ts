function timeZoneOffsetMilliseconds(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const representedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  )
  const wholeSecondInstant = Math.floor(instant.getTime() / 1000) * 1000
  return representedAsUtc - wholeSecondInstant
}

export function toUtcDateBoundary(value: string, endOfDay = false, timeZone?: string | null) {
  if (!value) return undefined
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return undefined
  const hour = endOfDay ? 23 : 0
  const minute = endOfDay ? 59 : 0
  const second = endOfDay ? 59 : 0
  const millisecond = endOfDay ? 999 : 0

  if (!timeZone) {
    return new Date(year, month - 1, day, hour, minute, second, millisecond).toISOString()
  }

  try {
    const desiredWallTime = Date.UTC(year, month - 1, day, hour, minute, second, millisecond)
    const firstOffset = timeZoneOffsetMilliseconds(new Date(desiredWallTime), timeZone)
    const firstCandidate = desiredWallTime - firstOffset
    const finalOffset = timeZoneOffsetMilliseconds(new Date(firstCandidate), timeZone)
    return new Date(desiredWallTime - finalOffset).toISOString()
  } catch {
    return new Date(year, month - 1, day, hour, minute, second, millisecond).toISOString()
  }
}

export function formatReportDate(value: string, timeZone?: string | null) {
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(timeZone ? { timeZone } : {}),
  }

  try {
    return new Intl.DateTimeFormat('en-AU', options).format(new Date(value))
  } catch {
    return new Intl.DateTimeFormat('en-AU', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  }
}

export function formatMinorCurrency(amountCents: number, currency = 'AUD') {
  try {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amountCents / 100)
  } catch {
    return `${currency.toUpperCase()} ${(amountCents / 100).toFixed(2)}`
  }
}

export function shortReportId(value: string | null | undefined) {
  if (!value) return 'None'
  return value.length <= 12 ? value : `${value.slice(0, 8)}...${value.slice(-4)}`
}

export function humanActorType(value: string) {
  return value === 'Provider' ? 'Payment provider' : value
}
