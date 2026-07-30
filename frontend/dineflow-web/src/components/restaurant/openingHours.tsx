/**
 * Shared opening-hours domain model and UI.
 *
 * Extracted from AdminRestaurantsPage so the staff dashboard can render the same status banner,
 * pause control, weekly schedule editor and special calendar without duplicating the parsing and
 * timezone rules. All date reasoning here is anchored to the restaurant's own clock — see
 * getRestaurantTodayKey.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import {
  updateRestaurantOpeningHours,
  updateRestaurantOrderingStatus,
  updateRestaurantSpecialDays,
  type PauseOrderingOptions,
  type Restaurant,
  type RestaurantAvailability,
} from '../../api/auth'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Switch } from '../ui/switch'
import { Textarea } from '../ui/textarea'

export const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/

export const maximumOpeningWindowsPerDay = 4

export function isFullDayOpeningWindow(value: { opensAt: string; closesAt: string }) {
  return value.opensAt === '00:00' && value.closesAt === '00:00'
}

export const openingHoursWindowSchema = z.object({
  opensAt: z.string().regex(timePattern, 'Use HH:mm time.'),
  closesAt: z.string().regex(timePattern, 'Use HH:mm time.'),
}).refine((value) => value.opensAt !== value.closesAt || isFullDayOpeningWindow(value), {
  path: ['closesAt'],
  message: 'Closing time must differ from opening time, except 00:00 to 00:00 for 24 hours.',
})

export const openingHoursDaySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  isOpen: z.boolean(),
  windows: z.array(openingHoursWindowSchema).min(1, 'Add at least one opening window.').max(maximumOpeningWindowsPerDay),
}).superRefine((day, context) => {
  if (!day.isOpen) {
    return
  }

  if (hasOverlappingOpeningWindows(day.windows)) {
    context.addIssue({
      code: 'custom',
      path: ['windows'],
      message: 'Opening windows must not overlap.',
    })
  }
})

export const specialOpeningDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use yyyy-mm-dd date.'),
  isClosed: z.boolean(),
  note: z.string().trim().max(160, 'Note must be 160 characters or fewer.').optional().nullable(),
  windows: z.array(openingHoursWindowSchema).max(maximumOpeningWindowsPerDay),
}).superRefine((day, context) => {
  if (day.isClosed) {
    return
  }

  if (day.windows.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['windows'],
      message: 'Add at least one opening window.',
    })
    return
  }

  if (hasOverlappingOpeningWindows(day.windows)) {
    context.addIssue({
      code: 'custom',
      path: ['windows'],
      message: 'Opening windows must not overlap.',
    })
  }
})

export type OpeningHoursWindow = z.infer<typeof openingHoursWindowSchema>
export type OpeningHoursDay = z.infer<typeof openingHoursDaySchema>
export type SpecialOpeningDay = z.infer<typeof specialOpeningDaySchema>
export type SpecialDayMode = 'normal' | 'special' | 'closed'
export type AutosaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'
export const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function createDefaultOpeningHours(): OpeningHoursDay[] {
  return dayLabels.map((_, dayOfWeek) => ({
    dayOfWeek,
    isOpen: true,
    windows: [createDefaultOpeningWindow()],
  }))
}

export function createDefaultOpeningWindow(): OpeningHoursWindow {
  return {
    opensAt: '09:00',
    closesAt: '21:00',
  }
}

export function createFullDayOpeningWindow(): OpeningHoursWindow {
  return {
    opensAt: '00:00',
    closesAt: '00:00',
  }
}

export function isFullDayOpeningSchedule(windows: OpeningHoursWindow[]) {
  return windows.length === 1 && isFullDayOpeningWindow(windows[0])
}

export function createSuggestedOpeningWindow(existingWindows: OpeningHoursWindow[]): OpeningHoursWindow {
  const lastWindow = existingWindows.at(-1)

  if (!lastWindow) {
    return createDefaultOpeningWindow()
  }

  const lastClosesAt = lastWindow.closesAt
  if (timePattern.test(lastClosesAt) && timeToMinutes(lastClosesAt) < timeToMinutes('21:00')) {
    return {
      opensAt: lastClosesAt,
      closesAt: '21:00',
    }
  }

  return {
    opensAt: '17:00',
    closesAt: '21:00',
  }
}

export function createClosedSpecialDay(date: string): SpecialOpeningDay {
  return {
    date,
    isClosed: true,
    note: '',
    windows: [],
  }
}

export function createOpenSpecialDay(date: string, windows: OpeningHoursWindow[]): SpecialOpeningDay {
  return {
    date,
    isClosed: false,
    note: '',
    windows: windows.length > 0 ? windows.map((window) => ({ ...window })) : [createDefaultOpeningWindow()],
  }
}

export function getSpecialOpeningSeedWindows(
  regularDay: OpeningHoursDay,
  preferredWindows: OpeningHoursWindow[] = [],
): OpeningHoursWindow[] {
  const seedWindows = preferredWindows.length > 0
    ? preferredWindows
    : regularDay.isOpen && regularDay.windows.length > 0
      ? regularDay.windows
      : [createDefaultOpeningWindow()]

  return seedWindows.map((window) => ({ ...window }))
}

export function normalizeSpecialOpeningDaysForDraft(specialOpeningDays: SpecialOpeningDay[]) {
  return specialOpeningDays
    .filter((day, index, days) => days.findIndex((candidate) => candidate.date === day.date) === index)
    .sort((first, second) => first.date.localeCompare(second.date))
}

export function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function fromDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function parseOpeningHoursJson(openingHoursJson?: string | null): OpeningHoursDay[] {
  if (!openingHoursJson) {
    return createDefaultOpeningHours()
  }

  try {
    const parsed = JSON.parse(openingHoursJson)
    if (!Array.isArray(parsed) || parsed.length !== 7) {
      return createDefaultOpeningHours()
    }

    const normalized = parsed.map((entry) => normalizeOpeningHoursDay(entry))
    const result = z.array(openingHoursDaySchema).length(7).safeParse(normalized)

    return result.success
      ? [...result.data].sort((first, second) => first.dayOfWeek - second.dayOfWeek)
      : createDefaultOpeningHours()
  } catch {
    return createDefaultOpeningHours()
  }
}

/**
 * Same parse as {@link parseOpeningHoursJson}, but reports when the stored value was unreadable.
 * Silently substituting defaults is dangerous here: the editor would show 09:00-21:00, the user
 * would save, and the real schedule would be overwritten without anyone noticing.
 */
export function readOpeningHours(openingHoursJson?: string | null): {
  value: OpeningHoursDay[]
  isFallback: boolean
} {
  const value = parseOpeningHoursJson(openingHoursJson)

  if (!openingHoursJson) {
    return { value, isFallback: false }
  }

  const isFallback = serializeOpeningHours(value) !== serializeOpeningHours(parseStoredOpeningHours(openingHoursJson))
  return { value, isFallback }
}

/** Best-effort parse used only to detect whether {@link parseOpeningHoursJson} fell back. */
export function parseStoredOpeningHours(openingHoursJson: string): OpeningHoursDay[] {
  try {
    const parsed = JSON.parse(openingHoursJson)
    if (!Array.isArray(parsed) || parsed.length !== 7) {
      return []
    }

    const result = z.array(openingHoursDaySchema).length(7).safeParse(parsed.map(normalizeOpeningHoursDay))
    return result.success ? [...result.data].sort((first, second) => first.dayOfWeek - second.dayOfWeek) : []
  } catch {
    return []
  }
}

export function serializeOpeningHours(openingHours: OpeningHoursDay[]) {
  return JSON.stringify([...openingHours].sort((first, second) => first.dayOfWeek - second.dayOfWeek))
}

export function parseSpecialOpeningDaysJson(specialOpeningDaysJson?: string | null): SpecialOpeningDay[] {
  if (!specialOpeningDaysJson) {
    return []
  }

  try {
    const parsed = JSON.parse(specialOpeningDaysJson)
    if (!Array.isArray(parsed)) {
      return []
    }

    const result = z.array(specialOpeningDaySchema).safeParse(parsed.map(normalizeSpecialOpeningDay))
    return result.success
      ? [...result.data].sort((first, second) => first.date.localeCompare(second.date))
      : []
  } catch {
    return []
  }
}

export function serializeSpecialOpeningDays(specialOpeningDays: SpecialOpeningDay[]) {
  return JSON.stringify(
    [...specialOpeningDays]
      .sort((first, second) => first.date.localeCompare(second.date))
      .map((day) => ({
        date: day.date,
        isClosed: day.isClosed,
        note: day.note?.trim() || null,
        windows: day.isClosed ? [] : day.windows,
      })),
  )
}

export function normalizeSpecialOpeningDay(value: unknown): SpecialOpeningDay {
  if (!value || typeof value !== 'object') {
    return createClosedSpecialDay(toDateKey(new Date()))
  }

  const candidate = value as {
    date?: unknown
    isClosed?: unknown
    note?: unknown
    windows?: unknown
  }
  const date = typeof candidate.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(candidate.date)
    ? candidate.date
    : toDateKey(new Date())
  const isClosed = typeof candidate.isClosed === 'boolean' ? candidate.isClosed : true
  const windows = Array.isArray(candidate.windows)
    ? candidate.windows
        .map((window) => normalizeOpeningWindow(window))
        .filter((window): window is OpeningHoursWindow => Boolean(window))
        .slice(0, maximumOpeningWindowsPerDay)
    : []

  return {
    date,
    isClosed,
    note: typeof candidate.note === 'string' ? candidate.note : null,
    windows: isClosed ? [] : (windows.length > 0 ? windows : [createDefaultOpeningWindow()]),
  }
}

export function normalizeOpeningHoursDay(value: unknown): OpeningHoursDay {
  if (!value || typeof value !== 'object') {
    return createDefaultOpeningHours()[0]
  }

  const candidate = value as {
    dayOfWeek?: unknown
    isOpen?: unknown
    opensAt?: unknown
    closesAt?: unknown
    windows?: unknown
  }
  const dayOfWeek = typeof candidate.dayOfWeek === 'number' && candidate.dayOfWeek >= 0 && candidate.dayOfWeek <= 6
    ? candidate.dayOfWeek
    : 0
  const isOpen = typeof candidate.isOpen === 'boolean' ? candidate.isOpen : true
  const parsedWindows = Array.isArray(candidate.windows)
    ? candidate.windows
        .map((window) => normalizeOpeningWindow(window))
        .filter((window): window is OpeningHoursWindow => Boolean(window))
    : []
  const legacyWindow = typeof candidate.opensAt === 'string' && typeof candidate.closesAt === 'string'
    ? normalizeOpeningWindow({ opensAt: candidate.opensAt, closesAt: candidate.closesAt })
    : null
  const windows = parsedWindows.length > 0
    ? parsedWindows
    : legacyWindow
      ? [legacyWindow]
      : [createDefaultOpeningWindow()]

  return {
    dayOfWeek,
    isOpen,
    windows: windows.slice(0, maximumOpeningWindowsPerDay),
  }
}

export function normalizeOpeningWindow(value: unknown): OpeningHoursWindow | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as { opensAt?: unknown; closesAt?: unknown }
  if (typeof candidate.opensAt !== 'string' || typeof candidate.closesAt !== 'string') {
    return null
  }

  const result = openingHoursWindowSchema.safeParse({
    opensAt: candidate.opensAt,
    closesAt: candidate.closesAt,
  })

  return result.success ? result.data : null
}

export function hasOverlappingOpeningWindows(windows: OpeningHoursWindow[]) {
  const ranges = windows
    .map((window) => {
      const opensAt = timeToMinutes(window.opensAt)
      const closesAt = timeToMinutes(window.closesAt)
      return {
        start: opensAt,
        end: closesAt > opensAt ? closesAt : closesAt + 24 * 60,
      }
    })
    .sort((first, second) => first.start - second.start)

  return ranges.some((range, index) => index > 0 && range.start < ranges[index - 1].end)
}

export function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

export function getMonthCalendarDates(monthDate: Date) {
  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
  const gridStart = new Date(firstDay)
  gridStart.setDate(firstDay.getDate() - firstDay.getDay())

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart)
    date.setDate(gridStart.getDate() + index)
    return date
  })
}

export function getRegularOpeningDayForDate(dateKey: string, openingHours: OpeningHoursDay[]) {
  const date = fromDateKey(dateKey)
  return openingHours.find((day) => day.dayOfWeek === date.getDay()) ?? createDefaultOpeningHours()[date.getDay()]
}

export function getSpecialOpeningDay(dateKey: string, specialOpeningDays: SpecialOpeningDay[]) {
  return specialOpeningDays.find((day) => day.date === dateKey) ?? null
}

export function getSpecialDayMode(specialDay?: SpecialOpeningDay | null): SpecialDayMode {
  if (!specialDay) {
    return 'normal'
  }

  return specialDay.isClosed ? 'closed' : 'special'
}

export function resolveCalendarDateStatus(
  dateKey: string,
  openingHours: OpeningHoursDay[],
  specialOpeningDays: SpecialOpeningDay[],
) {
  const specialDay = getSpecialOpeningDay(dateKey, specialOpeningDays)

  if (specialDay) {
    const windows = specialDay.isClosed ? [] : specialDay.windows
    return {
      isOpen: !specialDay.isClosed,
      isOverride: true,
      label: specialDay.isClosed ? 'Closed' : 'Special',
      windows,
      spillsOvernight: spillsOvernight(windows),
      note: specialDay.note ?? '',
    }
  }

  const regularDay = getRegularOpeningDayForDate(dateKey, openingHours)
  const windows = regularDay.isOpen ? regularDay.windows : []
  return {
    isOpen: regularDay.isOpen,
    isOverride: false,
    label: regularDay.isOpen ? 'Open' : 'Closed',
    windows,
    spillsOvernight: spillsOvernight(windows),
    note: '',
  }
}

export function formatOpeningWindows(windows: OpeningHoursWindow[]) {
  if (isFullDayOpeningSchedule(windows)) {
    return 'Open 24 hours'
  }

  return windows.length > 0
    ? windows.map((window) => `${window.opensAt}-${window.closesAt}`).join(', ')
    : 'Closed'
}

export function formatCalendarDate(dateKey: string) {
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(fromDateKey(dateKey))
}

/**
 * The restaurant's own current date. Opening hours are written and evaluated in the restaurant's
 * timezone, so using the browser's date here would mark the wrong day as "today" — and could apply
 * a holiday closure to the wrong date — whenever the two timezones disagree.
 */
export function getRestaurantTodayKey(availability: RestaurantAvailability | null | undefined) {
  return availability ? availability.localNow.slice(0, 10) : toDateKey(new Date())
}

export function shiftDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return toDateKey(new Date(year, month - 1, day + days))
}

export function startOfMonthForDateKey(dateKey: string) {
  const [year, month] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, 1)
}

/** A window whose closing time is at or before its opening time runs into the next morning. */
export function spillsOvernight(windows: OpeningHoursWindow[]) {
  return windows.some((window) =>
    !isFullDayOpeningWindow(window) && timeToMinutes(window.closesAt) <= timeToMinutes(window.opensAt))
}

/** "2026-07-28T21:00:00" -> "21:00" */
export function formatLocalTimeOfDay(localIso: string) {
  return localIso.split('T')[1]?.slice(0, 5) ?? ''
}

/** Renders a local ISO instant relative to the restaurant's today: "21:00", "tomorrow 09:00", "Wed 09:00". */
export function formatRelativeLocalTime(localIso: string, todayKey: string) {
  const dateKey = localIso.slice(0, 10)
  const time = formatLocalTimeOfDay(localIso)

  if (dateKey === todayKey) {
    return time
  }

  if (dateKey === shiftDateKey(todayKey, 1)) {
    return `tomorrow ${time}`
  }

  return `${dayLabels[fromDateKey(dateKey).getDay()]} ${time}`
}

export const pauseDurationOptions = [
  { label: '30 min', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: '2 hours', minutes: 120 },
]

/**
 * Answers "are we open right now?" from the server-evaluated availability, so neither the browser
 * clock nor the browser timezone is involved. Reused by both panels; intended for the staff
 * dashboard widget too.
 */
export function RestaurantStatusBanner({
  availability,
  name,
}: {
  availability: RestaurantAvailability | null
  /** Shown on the dashboard, where the card isn't already scoped to a named restaurant. */
  name?: string
}) {
  if (!availability) {
    return null
  }

  const todayKey = getRestaurantTodayKey(availability)
  const nextTransition = availability.nextTransitionLocal
  const transitionLabel = nextTransition
    ? availability.isWithinOpeningHours
      ? `closes ${formatRelativeLocalTime(nextTransition, todayKey)}`
      : `opens ${formatRelativeLocalTime(nextTransition, todayKey)}`
    : availability.isWithinOpeningHours
      ? 'open around the clock'
      : 'no upcoming opening in the next two weeks'

  return (
    <div className="restaurant-status-banner" data-reason={availability.reason} aria-live="polite">
      <span className="restaurant-status-dot" aria-hidden="true" />
      <div>
        <strong>{name ? `${name} · ${getStatusHeadline(availability)}` : getStatusHeadline(availability)}</strong>
        <small>
          {transitionLabel} · restaurant time {formatLocalTimeOfDay(availability.localNow)}
        </small>
      </div>
    </div>
  )
}

export function getStatusHeadline(availability: RestaurantAvailability) {
  if (availability.reason === 'Inactive') {
    return 'Inactive'
  }

  // 'Paused' means someone closed the restaurant by hand, which is worth distinguishing from
  // 'Closed', where the schedule simply has no window open right now.
  if (availability.reason === 'Paused') {
    if (!availability.pausedUntilUtc) {
      return 'Closed manually'
    }

    const reopensAt = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' })
      .format(new Date(availability.pausedUntilUtc))
    return `Closed · reopens ${reopensAt}`
  }

  return availability.isWithinOpeningHours ? 'Open now' : 'Closed now'
}

/**
 * Pause is an immediate action rather than a draft field: a rush-hour pause that only takes effect
 * once someone remembers to hit Save is worse than useless. Timed pauses resume on their own.
 */
export function OrderingPauseControl({
  restaurant,
  onRestaurantUpdated,
}: {
  restaurant: Restaurant
  onRestaurantUpdated: (restaurant: Restaurant) => void
}) {
  const [busy, setBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const availability = restaurant.availability
  const isAccepting = availability?.acceptingOrders ?? restaurant.acceptingOrders
  const nextOpeningHint = availability?.nextOpeningLocal
    ? `Reopens ${formatRelativeLocalTime(availability.nextOpeningLocal, getRestaurantTodayKey(availability))}`
    : null

  const applyOrderingStatus = async (acceptingOrders: boolean, options: PauseOrderingOptions = {}) => {
    setBusy(true)

    try {
      const response = await updateRestaurantOrderingStatus(restaurant.id, acceptingOrders, options)
      onRestaurantUpdated(response.restaurant)
      toast.success(acceptingOrders ? 'Restaurant reopened' : 'Restaurant closed', {
        description: response.message,
      })
    } catch (error) {
      toast.error('Could not change the restaurant status', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="restaurant-pause-control">
      <div>
        <span className="restaurant-hours-field-label">Accepting orders</span>
        <p>
          {isAccepting
            ? 'Close when the kitchen is overloaded. Opening hours still apply automatically.'
            : 'The restaurant is closed. Opening hours are ignored until it reopens.'}
        </p>
      </div>
      <div className="restaurant-pause-actions">
        {isAccepting ? (
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm" disabled={busy}>
                Close restaurant
                <ChevronDown size={15} />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="restaurant-pause-menu" align="end">
              {pauseDurationOptions.map((option) => (
                <button
                  key={option.minutes}
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    void applyOrderingStatus(false, { pauseMinutes: option.minutes })
                  }}
                >
                  Close for {option.label}
                </button>
              ))}
              <button
                type="button"
                className="is-section"
                onClick={() => {
                  setMenuOpen(false)
                  void applyOrderingStatus(false, { pauseUntilNextOpening: true })
                }}
              >
                <span>Close for today</span>
                <small>{nextOpeningHint ?? 'Reopens automatically at the next opening'}</small>
              </button>
              <button
                type="button"
                className="is-destructive"
                onClick={() => {
                  setMenuOpen(false)
                  void applyOrderingStatus(false)
                }}
              >
                <span>Close until I reopen</span>
                <small>Stays closed until someone reopens it</small>
              </button>
            </PopoverContent>
          </Popover>
        ) : (
          <Button type="button" size="sm" disabled={busy} onClick={() => void applyOrderingStatus(true)}>
            Reopen restaurant
          </Button>
        )}
      </div>
    </div>
  )
}

export function OpeningHoursEditor({
  value,
  onChange,
}: {
  value: OpeningHoursDay[]
  onChange: (value: OpeningHoursDay[]) => void
}) {
  const normalizedValue = value.length === 7 ? value : createDefaultOpeningHours()

  const updateDay = (dayOfWeek: number, patch: Partial<OpeningHoursDay>) => {
    onChange(
      normalizedValue.map((day) =>
        day.dayOfWeek === dayOfWeek
          ? { ...day, ...patch }
          : day,
      ),
    )
  }
  const updateWindow = (
    dayOfWeek: number,
    windowIndex: number,
    patch: Partial<OpeningHoursWindow>,
  ) => {
    const day = normalizedValue.find((entry) => entry.dayOfWeek === dayOfWeek)
    if (!day) {
      return
    }

    updateDay(dayOfWeek, {
      windows: day.windows.map((window, index) =>
        index === windowIndex
          ? { ...window, ...patch }
          : window,
      ),
    })
  }
  const addWindow = (dayOfWeek: number) => {
    const day = normalizedValue.find((entry) => entry.dayOfWeek === dayOfWeek)
    if (!day || day.windows.length >= maximumOpeningWindowsPerDay) {
      return
    }

    updateDay(dayOfWeek, {
      windows: [...day.windows, createSuggestedOpeningWindow(day.windows)],
    })
  }
  const removeWindow = (dayOfWeek: number, windowIndex: number) => {
    const day = normalizedValue.find((entry) => entry.dayOfWeek === dayOfWeek)
    if (!day || day.windows.length <= 1) {
      return
    }

    updateDay(dayOfWeek, {
      windows: day.windows.filter((_, index) => index !== windowIndex),
    })
  }
  const copyDayToAll = (sourceDay: OpeningHoursDay) => {
    onChange(normalizedValue.map((day) => ({
      dayOfWeek: day.dayOfWeek,
      isOpen: sourceDay.isOpen,
      windows: sourceDay.windows.map((window) => ({ ...window })),
    })))
  }

  return (
    <div className="opening-hours-editor">
      {normalizedValue.map((day) => {
        const isOpenAllDay = day.isOpen && isFullDayOpeningSchedule(day.windows)

        return (
          <div key={day.dayOfWeek} className="opening-hours-row">
            <div className="opening-hours-day">
              <Switch
                checked={day.isOpen}
                onCheckedChange={(checked) => updateDay(day.dayOfWeek, { isOpen: checked })}
                aria-label={`${dayLabels[day.dayOfWeek]} open`}
              />
              <span>{dayLabels[day.dayOfWeek]}</span>
              <small>
                {day.isOpen
                  ? isOpenAllDay
                    ? 'Open 24 hours'
                    : `${day.windows.length} segment${day.windows.length === 1 ? '' : 's'}`
                  : 'Closed'}
              </small>
            </div>
            <div className="opening-hours-windows">
              {day.windows.map((window, windowIndex) => (
                <div key={`${day.dayOfWeek}-${windowIndex}`} className="opening-hours-window">
                  <Input
                    type="time"
                    value={window.opensAt}
                    disabled={!day.isOpen}
                    aria-label={`${dayLabels[day.dayOfWeek]} segment ${windowIndex + 1} opening time`}
                    onChange={(event) => updateWindow(day.dayOfWeek, windowIndex, { opensAt: event.target.value })}
                  />
                  <span>to</span>
                  <Input
                    type="time"
                    value={window.closesAt}
                    disabled={!day.isOpen}
                    aria-label={`${dayLabels[day.dayOfWeek]} segment ${windowIndex + 1} closing time`}
                    onChange={(event) => updateWindow(day.dayOfWeek, windowIndex, { closesAt: event.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="opening-hours-remove-window"
                    disabled={!day.isOpen || day.windows.length <= 1}
                    aria-label={`Remove ${dayLabels[day.dayOfWeek]} segment ${windowIndex + 1}`}
                    onClick={() => removeWindow(day.dayOfWeek, windowIndex)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
              <div className="opening-hours-actions">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="opening-hours-copy-day"
                  title={`Copy ${dayLabels[day.dayOfWeek]} hours to every day`}
                  aria-label={`Copy ${dayLabels[day.dayOfWeek]} hours to every day`}
                  onClick={() => copyDayToAll(day)}
                >
                  <Copy size={14} />
                  Copy to all
                </Button>
                <Button
                  type="button"
                  variant={isOpenAllDay ? 'secondary' : 'outline'}
                  size="sm"
                  className="opening-hours-add-window"
                  disabled={!day.isOpen}
                  aria-pressed={isOpenAllDay}
                  onClick={() => updateDay(day.dayOfWeek, {
                    windows: [isOpenAllDay ? createDefaultOpeningWindow() : createFullDayOpeningWindow()],
                  })}
                >
                  24 hours
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="opening-hours-add-window"
                  disabled={!day.isOpen || isOpenAllDay || day.windows.length >= maximumOpeningWindowsPerDay}
                  onClick={() => addWindow(day.dayOfWeek)}
                >
                  <Plus size={14} />
                  Add segment
                </Button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function OpeningWindowsEditor({
  windows,
  disabled,
  onChange,
}: {
  windows: OpeningHoursWindow[]
  disabled?: boolean
  onChange: (windows: OpeningHoursWindow[]) => void
}) {
  const safeWindows = windows.length > 0 ? windows : [createDefaultOpeningWindow()]
  const isOpenAllDay = isFullDayOpeningSchedule(safeWindows)

  const updateWindow = (windowIndex: number, patch: Partial<OpeningHoursWindow>) => {
    onChange(safeWindows.map((window, index) => (index === windowIndex ? { ...window, ...patch } : window)))
  }

  const addWindow = () => {
    if (safeWindows.length >= maximumOpeningWindowsPerDay) {
      return
    }

    onChange([...safeWindows, createSuggestedOpeningWindow(safeWindows)])
  }

  const removeWindow = (windowIndex: number) => {
    if (safeWindows.length <= 1) {
      return
    }

    onChange(safeWindows.filter((_, index) => index !== windowIndex))
  }

  return (
    <div className="opening-hours-windows">
      {safeWindows.map((window, windowIndex) => (
        <div key={windowIndex} className="opening-hours-window">
          <Input
            type="time"
            value={window.opensAt}
            disabled={disabled}
            aria-label={`Special opening segment ${windowIndex + 1} opening time`}
            onChange={(event) => updateWindow(windowIndex, { opensAt: event.target.value })}
          />
          <span>to</span>
          <Input
            type="time"
            value={window.closesAt}
            disabled={disabled}
            aria-label={`Special opening segment ${windowIndex + 1} closing time`}
            onChange={(event) => updateWindow(windowIndex, { closesAt: event.target.value })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="opening-hours-remove-window"
            disabled={disabled || safeWindows.length <= 1}
            aria-label={`Remove special opening segment ${windowIndex + 1}`}
            onClick={() => removeWindow(windowIndex)}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      ))}
      <div className="opening-hours-actions">
        <Button
          type="button"
          variant={isOpenAllDay ? 'secondary' : 'outline'}
          size="sm"
          className="opening-hours-add-window"
          disabled={disabled}
          aria-pressed={isOpenAllDay}
          onClick={() => onChange([
            isOpenAllDay ? createDefaultOpeningWindow() : createFullDayOpeningWindow(),
          ])}
        >
          24 hours
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="opening-hours-add-window"
          disabled={disabled || isOpenAllDay || safeWindows.length >= maximumOpeningWindowsPerDay}
          onClick={addWindow}
        >
          <Plus size={14} />
          Add segment
        </Button>
      </div>
    </div>
  )
}

export type RestaurantOpeningHoursPanelProps = {
  restaurants: Restaurant[]
  restaurantsLoading: boolean
  canSelectRestaurant: boolean
  onSaved: () => Promise<void> | void
  onRestaurantUpdated: (restaurant: Restaurant) => void
  selectedRestaurantId?: string
  onSelectedRestaurantIdChange?: (restaurantId: string) => void
  onDirtyChange?: (isDirty: boolean) => void
}

export function RestaurantOpeningHoursPanel({
  restaurants,
  restaurantsLoading,
  canSelectRestaurant,
  onSaved,
  onRestaurantUpdated,
  selectedRestaurantId: selectedRestaurantIdProp,
  onSelectedRestaurantIdChange,
  onDirtyChange,
}: RestaurantOpeningHoursPanelProps) {
  const [restaurantIdState, setRestaurantIdState] = useState('')
  const [draftOpeningHoursState, setDraftOpeningHoursState] = useState<{
    restaurantId: string
    openingHours: OpeningHoursDay[]
  } | null>(null)
  const [saving, setSaving] = useState(false)
  const requestedRestaurantId = selectedRestaurantIdProp ?? restaurantIdState
  const selectedRestaurantId = requestedRestaurantId && restaurants.some((restaurant) => restaurant.id === requestedRestaurantId)
    ? requestedRestaurantId
    : restaurants[0]?.id || ''
  const selectedRestaurant = restaurants.find((restaurant) => restaurant.id === selectedRestaurantId)
  const currentDraftState = draftOpeningHoursState?.restaurantId === selectedRestaurant?.id
    ? draftOpeningHoursState
    : null
  const storedOpeningHours = useMemo(
    () => readOpeningHours(selectedRestaurant?.openingHoursJson),
    [selectedRestaurant?.openingHoursJson],
  )
  const draftOpeningHours = currentDraftState?.openingHours ?? storedOpeningHours.value
  const draftOpeningHoursJson = serializeOpeningHours(draftOpeningHours)
  const committedOpeningHoursJson = serializeOpeningHours(storedOpeningHours.value)
  const hasChanges = Boolean(selectedRestaurant) && draftOpeningHoursJson !== committedOpeningHoursJson
  const openingHoursValidation = z.array(openingHoursDaySchema).length(7).safeParse(draftOpeningHours)
  const saveStatus: AutosaveState = saving
    ? 'saving'
    : hasChanges && !openingHoursValidation.success
      ? 'error'
      : hasChanges
        ? 'pending'
        : 'saved'
  const saveLabel = saving
    ? 'Saving...'
    : saveStatus === 'error'
      ? 'Check time ranges'
      : hasChanges
        ? 'Unsaved changes'
        : 'Saved'

  useEffect(() => {
    onDirtyChange?.(hasChanges)
    return () => onDirtyChange?.(false)
  }, [hasChanges, onDirtyChange])

  useEffect(() => {
    if (!hasChanges) {
      return
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasChanges])

  const updateDraftOpeningHours = (openingHours: OpeningHoursDay[]) => {
    if (!selectedRestaurant) {
      return
    }

    setDraftOpeningHoursState({ restaurantId: selectedRestaurant.id, openingHours })
  }

  const resetDraft = () => {
    if (!selectedRestaurant) {
      return
    }

    setDraftOpeningHoursState(null)
  }

  const saveOpeningHours = useCallback(async () => {
    if (!selectedRestaurant || saving) {
      return
    }

    const openingHoursResult = z.array(openingHoursDaySchema).length(7).safeParse(draftOpeningHours)
    if (!openingHoursResult.success) {
      toast.error('Could not save opening hours', {
        description: openingHoursResult.error.issues[0]?.message ?? 'Please check each day has valid times.',
      })
      return
    }

    setSaving(true)

    try {
      // Scoped write: only the weekly schedule column is touched, so a concurrent calendar
      // edit can't be reverted by this save.
      const response = await updateRestaurantOpeningHours(
        selectedRestaurant.id,
        serializeOpeningHours(openingHoursResult.data),
      )

      setDraftOpeningHoursState(null)
      onRestaurantUpdated(response.restaurant)
      toast.success('Opening hours updated', { description: response.message })
    } catch (error) {
      toast.error('Could not update opening hours', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    } finally {
      setSaving(false)
    }
  }, [draftOpeningHours, onRestaurantUpdated, saving, selectedRestaurant])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void saveOpeningHours()
  }

  return (
    <Card id="restaurant-opening-hours">
      <CardHeader className="section-header">
        <div className="admin-page-title">
          <CalendarClock size={22} />
          <div>
            <CardTitle>Opening Hours</CardTitle>
            <CardDescription>Set weekly service windows and quickly pause incoming orders.</CardDescription>
          </div>
        </div>
        <div className="section-actions">
          <Button type="button" variant="secondary" onClick={() => void onSaved()} disabled={restaurantsLoading}>
            <RefreshCw size={18} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="restaurant-hours-content">
        <div className="restaurant-table-tools restaurant-table-filter-tools restaurant-hours-tools">
          {canSelectRestaurant && (
            <div className="restaurant-table-selector-row">
              <Select
                value={selectedRestaurantId}
                onValueChange={(value) => {
                  if (hasChanges && !window.confirm('Discard the unsaved opening-hours changes?')) {
                    return
                  }
                  setRestaurantIdState(value)
                  onSelectedRestaurantIdChange?.(value)
                  setDraftOpeningHoursState(null)
                }}
                disabled={restaurantsLoading || restaurants.length === 0}
              >
                <SelectTrigger aria-label="Select restaurant for opening hours"><SelectValue placeholder="Select restaurant" /></SelectTrigger>
                <SelectContent position="popper">
                  {restaurants.map((restaurant) => (
                    <SelectItem key={restaurant.id} value={restaurant.id}>{restaurant.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {selectedRestaurant ? (
            <div className="restaurant-hours-context">
              <div>
                <span>Restaurant</span>
                <strong>{selectedRestaurant.name}</strong>
                <small>{selectedRestaurant.timezone}</small>
              </div>
              <Badge variant={selectedRestaurant.isActive ? 'secondary' : 'destructive'}>
                {selectedRestaurant.isActive ? 'Active' : 'Inactive'}
              </Badge>
            </div>
          ) : null}
        </div>

        {!selectedRestaurant && !restaurantsLoading ? (
          <div className="restaurant-mobile-empty">No restaurant is available for this account.</div>
        ) : null}

        {selectedRestaurant ? (
          <>
            <RestaurantStatusBanner availability={selectedRestaurant.availability} />

            {storedOpeningHours.isFallback ? (
              <div className="restaurant-hours-warning" role="alert">
                <strong>The saved opening hours could not be read.</strong>
                <span>
                  A default 09:00-21:00 schedule is shown below. Saving now will replace whatever is
                  stored, so check every day before you save.
                </span>
              </div>
            ) : null}

            {/* Closing the restaurant lives on the dashboard; this panel only edits the schedule. */}
            <form className="restaurant-hours-form" onSubmit={handleSubmit}>
              <div className="restaurant-hours-schedule">
                <div className="restaurant-hours-schedule-header">
                  <div>
                    <h3>Weekly schedule</h3>
                    <p>Times use the selected restaurant timezone.</p>
                  </div>
                  <Badge variant="outline">{selectedRestaurant.timezone}</Badge>
                </div>
                <OpeningHoursEditor
                  value={draftOpeningHours}
                  onChange={updateDraftOpeningHours}
                />
              </div>

              <div className="restaurant-hours-actions">
                <span className="restaurant-autosave-status" data-state={saveStatus} aria-live="polite">
                  {saveLabel}
                </span>
                <Button type="button" variant="outline" onClick={resetDraft} disabled={!hasChanges || saving}>
                  Reset
                </Button>
                <Button type="submit" disabled={!hasChanges || saving}>
                  {saving ? 'Saving hours' : 'Save hours'}
                </Button>
              </div>
            </form>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

export type RestaurantSpecialCalendarPanelProps = {
  restaurants: Restaurant[]
  restaurantsLoading: boolean
  canSelectRestaurant: boolean
  onSaved: () => Promise<void> | void
  onRestaurantUpdated: (restaurant: Restaurant) => void
  selectedRestaurantId?: string
  onSelectedRestaurantIdChange?: (restaurantId: string) => void
  selectedDateKey?: string
  onSelectedDateKeyChange?: (dateKey: string) => void
  monthKey?: string
  onMonthKeyChange?: (monthKey: string) => void
  onDirtyChange?: (isDirty: boolean) => void
}

export function RestaurantSpecialCalendarPanel({
  restaurants,
  restaurantsLoading,
  canSelectRestaurant,
  onSaved,
  onRestaurantUpdated,
  selectedRestaurantId: selectedRestaurantIdProp,
  onSelectedRestaurantIdChange,
  selectedDateKey: selectedDateKeyProp,
  onSelectedDateKeyChange,
  monthKey,
  onMonthKeyChange,
  onDirtyChange,
}: RestaurantSpecialCalendarPanelProps) {
  const [restaurantIdState, setRestaurantIdState] = useState('')
  const [selectedDateKeyState, setSelectedDateKeyState] = useState<string | null>(null)
  const [monthDateState, setMonthDateState] = useState<Date | null>(null)
  const [draftState, setDraftState] = useState<{
    restaurantId: string
    specialOpeningDays: SpecialOpeningDay[]
  } | null>(null)
  const specialWindowMemoryRef = useRef<Record<string, OpeningHoursWindow[]>>({})
  const [saving, setSaving] = useState(false)
  const requestedRestaurantId = selectedRestaurantIdProp ?? restaurantIdState
  const selectedRestaurantId = requestedRestaurantId && restaurants.some((restaurant) => restaurant.id === requestedRestaurantId)
    ? requestedRestaurantId
    : restaurants[0]?.id || ''
  const selectedRestaurant = restaurants.find((restaurant) => restaurant.id === selectedRestaurantId)
  // "Today" comes from the restaurant's clock, not the browser's — see getRestaurantTodayKey.
  const todayKey = getRestaurantTodayKey(selectedRestaurant?.availability)
  const selectedDateKey = selectedDateKeyProp && /^\d{4}-\d{2}-\d{2}$/.test(selectedDateKeyProp)
    ? selectedDateKeyProp
    : selectedDateKeyState ?? todayKey
  const controlledMonthDate = monthKey && /^\d{4}-\d{2}$/.test(monthKey)
    ? startOfMonthForDateKey(`${monthKey}-01`)
    : null
  const monthDate = controlledMonthDate ?? monthDateState ?? startOfMonthForDateKey(todayKey)
  const currentDraftState = draftState?.restaurantId === selectedRestaurant?.id ? draftState : null
  const openingHours = selectedRestaurant ? parseOpeningHoursJson(selectedRestaurant.openingHoursJson) : createDefaultOpeningHours()
  const specialOpeningDays = currentDraftState
    ? currentDraftState.specialOpeningDays
    : selectedRestaurant
      ? parseSpecialOpeningDaysJson(selectedRestaurant.specialOpeningDaysJson)
      : []
  const selectedStatus = resolveCalendarDateStatus(selectedDateKey, openingHours, specialOpeningDays)
  const selectedSpecialDay = getSpecialOpeningDay(selectedDateKey, specialOpeningDays)
  const selectedDayMode = getSpecialDayMode(selectedSpecialDay)
  const selectedRegularDay = getRegularOpeningDayForDate(selectedDateKey, openingHours)
  const calendarDates = getMonthCalendarDates(monthDate)
  const monthLabel = new Intl.DateTimeFormat('en-AU', {
    month: 'long',
    year: 'numeric',
  }).format(monthDate)
  const committedSpecialOpeningDaysJson = selectedRestaurant
    ? serializeSpecialOpeningDays(parseSpecialOpeningDaysJson(selectedRestaurant.specialOpeningDaysJson))
    : '[]'
  const draftJson = serializeSpecialOpeningDays(specialOpeningDays)
  const hasChanges = Boolean(selectedRestaurant) && committedSpecialOpeningDaysJson !== draftJson
  const specialCalendarValidation = z.array(specialOpeningDaySchema).safeParse(specialOpeningDays)
  const saveStatus: AutosaveState = saving
    ? 'saving'
    : hasChanges && !specialCalendarValidation.success
      ? 'error'
      : hasChanges
        ? 'pending'
        : 'saved'
  const saveLabel = saving
    ? 'Saving...'
    : saveStatus === 'error'
      ? 'Check special hours'
      : hasChanges
        ? 'Unsaved changes'
        : 'Saved'

  useEffect(() => {
    onDirtyChange?.(hasChanges)
    return () => onDirtyChange?.(false)
  }, [hasChanges, onDirtyChange])

  useEffect(() => {
    if (!hasChanges) {
      return
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasChanges])
  // Paging month by month to find out whether Christmas is set is a poor way to review overrides.
  const upcomingOverrides = specialOpeningDays
    .filter((day) => day.date >= todayKey)
    .slice(0, 6)

  const setDraftSpecialOpeningDays = (nextSpecialOpeningDays: SpecialOpeningDay[]) => {
    if (!selectedRestaurant) {
      return
    }

    setDraftState({
      restaurantId: selectedRestaurant.id,
      specialOpeningDays: normalizeSpecialOpeningDaysForDraft(nextSpecialOpeningDays),
    })
  }

  const upsertSpecialDay = (nextDay: SpecialOpeningDay) => {
    const others = specialOpeningDays.filter((day) => day.date !== nextDay.date)
    setDraftSpecialOpeningDays([...others, nextDay])
  }

  const updateSelectedSpecialDay = (patch: Partial<SpecialOpeningDay>) => {
    const baseDay = selectedSpecialDay ?? createClosedSpecialDay(selectedDateKey)
    upsertSpecialDay({
      ...baseDay,
      ...patch,
      date: selectedDateKey,
    })
  }

  const selectedDayMemoryKey = `${selectedRestaurantId}:${selectedDateKey}`

  const rememberSelectedSpecialWindows = () => {
    if (
      !specialWindowMemoryRef.current[selectedDayMemoryKey]
      && selectedSpecialDay
      && !selectedSpecialDay.isClosed
      && selectedSpecialDay.windows.length > 0
    ) {
      specialWindowMemoryRef.current[selectedDayMemoryKey] = selectedSpecialDay.windows.map((window) => ({ ...window }))
    }
  }

  const updateSelectedSpecialWindows = (windows: OpeningHoursWindow[]) => {
    specialWindowMemoryRef.current[selectedDayMemoryKey] = windows.map((window) => ({ ...window }))
    updateSelectedSpecialDay({ windows })
  }

  const removeSelectedOverride = () => {
    rememberSelectedSpecialWindows()
    setDraftSpecialOpeningDays(specialOpeningDays.filter((day) => day.date !== selectedDateKey))
  }

  const markSelectedClosed = () => {
    rememberSelectedSpecialWindows()
    updateSelectedSpecialDay({
      isClosed: true,
      windows: [],
    })
  }

  const setSelectedSpecialHours = () => {
    const rememberedWindows = specialWindowMemoryRef.current[selectedDayMemoryKey] ?? []
    updateSelectedSpecialDay({
      isClosed: false,
      windows: getSpecialOpeningSeedWindows(
        selectedRegularDay,
        selectedSpecialDay && !selectedSpecialDay.isClosed
          ? selectedSpecialDay.windows
          : rememberedWindows,
      ),
    })
  }

  const moveMonth = (offset: number) => {
    const nextMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + offset, 1)
    setMonthDateState(nextMonth)
    onMonthKeyChange?.(`${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`)
  }

  const resetDraft = () => {
    if (!selectedRestaurant) {
      return
    }

    specialWindowMemoryRef.current = Object.fromEntries(
      Object.entries(specialWindowMemoryRef.current)
        .filter(([key]) => !key.startsWith(`${selectedRestaurant.id}:`)),
    )
    setDraftState(null)
  }

  const saveSpecialCalendar = useCallback(async (
    restaurant: Restaurant,
    nextSpecialOpeningDays: SpecialOpeningDay[],
  ) => {
    if (saving) {
      return
    }

    const validation = z.array(specialOpeningDaySchema)
      .safeParse(normalizeSpecialOpeningDaysForDraft(nextSpecialOpeningDays))

    if (!validation.success) {
      toast.error('Could not save special calendar', {
        description: validation.error.issues[0]?.message ?? 'Please check the selected date override.',
      })
      return
    }

    setSaving(true)

    try {
      // Scoped write: leaves the weekly schedule column untouched.
      const response = await updateRestaurantSpecialDays(
        restaurant.id,
        serializeSpecialOpeningDays(validation.data),
      )

      specialWindowMemoryRef.current = Object.fromEntries(
        Object.entries(specialWindowMemoryRef.current)
          .filter(([key]) => !key.startsWith(`${restaurant.id}:`)),
      )
      setDraftState(null)
      onRestaurantUpdated(response.restaurant)
      toast.success('Special calendar updated', { description: response.message })
    } catch (error) {
      toast.error('Could not update special calendar', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    } finally {
      setSaving(false)
    }
  }, [onRestaurantUpdated, saving])

  const handleSave = () => {
    if (!selectedRestaurant) {
      return
    }

    void saveSpecialCalendar(selectedRestaurant, specialOpeningDays)
  }

  return (
    <Card id="restaurant-special-calendar">
      <CardHeader className="section-header">
        <div className="admin-page-title">
          <CalendarDays size={22} />
          <div>
            <CardTitle>Special Calendar</CardTitle>
            <CardDescription>Close holidays or open one-off service windows for specific dates.</CardDescription>
          </div>
        </div>
        <div className="section-actions">
          <Button type="button" variant="secondary" onClick={() => void onSaved()} disabled={restaurantsLoading}>
            <RefreshCw size={18} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="restaurant-calendar-content">
        <div className="restaurant-table-tools restaurant-table-filter-tools restaurant-hours-tools">
          {canSelectRestaurant && (
            <div className="restaurant-table-selector-row">
              <Select
                value={selectedRestaurantId}
                onValueChange={(value) => {
                  if (hasChanges && !window.confirm('Discard the unsaved special-calendar changes?')) {
                    return
                  }
                  setRestaurantIdState(value)
                  onSelectedRestaurantIdChange?.(value)
                  setDraftState(null)
                }}
                disabled={restaurantsLoading || restaurants.length === 0}
              >
                <SelectTrigger aria-label="Select restaurant for special calendar"><SelectValue placeholder="Select restaurant" /></SelectTrigger>
                <SelectContent position="popper">
                  {restaurants.map((restaurant) => (
                    <SelectItem key={restaurant.id} value={restaurant.id}>{restaurant.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {selectedRestaurant ? (
            <div className="restaurant-hours-context">
              <div>
                <span>Restaurant</span>
                <strong>{selectedRestaurant.name}</strong>
                <small>{selectedRestaurant.timezone}</small>
              </div>
              <Badge variant="outline">{specialOpeningDays.length} override{specialOpeningDays.length === 1 ? '' : 's'}</Badge>
              <Badge variant={saveStatus === 'error' ? 'destructive' : hasChanges || saving ? 'secondary' : 'outline'}>
                {saveLabel}
              </Badge>
            </div>
          ) : null}
        </div>

        {!selectedRestaurant && !restaurantsLoading ? (
          <div className="restaurant-mobile-empty">No restaurant is available for this account.</div>
        ) : null}

        {selectedRestaurant ? (
          <div className="restaurant-calendar-layout">
            <section className="restaurant-calendar-panel" aria-label="Special day calendar">
              <RestaurantStatusBanner availability={selectedRestaurant.availability} />

              <div className="restaurant-calendar-toolbar">
                <Button type="button" variant="outline" size="icon" aria-label="Previous month" onClick={() => moveMonth(-1)}>
                  <ChevronLeft size={16} />
                </Button>
                <strong>{monthLabel}</strong>
                <Button type="button" variant="outline" size="icon" aria-label="Next month" onClick={() => moveMonth(1)}>
                  <ChevronRight size={16} />
                </Button>
              </div>
              <div className="restaurant-calendar-weekdays" aria-hidden="true">
                {dayLabels.map((label) => <span key={label}>{label}</span>)}
              </div>
              <div className="restaurant-calendar-grid">
                {calendarDates.map((date) => {
                  const dateKey = toDateKey(date)
                  const status = resolveCalendarDateStatus(dateKey, openingHours, specialOpeningDays)
                  const outsideMonth = date.getMonth() !== monthDate.getMonth()
                  const selected = dateKey === selectedDateKey
                  const today = dateKey === todayKey

                  return (
                    <button
                      key={dateKey}
                      type="button"
                      aria-pressed={selected}
                      aria-current={today ? 'date' : undefined}
                      aria-label={`${formatCalendarDate(dateKey)} — ${status.label}`}
                      className={[
                        'restaurant-calendar-day',
                        outsideMonth ? 'is-outside-month' : '',
                        selected ? 'is-selected' : '',
                        today ? 'is-today' : '',
                        status.isOpen ? 'is-open' : 'is-closed',
                        status.isOverride ? 'has-override' : '',
                      ].filter(Boolean).join(' ')}
                      onClick={() => {
                        setSelectedDateKeyState(dateKey)
                        onSelectedDateKeyChange?.(dateKey)
                      }}
                    >
                      <span className="restaurant-calendar-day-number">{date.getDate()}</span>
                      <span className="restaurant-calendar-day-status">{status.label}</span>
                      {status.spillsOvernight ? (
                        <span className="restaurant-calendar-day-overnight" title="Runs past midnight">
                          +1
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>

              {upcomingOverrides.length > 0 ? (
                <div className="restaurant-calendar-upcoming">
                  <h4>Upcoming overrides</h4>
                  <ul>
                    {upcomingOverrides.map((day) => (
                      <li key={day.date}>
                        <button type="button" onClick={() => {
                          setSelectedDateKeyState(day.date)
                          onSelectedDateKeyChange?.(day.date)
                          const nextMonth = startOfMonthForDateKey(day.date)
                          setMonthDateState(nextMonth)
                          onMonthKeyChange?.(`${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`)
                        }}>
                          <strong>{formatCalendarDate(day.date)}</strong>
                          <span>{day.isClosed ? 'Closed' : formatOpeningWindows(day.windows)}</span>
                          {day.note ? <small>{day.note}</small> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>

            <aside className="restaurant-calendar-detail">
              <div className="restaurant-calendar-detail-header">
                <div>
                  <span>{formatCalendarDate(selectedDateKey)}</span>
                  <h3>
                    {selectedDayMode === 'closed'
                      ? 'Special closure'
                      : selectedDayMode === 'special'
                        ? 'Special opening'
                        : 'Normal opening'}
                  </h3>
                </div>
                <Badge variant={selectedStatus.isOpen ? 'secondary' : 'destructive'}>
                  {selectedDayMode === 'special'
                    ? 'Special open'
                    : selectedDayMode === 'normal' && selectedStatus.isOpen
                      ? 'Normal open'
                      : selectedStatus.isOpen
                        ? 'Open'
                        : 'Closed'}
                </Badge>
              </div>

              <div className="restaurant-calendar-summary">
                <div>
                  <span>Weekly baseline</span>
                  <strong>{selectedRegularDay.isOpen ? formatOpeningWindows(selectedRegularDay.windows) : 'Closed'}</strong>
                </div>
                <div>
                  <span>Selected day</span>
                  <strong>
                    {selectedDayMode === 'normal'
                      ? `Normal · ${formatOpeningWindows(selectedStatus.windows)}`
                      : selectedDayMode === 'special'
                        ? `Special · ${formatOpeningWindows(selectedStatus.windows)}`
                        : 'Closed all day'}
                  </strong>
                </div>
              </div>

              <div className="restaurant-calendar-override-form">
                <div className="restaurant-calendar-mode-picker" role="group" aria-label="Hours for selected date">
                  <Button
                    type="button"
                    variant={selectedDayMode === 'normal' ? 'default' : 'outline'}
                    aria-pressed={selectedDayMode === 'normal'}
                    onClick={removeSelectedOverride}
                  >
                    <CalendarClock size={15} />
                    Normal
                  </Button>
                  <Button
                    type="button"
                    variant={selectedDayMode === 'special' ? 'default' : 'outline'}
                    aria-pressed={selectedDayMode === 'special'}
                    onClick={setSelectedSpecialHours}
                  >
                    <Pencil size={15} />
                    Special
                  </Button>
                  <Button
                    type="button"
                    variant={selectedDayMode === 'closed' ? 'destructive' : 'outline'}
                    aria-pressed={selectedDayMode === 'closed'}
                    onClick={markSelectedClosed}
                  >
                    <X size={15} />
                    Closed
                  </Button>
                </div>
                <p className="restaurant-calendar-mode-help">
                  {selectedDayMode === 'normal'
                    ? 'Uses the weekly schedule. Changes to this date will follow the weekly baseline.'
                    : selectedDayMode === 'special'
                      ? 'These hours apply only to this date and override the weekly schedule.'
                      : 'This date is closed all day, regardless of the weekly schedule.'}
                </p>
                {selectedDayMode === 'special' && selectedSpecialDay ? (
                  <OpeningWindowsEditor
                    windows={selectedSpecialDay.windows}
                    onChange={updateSelectedSpecialWindows}
                  />
                ) : null}
                {selectedDayMode !== 'normal' && selectedSpecialDay ? (
                  <div className="restaurant-calendar-note-field">
                    <label htmlFor="special-day-note">Note</label>
                    <Textarea
                      id="special-day-note"
                      rows={2}
                      value={selectedSpecialDay.note ?? ''}
                      placeholder="Public holiday, private event, staff training..."
                      onChange={(event) => updateSelectedSpecialDay({ note: event.target.value })}
                    />
                  </div>
                ) : null}
              </div>

              <div className="restaurant-hours-actions">
                <span className="restaurant-autosave-status" data-state={saveStatus} aria-live="polite">
                  {saveLabel}
                </span>
                <Button type="button" variant="outline" onClick={resetDraft} disabled={!hasChanges || saving}>
                  Reset
                </Button>
                <Button type="button" onClick={() => void handleSave()} disabled={!hasChanges || saving}>
                  {saving ? 'Saving calendar' : 'Save calendar'}
                </Button>
              </div>
            </aside>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
