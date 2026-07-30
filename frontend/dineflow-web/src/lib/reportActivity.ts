export function toUtcDateBoundary(value: string, endOfDay = false) {
  if (!value) return undefined
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return undefined
  const date = new Date(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0)
  return date.toISOString()
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
