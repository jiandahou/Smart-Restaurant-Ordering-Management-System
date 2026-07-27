import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type HTMLAttributes } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Armchair,
  Building2,
  CalendarDays,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Copy,
  Eye,
  ExternalLink,
  Globe2,
  ImageIcon,
  Link2,
  MapPin,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import { useForm, type FieldErrors } from 'react-hook-form'
import {
  getCountryCallingCode,
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js'
import { motion } from 'motion/react'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from 'sonner'
import { z } from 'zod'
import {
  createRestaurant,
  deleteRestaurant,
  getRestaurantPage,
  getRestaurants,
  updateRestaurant,
  type Restaurant,
  type RestaurantRequest,
} from '../api/auth'
import { useAuth } from '../auth/AuthContext'
import { RestaurantTablesPanel } from '../components/admin/RestaurantTablesPanel'
import {
  countryOptions,
  currencyOptions,
  getCountryDefaults,
  getCountryOption,
  getTimezoneOptions,
  inferCountryCode,
  normalizeCountryCode,
  timezoneBelongsToCountry,
  type CurrencyOption,
  type TimezoneOption,
} from '../lib/localeOptions'
import { buildTakeawayPublicUrl } from '../lib/publicUrls'
import { resolvePublicAssetUrl } from '../api/publicMenu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../components/ui/alert-dialog'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../components/ui/form'
import { Input } from '../components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Switch } from '../components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Textarea } from '../components/ui/textarea'

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/

const maximumOpeningWindowsPerDay = 4

function isFullDayOpeningWindow(value: { opensAt: string; closesAt: string }) {
  return value.opensAt === '00:00' && value.closesAt === '00:00'
}

const openingHoursWindowSchema = z.object({
  opensAt: z.string().regex(timePattern, 'Use HH:mm time.'),
  closesAt: z.string().regex(timePattern, 'Use HH:mm time.'),
}).refine((value) => value.opensAt !== value.closesAt || isFullDayOpeningWindow(value), {
  path: ['closesAt'],
  message: 'Closing time must differ from opening time, except 00:00 to 00:00 for 24 hours.',
})

const openingHoursDaySchema = z.object({
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

const specialOpeningDaySchema = z.object({
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

const restaurantSchema = z.object({
  name: z.string().trim().min(2, 'Restaurant name must be at least 2 characters.').max(120),
  address: z.string().trim().min(5, 'Enter the restaurant address.').max(300),
  phoneCountryCode: z.string().length(2, 'Select a dialing country.'),
  phoneNationalNumber: z
    .string()
    .trim()
    .min(6, 'Enter a valid phone number.')
    .max(24)
    .regex(/^[()\-\s\d]+$/, 'Use digits and standard phone symbols only.'),
  countryCode: z.string().length(2, 'Select a country.'),
  timezone: z.string().min(1, 'Select a timezone.'),
  currency: z.string().length(3, 'Select a currency.'),
  imageUrl: z
    .string()
    .trim()
    .max(2048, 'Image URL must be 2048 characters or fewer.')
    .refine(
      (value) => value === '' || value.startsWith('/') || /^https?:\/\//i.test(value),
      'Use an http(s) URL or an app-relative path starting with /.',
    ),
  paymentPolicy: z.enum(['PrepayRequired', 'PayAtCounterAllowed']),
  isActive: z.boolean(),
  acceptingOrders: z.boolean(),
  openingHours: z.array(openingHoursDaySchema).length(7, 'Set opening hours for all seven days.'),
  specialOpeningDays: z.array(specialOpeningDaySchema),
})

type RestaurantFormValues = z.infer<typeof restaurantSchema>
type OpeningHoursWindow = z.infer<typeof openingHoursWindowSchema>
type OpeningHoursDay = z.infer<typeof openingHoursDaySchema>
type SpecialOpeningDay = z.infer<typeof specialOpeningDaySchema>
type SortKey = 'name' | 'status' | 'currency' | 'created'
type SortDirection = 'asc' | 'desc'
type StatusFilter = 'all' | 'active' | 'inactive'
type RestaurantAdminTab = 'restaurants' | 'tables' | 'hours' | 'calendar'
type RestaurantFormTab = 'basic' | 'advanced'
type AutosaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function createDefaultOpeningHours(): OpeningHoursDay[] {
  return dayLabels.map((_, dayOfWeek) => ({
    dayOfWeek,
    isOpen: true,
    windows: [createDefaultOpeningWindow()],
  }))
}

function createDefaultOpeningWindow(): OpeningHoursWindow {
  return {
    opensAt: '09:00',
    closesAt: '21:00',
  }
}

function createFullDayOpeningWindow(): OpeningHoursWindow {
  return {
    opensAt: '00:00',
    closesAt: '00:00',
  }
}

function isFullDayOpeningSchedule(windows: OpeningHoursWindow[]) {
  return windows.length === 1 && isFullDayOpeningWindow(windows[0])
}

function createSuggestedOpeningWindow(existingWindows: OpeningHoursWindow[]): OpeningHoursWindow {
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

function createClosedSpecialDay(date: string): SpecialOpeningDay {
  return {
    date,
    isClosed: true,
    note: '',
    windows: [],
  }
}

function createOpenSpecialDay(date: string, windows: OpeningHoursWindow[]): SpecialOpeningDay {
  return {
    date,
    isClosed: false,
    note: '',
    windows: windows.length > 0 ? windows.map((window) => ({ ...window })) : [createDefaultOpeningWindow()],
  }
}

function getSpecialOpeningSeedWindows(
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

function normalizeSpecialOpeningDaysForDraft(specialOpeningDays: SpecialOpeningDay[]) {
  return specialOpeningDays
    .filter((day, index, days) => days.findIndex((candidate) => candidate.date === day.date) === index)
    .sort((first, second) => first.date.localeCompare(second.date))
}

function createEmptyRestaurant(): RestaurantFormValues {
  return {
    name: '',
    address: '',
    phoneCountryCode: 'AU',
    phoneNationalNumber: '',
    countryCode: 'AU',
    timezone: 'Australia/Adelaide',
    currency: 'AUD',
    imageUrl: '',
    paymentPolicy: 'PayAtCounterAllowed',
    isActive: true,
    acceptingOrders: true,
    openingHours: createDefaultOpeningHours(),
    specialOpeningDays: [],
  }
}

function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function fromDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function parseOpeningHoursJson(openingHoursJson?: string | null): OpeningHoursDay[] {
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

function serializeOpeningHours(openingHours: OpeningHoursDay[]) {
  return JSON.stringify([...openingHours].sort((first, second) => first.dayOfWeek - second.dayOfWeek))
}

function parseSpecialOpeningDaysJson(specialOpeningDaysJson?: string | null): SpecialOpeningDay[] {
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

function serializeSpecialOpeningDays(specialOpeningDays: SpecialOpeningDay[]) {
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

function normalizeSpecialOpeningDay(value: unknown): SpecialOpeningDay {
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

function normalizeOpeningHoursDay(value: unknown): OpeningHoursDay {
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

function normalizeOpeningWindow(value: unknown): OpeningHoursWindow | null {
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

function hasOverlappingOpeningWindows(windows: OpeningHoursWindow[]) {
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

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

function getMonthCalendarDates(monthDate: Date) {
  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
  const gridStart = new Date(firstDay)
  gridStart.setDate(firstDay.getDate() - firstDay.getDay())

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart)
    date.setDate(gridStart.getDate() + index)
    return date
  })
}

function getRegularOpeningDayForDate(dateKey: string, openingHours: OpeningHoursDay[]) {
  const date = fromDateKey(dateKey)
  return openingHours.find((day) => day.dayOfWeek === date.getDay()) ?? createDefaultOpeningHours()[date.getDay()]
}

function getSpecialOpeningDay(dateKey: string, specialOpeningDays: SpecialOpeningDay[]) {
  return specialOpeningDays.find((day) => day.date === dateKey) ?? null
}

function resolveCalendarDateStatus(
  dateKey: string,
  openingHours: OpeningHoursDay[],
  specialOpeningDays: SpecialOpeningDay[],
) {
  const specialDay = getSpecialOpeningDay(dateKey, specialOpeningDays)

  if (specialDay) {
    return {
      isOpen: !specialDay.isClosed,
      isOverride: true,
      label: specialDay.isClosed ? 'Closed' : 'Special',
      windows: specialDay.isClosed ? [] : specialDay.windows,
      note: specialDay.note ?? '',
    }
  }

  const regularDay = getRegularOpeningDayForDate(dateKey, openingHours)
  return {
    isOpen: regularDay.isOpen,
    isOverride: false,
    label: regularDay.isOpen ? 'Open' : 'Closed',
    windows: regularDay.isOpen ? regularDay.windows : [],
    note: '',
  }
}

function formatOpeningWindows(windows: OpeningHoursWindow[]) {
  return windows.length > 0
    ? windows.map((window) => `${window.opensAt}-${window.closesAt}`).join(', ')
    : 'Closed'
}

function formatCalendarDate(dateKey: string) {
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(fromDateKey(dateKey))
}

function toPayload(values: RestaurantFormValues): RestaurantRequest {
  return {
    name: values.name.trim(),
    address: values.address.trim(),
    phone: formatPhoneForPayload(values.phoneCountryCode, values.phoneNationalNumber),
    countryCode: normalizeCountryCode(values.countryCode),
    timezone: values.timezone,
    currency: values.currency,
    imageUrl: values.imageUrl.trim() || null,
    paymentPolicy: values.paymentPolicy,
    isActive: values.isActive,
    acceptingOrders: values.acceptingOrders,
    openingHoursJson: serializeOpeningHours(values.openingHours),
    specialOpeningDaysJson: serializeSpecialOpeningDays(values.specialOpeningDays),
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

async function copyText(value: string, successMessage: string) {
  await navigator.clipboard.writeText(value)
  toast.success(successMessage)
}

function PublicAccessCard({
  title,
  description,
  url,
}: {
  title: string
  description: string
  url: string
}) {
  return (
    <div className="restaurant-public-card">
      <div className="restaurant-public-card-copy">
        <div className="restaurant-public-card-body">
          <div>
            <span>{title}</span>
            <strong>{description}</strong>
          </div>
          <code>{url}</code>
        </div>
        <div className="restaurant-public-card-actions">
          <Button type="button" variant="outline" size="sm" onClick={() => void copyText(url, `${title} copied`)}>
            <Copy size={15} />
            Copy
          </Button>
          <Button type="button" variant="secondary" size="sm" asChild>
            <a href={url} target="_blank" rel="noreferrer">
              <ExternalLink size={15} />
              Open
            </a>
          </Button>
        </div>
      </div>
      <div className="restaurant-public-card-qr">
        <QRCodeSVG value={url} size={132} />
      </div>
    </div>
  )
}

function RestaurantPublicAccessDialog({ restaurant }: { restaurant: Restaurant }) {
  const takeawayUrl = buildTakeawayPublicUrl(restaurant.id)

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="icon" title="Public takeaway access" aria-label="Public takeaway access">
          <Link2 size={16} />
        </Button>
      </DialogTrigger>
      <DialogContent className="restaurant-details-dialog">
        <DialogHeader>
          <DialogTitle>{restaurant.name} public access</DialogTitle>
          <DialogDescription>Share this link or QR code for takeaway and general restaurant ordering.</DialogDescription>
        </DialogHeader>
        <PublicAccessCard
          title="Takeaway menu"
          description={`${restaurant.name} public ordering entry`}
          url={takeawayUrl}
        />
      </DialogContent>
    </Dialog>
  )
}

type RestaurantFormDialogProps = {
  restaurant?: Restaurant
  onSaved: () => Promise<void> | void
}

type LocaleOption = {
  value: string
  label: string
  description?: string
  flagCountryCode?: string
  meta?: string
  searchValue: string
}

type LocaleComboboxProps = {
  value: string
  options: LocaleOption[]
  placeholder: string
  searchPlaceholder: string
  emptyMessage: string
  onChange: (value: string) => void
}

function CountryFlag({ countryCode }: { countryCode: string }) {
  return <span className={`country-flag fi fi-${countryCode.toLowerCase()}`} aria-hidden="true" />
}

type PhoneCountryOption = {
  code: CountryCode
  name: string
  dialCode: string
  searchValue: string
}

const defaultPhoneCountryCode: CountryCode = 'AU'

function getSupportedPhoneCountryCode(countryCode: string | null | undefined): CountryCode {
  const normalizedCountryCode = normalizeCountryCode(countryCode)
  return isSupportedCountry(normalizedCountryCode as CountryCode)
    ? (normalizedCountryCode as CountryCode)
    : defaultPhoneCountryCode
}

function getPhoneCallingCode(countryCode: string | null | undefined) {
  return getCountryCallingCode(getSupportedPhoneCountryCode(countryCode))
}

function cleanNationalPhoneInput(value: string) {
  return value.replace(/[^\d()\-\s]/g, '')
}

function splitPhoneForForm(phone: string | null | undefined, fallbackCountryCode: string | null | undefined) {
  const fallbackPhoneCountryCode = getSupportedPhoneCountryCode(fallbackCountryCode)
  const trimmedPhone = phone?.trim() ?? ''

  if (!trimmedPhone) {
    return {
      phoneCountryCode: fallbackPhoneCountryCode,
      phoneNationalNumber: '',
    }
  }

  const parsedPhone = parsePhoneNumberFromString(trimmedPhone, fallbackPhoneCountryCode)
  if (parsedPhone?.country) {
    return {
      phoneCountryCode: parsedPhone.country,
      phoneNationalNumber: parsedPhone.formatNational(),
    }
  }

  const fallbackCallingCode = getPhoneCallingCode(fallbackPhoneCountryCode)

  return {
    phoneCountryCode: fallbackPhoneCountryCode,
    phoneNationalNumber: cleanNationalPhoneInput(
      trimmedPhone
        .replace(new RegExp(`^\\+?${fallbackCallingCode}\\s*`), '')
        .replace(/^\+/, ''),
    ).trim(),
  }
}

function formatPhoneForPayload(countryCode: string, nationalNumber: string) {
  const phoneCountryCode = getSupportedPhoneCountryCode(countryCode)
  const cleanedNationalNumber = cleanNationalPhoneInput(nationalNumber).trim()
  const parsedNationalPhone = parsePhoneNumberFromString(cleanedNationalNumber, phoneCountryCode)

  if (parsedNationalPhone?.isPossible()) {
    return parsedNationalPhone.formatInternational()
  }

  const rawInternationalNumber = `+${getPhoneCallingCode(phoneCountryCode)} ${cleanedNationalNumber}`
  const parsedPhone = parsePhoneNumberFromString(rawInternationalNumber, phoneCountryCode)

  return parsedPhone?.isPossible() ? parsedPhone.formatInternational() : rawInternationalNumber
}

function LocaleCombobox({
  value,
  options,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  onChange,
}: LocaleComboboxProps) {
  const [open, setOpen] = useState(false)
  const selectedOption = options.find((option) => option.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <FormControl>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="locale-combobox-trigger"
          >
            <span className="locale-combobox-selection">
              {selectedOption?.flagCountryCode ? <CountryFlag countryCode={selectedOption.flagCountryCode} /> : null}
              {selectedOption ? (
                <span className="locale-combobox-selected-copy">
                  <strong>{selectedOption.label}</strong>
                  {selectedOption.meta ? <small>{selectedOption.meta}</small> : null}
                </span>
              ) : (
                <strong>{placeholder}</strong>
              )}
            </span>
            <ChevronsUpDown size={16} />
          </Button>
        </FormControl>
      </PopoverTrigger>
      <PopoverContent className="locale-combobox-content" align="start" side="bottom" sideOffset={6}>
        <Command className="locale-combobox-command">
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList className="locale-combobox-list">
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.searchValue}
                  data-checked={option.value === value}
                  onSelect={() => {
                    onChange(option.value)
                    setOpen(false)
                  }}
                >
                  <div className="locale-combobox-option-row">
                    {option.flagCountryCode ? <CountryFlag countryCode={option.flagCountryCode} /> : null}
                    <div className="locale-combobox-option">
                      <strong>{option.label}</strong>
                      {option.description ? <span>{option.description}</span> : null}
                      {option.meta ? <code>{option.meta}</code> : null}
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function PhoneCountryCombobox({
  value,
  options,
  onChange,
}: {
  value: string
  options: PhoneCountryOption[]
  onChange: (countryCode: CountryCode) => void
}) {
  const [open, setOpen] = useState(false)
  const selectedOption = options.find((option) => option.code === value) ?? options[0]

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="phone-country-trigger"
        >
          <span>
            <CountryFlag countryCode={selectedOption.code} />
            <strong>+{selectedOption.dialCode}</strong>
          </span>
          <ChevronsUpDown size={15} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="phone-country-content" align="start" side="bottom" sideOffset={6}>
        <Command className="locale-combobox-command">
          <CommandInput placeholder="Search country or dial code..." />
          <CommandList className="phone-country-list">
            <CommandEmpty>No dialing countries found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.code}
                  value={option.searchValue}
                  data-checked={option.code === selectedOption.code}
                  onSelect={() => {
                    onChange(option.code)
                    setOpen(false)
                  }}
                >
                  <div className="phone-country-option">
                    <CountryFlag countryCode={option.code} />
                    <div>
                      <strong>{option.name}</strong>
                      <span>{option.code} - +{option.dialCode}</span>
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function InternationalPhoneInput({
  countryCode,
  nationalNumber,
  options,
  onCountryChange,
  onNationalNumberChange,
  onBlur,
  className,
  id,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  ...containerProps
}: {
  countryCode: string
  nationalNumber: string
  options: PhoneCountryOption[]
  onCountryChange: (countryCode: CountryCode) => void
  onNationalNumberChange: (value: string) => void
  onBlur?: () => void
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...containerProps}
      className={['international-phone-input', className].filter(Boolean).join(' ')}
    >
      <PhoneCountryCombobox value={countryCode} options={options} onChange={onCountryChange} />
      <Input
        id={id}
        type="tel"
        inputMode="tel"
        value={nationalNumber}
        placeholder="412 345 678"
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        onBlur={onBlur}
        onChange={(event) => onNationalNumberChange(cleanNationalPhoneInput(event.target.value))}
      />
    </div>
  )
}

function OpeningHoursEditor({
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

function OpeningWindowsEditor({
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

function RestaurantFormDialog({ restaurant, onSaved }: RestaurantFormDialogProps) {
  const [open, setOpen] = useState(false)
  const [formTab, setFormTab] = useState<RestaurantFormTab>('basic')
  const editing = Boolean(restaurant)
  const timezoneOptions = useMemo(() => getTimezoneOptions(), [])
  const form = useForm<RestaurantFormValues>({
    resolver: zodResolver(restaurantSchema),
    defaultValues: createEmptyRestaurant(),
  })
  const selectedCountryCode = form.watch('countryCode')
  const selectedPhoneCountryCode = form.watch('phoneCountryCode')

  useEffect(() => {
    if (!open) {
      return
    }

    const restaurantCountryCode = restaurant?.countryCode || inferCountryCode(restaurant?.currency, restaurant?.timezone)
    const restaurantPhone = splitPhoneForForm(restaurant?.phone, restaurantCountryCode)

    form.reset(
      restaurant
        ? {
            name: restaurant.name,
            address: restaurant.address,
            phoneCountryCode: restaurantPhone.phoneCountryCode,
            phoneNationalNumber: restaurantPhone.phoneNationalNumber,
            countryCode: restaurantCountryCode,
            timezone: restaurant.timezone,
            currency: restaurant.currency,
            imageUrl: restaurant.imageUrl ?? '',
            paymentPolicy: restaurant.paymentPolicy,
            isActive: restaurant.isActive,
            acceptingOrders: restaurant.acceptingOrders,
            openingHours: parseOpeningHoursJson(restaurant.openingHoursJson),
            specialOpeningDays: parseSpecialOpeningDaysJson(restaurant.specialOpeningDaysJson),
          }
        : createEmptyRestaurant(),
    )
  }, [form, open, restaurant])

  const countryComboboxOptions = useMemo<LocaleOption[]>(
    () =>
      countryOptions.map((country) => ({
        value: country.code,
        label: `${country.name} (${country.code})`,
        description: `${country.defaultCurrency} - ${country.defaultTimezone}`,
        flagCountryCode: country.code,
        searchValue: `${country.name} ${country.code} ${country.defaultCurrency} ${country.defaultTimezone}`,
      })),
    [],
  )

  const phoneCountryOptions = useMemo<PhoneCountryOption[]>(
    () =>
      countryOptions
        .filter((country) => isSupportedCountry(country.code as CountryCode))
        .map((country) => ({
          code: country.code as CountryCode,
          name: country.name,
          dialCode: getCountryCallingCode(country.code as CountryCode),
          searchValue: `${country.name} ${country.code} +${getCountryCallingCode(country.code as CountryCode)}`,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [],
  )

  const currencyComboboxOptions = useMemo<LocaleOption[]>(
    () =>
      currencyOptions.map((currency: CurrencyOption) => ({
        value: currency.code,
        label: `${currency.code} - ${currency.name}`,
        searchValue: `${currency.code} ${currency.name}`,
      })),
    [],
  )

  const timezoneComboboxOptions = useMemo<LocaleOption[]>(() => {
    const normalizedCountryCode = normalizeCountryCode(selectedCountryCode)

    return [...timezoneOptions]
      .sort((left, right) => {
        const leftRecommended = timezoneBelongsToCountry(left, normalizedCountryCode) ? 0 : 1
        const rightRecommended = timezoneBelongsToCountry(right, normalizedCountryCode) ? 0 : 1

        return leftRecommended - rightRecommended || left.value.localeCompare(right.value)
      })
      .map((timezone: TimezoneOption) => {
        const countryCodes = timezone.countryCodes?.join(', ') ?? timezone.countryCode

        return {
          value: timezone.value,
          label: timezone.label,
          description: timezoneBelongsToCountry(timezone, normalizedCountryCode) ? 'Recommended for selected country' : undefined,
          meta: countryCodes,
          searchValue: `${timezone.value} ${countryCodes ?? ''}`,
        }
      })
  }, [selectedCountryCode, timezoneOptions])

  const applyCountryDefaults = (countryCode: string, force = false) => {
    const nextDefaults = getCountryDefaults(countryCode)

    if (force || !form.getValues('currency')) {
      form.setValue('currency', nextDefaults.defaultCurrency, { shouldDirty: true, shouldValidate: true })
    }

    if (force || !form.getValues('timezone')) {
      form.setValue('timezone', nextDefaults.defaultTimezone, { shouldDirty: true, shouldValidate: true })
    }
  }

  const handleCountryChange = (nextCountryCode: string) => {
    const previousCountryCode = form.getValues('countryCode')
    const previousDefaults = getCountryDefaults(previousCountryCode)
    const currentCurrency = form.getValues('currency')
    const currentTimezone = form.getValues('timezone')
    const nextDefaults = getCountryDefaults(nextCountryCode)

    form.setValue('countryCode', nextCountryCode, { shouldDirty: true, shouldValidate: true })

    if (!currentCurrency || currentCurrency === previousDefaults.defaultCurrency) {
      form.setValue('currency', nextDefaults.defaultCurrency, { shouldDirty: true, shouldValidate: true })
    }

    if (!currentTimezone || currentTimezone === previousDefaults.defaultTimezone) {
      form.setValue('timezone', nextDefaults.defaultTimezone, { shouldDirty: true, shouldValidate: true })
    }
  }

  const handleSubmit = async (values: RestaurantFormValues) => {
    try {
      if (restaurant) {
        const response = await updateRestaurant(restaurant.id, toPayload(values))
        toast.success('Restaurant updated', { description: response.message })
      } else {
        await createRestaurant(toPayload(values))
        toast.success('Restaurant created')
      }

      setOpen(false)
      await onSaved()
    } catch (error) {
      toast.error(editing ? 'Could not update restaurant' : 'Could not create restaurant', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    }
  }

  const handleInvalidSubmit = (errors: FieldErrors<RestaurantFormValues>) => {
    if (errors.imageUrl || errors.paymentPolicy || errors.isActive || errors.acceptingOrders || errors.openingHours || errors.specialOpeningDays) {
      setFormTab('advanced')
      return
    }

    setFormTab('basic')
  }

  const handleDialogOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)

    if (nextOpen) {
      setFormTab('basic')
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogTrigger asChild>
        {editing ? (
          <Button type="button" variant="outline" size="icon" title="Edit restaurant" aria-label="Edit restaurant">
            <Pencil size={16} />
          </Button>
        ) : (
          <Button type="button">
            <Plus size={18} />
            Create restaurant
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="restaurant-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit restaurant' : 'Create restaurant'}</DialogTitle>
          <DialogDescription>
            {editing ? 'Update this restaurant profile and operating status.' : 'Add a restaurant to the platform.'}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form className="restaurant-form" onSubmit={form.handleSubmit(handleSubmit, handleInvalidSubmit)}>
            <div className="restaurant-form-scroll">
              <Tabs value={formTab} onValueChange={(value) => setFormTab(value as RestaurantFormTab)} className="restaurant-form-tabs">
                <TabsList className="restaurant-form-tabs-list" aria-label="Restaurant form sections">
                  <TabsTrigger value="basic">
                    <Building2 size={15} />
                    Basic
                  </TabsTrigger>
                  <TabsTrigger value="advanced">
                    <SlidersHorizontal size={15} />
                    Advanced
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="basic" className="restaurant-form-tab-panel">
                  <div className="restaurant-form-grid restaurant-form-core-grid">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem className="restaurant-form-wide">
                          <FormLabel>Restaurant name</FormLabel>
                          <FormControl>
                            <Input placeholder="DineFlow Central" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="phoneNationalNumber"
                      render={({ field }) => (
                        <FormItem className="restaurant-form-stack-top restaurant-phone-field">
                          <FormLabel>Phone</FormLabel>
                          <FormControl>
                            <InternationalPhoneInput
                              countryCode={selectedPhoneCountryCode}
                              nationalNumber={field.value}
                              options={phoneCountryOptions}
                              onCountryChange={(countryCode) => {
                                form.setValue('phoneCountryCode', countryCode, { shouldDirty: true, shouldValidate: true })
                              }}
                              onNationalNumberChange={field.onChange}
                              onBlur={field.onBlur}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="countryCode"
                      render={({ field }) => (
                        <FormItem className="restaurant-form-stack-top">
                          <FormLabel>Country</FormLabel>
                          <LocaleCombobox
                            value={field.value}
                            options={countryComboboxOptions}
                            placeholder="Select country"
                            searchPlaceholder="Search countries..."
                            emptyMessage="No countries found."
                            onChange={handleCountryChange}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="locale-defaults-button"
                            onClick={() => applyCountryDefaults(form.getValues('countryCode'), true)}
                          >
                            Apply country defaults
                          </Button>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="currency"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Currency</FormLabel>
                          <LocaleCombobox
                            value={field.value}
                            options={currencyComboboxOptions}
                            placeholder="Select currency"
                            searchPlaceholder="Search currencies..."
                            emptyMessage="No currencies found."
                            onChange={field.onChange}
                          />
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="timezone"
                      render={({ field }) => (
                        <FormItem className="restaurant-form-wide">
                          <FormLabel>Timezone</FormLabel>
                          <LocaleCombobox
                            value={field.value}
                            options={timezoneComboboxOptions}
                            placeholder="Select timezone"
                            searchPlaceholder="Search timezones..."
                            emptyMessage="No timezones found."
                            onChange={field.onChange}
                          />
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem className="restaurant-form-wide">
                          <FormLabel>Address</FormLabel>
                          <FormControl>
                            <Textarea rows={2} placeholder="123 King William Street, Adelaide SA 5000" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </TabsContent>
                <TabsContent value="advanced" className="restaurant-form-tab-panel">
                  <div className="restaurant-form-grid restaurant-advanced-grid">
                    <FormField
                      control={form.control}
                      name="acceptingOrders"
                      render={({ field }) => (
                        <FormItem className="restaurant-status-field restaurant-form-wide">
                          <div>
                            <FormLabel>Accepting orders</FormLabel>
                            <p>Pause incoming customer orders without deactivating the restaurant.</p>
                          </div>
                          <FormControl>
                            <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Accepting orders" />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="openingHours"
                      render={({ field }) => (
                        <FormItem className="restaurant-form-wide">
                          <FormLabel className="inline-flex items-center gap-2">
                            <CalendarClock size={14} />
                            Opening hours
                          </FormLabel>
                          <OpeningHoursEditor value={field.value} onChange={field.onChange} />
                          <p className="text-xs text-muted-foreground">
                            Orders are blocked automatically outside these local restaurant hours.
                          </p>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="imageUrl"
                      render={({ field }) => (
                        <FormItem className="restaurant-form-wide">
                          <FormLabel className="inline-flex items-center gap-2">
                            <ImageIcon size={14} />
                            Restaurant image URL
                          </FormLabel>
                          <FormControl>
                            <Input placeholder="/seed-menu/veg-spring-rolls.svg or https://..." {...field} />
                          </FormControl>
                          <p className="text-xs text-muted-foreground">
                            Used as the public ordering hero image. Leave blank to use the default gradient card.
                          </p>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="paymentPolicy"
                      render={({ field }) => (
                        <FormItem className="restaurant-form-wide">
                          <FormLabel>Customer payment</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger><SelectValue placeholder="Select payment policy" /></SelectTrigger>
                            </FormControl>
                            <SelectContent position="popper">
                              <SelectItem value="PrepayRequired">Online payment required</SelectItem>
                              <SelectItem value="PayAtCounterAllowed">Online or pay at counter</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">
                            This controls whether an unpaid counter order may enter the staff workflow.
                          </p>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="isActive"
                      render={({ field }) => (
                        <FormItem className="restaurant-status-field restaurant-form-wide">
                          <div>
                            <FormLabel>Operating status</FormLabel>
                            <p>Inactive restaurants remain available for historical records but cannot operate normally.</p>
                          </div>
                          <FormControl>
                            <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Restaurant active status" />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                </TabsContent>
              </Tabs>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Saving restaurant' : editing ? 'Save changes' : 'Create restaurant'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function RestaurantDetailsDialog({ restaurant }: { restaurant: Restaurant }) {
  const takeawayUrl = buildTakeawayPublicUrl(restaurant.id)
  const country = getCountryOption(restaurant.countryCode)
  const restaurantImageUrl = resolvePublicAssetUrl(restaurant.imageUrl)

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon" title="View restaurant" aria-label="View restaurant">
          <Eye size={16} />
        </Button>
      </DialogTrigger>
      <DialogContent className="restaurant-details-dialog">
        <DialogHeader>
          <DialogTitle>{restaurant.name}</DialogTitle>
          <DialogDescription>Restaurant profile and operating configuration.</DialogDescription>
        </DialogHeader>
        <div className="restaurant-details-grid">
          {restaurantImageUrl ? (
            <div className="restaurant-detail-wide overflow-hidden rounded-2xl border bg-muted">
              <img
                src={restaurantImageUrl}
                alt={`${restaurant.name} restaurant image`}
                className="h-44 w-full object-cover"
              />
            </div>
          ) : null}
          <div><span>Status</span><Badge variant={restaurant.isActive ? 'secondary' : 'destructive'}>{restaurant.isActive ? 'Active' : 'Inactive'}</Badge></div>
          <div><span>Image</span><strong>{restaurant.imageUrl ? 'Configured' : 'Default hero'}</strong></div>
          <div>
            <span>Country</span>
            <strong className="restaurant-locale-inline">
              <CountryFlag countryCode={restaurant.countryCode} />
              {country ? `${country.name} (${country.code})` : restaurant.countryCode}
            </strong>
          </div>
          <div><span>Currency</span><strong>{restaurant.currency}</strong></div>
          <div><span>Payment</span><strong>{restaurant.paymentPolicy === 'PrepayRequired' ? 'Online payment required' : 'Online or counter'}</strong></div>
          <div className="restaurant-detail-wide"><span>Address</span><strong>{restaurant.address}</strong></div>
          <div><span>Phone</span><strong>{restaurant.phone}</strong></div>
          <div><span>Timezone</span><strong>{restaurant.timezone}</strong></div>
          <div><span>Created</span><strong>{formatDate(restaurant.createdAt)}</strong></div>
          <div><span>Last updated</span><strong>{restaurant.updatedAt ? formatDate(restaurant.updatedAt) : 'Not updated'}</strong></div>
          <div className="restaurant-detail-wide"><span>Restaurant ID</span><code>{restaurant.id}</code></div>
        </div>
        <div className="restaurant-public-section">
          <h3>Public takeaway access</h3>
          <p>Share this public menu link for takeaway or general restaurant ordering.</p>
          <PublicAccessCard
            title="Takeaway menu"
            description={`${restaurant.name} public ordering entry`}
            url={takeawayUrl}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

type RestaurantOpeningHoursPanelProps = {
  restaurants: Restaurant[]
  restaurantsLoading: boolean
  canSelectRestaurant: boolean
  onSaved: () => Promise<void> | void
  onRestaurantUpdated: (restaurant: Restaurant) => void
}

function RestaurantOpeningHoursPanel({
  restaurants,
  restaurantsLoading,
  canSelectRestaurant,
  onSaved,
  onRestaurantUpdated,
}: RestaurantOpeningHoursPanelProps) {
  const [restaurantId, setRestaurantId] = useState('')
  const [draftState, setDraftState] = useState<{
    restaurantId: string
    acceptingOrders: boolean
    openingHours: OpeningHoursDay[]
  } | null>(null)
  const [saving, setSaving] = useState(false)
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(false)
  const [autoSaveState, setAutoSaveState] = useState<AutosaveState>('idle')
  const [savedHoursState, setSavedHoursState] = useState<{
    restaurantId: string
    sourceAcceptingOrders: boolean
    sourceOpeningHoursJson: string
    acceptingOrders: boolean
    openingHoursJson: string
  } | null>(null)
  const selectedRestaurantId = restaurantId && restaurants.some((restaurant) => restaurant.id === restaurantId)
    ? restaurantId
    : restaurants[0]?.id || ''
  const selectedRestaurant = restaurants.find((restaurant) => restaurant.id === selectedRestaurantId)
  const currentDraftState = draftState?.restaurantId === selectedRestaurant?.id ? draftState : null
  const draftAcceptingOrders = currentDraftState
    ? currentDraftState.acceptingOrders
    : selectedRestaurant?.acceptingOrders ?? true
  const draftOpeningHours = currentDraftState
    ? currentDraftState.openingHours
    : selectedRestaurant
      ? parseOpeningHoursJson(selectedRestaurant.openingHoursJson)
      : createDefaultOpeningHours()
  const selectedOpeningHoursJson = selectedRestaurant
    ? serializeOpeningHours(parseOpeningHoursJson(selectedRestaurant.openingHoursJson))
    : serializeOpeningHours(createDefaultOpeningHours())
  const committedHoursState = savedHoursState &&
    selectedRestaurant &&
    savedHoursState.restaurantId === selectedRestaurant.id &&
    savedHoursState.sourceAcceptingOrders === selectedRestaurant.acceptingOrders &&
    savedHoursState.sourceOpeningHoursJson === selectedRestaurant.openingHoursJson
    ? savedHoursState
    : null
  const committedAcceptingOrders = committedHoursState?.acceptingOrders ?? selectedRestaurant?.acceptingOrders ?? true
  const committedOpeningHoursJson = committedHoursState?.openingHoursJson ?? selectedOpeningHoursJson
  const draftOpeningHoursJson = serializeOpeningHours(draftOpeningHours)
  const latestHoursDraftRef = useRef({
    acceptingOrders: draftAcceptingOrders,
    openingHoursJson: draftOpeningHoursJson,
  })
  const hasChanges = Boolean(selectedRestaurant) &&
    (draftAcceptingOrders !== committedAcceptingOrders || draftOpeningHoursJson !== committedOpeningHoursJson)
  const openingHoursValidation = z.array(openingHoursDaySchema).length(7).safeParse(draftOpeningHours)
  const effectiveAutoSaveState = hasChanges && !openingHoursValidation.success ? 'error' : autoSaveState
  const autoSaveLabel = saving
    ? 'Saving...'
    : effectiveAutoSaveState === 'error'
      ? 'Check time ranges'
    : !autoSaveEnabled && hasChanges
      ? 'Save needed'
      : effectiveAutoSaveState === 'pending'
      ? 'Auto-saving...'
      : hasChanges
          ? 'Unsaved changes'
          : 'Saved'

  useEffect(() => {
    latestHoursDraftRef.current = {
      acceptingOrders: draftAcceptingOrders,
      openingHoursJson: draftOpeningHoursJson,
    }
  }, [draftAcceptingOrders, draftOpeningHoursJson])

  const updateDraft = (patch: Partial<Omit<NonNullable<typeof draftState>, 'restaurantId'>>) => {
    if (!selectedRestaurant) {
      return
    }

    setDraftState({
      restaurantId: selectedRestaurant.id,
      acceptingOrders: patch.acceptingOrders ?? draftAcceptingOrders,
      openingHours: patch.openingHours ?? draftOpeningHours,
    })
    setAutoSaveState(autoSaveEnabled ? 'pending' : 'idle')
  }

  const resetDraft = () => {
    if (!selectedRestaurant) {
      return
    }

    setDraftState({
      restaurantId: selectedRestaurant.id,
      acceptingOrders: selectedRestaurant.acceptingOrders,
      openingHours: parseOpeningHoursJson(selectedRestaurant.openingHoursJson),
    })
    setAutoSaveState('idle')
  }

  const handleAutoSaveEnabledChange = (enabled: boolean) => {
    setAutoSaveEnabled(enabled)
    setAutoSaveState(enabled && hasChanges ? 'pending' : 'idle')
  }

  const saveOpeningHours = useCallback(async ({ showToast = false }: { showToast?: boolean } = {}) => {
    if (!selectedRestaurant || saving) {
      return
    }

    const openingHoursResult = z.array(openingHoursDaySchema).length(7).safeParse(draftOpeningHours)
    if (!openingHoursResult.success) {
      setAutoSaveState('error')
      if (showToast) {
        toast.error('Could not save opening hours', {
          description: openingHoursResult.error.issues[0]?.message ?? 'Please check each day has valid times.',
        })
      }
      return
    }

    setSaving(true)
    setAutoSaveState('saving')
    const nextOpeningHoursJson = serializeOpeningHours(openingHoursResult.data)
    const submittedAcceptingOrders = draftAcceptingOrders

    try {
      const response = await updateRestaurant(selectedRestaurant.id, {
        name: selectedRestaurant.name,
        address: selectedRestaurant.address,
        phone: selectedRestaurant.phone,
        imageUrl: selectedRestaurant.imageUrl,
        countryCode: selectedRestaurant.countryCode,
        timezone: selectedRestaurant.timezone,
        currency: selectedRestaurant.currency,
        paymentPolicy: selectedRestaurant.paymentPolicy,
        isActive: selectedRestaurant.isActive,
        acceptingOrders: submittedAcceptingOrders,
        openingHoursJson: nextOpeningHoursJson,
        specialOpeningDaysJson: selectedRestaurant.specialOpeningDaysJson,
      })

      const latestDraft = latestHoursDraftRef.current
      const responseOpeningHoursJson = serializeOpeningHours(parseOpeningHoursJson(response.restaurant.openingHoursJson))

      if (
        latestDraft.acceptingOrders === submittedAcceptingOrders &&
        latestDraft.openingHoursJson === nextOpeningHoursJson
      ) {
        setDraftState({
          restaurantId: response.restaurant.id,
          acceptingOrders: response.restaurant.acceptingOrders,
          openingHours: parseOpeningHoursJson(response.restaurant.openingHoursJson),
        })
        setAutoSaveState('saved')
      } else {
        setAutoSaveState('pending')
      }

      setSavedHoursState({
        restaurantId: response.restaurant.id,
        sourceAcceptingOrders: selectedRestaurant.acceptingOrders,
        sourceOpeningHoursJson: selectedRestaurant.openingHoursJson,
        acceptingOrders: response.restaurant.acceptingOrders,
        openingHoursJson: responseOpeningHoursJson,
      })
      onRestaurantUpdated(response.restaurant)
      if (showToast) {
        toast.success('Opening hours updated', { description: response.message })
      }
    } catch (error) {
      setAutoSaveState('error')
      toast.error('Could not update opening hours', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    } finally {
      setSaving(false)
    }
  }, [draftAcceptingOrders, draftOpeningHours, onRestaurantUpdated, saving, selectedRestaurant])

  useEffect(() => {
    if (!autoSaveEnabled || !selectedRestaurant || !hasChanges || saving) {
      return
    }

    if (!openingHoursValidation.success) {
      return
    }

    const timer = window.setTimeout(() => {
      void saveOpeningHours()
    }, 900)

    return () => window.clearTimeout(timer)
  }, [autoSaveEnabled, draftOpeningHoursJson, hasChanges, openingHoursValidation.success, saveOpeningHours, saving, selectedRestaurant])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void saveOpeningHours({ showToast: true })
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
          <div className="restaurant-autosave-toggle">
            <span>Auto save</span>
            <Switch
              checked={autoSaveEnabled}
              onCheckedChange={handleAutoSaveEnabledChange}
              aria-label="Auto save opening hours"
            />
          </div>
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
                  setRestaurantId(value)
                  setDraftState(null)
                }}
                disabled={restaurantsLoading || restaurants.length === 0}
              >
                <SelectTrigger><SelectValue placeholder="Select restaurant" /></SelectTrigger>
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
              <Badge variant={draftAcceptingOrders ? 'outline' : 'destructive'}>
                {draftAcceptingOrders ? 'Accepting orders' : 'Paused'}
              </Badge>
            </div>
          ) : null}
        </div>

        {!selectedRestaurant && !restaurantsLoading ? (
          <div className="restaurant-mobile-empty">No restaurant is available for this account.</div>
        ) : null}

        {selectedRestaurant ? (
          <form className="restaurant-hours-form" onSubmit={handleSubmit}>
            <div className="restaurant-status-field restaurant-hours-status-field">
              <div>
                <span className="restaurant-hours-field-label">Accepting orders</span>
                <p>Turn this off when the kitchen is overloaded. Opening hours still apply automatically.</p>
              </div>
              <Switch
                checked={draftAcceptingOrders}
                onCheckedChange={(checked) => updateDraft({ acceptingOrders: checked })}
                aria-label="Accepting orders"
              />
            </div>

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
                onChange={(openingHours) => updateDraft({ openingHours })}
              />
            </div>

            <div className="restaurant-hours-actions">
              <span className="restaurant-autosave-status" data-state={effectiveAutoSaveState} aria-live="polite">
                {autoSaveLabel}
              </span>
              <Button type="button" variant="outline" onClick={resetDraft} disabled={!hasChanges || saving}>
                Reset
              </Button>
              <Button type="submit" disabled={!hasChanges || saving}>
                {saving ? 'Saving hours' : 'Save now'}
              </Button>
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  )
}

type RestaurantSpecialCalendarPanelProps = {
  restaurants: Restaurant[]
  restaurantsLoading: boolean
  canSelectRestaurant: boolean
  onSaved: () => Promise<void> | void
  onRestaurantUpdated: (restaurant: Restaurant) => void
}

function RestaurantSpecialCalendarPanel({
  restaurants,
  restaurantsLoading,
  canSelectRestaurant,
  onSaved,
  onRestaurantUpdated,
}: RestaurantSpecialCalendarPanelProps) {
  const todayKey = toDateKey(new Date())
  const [restaurantId, setRestaurantId] = useState('')
  const [monthDate, setMonthDate] = useState(() => {
    const today = new Date()
    return new Date(today.getFullYear(), today.getMonth(), 1)
  })
  const [selectedDateKey, setSelectedDateKey] = useState(todayKey)
  const [draftState, setDraftState] = useState<{
    restaurantId: string
    specialOpeningDays: SpecialOpeningDay[]
  } | null>(null)
  const [saving, setSaving] = useState(false)
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(false)
  const [autoSaveState, setAutoSaveState] = useState<AutosaveState>('idle')
  const [savedCalendarState, setSavedCalendarState] = useState<{
    restaurantId: string
    sourceSpecialOpeningDaysJson: string
    specialOpeningDaysJson: string
  } | null>(null)
  const selectedRestaurantId = restaurantId && restaurants.some((restaurant) => restaurant.id === restaurantId)
    ? restaurantId
    : restaurants[0]?.id || ''
  const selectedRestaurant = restaurants.find((restaurant) => restaurant.id === selectedRestaurantId)
  const selectedRestaurantRef = useRef<Restaurant | undefined>(selectedRestaurant)
  const savingRef = useRef(saving)
  const currentDraftState = draftState?.restaurantId === selectedRestaurant?.id ? draftState : null
  const openingHours = selectedRestaurant ? parseOpeningHoursJson(selectedRestaurant.openingHoursJson) : createDefaultOpeningHours()
  const specialOpeningDays = currentDraftState
    ? currentDraftState.specialOpeningDays
    : selectedRestaurant
      ? parseSpecialOpeningDaysJson(selectedRestaurant.specialOpeningDaysJson)
      : []
  const selectedStatus = resolveCalendarDateStatus(selectedDateKey, openingHours, specialOpeningDays)
  const selectedSpecialDay = getSpecialOpeningDay(selectedDateKey, specialOpeningDays)
  const selectedRegularDay = getRegularOpeningDayForDate(selectedDateKey, openingHours)
  const calendarDates = getMonthCalendarDates(monthDate)
  const monthLabel = new Intl.DateTimeFormat('en-AU', {
    month: 'long',
    year: 'numeric',
  }).format(monthDate)
  const selectedJson = selectedRestaurant
    ? serializeSpecialOpeningDays(parseSpecialOpeningDaysJson(selectedRestaurant.specialOpeningDaysJson))
    : '[]'
  const committedCalendarState = savedCalendarState &&
    selectedRestaurant &&
    savedCalendarState.restaurantId === selectedRestaurant.id &&
    savedCalendarState.sourceSpecialOpeningDaysJson === selectedRestaurant.specialOpeningDaysJson
    ? savedCalendarState
    : null
  const committedSpecialOpeningDaysJson = committedCalendarState?.specialOpeningDaysJson ?? selectedJson
  const draftJson = serializeSpecialOpeningDays(specialOpeningDays)
  const latestCalendarDraftRef = useRef(draftJson)
  const hasChanges = Boolean(selectedRestaurant) && committedSpecialOpeningDaysJson !== draftJson
  const specialCalendarValidation = z.array(specialOpeningDaySchema).safeParse(specialOpeningDays)
  const effectiveAutoSaveState = hasChanges && !specialCalendarValidation.success ? 'error' : autoSaveState
  const autoSaveLabel = saving
    ? 'Saving...'
    : effectiveAutoSaveState === 'error'
      ? 'Check special hours'
    : !autoSaveEnabled && hasChanges
      ? 'Save needed'
      : effectiveAutoSaveState === 'pending'
      ? 'Auto-saving...'
      : hasChanges
          ? 'Unsaved changes'
          : 'Saved'

  useEffect(() => {
    latestCalendarDraftRef.current = draftJson
  }, [draftJson])

  useEffect(() => {
    selectedRestaurantRef.current = selectedRestaurant
  }, [selectedRestaurant])

  useEffect(() => {
    savingRef.current = saving
  }, [saving])

  const setDraftSpecialOpeningDays = (nextSpecialOpeningDays: SpecialOpeningDay[]) => {
    if (!selectedRestaurant) {
      return
    }

    setDraftState({
      restaurantId: selectedRestaurant.id,
      specialOpeningDays: normalizeSpecialOpeningDaysForDraft(nextSpecialOpeningDays),
    })
    setAutoSaveState(autoSaveEnabled ? 'pending' : 'idle')
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

  const removeSelectedOverride = () => {
    setDraftSpecialOpeningDays(specialOpeningDays.filter((day) => day.date !== selectedDateKey))
  }

  const markSelectedClosed = () => {
    upsertSpecialDay(createClosedSpecialDay(selectedDateKey))
  }

  const setSelectedSpecialHours = () => {
    upsertSpecialDay(createOpenSpecialDay(selectedDateKey, getSpecialOpeningSeedWindows(selectedRegularDay)))
  }

  const setSelectedOverrideOpen = () => {
    updateSelectedSpecialDay({
      isClosed: false,
      windows: getSpecialOpeningSeedWindows(selectedRegularDay, selectedSpecialDay?.windows ?? []),
    })
  }

  const setSelectedOverrideClosed = () => {
    updateSelectedSpecialDay({
      isClosed: true,
      windows: [],
    })
  }

  const moveMonth = (offset: number) => {
    setMonthDate((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1))
  }

  const resetDraft = () => {
    if (!selectedRestaurant) {
      return
    }

    setDraftState({
      restaurantId: selectedRestaurant.id,
      specialOpeningDays: parseSpecialOpeningDaysJson(selectedRestaurant.specialOpeningDaysJson),
    })
    setAutoSaveState('idle')
  }

  const handleAutoSaveEnabledChange = (enabled: boolean) => {
    setAutoSaveEnabled(enabled)
    setAutoSaveState(enabled && hasChanges ? 'pending' : 'idle')
  }

  const saveSpecialCalendar = useCallback(async (
    nextSpecialOpeningDays: SpecialOpeningDay[],
    { showToast = false }: { showToast?: boolean } = {},
  ) => {
    const restaurant = selectedRestaurantRef.current

    if (!restaurant || savingRef.current) {
      return
    }

    const normalizedSpecialOpeningDays = normalizeSpecialOpeningDaysForDraft(nextSpecialOpeningDays)
    const validation = z.array(specialOpeningDaySchema).safeParse(normalizedSpecialOpeningDays)
    if (!validation.success) {
      setAutoSaveState('error')
      if (showToast) {
        toast.error('Could not save special calendar', {
          description: validation.error.issues[0]?.message ?? 'Please check the selected date override.',
        })
      }
      return
    }

    savingRef.current = true
    setSaving(true)
    setAutoSaveState('saving')
    const nextSpecialOpeningDaysJson = serializeSpecialOpeningDays(validation.data)

    try {
      const response = await updateRestaurant(restaurant.id, {
        name: restaurant.name,
        address: restaurant.address,
        phone: restaurant.phone,
        imageUrl: restaurant.imageUrl,
        countryCode: restaurant.countryCode,
        timezone: restaurant.timezone,
        currency: restaurant.currency,
        paymentPolicy: restaurant.paymentPolicy,
        isActive: restaurant.isActive,
        acceptingOrders: restaurant.acceptingOrders,
        openingHoursJson: restaurant.openingHoursJson,
        specialOpeningDaysJson: nextSpecialOpeningDaysJson,
      })

      const responseSpecialOpeningDays = parseSpecialOpeningDaysJson(response.restaurant.specialOpeningDaysJson)
      const responseSpecialOpeningDaysJson = serializeSpecialOpeningDays(responseSpecialOpeningDays)

      if (latestCalendarDraftRef.current === nextSpecialOpeningDaysJson) {
        setDraftState({
          restaurantId: response.restaurant.id,
          specialOpeningDays: responseSpecialOpeningDays,
        })
        setAutoSaveState('saved')
      } else {
        setAutoSaveState('pending')
      }

      setSavedCalendarState({
        restaurantId: response.restaurant.id,
        sourceSpecialOpeningDaysJson: restaurant.specialOpeningDaysJson,
        specialOpeningDaysJson: responseSpecialOpeningDaysJson,
      })
      onRestaurantUpdated(response.restaurant)
      if (showToast) {
        toast.success('Special calendar updated', { description: response.message })
      }
    } catch (error) {
      setAutoSaveState('error')
      toast.error('Could not update special calendar', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [onRestaurantUpdated])

  useEffect(() => {
    if (!autoSaveEnabled || !selectedRestaurant || !hasChanges || saving) {
      return
    }

    let draftSpecialOpeningDays: unknown
    try {
      draftSpecialOpeningDays = JSON.parse(draftJson)
    } catch {
      return
    }

    const validation = z.array(specialOpeningDaySchema).safeParse(draftSpecialOpeningDays)
    if (!validation.success) {
      return
    }

    const timer = window.setTimeout(() => {
      void saveSpecialCalendar(validation.data)
    }, 900)

    return () => window.clearTimeout(timer)
  }, [autoSaveEnabled, draftJson, hasChanges, saveSpecialCalendar, saving, selectedRestaurant])

  const handleSave = () => {
    void saveSpecialCalendar(specialOpeningDays, { showToast: true })
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
          <div className="restaurant-autosave-toggle">
            <span>Auto save</span>
            <Switch
              checked={autoSaveEnabled}
              onCheckedChange={handleAutoSaveEnabledChange}
              aria-label="Auto save special calendar"
            />
          </div>
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
                  setRestaurantId(value)
                  setDraftState(null)
                }}
                disabled={restaurantsLoading || restaurants.length === 0}
              >
                <SelectTrigger><SelectValue placeholder="Select restaurant" /></SelectTrigger>
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
              <Badge variant={effectiveAutoSaveState === 'error' ? 'destructive' : hasChanges || saving ? 'secondary' : 'outline'}>
                {autoSaveLabel}
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
                      className={[
                        'restaurant-calendar-day',
                        outsideMonth ? 'is-outside-month' : '',
                        selected ? 'is-selected' : '',
                        today ? 'is-today' : '',
                        status.isOpen ? 'is-open' : 'is-closed',
                        status.isOverride ? 'has-override' : '',
                      ].filter(Boolean).join(' ')}
                      onClick={() => setSelectedDateKey(dateKey)}
                    >
                      <span className="restaurant-calendar-day-number">{date.getDate()}</span>
                      <span className="restaurant-calendar-day-status">{status.label}</span>
                    </button>
                  )
                })}
              </div>
            </section>

            <aside className="restaurant-calendar-detail">
              <div className="restaurant-calendar-detail-header">
                <div>
                  <span>{formatCalendarDate(selectedDateKey)}</span>
                  <h3>
                    {selectedSpecialDay
                      ? selectedSpecialDay.isClosed
                        ? 'Special closure'
                        : 'Special opening'
                      : 'Weekly schedule'}
                  </h3>
                </div>
                <Badge variant={selectedStatus.isOpen ? 'secondary' : 'destructive'}>
                  {selectedStatus.isOverride && selectedStatus.isOpen ? 'Special open' : selectedStatus.isOpen ? 'Open' : 'Closed'}
                </Badge>
              </div>

              <div className="restaurant-calendar-summary">
                <div>
                  <span>Weekly baseline</span>
                  <strong>{selectedRegularDay.isOpen ? formatOpeningWindows(selectedRegularDay.windows) : 'Closed'}</strong>
                </div>
                <div>
                  <span>Selected day</span>
                  <strong>{formatOpeningWindows(selectedStatus.windows)}</strong>
                </div>
              </div>

              {selectedSpecialDay ? (
                <div className="restaurant-calendar-override-form">
                  <div className="restaurant-calendar-mode-picker" role="group" aria-label="Special day mode">
                    {selectedSpecialDay.isClosed ? (
                      <Button type="button" onClick={setSelectedOverrideOpen}>
                        <Plus size={15} />
                        Open specially
                      </Button>
                    ) : (
                      <Button type="button" variant="destructive" onClick={setSelectedOverrideClosed}>
                        <X size={15} />
                        Close all day
                      </Button>
                    )}
                  </div>
                  <p className="restaurant-calendar-mode-help">
                    Special dates override the weekly schedule for this day.
                  </p>
                  {!selectedSpecialDay.isClosed ? (
                    <OpeningWindowsEditor
                      windows={selectedSpecialDay.windows}
                      onChange={(windows) => updateSelectedSpecialDay({ windows })}
                    />
                  ) : null}
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
                  <Button type="button" variant="ghost" className="restaurant-calendar-remove-override" onClick={removeSelectedOverride}>
                    <Trash2 size={15} />
                    Remove override
                  </Button>
                </div>
              ) : (
                <div className="restaurant-calendar-empty-override">
                  <p>This date is using the weekly schedule.</p>
                  <div>
                    {selectedStatus.isOpen ? (
                      <>
                        <Button type="button" variant="outline" onClick={setSelectedSpecialHours}>
                          <Pencil size={15} />
                          Adjust hours
                        </Button>
                        <Button type="button" variant="destructive" onClick={markSelectedClosed}>
                          <X size={15} />
                          Close all day
                        </Button>
                      </>
                    ) : (
                      <Button type="button" onClick={setSelectedSpecialHours}>
                        <Plus size={15} />
                        Open specially
                      </Button>
                    )}
                  </div>
                </div>
              )}

              <div className="restaurant-hours-actions">
                <span className="restaurant-autosave-status" data-state={effectiveAutoSaveState} aria-live="polite">
                  {autoSaveLabel}
                </span>
                <Button type="button" variant="outline" onClick={resetDraft} disabled={!hasChanges || saving}>
                  Reset
                </Button>
                <Button type="button" onClick={() => void handleSave()} disabled={!hasChanges || saving}>
                  {saving ? 'Saving calendar' : 'Save now'}
                </Button>
              </div>
            </aside>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function AdminRestaurantsPage() {
  const { user } = useAuth()
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [allRestaurants, setAllRestaurants] = useState<Restaurant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [currencyFilter, setCurrencyFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [totalItems, setTotalItems] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: 'name', direction: 'asc' })
  const [activeRestaurantTab, setActiveRestaurantTab] = useState<RestaurantAdminTab | null>(null)
  const isPlatformOwner = user?.roles.includes('PlatformOwner') ?? false
  const restaurantTabOrder = useMemo(
    () => isPlatformOwner
      ? [
          { value: 'restaurants' as const, label: 'Restaurants', icon: Building2 },
          { value: 'hours' as const, label: 'Hours', icon: CalendarClock },
          { value: 'calendar' as const, label: 'Calendar', icon: CalendarDays },
          { value: 'tables' as const, label: 'Tables', icon: Armchair },
        ]
      : [
          { value: 'tables' as const, label: 'Tables', icon: Armchair },
          { value: 'hours' as const, label: 'Hours', icon: CalendarClock },
          { value: 'calendar' as const, label: 'Calendar', icon: CalendarDays },
          { value: 'restaurants' as const, label: 'Restaurants', icon: Building2 },
        ],
    [isPlatformOwner],
  )
  const activeRestaurantTabValue = activeRestaurantTab ?? (isPlatformOwner ? 'restaurants' : 'tables')

  const loadRestaurants = useCallback(async (showToast = false) => {
    setLoading(true)
    setError(null)

    try {
      const response = await getRestaurantPage({
        page,
        pageSize,
        search: search.trim() || undefined,
        sortBy: sort.key === 'created' ? 'createdAt' : sort.key,
        sortDirection: sort.direction,
        isActive: statusFilter === 'all' ? undefined : statusFilter === 'active',
        currency: currencyFilter === 'all' ? undefined : currencyFilter,
      })
      setRestaurants(response.items)
      setTotalItems(response.totalItems)
      setTotalPages(response.totalPages)

      if (response.totalPages > 0 && page > response.totalPages) {
        setPage(response.totalPages)
      }

      if (showToast) toast.success('Restaurant directory refreshed')
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load restaurants.'
      setError(message)
      toast.error('Could not load restaurants', { description: message })
    } finally {
      setLoading(false)
    }
  }, [currencyFilter, page, pageSize, search, sort, statusFilter])

  const loadRestaurantOptions = useCallback(async () => {
    setAllRestaurants(await getRestaurants())
  }, [])

  useEffect(() => {
    void Promise.resolve().then(() => loadRestaurants())
  }, [loadRestaurants])

  useEffect(() => {
    void Promise.resolve().then(() => loadRestaurantOptions())
  }, [loadRestaurantOptions])

  const currencyOptionsInUse = useMemo(
    () => Array.from(new Set(allRestaurants.map((restaurant) => restaurant.currency))).sort(),
    [allRestaurants],
  )
  const currentPage = totalPages === 0 ? 0 : page
  const pageStart = totalItems === 0 ? 0 : (page - 1) * pageSize + 1
  const pageEnd = Math.min(page * pageSize, totalItems)
  const hasActiveFilters = search.trim() !== '' || statusFilter !== 'all' || currencyFilter !== 'all'
  const activeRestaurantDropdownFilterCount = [statusFilter !== 'all', currencyFilter !== 'all'].filter(Boolean).length
  const selectedStatusFilterLabel = statusFilter === 'active' ? 'Active' : statusFilter === 'inactive' ? 'Inactive' : ''
  const SortIcon = sort.direction === 'asc' ? ArrowDownAZ : ArrowUpAZ

  const updateSort = (key: SortKey) => {
    setPage(1)
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  const resetFilters = () => {
    setPage(1)
    setSearch('')
    setStatusFilter('all')
    setCurrencyFilter('all')
  }

  const refreshRestaurantData = async () => {
    await Promise.all([loadRestaurants(), loadRestaurantOptions()])
  }

  const updateRestaurantInState = (updatedRestaurant: Restaurant) => {
    setRestaurants((currentRestaurants) => currentRestaurants.map((restaurant) => (
      restaurant.id === updatedRestaurant.id ? updatedRestaurant : restaurant
    )))
    setAllRestaurants((currentRestaurants) => currentRestaurants.map((restaurant) => (
      restaurant.id === updatedRestaurant.id ? updatedRestaurant : restaurant
    )))
  }

  const handleDelete = async (restaurant: Restaurant) => {
    try {
      const response = await deleteRestaurant(restaurant.id)
      toast.success('Restaurant deleted', { description: response.message })
      await refreshRestaurantData()
    } catch (deleteError) {
      toast.error('Could not delete restaurant', {
        description: deleteError instanceof Error ? deleteError.message : 'The request failed.',
      })
    }
  }
  const renderRestaurantActions = (restaurant: Restaurant) => (
    <div className="row-actions">
      <RestaurantDetailsDialog restaurant={restaurant} />
      <RestaurantPublicAccessDialog restaurant={restaurant} />
      <RestaurantFormDialog restaurant={restaurant} onSaved={() => refreshRestaurantData()} />
      {isPlatformOwner && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="destructive" size="icon" title="Delete restaurant" aria-label="Delete restaurant"><Trash2 size={16} /></Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {restaurant.name}?</AlertDialogTitle>
              <AlertDialogDescription>This permanently removes the restaurant. The request will fail if related records still depend on it.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => void handleDelete(restaurant)}>Delete restaurant</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )

  return (
    <main className="content-grid">
      <Tabs
        value={activeRestaurantTabValue}
        onValueChange={(value) => setActiveRestaurantTab(value as RestaurantAdminTab)}
        orientation="horizontal"
        className="admin-tabs restaurant-admin-tabs"
      >
        <TabsList className="admin-tabs-list restaurant-admin-tabs-list" aria-label="Restaurant management sections">
          {restaurantTabOrder.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value}>
              <Icon size={16} />
              <span>{label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="restaurants">
          <Card id="restaurant-directory">
        <CardHeader className="section-header">
          <div className="admin-page-title">
            <Building2 size={22} />
            <div>
              <CardTitle>Restaurant Management</CardTitle>
              <CardDescription>
                {isPlatformOwner ? 'Manage restaurant profiles across the platform.' : 'Manage your assigned restaurant profile.'}
              </CardDescription>
            </div>
          </div>
          <div className="section-actions">
            {isPlatformOwner && <RestaurantFormDialog onSaved={() => refreshRestaurantData()} />}
            <Button type="button" variant="secondary" onClick={() => void loadRestaurants(true)} disabled={loading}>
              <RefreshCw size={18} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && <p className="form-error">{error}</p>}
          {loading ? (
            <div className="restaurant-loading" aria-live="polite">
              <motion.span animate={{ rotate: 360 }} transition={{ duration: 0.9, ease: 'linear', repeat: Infinity }}>
                <RefreshCw size={18} />
              </motion.span>
              Loading restaurants...
            </div>
          ) : (
            <div className="directory-stack">
              <div className="restaurant-directory-tools restaurant-filter-tools">
                <div className="restaurant-filter-search-row">
                  <div className="directory-search">
                    <Search size={16} />
                    <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Filter by name, address, phone, country, timezone, or currency" />
                  </div>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="restaurant-filter-trigger"
                        aria-label="Filter restaurants"
                      >
                        <SlidersHorizontal size={16} />
                        {activeRestaurantDropdownFilterCount > 0 && (
                          <span className="restaurant-filter-count">{activeRestaurantDropdownFilterCount}</span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="restaurant-filter-popover" align="end">
                      <div className="restaurant-filter-popover-header">
                        <strong>Filters</strong>
                        <Button type="button" variant="ghost" size="xs" onClick={resetFilters} disabled={!hasActiveFilters}>
                          <X size={13} />
                          Clear all
                        </Button>
                      </div>
                      <div className="restaurant-filter-fields">
                        <div className="restaurant-filter-field">
                          <span>Status</span>
                          <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value as StatusFilter); setPage(1) }}>
                            <SelectTrigger className="filter-select"><SelectValue placeholder="Status" /></SelectTrigger>
                            <SelectContent position="popper">
                              <SelectItem value="all">All statuses</SelectItem>
                              <SelectItem value="active">Active</SelectItem>
                              <SelectItem value="inactive">Inactive</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="restaurant-filter-field">
                          <span>Currency</span>
                          <Select value={currencyFilter} onValueChange={(value) => { setCurrencyFilter(value); setPage(1) }}>
                            <SelectTrigger className="filter-select"><SelectValue placeholder="Currency" /></SelectTrigger>
                            <SelectContent position="popper">
                              <SelectItem value="all">All currencies</SelectItem>
                              {currencyOptionsInUse.map((currency) => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="restaurant-inline-filters">
                  <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value as StatusFilter); setPage(1) }}>
                    <SelectTrigger className="filter-select"><SelectValue placeholder="Status" /></SelectTrigger>
                    <SelectContent position="popper">
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={currencyFilter} onValueChange={(value) => { setCurrencyFilter(value); setPage(1) }}>
                    <SelectTrigger className="filter-select"><SelectValue placeholder="Currency" /></SelectTrigger>
                    <SelectContent position="popper">
                      <SelectItem value="all">All currencies</SelectItem>
                      {currencyOptionsInUse.map((currency) => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="ghost" size="icon" onClick={resetFilters} disabled={!hasActiveFilters} title="Clear filters" aria-label="Clear filters">
                    <X size={16} />
                  </Button>
                </div>

                {hasActiveFilters && (
                  <div className="restaurant-filter-chips" aria-label="Active restaurant filters">
                    {search.trim() && (
                      <button type="button" className="restaurant-filter-chip" onClick={() => { setSearch(''); setPage(1) }} title={`Search: ${search.trim()}`}>
                        <span>Search: {search.trim()}</span>
                        <X size={13} />
                      </button>
                    )}
                    {statusFilter !== 'all' && (
                      <button type="button" className="restaurant-filter-chip" onClick={() => { setStatusFilter('all'); setPage(1) }} title={`Status: ${selectedStatusFilterLabel}`}>
                        <span>Status: {selectedStatusFilterLabel}</span>
                        <X size={13} />
                      </button>
                    )}
                    {currencyFilter !== 'all' && (
                      <button type="button" className="restaurant-filter-chip" onClick={() => { setCurrencyFilter('all'); setPage(1) }} title={`Currency: ${currencyFilter}`}>
                        <span>Currency: {currencyFilter}</span>
                        <X size={13} />
                      </button>
                    )}
                    <button type="button" className="restaurant-filter-chip restaurant-filter-chip-clear" onClick={resetFilters}>
                      <X size={13} />
                      <span>Clear all</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="table-wrap restaurant-directory-table-wrap">
                <table className="data-table restaurant-table">
                  <thead>
                    <tr>
                      <th><button type="button" className="sort-button" onClick={() => updateSort('name')}>Restaurant {sort.key === 'name' && <SortIcon size={15} />}</button></th>
                      <th>Contact</th>
                      <th><button type="button" className="sort-button" onClick={() => updateSort('currency')}>Locale {sort.key === 'currency' && <SortIcon size={15} />}</button></th>
                      <th><button type="button" className="sort-button" onClick={() => updateSort('status')}>Status {sort.key === 'status' && <SortIcon size={15} />}</button></th>
                      <th><button type="button" className="sort-button" onClick={() => updateSort('created')}>Created {sort.key === 'created' && <SortIcon size={15} />}</button></th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {restaurants.map((restaurant) => (
                      <tr key={restaurant.id}>
                        <td>
                          <span className="table-name"><Building2 size={16} />{restaurant.name}</span>
                          <span className="table-subtext"><MapPin size={12} />{restaurant.address}</span>
                        </td>
                        <td><span className="restaurant-contact"><Phone size={14} />{restaurant.phone}</span></td>
                        <td>
                          <div className="restaurant-locale-cell">
                            <CountryFlag countryCode={restaurant.countryCode} />
                            <div>
                              <strong>{restaurant.countryCode} - {restaurant.currency}</strong>
                              <span className="table-subtext">{restaurant.timezone}</span>
                            </div>
                          </div>
                        </td>
                        <td><Badge variant={restaurant.isActive ? 'secondary' : 'destructive'}>{restaurant.isActive ? 'Active' : 'Inactive'}</Badge></td>
                        <td>{formatDate(restaurant.createdAt)}</td>
                        <td>
                          {renderRestaurantActions(restaurant)}
                        </td>
                      </tr>
                    ))}
                    {restaurants.length === 0 && (
                      <tr><td colSpan={6} className="empty-cell">{hasActiveFilters ? 'No restaurants match the current filters.' : 'No restaurants are available for your account.'}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="restaurant-mobile-list" aria-label="Restaurants">
                {restaurants.map((restaurant) => (
                  <article className="restaurant-mobile-card" key={restaurant.id}>
                    <header className="restaurant-mobile-card-header">
                      <span className="restaurant-mobile-avatar">
                        <Building2 size={18} />
                      </span>
                      <div className="restaurant-mobile-primary">
                        <strong title={restaurant.name}>{restaurant.name}</strong>
                        <span title={restaurant.address}>{restaurant.address}</span>
                      </div>
                      <Badge variant={restaurant.isActive ? 'secondary' : 'destructive'}>{restaurant.isActive ? 'Active' : 'Inactive'}</Badge>
                    </header>
                    <div className="restaurant-mobile-meta-grid">
                      <div className="restaurant-mobile-meta">
                        <Phone size={15} />
                        <div>
                          <span>Contact</span>
                          <strong title={restaurant.phone}>{restaurant.phone}</strong>
                        </div>
                      </div>
                      <div className="restaurant-mobile-meta">
                        <Globe2 size={15} />
                        <div>
                          <span>Locale</span>
                          <strong className="restaurant-mobile-locale">
                            <CountryFlag countryCode={restaurant.countryCode} />
                            {restaurant.countryCode} - {restaurant.currency}
                          </strong>
                          <small title={restaurant.timezone}>{restaurant.timezone}</small>
                        </div>
                      </div>
                      <div className="restaurant-mobile-meta">
                        <CalendarClock size={15} />
                        <div>
                          <span>Created</span>
                          <strong>{formatDate(restaurant.createdAt)}</strong>
                        </div>
                      </div>
                    </div>
                    <div className="restaurant-mobile-actions">
                      {renderRestaurantActions(restaurant)}
                    </div>
                  </article>
                ))}
                {restaurants.length === 0 && (
                  <div className="restaurant-mobile-empty">
                    {hasActiveFilters ? 'No restaurants match the current filters.' : 'No restaurants are available for your account.'}
                  </div>
                )}
              </div>

              <div className="pagination-bar compact-pagination restaurant-directory-pagination">
                <span className="pagination-range">
                  <span className="pagination-full">Showing {pageStart}-{pageEnd} of {totalItems}</span>
                  <span className="pagination-compact">{pageStart}-{pageEnd} / {totalItems}</span>
                </span>
                <div className="pagination-actions">
                  <Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setPage(1) }}>
                    <SelectTrigger className="page-size-select"><SelectValue /></SelectTrigger>
                    <SelectContent position="popper">
                      <SelectItem value="10">10 / page</SelectItem>
                      <SelectItem value="20">20 / page</SelectItem>
                      <SelectItem value="50">50 / page</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="pagination-page">
                    <span className="pagination-full">Page {currentPage} of {totalPages}</span>
                    <span className="pagination-compact">{currentPage} / {totalPages}</span>
                  </span>
                  <Button type="button" variant="outline" size="icon" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={loading || currentPage <= 1} aria-label="Previous page"><ChevronLeft size={16} /></Button>
                  <Button type="button" variant="outline" size="icon" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={loading || currentPage >= totalPages} aria-label="Next page"><ChevronRight size={16} /></Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tables">
          <RestaurantTablesPanel
            restaurants={allRestaurants}
            restaurantsLoading={loading}
            canSelectRestaurant={isPlatformOwner}
          />
        </TabsContent>

        <TabsContent value="hours">
          <RestaurantOpeningHoursPanel
            restaurants={allRestaurants}
            restaurantsLoading={loading}
            canSelectRestaurant={isPlatformOwner}
            onSaved={refreshRestaurantData}
            onRestaurantUpdated={updateRestaurantInState}
          />
        </TabsContent>

        <TabsContent value="calendar">
          <RestaurantSpecialCalendarPanel
            restaurants={allRestaurants}
            restaurantsLoading={loading}
            canSelectRestaurant={isPlatformOwner}
            onSaved={refreshRestaurantData}
            onRestaurantUpdated={updateRestaurantInState}
          />
        </TabsContent>
      </Tabs>
    </main>
  )
}
