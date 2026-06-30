import { useCallback, useEffect, useMemo, useState, type HTMLAttributes } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Building2,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Copy,
  Eye,
  ExternalLink,
  ImageIcon,
  Link2,
  MapPin,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { useForm } from 'react-hook-form'
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
import { Textarea } from '../components/ui/textarea'

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
})

type RestaurantFormValues = z.infer<typeof restaurantSchema>
type SortKey = 'name' | 'status' | 'currency' | 'created'
type SortDirection = 'asc' | 'desc'
type StatusFilter = 'all' | 'active' | 'inactive'

const emptyRestaurant: RestaurantFormValues = {
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

function RestaurantFormDialog({ restaurant, onSaved }: RestaurantFormDialogProps) {
  const [open, setOpen] = useState(false)
  const editing = Boolean(restaurant)
  const timezoneOptions = useMemo(() => getTimezoneOptions(), [])
  const form = useForm<RestaurantFormValues>({
    resolver: zodResolver(restaurantSchema),
    defaultValues: emptyRestaurant,
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
          }
        : emptyRestaurant,
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
          <form className="restaurant-form" onSubmit={form.handleSubmit(handleSubmit)}>
            <div className="restaurant-form-grid">
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
                name="phoneNationalNumber"
                render={({ field }) => (
                  <FormItem className="restaurant-form-stack-top">
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
                name="address"
                render={({ field }) => (
                  <FormItem className="restaurant-form-wide">
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Textarea rows={3} placeholder="123 King William Street, Adelaide SA 5000" {...field} />
                    </FormControl>
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
  const isPlatformOwner = user?.roles.includes('PlatformOwner') ?? false

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

  return (
    <main className="content-grid">
      <Card>
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
              <div className="restaurant-directory-tools">
                <div className="directory-search">
                  <Search size={16} />
                  <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Filter by name, address, phone, country, timezone, or currency" />
                </div>
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

              <div className="table-wrap">
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
                        </td>
                      </tr>
                    ))}
                    {restaurants.length === 0 && (
                      <tr><td colSpan={6} className="empty-cell">{hasActiveFilters ? 'No restaurants match the current filters.' : 'No restaurants are available for your account.'}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="pagination-bar">
                <span>Showing {pageStart}-{pageEnd} of {totalItems}</span>
                <div className="pagination-actions">
                  <Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setPage(1) }}>
                    <SelectTrigger className="page-size-select"><SelectValue /></SelectTrigger>
                    <SelectContent position="popper">
                      <SelectItem value="10">10 / page</SelectItem>
                      <SelectItem value="20">20 / page</SelectItem>
                      <SelectItem value="50">50 / page</SelectItem>
                    </SelectContent>
                  </Select>
                  <span>Page {currentPage} of {totalPages}</span>
                  <Button type="button" variant="outline" size="icon" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={loading || currentPage <= 1} aria-label="Previous page"><ChevronLeft size={16} /></Button>
                  <Button type="button" variant="outline" size="icon" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={loading || currentPage >= totalPages} aria-label="Next page"><ChevronRight size={16} /></Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <RestaurantTablesPanel restaurants={allRestaurants} restaurantsLoading={loading} />
    </main>
  )
}
