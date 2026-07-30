import { useCallback, useEffect, useMemo, useRef, useState, type HTMLAttributes } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Armchair,
  Building2,
  CalendarDays,
  CalendarClock,
  CircleCheck,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Copy,
  CreditCard,
  Eye,
  ExternalLink,
  Globe2,
  ImageIcon,
  Info,
  Link2,
  MapPin,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  TestTube2,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useForm, useWatch, type FieldErrors } from 'react-hook-form'
import { useSearchParams } from 'react-router-dom'
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
  createRestaurantPlatformFeeCheckout,
  createRestaurantStripeConnectLink,
  deleteRestaurant,
  getPaymentEnvironment,
  getRestaurantPaymentSettings,
  getRestaurantPage,
  getRestaurants,
  refreshRestaurantStripeStatus,
  runRestaurantStripeDiagnostics,
  updateRestaurant,
  updateRestaurantPlatformFees,
  type Restaurant,
  type StripeConnectDiagnostic,
  type RestaurantPaymentSettings,
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
import { buildFeePreview } from '../lib/platformFee'
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
import {
  createDefaultOpeningHours,
  openingHoursDaySchema,
  parseOpeningHoursJson,
  parseSpecialOpeningDaysJson,
  serializeOpeningHours,
  serializeSpecialOpeningDays,
  specialOpeningDaySchema,
  OpeningHoursEditor,
  RestaurantOpeningHoursPanel,
  RestaurantSpecialCalendarPanel,
  getStatusHeadline,
} from '../components/restaurant/openingHours'


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
}).superRefine((values, context) => {
  const countryCode = getSupportedPhoneCountryCode(values.phoneCountryCode)
  const parsedPhone = parsePhoneNumberFromString(cleanNationalPhoneInput(values.phoneNationalNumber), countryCode)

  if (!parsedPhone?.isValid()) {
    context.addIssue({
      code: 'custom',
      path: ['phoneNationalNumber'],
      message: 'Enter a valid phone number for the selected dialing country.',
    })
  }
})

type RestaurantFormValues = z.infer<typeof restaurantSchema>
type SortKey = 'name' | 'status' | 'currency' | 'created'
type SortDirection = 'asc' | 'desc'
type StatusFilter = 'all' | 'active' | 'inactive'
type RestaurantAdminTab = 'restaurants' | 'tables' | 'hours' | 'calendar'
type RestaurantFormTab = 'basic' | 'advanced'

const restaurantAdminTabs: RestaurantAdminTab[] = ['restaurants', 'tables', 'hours', 'calendar']
const restaurantSortKeys: SortKey[] = ['name', 'status', 'currency', 'created']
const restaurantPageSizes = [10, 20, 50]

function getPositiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function getRestaurantOperationalStatus(restaurant: Restaurant) {
  if (!restaurant.isActive) {
    return { label: 'Inactive', variant: 'destructive' as const }
  }

  if (restaurant.availability) {
    const label = getStatusHeadline(restaurant.availability)
    return {
      label,
      variant: restaurant.availability.isWithinOpeningHours && restaurant.availability.reason === 'Open'
        ? 'secondary' as const
        : 'outline' as const,
    }
  }

  return restaurant.acceptingOrders
    ? { label: 'Schedule unavailable', variant: 'outline' as const }
    : { label: 'Orders paused', variant: 'outline' as const }
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
        <Button
          type="button"
          variant="outline"
          size="icon"
          title={`Public ordering access for ${restaurant.name}`}
          aria-label={`Public ordering access for ${restaurant.name}`}
        >
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

function RestaurantPaymentsDialog({
  restaurant,
  isPlatformOwner,
  onUpdated,
}: {
  restaurant: Restaurant
  isPlatformOwner: boolean
  onUpdated: () => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<RestaurantPaymentSettings | null>(null)
  const [orderFeePercent, setOrderFeePercent] = useState('0')
  const [setupFeeAmount, setSetupFeeAmount] = useState('0')
  const [loading, setLoading] = useState(false)
  const [workingAction, setWorkingAction] = useState<string | null>(null)
  const [stripeMode, setStripeMode] = useState<'Live' | 'Test' | 'Unconfigured'>('Unconfigured')
  const [diagnostic, setDiagnostic] = useState<StripeConnectDiagnostic | null>(null)

  const applySettings = useCallback((nextSettings: RestaurantPaymentSettings) => {
    setSettings(nextSettings)
    setOrderFeePercent(String(nextSettings.orderPlatformFeePercent))
    setSetupFeeAmount((nextSettings.oneTimePlatformFeeCents / 100).toFixed(2))
  }, [])

  const loadSettings = useCallback(async (showSuccess = false) => {
    setLoading(true)
    try {
      const [nextSettings, environment] = await Promise.all([
        getRestaurantPaymentSettings(restaurant.id),
        getPaymentEnvironment().catch(() => null),
      ])
      applySettings(nextSettings)
      if (environment) setStripeMode(environment.mode)
      if (showSuccess) toast.success('Payment settings refreshed')
    } catch (loadError) {
      toast.error('Could not load payment settings', {
        description: loadError instanceof Error ? loadError.message : 'The request failed.',
      })
    } finally {
      setLoading(false)
    }
  }, [applySettings, restaurant.id])

  useEffect(() => {
    if (!open) return
    const loadTimer = window.setTimeout(() => void loadSettings(), 0)
    return () => window.clearTimeout(loadTimer)
  }, [loadSettings, open])

  const runAction = async (action: string, callback: () => Promise<void>) => {
    setWorkingAction(action)
    try {
      await callback()
    } finally {
      setWorkingAction(null)
    }
  }

  const handleConnect = () => runAction('connect', async () => {
    try {
      const response = await createRestaurantStripeConnectLink(restaurant.id)
      if (!response.url) throw new Error('Stripe did not return an onboarding link.')
      window.location.assign(response.url)
    } catch (connectError) {
      toast.error('Could not open Stripe onboarding', {
        description: connectError instanceof Error ? connectError.message : 'The request failed.',
      })
    }
  })

  const handleRefresh = () => runAction('refresh', async () => {
    try {
      applySettings(await refreshRestaurantStripeStatus(restaurant.id))
      await onUpdated()
      toast.success('Stripe status refreshed')
    } catch (refreshError) {
      toast.error('Could not refresh Stripe status', {
        description: refreshError instanceof Error ? refreshError.message : 'The request failed.',
      })
    }
  })

  const handleDiagnostics = () => runAction('diagnostics', async () => {
    try {
      const result = await runRestaurantStripeDiagnostics(restaurant.id)
      setDiagnostic(result)
      applySettings(result.settings)
      await onUpdated()
      const failedChecks = result.checks.filter((check) => check.status === 'Failed').length
      const warningChecks = result.checks.filter((check) => check.status === 'Warning').length
      if (failedChecks > 0) {
        toast.error('Stripe diagnostics found a blocking issue')
      } else if (warningChecks > 0) {
        toast.warning('Stripe diagnostics completed with warnings')
      } else {
        toast.success('Stripe diagnostics passed')
      }
    } catch (diagnosticError) {
      toast.error('Could not run Stripe diagnostics', {
        description: diagnosticError instanceof Error ? diagnosticError.message : 'The request failed.',
      })
    }
  })

  const orderFeePreview = buildFeePreview(Number(orderFeePercent), settings?.currency ?? 'AUD')

  const handleSaveFees = () => runAction('fees', async () => {
    const percentage = Number(orderFeePercent)
    const dollars = Number(setupFeeAmount)
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
      toast.error('Per-order fee must be between 0% and 100%.')
      return
    }
    if (!Number.isFinite(dollars) || dollars < 0) {
      toast.error('One-time fee cannot be negative.')
      return
    }
    if (dollars > 0 && dollars < 0.5) {
      toast.error('A non-zero one-time fee must be at least 0.50.')
      return
    }

    try {
      applySettings(await updateRestaurantPlatformFees(restaurant.id, {
        orderPlatformFeePercent: Math.round(percentage * 100) / 100,
        oneTimePlatformFeeCents: Math.round(dollars * 100),
      }))
      await onUpdated()
      toast.success('Platform fees saved')
    } catch (saveError) {
      toast.error('Could not save platform fees', {
        description: saveError instanceof Error ? saveError.message : 'The request failed.',
      })
    }
  })

  const handleSetupFeeCheckout = () => runAction('setup-fee', async () => {
    try {
      const response = await createRestaurantPlatformFeeCheckout(restaurant.id)
      if (!response.required || response.paid) {
        toast.success(response.message)
        await loadSettings()
        return
      }
      if (!response.checkoutUrl) throw new Error('Stripe did not return a checkout link.')
      window.location.assign(response.checkoutUrl)
    } catch (checkoutError) {
      toast.error('Could not open platform fee checkout', {
        description: checkoutError instanceof Error ? checkoutError.message : 'The request failed.',
      })
    }
  })

  const statusLabel = settings?.stripeConnectStatus ?? restaurant.stripeConnectStatus ?? 'NotConnected'
  const statusVariant = statusLabel === 'Ready'
    ? 'secondary' as const
    : statusLabel === 'Restricted'
      ? 'destructive' as const
      : 'outline' as const

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          title={`Payments for ${restaurant.name}`}
          aria-label={`Payments for ${restaurant.name}`}
        >
          <CreditCard size={16} />
        </Button>
      </DialogTrigger>
      <DialogContent className="restaurant-payments-dialog">
        <DialogHeader>
          <DialogTitle>{restaurant.name} payments</DialogTitle>
          <DialogDescription>
            Connect this restaurant to Stripe and configure optional platform pricing. Both fees start at zero.
          </DialogDescription>
        </DialogHeader>

        {loading && !settings ? (
          <div className="restaurant-payment-loading" role="status">
            <RefreshCw className="spinner" size={18} />
            Loading payment settings...
          </div>
        ) : settings ? (
          <div className="restaurant-payment-stack">
            <section className="restaurant-payment-section">
              <div className="restaurant-payment-section-heading">
                <div>
                  <strong>Stripe Connect</strong>
                  <span>Customer payments settle directly into this restaurant's Stripe account.</span>
                </div>
                <Badge variant={statusVariant}>{statusLabel.replace(/([a-z])([A-Z])/g, '$1 $2')}</Badge>
              </div>
              <div className="restaurant-payment-capabilities">
                <span data-ready={settings.stripeChargesEnabled}>Charges {settings.stripeChargesEnabled ? 'enabled' : 'pending'}</span>
                <span data-ready={settings.stripePayoutsEnabled}>Payouts {settings.stripePayoutsEnabled ? 'enabled' : 'pending'}</span>
                <span data-ready={settings.stripeDetailsSubmitted}>Details {settings.stripeDetailsSubmitted ? 'submitted' : 'incomplete'}</span>
              </div>
              {settings.stripeRestrictions.length > 0 ? (
                <div className="restaurant-stripe-restrictions" aria-live="polite">
                  <div className="restaurant-stripe-restrictions-heading">
                    <div>
                      <strong>
                        {settings.stripeRestrictions.some((restriction) => restriction.actionRequired)
                          ? 'Stripe needs attention'
                          : 'Stripe review in progress'}
                      </strong>
                      <span>
                        {settings.stripeCurrentDeadline
                          ? `Resolve required items by ${formatDate(settings.stripeCurrentDeadline)}.`
                          : 'These details come directly from the connected Stripe account.'}
                      </span>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleConnect()}
                      disabled={workingAction !== null}
                    >
                      <ExternalLink size={15} />
                      {settings.stripeRestrictions.some((restriction) => restriction.actionRequired)
                        ? 'Resolve in Stripe'
                        : 'View in Stripe'}
                    </Button>
                  </div>
                  <div className="restaurant-stripe-restriction-list">
                    {settings.stripeRestrictions.map((restriction, index) => (
                      <article
                        key={`${restriction.code}-${restriction.requirement ?? index}`}
                        data-severity={restriction.severity.toLowerCase()}
                      >
                        {restriction.severity === 'Error' ? (
                          <TriangleAlert size={17} />
                        ) : restriction.severity === 'Warning' ? (
                          <TriangleAlert size={17} />
                        ) : (
                          <Info size={17} />
                        )}
                        <div>
                          <strong>{restriction.title}</strong>
                          <span>{restriction.message}</span>
                        </div>
                        <Badge variant="outline">
                          {restriction.actionRequired ? 'Action required' : 'No action'}
                        </Badge>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}
              {diagnostic ? (
                <div className="restaurant-stripe-diagnostics" role="status">
                  <div className="restaurant-stripe-diagnostics-heading">
                    <div>
                      <TestTube2 size={17} />
                      <strong>Sandbox diagnostics</strong>
                    </div>
                    <span>{formatDate(diagnostic.checkedAt)}</span>
                  </div>
                  <div className="restaurant-stripe-diagnostic-list">
                    {diagnostic.checks.map((check) => (
                      <div key={check.code} data-status={check.status.toLowerCase()}>
                        {check.status === 'Passed' ? <CircleCheck size={17} /> : <TriangleAlert size={17} />}
                        <div>
                          <strong>{check.label}</strong>
                          <span>{check.message}</span>
                        </div>
                        <Badge variant="outline">{check.status}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="restaurant-payment-actions">
                <Button type="button" onClick={() => void handleConnect()} disabled={workingAction !== null}>
                  <ExternalLink size={16} />
                  {settings.stripeAccountId
                    ? settings.stripeConnectStatus === 'Ready'
                      ? 'Manage in Stripe'
                      : 'Continue Stripe setup'
                    : 'Connect Stripe'}
                </Button>
                <Button type="button" variant="outline" onClick={() => void handleRefresh()} disabled={workingAction !== null}>
                  <RefreshCw size={16} className={workingAction === 'refresh' ? 'spinner' : undefined} />
                  Refresh status
                </Button>
                {stripeMode === 'Test' && settings.stripeAccountId ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleDiagnostics()}
                    disabled={workingAction !== null}
                  >
                    <TestTube2 size={16} className={workingAction === 'diagnostics' ? 'spinner' : undefined} />
                    Run diagnostics
                  </Button>
                ) : null}
              </div>
            </section>

            <section className="restaurant-payment-section">
              <div className="restaurant-payment-section-heading">
                <div>
                  <strong>Platform pricing</strong>
                  <span>These are platform fees, separate from Stripe's processing fees.</span>
                </div>
                <Badge variant="outline">{settings.currency}</Badge>
              </div>
              <div className="restaurant-payment-fee-grid">
                <label>
                  <span>Per-order fee</span>
                  <div className="restaurant-payment-input">
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      inputMode="decimal"
                      value={orderFeePercent}
                      onChange={(event) => setOrderFeePercent(event.target.value)}
                      disabled={!isPlatformOwner || workingAction !== null}
                    />
                    <span>%</span>
                  </div>
                  <small>Default 0%. Collected automatically from each successful online order.</small>
                  {/* A bare "0.1" reads as ten cents; showing the worked amounts removes the doubt. */}
                  {orderFeePreview && (
                    <small className="restaurant-fee-preview">{orderFeePreview}</small>
                  )}
                </label>
                <label>
                  <span>One-time activation fee</span>
                  <div className="restaurant-payment-input">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={setupFeeAmount}
                      onChange={(event) => setSetupFeeAmount(event.target.value)}
                      disabled={!isPlatformOwner || settings.oneTimePlatformFeeStatus === 'Paid' || workingAction !== null}
                    />
                    <span>{settings.currency}</span>
                  </div>
                  <small>
                    Default {settings.currency} 0.00. Status: {settings.oneTimePlatformFeeStatus}.
                  </small>
                </label>
              </div>
              <div className="restaurant-payment-actions">
                {isPlatformOwner ? (
                  <Button type="button" onClick={() => void handleSaveFees()} disabled={workingAction !== null}>
                    Save platform fees
                  </Button>
                ) : null}
                {settings.oneTimePlatformFeeCents > 0 && settings.oneTimePlatformFeeStatus !== 'Paid' ? (
                  <Button type="button" variant="outline" onClick={() => void handleSetupFeeCheckout()} disabled={workingAction !== null}>
                    Pay one-time fee
                  </Button>
                ) : null}
              </div>
            </section>
          </div>
        ) : (
          <p className="form-error">Payment settings could not be loaded.</p>
        )}
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

  if (parsedNationalPhone?.isValid()) {
    return parsedNationalPhone.formatInternational()
  }

  const rawInternationalNumber = `+${getPhoneCallingCode(phoneCountryCode)} ${cleanedNationalNumber}`
  const parsedPhone = parsePhoneNumberFromString(rawInternationalNumber, phoneCountryCode)

  if (!parsedPhone?.isValid()) {
    throw new Error('Enter a valid phone number for the selected dialing country.')
  }

  return parsedPhone.formatInternational()
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
          aria-label="Phone dialing country"
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


function RestaurantFormDialog({ restaurant, onSaved }: RestaurantFormDialogProps) {
  const [open, setOpen] = useState(false)
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false)
  const [failedImagePreviewUrl, setFailedImagePreviewUrl] = useState('')
  const [formTab, setFormTab] = useState<RestaurantFormTab>('basic')
  const editing = Boolean(restaurant)
  const timezoneOptions = useMemo(() => getTimezoneOptions(), [])
  const form = useForm<RestaurantFormValues>({
    resolver: zodResolver(restaurantSchema),
    defaultValues: createEmptyRestaurant(),
  })
  const selectedCountryCode = useWatch({ control: form.control, name: 'countryCode' })
  const selectedPhoneCountryCode = useWatch({ control: form.control, name: 'phoneCountryCode' })
  const imageUrl = useWatch({ control: form.control, name: 'imageUrl' })
  const { isDirty, isSubmitting } = form.formState

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
    if (!nextOpen && isDirty && !isSubmitting) {
      setDiscardDialogOpen(true)
      return
    }

    setOpen(nextOpen)
    if (nextOpen) {
      setFormTab('basic')
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogTrigger asChild>
          {editing ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              title={`Edit ${restaurant?.name ?? 'restaurant'}`}
              aria-label={`Edit ${restaurant?.name ?? 'restaurant'}`}
            >
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
                            <Input
                              placeholder="/seed-menu/veg-spring-rolls.svg or https://..."
                              {...field}
                              onChange={(event) => {
                                field.onChange(event)
                              }}
                            />
                          </FormControl>
                          <p className="text-xs text-muted-foreground">
                            Used as the public ordering hero image. Leave blank to use the default gradient card.
                          </p>
                          {imageUrl.trim() && failedImagePreviewUrl !== imageUrl ? (
                            <div className="restaurant-image-preview">
                              <img
                                src={resolvePublicAssetUrl(imageUrl) ?? undefined}
                                alt="Restaurant image preview"
                                onError={() => setFailedImagePreviewUrl(imageUrl)}
                              />
                              <span>Preview</span>
                            </div>
                          ) : imageUrl.trim() && failedImagePreviewUrl === imageUrl ? (
                            <p className="restaurant-image-preview-error" role="status">
                              This image could not be loaded. Check the URL or app-relative path.
                            </p>
                          ) : null}
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
                              <SelectTrigger aria-label="Customer payment policy"><SelectValue placeholder="Select payment policy" /></SelectTrigger>
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
              <Button type="button" variant="outline" onClick={() => handleDialogOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving restaurant' : editing ? 'Save changes' : 'Create restaurant'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={discardDialogOpen} onOpenChange={setDiscardDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your restaurant changes have not been saved. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setDiscardDialogOpen(false)
                setOpen(false)
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function RestaurantDetailsDialog({ restaurant }: { restaurant: Restaurant }) {
  const takeawayUrl = buildTakeawayPublicUrl(restaurant.id)
  const country = getCountryOption(restaurant.countryCode)
  const restaurantImageUrl = resolvePublicAssetUrl(restaurant.imageUrl)

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title={`View ${restaurant.name}`}
          aria-label={`View ${restaurant.name}`}
        >
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

function RestaurantDeleteAction({
  restaurant,
  onDelete,
}: {
  restaurant: Restaurant
  onDelete: (restaurant: Restaurant) => Promise<void>
}) {
  const [confirmation, setConfirmation] = useState('')
  const [deleting, setDeleting] = useState(false)
  const matchesRestaurantName = confirmation.trim() === restaurant.name

  return (
    <AlertDialog onOpenChange={(nextOpen) => { if (!nextOpen) setConfirmation('') }}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="destructive"
          size="icon"
          title={`Delete ${restaurant.name}`}
          aria-label={`Delete ${restaurant.name}`}
        >
          <Trash2 size={16} />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {restaurant.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the restaurant and may fail while related records still depend on it.
            Consider making the restaurant inactive instead if its history must remain available.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="restaurant-delete-confirmation">
          <label htmlFor={`delete-restaurant-${restaurant.id}`}>
            Type <strong>{restaurant.name}</strong> to confirm
          </label>
          <Input
            id={`delete-restaurant-${restaurant.id}`}
            value={confirmation}
            autoComplete="off"
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={!matchesRestaurantName || deleting}
            onClick={(event) => {
              event.preventDefault()
              setDeleting(true)
              void onDelete(restaurant).finally(() => setDeleting(false))
            }}
          >
            {deleting ? 'Deleting restaurant' : 'Delete permanently'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}



export function AdminRestaurantsPage() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [allRestaurants, setAllRestaurants] = useState<Restaurant[]>([])
  const [loading, setLoading] = useState(true)
  const [optionsLoading, setOptionsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const [hoursDirty, setHoursDirty] = useState(false)
  const [calendarDirty, setCalendarDirty] = useState(false)
  const [pendingRestaurantSection, setPendingRestaurantSection] = useState<RestaurantAdminTab | null>(null)
  const searchQuery = searchParams.get('q') ?? ''
  const [searchDraft, setSearchDraft] = useState({ value: searchQuery, sourceQuery: searchQuery })
  const search = searchDraft.sourceQuery === searchQuery ? searchDraft.value : searchQuery
  const setSearch = (value: string) => setSearchDraft({ value, sourceQuery: searchQuery })
  const [totalItems, setTotalItems] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const requestIdRef = useRef(0)
  const paymentReturnHandledRef = useRef('')
  const isPlatformOwner = user?.roles.includes('PlatformOwner') ?? false
  const rawStatusFilter = searchParams.get('status')
  const statusFilter: StatusFilter = rawStatusFilter === 'active' || rawStatusFilter === 'inactive' ? rawStatusFilter : 'all'
  const currencyFilter = searchParams.get('currency') || 'all'
  const pageSizeParam = getPositiveInteger(searchParams.get('pageSize'), 10)
  const pageSize = restaurantPageSizes.includes(pageSizeParam) ? pageSizeParam : 10
  const page = getPositiveInteger(searchParams.get('page'), 1)
  const rawSortKey = searchParams.get('sort')
  const sortKey: SortKey = restaurantSortKeys.includes(rawSortKey as SortKey) ? rawSortKey as SortKey : 'name'
  const sortDirection: SortDirection = searchParams.get('direction') === 'desc' ? 'desc' : 'asc'
  const sort = useMemo(() => ({ key: sortKey, direction: sortDirection }), [sortDirection, sortKey])
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
  const defaultRestaurantTab: RestaurantAdminTab = isPlatformOwner ? 'restaurants' : 'tables'
  const sectionParam = searchParams.get('section')
  const activeRestaurantTabValue: RestaurantAdminTab = restaurantAdminTabs.includes(sectionParam as RestaurantAdminTab)
    ? sectionParam as RestaurantAdminTab
    : defaultRestaurantTab
  const selectedRestaurantId = searchParams.get('restaurant') ?? ''
  const selectedCalendarDate = searchParams.get('date') ?? ''
  const selectedCalendarMonth = searchParams.get('month') ?? ''

  const updateUrlState = useCallback((
    updates: Record<string, string | number | null | undefined>,
    replace = true,
  ) => {
    setSearchParams((currentParams) => {
      const nextParams = new URLSearchParams(currentParams)
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === undefined || value === '') {
          nextParams.delete(key)
        } else {
          nextParams.set(key, String(value))
        }
      })
      return nextParams
    }, { replace })
  }, [setSearchParams])

  useEffect(() => {
    if (search === searchQuery) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      updateUrlState({ q: search.trim() || null, page: null })
    }, 320)

    return () => window.clearTimeout(timeoutId)
  }, [search, searchQuery, updateUrlState])

  const loadRestaurants = useCallback(async (showToast = false) => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(null)

    try {
      const response = await getRestaurantPage({
        page,
        pageSize,
        search: searchQuery.trim() || undefined,
        sortBy: sort.key === 'created' ? 'createdAt' : sort.key,
        sortDirection: sort.direction,
        isActive: statusFilter === 'all' ? undefined : statusFilter === 'active',
        currency: currencyFilter === 'all' ? undefined : currencyFilter,
      })
      if (requestId !== requestIdRef.current) {
        return
      }

      setRestaurants(response.items)
      setTotalItems(response.totalItems)
      setTotalPages(response.totalPages)

      if (response.totalPages > 0 && page > response.totalPages) {
        updateUrlState({ page: response.totalPages === 1 ? null : response.totalPages })
      }

      if (showToast) toast.success('Restaurant directory refreshed')
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load restaurants.'
      if (requestId === requestIdRef.current) {
        setError(message)
        toast.error('Could not load restaurants', { description: message })
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }, [currencyFilter, page, pageSize, searchQuery, sort, statusFilter, updateUrlState])

  const loadRestaurantOptions = useCallback(async () => {
    setOptionsLoading(true)
    setOptionsError(null)
    try {
      setAllRestaurants(await getRestaurants())
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load restaurant options.'
      setOptionsError(message)
      toast.error('Could not load restaurant options', { description: message })
    } finally {
      setOptionsLoading(false)
    }
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
  const getAriaSort = (key: SortKey): 'ascending' | 'descending' | 'none' => (
    sort.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'
  )

  const updateSort = (key: SortKey) => {
    const nextDirection = sort.key === key && sort.direction === 'asc' ? 'desc' : 'asc'
    updateUrlState({
      page: null,
      sort: key === 'name' ? null : key,
      direction: nextDirection === 'asc' ? null : nextDirection,
    })
  }

  const commitRestaurantSection = (nextSection: RestaurantAdminTab) => {
    updateUrlState({
      section: nextSection === defaultRestaurantTab ? null : nextSection,
    }, false)
  }

  const changeRestaurantSection = (nextSection: RestaurantAdminTab) => {
    const leavingUnsavedHours = activeRestaurantTabValue === 'hours' && hoursDirty
    const leavingUnsavedCalendar = activeRestaurantTabValue === 'calendar' && calendarDirty

    if (leavingUnsavedHours || leavingUnsavedCalendar) {
      setPendingRestaurantSection(nextSection)
      return
    }

    commitRestaurantSection(nextSection)
  }

  const resetFilters = () => {
    setSearch('')
    updateUrlState({ q: null, status: null, currency: null, page: null })
  }

  const refreshRestaurantData = useCallback(async () => {
    await Promise.all([loadRestaurants(), loadRestaurantOptions()])
  }, [loadRestaurantOptions, loadRestaurants])

  useEffect(() => {
    const stripeConnectResult = searchParams.get('stripeConnect')
    const platformFeeResult = searchParams.get('platformFee')
    const restaurantId = searchParams.get('restaurantId')
    const returnKey = [stripeConnectResult, platformFeeResult, restaurantId].join(':')

    if ((!stripeConnectResult && !platformFeeResult) ||
        paymentReturnHandledRef.current === returnKey) {
      return
    }

    paymentReturnHandledRef.current = returnKey
    void (async () => {
      if (stripeConnectResult === 'return' && restaurantId) {
        try {
          await refreshRestaurantStripeStatus(restaurantId)
          await refreshRestaurantData()
          toast.success('Stripe account status updated')
        } catch (returnError) {
          toast.error('Stripe setup returned, but status refresh failed', {
            description: returnError instanceof Error ? returnError.message : 'Open Payments and refresh again.',
          })
        }
      } else if (stripeConnectResult === 'refresh') {
        toast.info('The Stripe setup link expired. Open Payments and continue setup with a new link.')
      } else if (platformFeeResult === 'success') {
        toast.success('Platform fee payment submitted. Stripe confirmation may take a moment.')
        await refreshRestaurantData()
      } else if (platformFeeResult === 'cancelled') {
        toast.info('Platform fee checkout was cancelled. No charge was made.')
      }

      updateUrlState({
        stripeConnect: null,
        platformFee: null,
        restaurantId: null,
      })
    })()
  }, [refreshRestaurantData, searchParams, updateUrlState])

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
      <RestaurantPaymentsDialog
        restaurant={restaurant}
        isPlatformOwner={isPlatformOwner}
        onUpdated={() => refreshRestaurantData()}
      />
      <RestaurantFormDialog restaurant={restaurant} onSaved={() => refreshRestaurantData()} />
      {isPlatformOwner && <RestaurantDeleteAction restaurant={restaurant} onDelete={handleDelete} />}
    </div>
  )

  return (
    <main className="content-grid">
      <h1 className="sr-only">Restaurant administration</h1>
      <Tabs
        value={activeRestaurantTabValue}
        onValueChange={(value) => changeRestaurantSection(value as RestaurantAdminTab)}
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
        {optionsError && activeRestaurantTabValue !== 'restaurants' ? (
          <div className="restaurant-options-error" role="alert">
            <span>{optionsError}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadRestaurantOptions()}>
              Try again
            </Button>
          </div>
        ) : null}

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
          {loading && restaurants.length === 0 ? (
            <div className="restaurant-loading" aria-live="polite">
              <motion.span animate={{ rotate: 360 }} transition={{ duration: 0.9, ease: 'linear', repeat: Infinity }}>
                <RefreshCw size={18} />
              </motion.span>
              Loading restaurants...
            </div>
          ) : null}
            <div className="directory-stack" aria-busy={loading}>
              {loading && restaurants.length > 0 ? (
                <div className="restaurant-directory-refreshing" role="status">
                  <motion.span animate={{ rotate: 360 }} transition={{ duration: 0.9, ease: 'linear', repeat: Infinity }}>
                    <RefreshCw size={14} />
                  </motion.span>
                  Updating results...
                </div>
              ) : null}
              <div className="restaurant-directory-tools restaurant-filter-tools">
                <div className="restaurant-filter-search-row">
                  <div className="directory-search">
                    <Search size={16} />
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      aria-label="Search restaurants"
                      placeholder="Filter by name, address, phone, country, timezone, or currency"
                    />
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
                    <PopoverContent className="restaurant-filter-popover" align="end" aria-label="Restaurant filters">
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
                          <Select value={statusFilter} onValueChange={(value) => updateUrlState({ status: value === 'all' ? null : value, page: null })}>
                            <SelectTrigger className="filter-select" aria-label="Filter restaurants by status"><SelectValue placeholder="Status" /></SelectTrigger>
                            <SelectContent position="popper">
                              <SelectItem value="all">All statuses</SelectItem>
                              <SelectItem value="active">Active</SelectItem>
                              <SelectItem value="inactive">Inactive</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="restaurant-filter-field">
                          <span>Currency</span>
                          <Select value={currencyFilter} onValueChange={(value) => updateUrlState({ currency: value === 'all' ? null : value, page: null })}>
                            <SelectTrigger className="filter-select" aria-label="Filter restaurants by currency"><SelectValue placeholder="Currency" /></SelectTrigger>
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
                  <Select value={statusFilter} onValueChange={(value) => updateUrlState({ status: value === 'all' ? null : value, page: null })}>
                    <SelectTrigger className="filter-select" aria-label="Filter restaurants by status"><SelectValue placeholder="Status" /></SelectTrigger>
                    <SelectContent position="popper">
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={currencyFilter} onValueChange={(value) => updateUrlState({ currency: value === 'all' ? null : value, page: null })}>
                    <SelectTrigger className="filter-select" aria-label="Filter restaurants by currency"><SelectValue placeholder="Currency" /></SelectTrigger>
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
                      <button type="button" className="restaurant-filter-chip" onClick={() => { setSearch(''); updateUrlState({ q: null, page: null }) }} title={`Search: ${search.trim()}`}>
                        <span>Search: {search.trim()}</span>
                        <X size={13} />
                      </button>
                    )}
                    {statusFilter !== 'all' && (
                      <button type="button" className="restaurant-filter-chip" onClick={() => updateUrlState({ status: null, page: null })} title={`Status: ${selectedStatusFilterLabel}`}>
                        <span>Status: {selectedStatusFilterLabel}</span>
                        <X size={13} />
                      </button>
                    )}
                    {currencyFilter !== 'all' && (
                      <button type="button" className="restaurant-filter-chip" onClick={() => updateUrlState({ currency: null, page: null })} title={`Currency: ${currencyFilter}`}>
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
                  <caption className="sr-only">Restaurants matching the current filters</caption>
                  <thead>
                    <tr>
                      <th aria-sort={getAriaSort('name')}><button type="button" className="sort-button" onClick={() => updateSort('name')}>Restaurant {sort.key === 'name' && <SortIcon size={15} />}</button></th>
                      <th>Contact</th>
                      <th aria-sort={getAriaSort('currency')}><button type="button" className="sort-button" onClick={() => updateSort('currency')}>Locale {sort.key === 'currency' && <SortIcon size={15} />}</button></th>
                      <th aria-sort={getAriaSort('status')}><button type="button" className="sort-button" onClick={() => updateSort('status')}>Status {sort.key === 'status' && <SortIcon size={15} />}</button></th>
                      <th aria-sort={getAriaSort('created')}><button type="button" className="sort-button" onClick={() => updateSort('created')}>Created {sort.key === 'created' && <SortIcon size={15} />}</button></th>
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
                        <td>
                          <div className="restaurant-status-badges">
                            <Badge variant={restaurant.isActive ? 'secondary' : 'destructive'}>{restaurant.isActive ? 'Active' : 'Inactive'}</Badge>
                            {restaurant.isActive ? (() => {
                              const operationalStatus = getRestaurantOperationalStatus(restaurant)
                              return <Badge variant={operationalStatus.variant}>{operationalStatus.label}</Badge>
                            })() : null}
                          </div>
                        </td>
                        <td>{formatDate(restaurant.createdAt)}</td>
                        <td>
                          {renderRestaurantActions(restaurant)}
                        </td>
                      </tr>
                    ))}
                    {restaurants.length === 0 && !loading && (
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
                      <div className="restaurant-status-badges">
                        <Badge variant={restaurant.isActive ? 'secondary' : 'destructive'}>{restaurant.isActive ? 'Active' : 'Inactive'}</Badge>
                        {restaurant.isActive ? (() => {
                          const operationalStatus = getRestaurantOperationalStatus(restaurant)
                          return <Badge variant={operationalStatus.variant}>{operationalStatus.label}</Badge>
                        })() : null}
                      </div>
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
                {restaurants.length === 0 && !loading && (
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
                  <Select value={String(pageSize)} onValueChange={(value) => updateUrlState({ pageSize: value === '10' ? null : value, page: null })}>
                    <SelectTrigger className="page-size-select" aria-label="Restaurants per page"><SelectValue /></SelectTrigger>
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
                  <Button type="button" variant="outline" size="icon" onClick={() => updateUrlState({ page: Math.max(1, page - 1) === 1 ? null : Math.max(1, page - 1) }, false)} disabled={loading || currentPage <= 1} aria-label="Previous page"><ChevronLeft size={16} /></Button>
                  <Button type="button" variant="outline" size="icon" onClick={() => updateUrlState({ page: Math.min(totalPages, page + 1) }, false)} disabled={loading || currentPage >= totalPages} aria-label="Next page"><ChevronRight size={16} /></Button>
                </div>
              </div>
            </div>
        </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tables">
          <RestaurantTablesPanel
            restaurants={allRestaurants}
            restaurantsLoading={optionsLoading}
            canSelectRestaurant={isPlatformOwner}
            selectedRestaurantId={selectedRestaurantId}
            onSelectedRestaurantIdChange={(restaurantId) => updateUrlState({ restaurant: restaurantId }, false)}
          />
        </TabsContent>

        <TabsContent value="hours">
          <RestaurantOpeningHoursPanel
            restaurants={allRestaurants}
            restaurantsLoading={optionsLoading}
            canSelectRestaurant={isPlatformOwner}
            onSaved={refreshRestaurantData}
            onRestaurantUpdated={updateRestaurantInState}
            selectedRestaurantId={selectedRestaurantId}
            onSelectedRestaurantIdChange={(restaurantId) => updateUrlState({ restaurant: restaurantId }, false)}
            onDirtyChange={setHoursDirty}
          />
        </TabsContent>

        <TabsContent value="calendar">
          <RestaurantSpecialCalendarPanel
            restaurants={allRestaurants}
            restaurantsLoading={optionsLoading}
            canSelectRestaurant={isPlatformOwner}
            onSaved={refreshRestaurantData}
            onRestaurantUpdated={updateRestaurantInState}
            selectedRestaurantId={selectedRestaurantId}
            onSelectedRestaurantIdChange={(restaurantId) => updateUrlState({ restaurant: restaurantId }, false)}
            selectedDateKey={selectedCalendarDate}
            onSelectedDateKeyChange={(date) => updateUrlState({ date }, false)}
            monthKey={selectedCalendarMonth}
            onMonthKeyChange={(month) => updateUrlState({ month }, false)}
            onDirtyChange={setCalendarDirty}
          />
        </TabsContent>
      </Tabs>
      <AlertDialog
        open={pendingRestaurantSection !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setPendingRestaurantSection(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved schedule changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes in this restaurant schedule. Keep editing to save them, or discard them and continue to the selected section.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const nextSection = pendingRestaurantSection
                setPendingRestaurantSection(null)
                setHoursDirty(false)
                setCalendarDirty(false)
                if (nextSection) {
                  commitRestaurantSection(nextSection)
                }
              }}
            >
              Discard and continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}
