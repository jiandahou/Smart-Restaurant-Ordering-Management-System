import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  Check,
  ClipboardList,
  ChevronDown,
  ChevronUp,
  Clock3,
  LayoutDashboard,
  Loader2,
  LogIn,
  LogOut,
  Minus,
  MapPin,
  MinusCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShoppingBag,
  Store,
  Trash2,
  Utensils,
  UserPlus,
  UserRound,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  addCartItem,
  checkoutCart,
  clearCartItems,
  deleteCartItem,
  getCart,
  joinCart,
  updateCartItem,
  updateCartNote,
  type Cart,
  type CartItem,
} from '@/api/carts'
import type { AuthUser } from '@/api/auth'
import { useAuth } from '@/auth/AuthContext'
import { type CheckoutNavigationState } from '@/pages/CheckoutPage'
import {
  getPublicRestaurantMenu,
  getPublicRestaurantOrderingContext,
  getPublicTableOrderingContext,
  resolvePublicAssetUrl,
  type PublicMenu,
  type PublicMenuCategory,
  type PublicMenuItem,
  type PublicMenuOption,
  type PublicMenuOptionGroup,
  type PublicOrderingContext,
} from '@/api/publicMenu'
import { createCartRealtimeClient, type CartRealtimeClient } from '@/realtime/cartConnection'
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
} from '@/components/ui/alert-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { BrandLogo } from '@/components/BrandLogo'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { rememberGuestOrder } from '@/lib/guestOrders'
import { cn } from '@/lib/utils'

type StoredCartSession = {
  cartId: string
  participantToken: string
  participantId: string
}

type CartViewer = Pick<AuthUser, 'fullName' | 'email' | 'avatarUrl' | 'roles'> | null

const defaultRestaurantHeroImageUrl = 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?auto=format&fit=crop&w=1600&q=80'

type CustomerMenuState =
  | { status: 'loading' }
  | {
      status: 'choosing'
      context: PublicOrderingContext
      menu: PublicMenu
    }
  | {
      status: 'ready'
      context: PublicOrderingContext
      menu: PublicMenu
      cart: Cart
      participantToken: string
      participantId: string
    }
  | { status: 'error'; title: string; message: string }

type CartActivityBanner = {
  id: number
  actorName: string
  itemName: string
  quantity: number
}

const cartActivityBannerDurationMs = 5_200
const cartActivityBannerLaneCount = 4

const cartSessionPrefix = 'dineflow.customer-cart'
const itemNoteMaxLength = 180
const orderNoteMaxLength = 4_000

type NotePresetGroup = {
  label: string
  items: string[]
}

const itemNotePresetGroups: NotePresetGroup[] = [
  {
    label: 'Special requests',
    items: ['Less spicy', 'No onion', 'No coriander', 'Sauce on the side', 'Cut in half'],
  },
  {
    label: 'Allergies',
    items: ['Peanut allergy', 'Tree nut allergy', 'Dairy allergy', 'Gluten-free / coeliac', 'Shellfish allergy'],
  },
]

const orderNotePresetGroups: NotePresetGroup[] = [
  {
    label: 'Order requests',
    items: ['Extra cutlery', 'Keep spicy dishes mild', 'Sauces on the side', 'Call when ready'],
  },
  {
    label: 'Allergies',
    items: ['Peanut allergy', 'Tree nut allergy', 'Dairy allergy', 'Egg allergy', 'Gluten-free / coeliac', 'Shellfish allergy', 'Sesame allergy'],
  },
]

type PublicOpeningHoursWindow = {
  opensAt: string
  closesAt: string
}

type PublicOpeningHoursDay = {
  dayOfWeek: number
  isOpen: boolean
  windows: PublicOpeningHoursWindow[]
}

type PublicSpecialOpeningDay = {
  date: string
  isClosed: boolean
  note: string | null
  windows: PublicOpeningHoursWindow[]
}

const publicOpeningDayLabels = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const publicOpeningTimePattern = /^([01]\d|2[0-3]):[0-5]\d$/

function parsePublicOpeningHours(openingHoursJson?: string | null): PublicOpeningHoursDay[] {
  try {
    const parsed = JSON.parse(openingHoursJson || '[]')
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .map((entry) => {
        const dayOfWeekValue = readPublicJsonValue(entry, 'dayOfWeek')
        const isOpenValue = readPublicJsonValue(entry, 'isOpen')
        const windowsValue = readPublicJsonValue(entry, 'windows')
        const opensAtValue = readPublicJsonValue(entry, 'opensAt')
        const closesAtValue = readPublicJsonValue(entry, 'closesAt')
        const dayOfWeek = typeof dayOfWeekValue === 'number' ? dayOfWeekValue : -1
        const windows = normalizePublicOpeningWindows(windowsValue, opensAtValue, closesAtValue)
        const isOpen = typeof isOpenValue === 'boolean' ? isOpenValue : windows.length > 0

        return {
          dayOfWeek,
          isOpen,
          windows: isOpen && windows.length === 0 ? [{ opensAt: '09:00', closesAt: '21:00' }] : windows,
        }
      })
      .filter((day): day is PublicOpeningHoursDay => day.dayOfWeek >= 0 && day.dayOfWeek <= 6)
      .sort((first, second) => first.dayOfWeek - second.dayOfWeek)
  } catch {
    return []
  }
}

function parsePublicSpecialOpeningDays(specialOpeningDaysJson?: string | null): PublicSpecialOpeningDay[] {
  try {
    const parsed = JSON.parse(specialOpeningDaysJson || '[]')
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .map((entry) => {
        const dateValue = readPublicJsonValue(entry, 'date')
        const isClosedValue = readPublicJsonValue(entry, 'isClosed')
        const noteValue = readPublicJsonValue(entry, 'note')
        const windowsValue = readPublicJsonValue(entry, 'windows')
        const opensAtValue = readPublicJsonValue(entry, 'opensAt')
        const closesAtValue = readPublicJsonValue(entry, 'closesAt')

        if (typeof dateValue !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
          return null
        }

        const isClosed = typeof isClosedValue === 'boolean' ? isClosedValue : true
        const windows = normalizePublicOpeningWindows(windowsValue, opensAtValue, closesAtValue)
        return {
          date: dateValue,
          isClosed,
          note: typeof noteValue === 'string' && noteValue.trim() ? noteValue.trim() : null,
          windows: isClosed ? [] : (windows.length > 0 ? windows : [{ opensAt: '09:00', closesAt: '21:00' }]),
        }
      })
      .filter((day): day is PublicSpecialOpeningDay => Boolean(day))
      .sort((first, second) => first.date.localeCompare(second.date))
  } catch {
    return []
  }
}

function readPublicJsonValue(value: unknown, key: string) {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const record = value as Record<string, unknown>
  const directValue = record[key]
  if (directValue !== undefined) {
    return directValue
  }

  const normalizedKey = key.toLowerCase()
  const matchedKey = Object.keys(record).find((candidate) => candidate.toLowerCase() === normalizedKey)
  return matchedKey ? record[matchedKey] : undefined
}

function normalizePublicOpeningWindows(
  windows: unknown,
  legacyOpensAt?: unknown,
  legacyClosesAt?: unknown,
): PublicOpeningHoursWindow[] {
  const sourceWindows = Array.isArray(windows)
    ? windows
    : typeof legacyOpensAt === 'string' && typeof legacyClosesAt === 'string'
      ? [{ opensAt: legacyOpensAt, closesAt: legacyClosesAt }]
      : []

  return sourceWindows
    .map((window) => {
      const opensAt = readPublicJsonValue(window, 'opensAt')
      const closesAt = readPublicJsonValue(window, 'closesAt')
      return typeof opensAt === 'string' &&
        typeof closesAt === 'string' &&
        publicOpeningTimePattern.test(opensAt) &&
        publicOpeningTimePattern.test(closesAt)
        ? { opensAt, closesAt }
        : null
    })
    .filter((window): window is PublicOpeningHoursWindow => Boolean(window))
}

function getRestaurantDateKey(timezone: string) {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-AU', {
      timeZone: timezone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())
  } catch {
    parts = new Intl.DateTimeFormat('en-AU', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())
  }

  const year = parts.find((part) => part.type === 'year')?.value ?? '1970'
  const month = parts.find((part) => part.type === 'month')?.value ?? '01'
  const day = parts.find((part) => part.type === 'day')?.value ?? '01'
  return `${year}-${month}-${day}`
}

function getDayOfWeekFromDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day).getDay()
}

function formatPublicOpeningWindows(windows: PublicOpeningHoursWindow[]) {
  return windows.length > 0
    ? windows.map((window) => `${window.opensAt} to ${window.closesAt}`).join(', ')
    : 'Closed'
}

function formatPublicSpecialDate(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(year, month - 1, day))
}

function getPublicRestaurantStatus(restaurant: PublicOrderingContext['restaurant']) {
  if (restaurant.isOrderingAvailable) {
    return {
      label: 'Open',
      tone: 'open' as const,
      description: 'Ordering is available now.',
    }
  }

  if (!restaurant.isWithinOpeningHours) {
    return {
      label: 'Closed',
      tone: 'closed' as const,
      description: restaurant.orderingStatusMessage || 'The restaurant is outside operating hours.',
    }
  }

  return {
    label: 'Paused',
    tone: 'paused' as const,
    description: restaurant.orderingStatusMessage || 'Ordering is paused right now.',
  }
}

function isNotePresetApplied(note: string, preset: string) {
  return note.trim().toLowerCase().includes(preset.trim().toLowerCase())
}

function appendNotePreset(note: string, preset: string, maxLength: number) {
  const normalizedNote = note.trim()
  const normalizedPreset = preset.trim()

  if (!normalizedPreset || isNotePresetApplied(normalizedNote, normalizedPreset)) {
    return note
  }

  const nextNote = normalizedNote ? `${normalizedNote}; ${normalizedPreset}` : normalizedPreset
  return nextNote.length > maxLength ? nextNote.slice(0, maxLength) : nextNote
}

export function CustomerMenuPage() {
  const { restaurantId, qrToken } = useParams()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const [state, setState] = useState<CustomerMenuState>({ status: 'loading' })
  const [retryKey, setRetryKey] = useState(0)
  const [search, setSearch] = useState('')
  const [activeCategoryId, setActiveCategoryId] = useState<string | 'all'>('all')
  const [addingItemId, setAddingItemId] = useState<string | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [cartActionItemId, setCartActionItemId] = useState<string | null>(null)
  const [clearingCart, setClearingCart] = useState(false)
  const [savingCartNote, setSavingCartNote] = useState(false)
  const [checkingOut, setCheckingOut] = useState(false)
  const [selectingOrderType, setSelectingOrderType] = useState(false)
  const [selectedItem, setSelectedItem] = useState<PublicMenuItem | null>(null)
  const [selectedItemQuantity, setSelectedItemQuantity] = useState(1)
  const [selectedItemNote, setSelectedItemNote] = useState('')
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([])
  const [editingCartItem, setEditingCartItem] = useState<CartItem | null>(null)
  const [cartActivityBanners, setCartActivityBanners] = useState<Array<CartActivityBanner | null>>(
    Array.from({ length: cartActivityBannerLaneCount }, () => null),
  )
  const realtimeClientRef = useRef<CartRealtimeClient | null>(null)
  const latestCartRef = useRef<Cart | null>(null)
  const cartActivityBannerTimeoutsRef = useRef<number[]>([])
  const pendingFallbackBannerRef = useRef<{ timeoutId: number } | null>(null)

  const showCartActivityBanner = (actorName: string, itemName: string, itemQuantity: number) => {
    const id = Date.now() + Math.floor(Math.random() * 1_000)
    let laneIndex = 0

    setCartActivityBanners((current) => {
      const emptyLaneIndex = current.findIndex((banner) => banner === null)
      laneIndex = emptyLaneIndex >= 0
        ? emptyLaneIndex
        : current.reduce(
            (oldestIndex, banner, index) =>
              (banner?.id ?? 0) < (current[oldestIndex]?.id ?? 0) ? index : oldestIndex,
            0,
          )

      const next = [...current]
      next[laneIndex] = {
        id,
        actorName,
        itemName,
        quantity: itemQuantity,
      }

      return next
    })

    const timeoutId = window.setTimeout(() => {
      setCartActivityBanners((current) => {
        const next = [...current]
        if (next[laneIndex]?.id === id) {
          next[laneIndex] = null
        }
        return next
      })
      cartActivityBannerTimeoutsRef.current = cartActivityBannerTimeoutsRef.current.filter(
        (entry) => entry !== timeoutId,
      )
    }, cartActivityBannerDurationMs)

    cartActivityBannerTimeoutsRef.current.push(timeoutId)
  }

  useEffect(() => {
    return () => {
      cartActivityBannerTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId))
      cartActivityBannerTimeoutsRef.current = []
      if (pendingFallbackBannerRef.current) {
        window.clearTimeout(pendingFallbackBannerRef.current.timeoutId)
        pendingFallbackBannerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadMenu() {
      if (!restaurantId && !qrToken) {
        setState({
          status: 'error',
          title: 'Ordering link unavailable',
          message: 'This ordering link is missing restaurant or table information.',
        })
        return
      }

      setState({ status: 'loading' })

      try {
        const context = restaurantId
          ? await getPublicRestaurantOrderingContext(restaurantId)
          : await getPublicTableOrderingContext(qrToken!)

        const menu = await getPublicRestaurantMenu(context.restaurant.id)

        if (cancelled) {
          return
        }

        if (!context.restaurant.isOrderingAvailable) {
          setState({ status: 'choosing', context, menu })
          return
        }

        if (restaurantId) {
          setState({ status: 'choosing', context, menu })
          return
        }

        const cartSession = await loadOrJoinCart(context, `table:${qrToken}`, 'DineIn')

        setState({
          status: 'ready',
          context,
          menu,
          cart: cartSession.cart,
          participantToken: cartSession.participantToken,
          participantId: cartSession.participantId,
        })
      } catch (error) {
        if (cancelled) {
          return
        }

        const message = error instanceof Error ? error.message : 'Unable to load menu.'
        setState({
          status: 'error',
          title: 'Menu unavailable',
          message,
        })
      }
    }

    void loadMenu()

    return () => {
      cancelled = true
    }
  }, [restaurantId, qrToken, retryKey])

  useEffect(() => {
    latestCartRef.current = state.status === 'ready' ? state.cart : null
  }, [state])

  useEffect(() => {
    if (state.status !== 'ready') {
      void realtimeClientRef.current?.stop()
      realtimeClientRef.current = null
      return
    }

    const client = createCartRealtimeClient(state.cart.id, state.participantToken, {
      onCartUpdated: ({ reason, cart }) => {
        if (cart) {
          if (reason === 'item-added') {
            const previousCart = latestCartRef.current
            const addedItem = previousCart ? detectCartAddition(previousCart, cart) : null
            if (addedItem) {
              if (pendingFallbackBannerRef.current) {
                window.clearTimeout(pendingFallbackBannerRef.current.timeoutId)
              }
              const timeoutId = window.setTimeout(() => {
                pendingFallbackBannerRef.current = null
                showCartActivityBanner('Someone', addedItem.name, addedItem.quantity)
              }, 300)
              pendingFallbackBannerRef.current = { timeoutId }
            }
          }
          latestCartRef.current = cart
          setState((current) =>
            current.status === 'ready' ? { ...current, cart } : current,
          )
        }
      },
      onCartItemAdded: (update) => {
        if (update.actorParticipantId === state.participantId) {
          if (pendingFallbackBannerRef.current) {
            window.clearTimeout(pendingFallbackBannerRef.current.timeoutId)
            pendingFallbackBannerRef.current = null
          }
          return
        }
        if (pendingFallbackBannerRef.current) {
          window.clearTimeout(pendingFallbackBannerRef.current.timeoutId)
          pendingFallbackBannerRef.current = null
        }
        showCartActivityBanner(update.actorName, update.itemName, update.quantity)
      },
      onCartSubmitted: ({ cart }) => {
        latestCartRef.current = cart
        setState((current) =>
          current.status === 'ready' ? { ...current, cart } : current,
        )
        toast.success('Order submitted')
      },
      onCartExpired: () => {
        setState({
          status: 'error',
          title: 'Cart expired',
          message: 'This cart has expired. Scan the QR code again to start a new order.',
        })
      },
      onReconnected: async () => {
        const refreshed = await getCart(state.cart.id, state.participantToken)
        latestCartRef.current = refreshed
        setState((current) =>
          current.status === 'ready' ? { ...current, cart: refreshed } : current,
        )
      },
    })

    realtimeClientRef.current = client
    void client.start().catch(() => undefined)

    return () => {
      void client.stop()
      realtimeClientRef.current = null
    }
  }, [
    state.status === 'ready' ? state.cart.id : null,
    state.status === 'ready' ? state.participantToken : null,
    state.status === 'ready' ? state.participantId : null,
  ])

  useEffect(() => {
    if (state.status !== 'ready') {
      return undefined
    }

    let stopped = false
    const cartId = state.cart.id
    const participantToken = state.participantToken

    const intervalId = window.setInterval(async () => {
      try {
        const refreshed = await getCart(cartId, participantToken)

        if (stopped) {
          return
        }

        const previousCart = latestCartRef.current
        const addedItem = previousCart ? detectCartAddition(previousCart, refreshed) : null
        latestCartRef.current = refreshed

        setState((current) =>
          current.status === 'ready' && current.cart.id === cartId
            ? { ...current, cart: refreshed }
            : current,
        )

        // Fallback banner when SignalR CartUpdated didn't already handle detection
        // (latestCartRef stays stale when SignalR is disconnected, so polling detects the diff)
        if (addedItem) {
          showCartActivityBanner('Someone', addedItem.name, addedItem.quantity)
        }
      } catch {
        // Realtime remains the primary path; polling is only a quiet fallback.
      }
    }, 2_500)

    return () => {
      stopped = true
      window.clearInterval(intervalId)
    }
  }, [
    state.status === 'ready' ? state.cart.id : null,
    state.status === 'ready' ? state.participantToken : null,
  ])

  const visibleCategories = useMemo(() => {
    if (state.status !== 'ready') {
      return []
    }

    const normalizedSearch = search.trim().toLowerCase()

    return state.menu.categories
      .map((category) => ({
        ...category,
        items: category.items.filter((item) => {
          if (!normalizedSearch) {
            return true
          }

          const optionText = getAvailableOptionGroups(item)
            .flatMap((group) => [group.name, ...group.options.map((option) => option.name)])

          return [item.name, item.description ?? '', ...optionText]
            .join(' ')
            .toLowerCase()
            .includes(normalizedSearch)
        }),
      }))
      .filter((category) => category.items.length > 0)
  }, [search, state])

  useEffect(() => {
    if (state.status !== 'ready' || visibleCategories.length === 0) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((first, second) => first.boundingClientRect.top - second.boundingClientRect.top)[0]

        if (visibleEntry?.target.id) {
          setActiveCategoryId(visibleEntry.target.id.replace('menu-category-', ''))
        }
      },
      {
        rootMargin: '-20% 0px -65% 0px',
        threshold: 0.01,
      },
    )

    visibleCategories.forEach((category) => {
      const element = document.getElementById(getCategorySectionId(category.id))
      if (element) {
        observer.observe(element)
      }
    })

    return () => observer.disconnect()
  }, [state.status, visibleCategories])

  const chooseOrderType = async (orderType: 'DineIn' | 'Takeaway') => {
    if (state.status !== 'choosing' || selectingOrderType) return

    if (!state.context.restaurant.isOrderingAvailable) {
      toast.error(state.context.restaurant.orderingStatusMessage)
      return
    }

    setSelectingOrderType(true)
    try {
      const cartSession = await loadOrJoinCart(
        state.context,
        `restaurant:${state.context.restaurant.id}:${orderType.toLowerCase()}`,
        orderType,
      )
      setState({
        status: 'ready',
        context: { ...state.context, orderType },
        menu: state.menu,
        cart: cartSession.cart,
        participantToken: cartSession.participantToken,
        participantId: cartSession.participantId,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start ordering')
    } finally {
      setSelectingOrderType(false)
    }
  }

  const switchOrderType = async (orderType: 'DineIn' | 'Takeaway') => {
    if (
      state.status !== 'ready' ||
      state.context.table ||
      state.cart.orderType === orderType ||
      selectingOrderType
    ) {
      return
    }

    if (!state.context.restaurant.isOrderingAvailable) {
      toast.error(state.context.restaurant.orderingStatusMessage)
      return
    }

    setSelectingOrderType(true)
    try {
      const cartSession = await loadOrJoinCart(
        state.context,
        `restaurant:${state.context.restaurant.id}:${orderType.toLowerCase()}`,
        orderType,
      )
      latestCartRef.current = cartSession.cart
      setCartOpen(false)
      setState({
        ...state,
        context: { ...state.context, orderType },
        cart: cartSession.cart,
        participantToken: cartSession.participantToken,
        participantId: cartSession.participantId,
      })
      toast.success(`Switched to ${orderType === 'DineIn' ? 'dine in' : 'takeaway'}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not change order type')
    } finally {
      setSelectingOrderType(false)
    }
  }

  if (state.status === 'loading') {
    return <CustomerMenuLoading />
  }

  if (state.status === 'error') {
    return (
      <CustomerMenuError
        title={state.title}
        message={state.message}
        onRetry={(restaurantId || qrToken) ? () => setRetryKey((k) => k + 1) : undefined}
      />
    )
  }

  if (state.status === 'choosing') {
    return (
      <PublicOrderTypeChooser
        context={state.context}
        loading={selectingOrderType}
        onSelect={(orderType) => void chooseOrderType(orderType)}
      />
    )
  }

  const { context, menu, cart, participantToken } = state
  const currencyFormatter = createCurrencyFormatter(context.restaurant.currency)
  const restaurantImageUrl = resolveRestaurantHeroImageUrl(context.restaurant.imageUrl)
  const orderTypeLabel = cart.orderType === 'DineIn' ? 'Dine in' : 'Takeaway'
  const paymentPolicyLabel = context.restaurant.paymentPolicy === 'PrepayRequired'
    ? 'Online payment required'
    : 'Online or counter'
  const hasMenu = menu.categories.some((category) => category.items.length > 0)
  const categorySummaries = menu.categories.map((category) => ({
    id: category.id,
    name: category.name,
    count: category.items.length,
  }))
  const menuItemsById = new Map(
    menu.categories.flatMap((category) => category.items.map((item) => [item.id, item] as const)),
  )
  const totalMenuItemCount = categorySummaries.reduce((total, category) => total + category.count, 0)
  const visibleMenuItemCount = visibleCategories.reduce((total, category) => total + category.items.length, 0)

  const scrollToCategory = (categoryId: string | 'all') => {
    setActiveCategoryId(categoryId)

    if (categoryId === 'all') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    document
      .getElementById(getCategorySectionId(categoryId))
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const openItemDetail = (item: PublicMenuItem) => {
    setEditingCartItem(null)
    setSelectedItem(item)
    setSelectedItemQuantity(1)
    setSelectedItemNote('')
    setSelectedOptionIds(getDefaultSelectedOptionIds(item))
  }

  const closeItemDetail = () => {
    if (!addingItemId) {
      setSelectedItem(null)
      setSelectedItemQuantity(1)
      setSelectedItemNote('')
      setSelectedOptionIds([])
      setEditingCartItem(null)
    }
  }

  const openCartItemModifier = (item: CartItem) => {
    if (cart.status !== 'Active') {
      return
    }

    const menuItem = menuItemsById.get(item.menuItemId)

    if (!menuItem) {
      toast.error('This item is no longer available to modify.')
      return
    }

    setEditingCartItem(item)
    setSelectedItem(menuItem)
    setSelectedItemQuantity(item.quantity)
    setSelectedItemNote(item.note ?? '')
    setSelectedOptionIds(getCartItemSelectedOptionIds(item))
  }

  const addItem = async (item: PublicMenuItem, quantity = 1, note = '', optionIds: string[] = []) => {
    if (item.isSoldOut || !item.isAvailable || addingItemId) {
      return false
    }

    setAddingItemId(item.id)
    const normalizedNote = note.trim()
    const normalizedOptionIds = getOrderedSelectedOptionIds(item, optionIds)

    try {
      const updatedCart = await addCartItem(cart.id, participantToken, {
        menuItemId: item.id,
        quantity,
        ...(normalizedNote ? { note: normalizedNote } : {}),
        ...(normalizedOptionIds.length > 0 ? { selectedOptionIds: normalizedOptionIds } : {}),
      })
      latestCartRef.current = updatedCart
      setState((current) =>
        current.status === 'ready' ? { ...current, cart: updatedCart } : current,
      )
      showCartActivityBanner('You', item.name, quantity)
      toast.success(`${item.name} added to cart`)
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add item')
      return false
    } finally {
      setAddingItemId(null)
    }
  }

  const updateCartLine = async (
    item: CartItem,
    quantity: number,
    note = '',
    optionIds?: string[],
  ) => {
    if (cart.status !== 'Active' || cartActionItemId || clearingCart) {
      return false
    }

    if (quantity < 1) {
      return false
    }

    setCartActionItemId(item.id)
    const normalizedNote = note.trim()

    try {
      const updatedCart = await updateCartItem(cart.id, item.id, participantToken, {
        quantity,
        ...(normalizedNote ? { note: normalizedNote } : {}),
        ...(optionIds ? { selectedOptionIds: optionIds } : {}),
      })

      latestCartRef.current = updatedCart
      setState((current) =>
        current.status === 'ready' ? { ...current, cart: updatedCart } : current,
      )
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update cart')
      return false
    } finally {
      setCartActionItemId(null)
    }
  }

  const addSelectedItem = async () => {
    if (!selectedItem) {
      return
    }

    const validationMessage = getOptionSelectionError(selectedItem, selectedOptionIds)

    if (validationMessage) {
      toast.error(validationMessage)
      return
    }

    if (editingCartItem) {
      setAddingItemId(selectedItem.id)

      const normalizedOptionIds = getOrderedSelectedOptionIds(selectedItem, selectedOptionIds)
      const updated = await updateCartLine(
        editingCartItem,
        selectedItemQuantity,
        selectedItemNote,
        normalizedOptionIds,
      )

      setAddingItemId(null)

      if (updated) {
        setSelectedItem(null)
        setSelectedItemQuantity(1)
        setSelectedItemNote('')
        setSelectedOptionIds([])
        setEditingCartItem(null)
        toast.success(`${selectedItem.name} updated`)
      }

      return
    }

    const added = await addItem(selectedItem, selectedItemQuantity, selectedItemNote, selectedOptionIds)

    if (added) {
      closeItemDetail()
    }
  }

  const toggleSelectedOption = (group: PublicMenuOptionGroup, option: PublicMenuOption) => {
    if (!selectedItem || addingItemId) {
      return
    }

    setSelectedOptionIds((current) => toggleOptionSelection(current, group, option))
  }

  const changeSelectedOptionQuantity = (
    group: PublicMenuOptionGroup,
    option: PublicMenuOption,
    quantity: number,
  ) => {
    if (!selectedItem || addingItemId) {
      return
    }

    setSelectedOptionIds((current) => setOptionQuantity(current, group, option, quantity))
  }

  const updateCartLineQuantity = async (item: CartItem, nextQuantity: number) => {
    await updateCartLine(item, nextQuantity, item.note ?? '')
  }

  const updateCartLineOptionQuantity = async (
    item: CartItem,
    group: PublicMenuOptionGroup,
    option: PublicMenuOption,
    nextQuantity: number,
  ) => {
    const menuItem = menuItemsById.get(item.menuItemId)

    if (!menuItem) {
      toast.error('This item is no longer available to modify.')
      return
    }

    const nextOptionIds = setOptionQuantity(
      getCartItemSelectedOptionIds(item),
      group,
      option,
      nextQuantity,
    )
    const validationMessage = getOptionSelectionError(menuItem, nextOptionIds)

    if (validationMessage) {
      toast.error(validationMessage)
      return
    }

    await updateCartLine(
      item,
      item.quantity,
      item.note ?? '',
      getOrderedSelectedOptionIds(menuItem, nextOptionIds),
    )
  }

  const removeCartLine = async (item: CartItem) => {
    if (cart.status !== 'Active' || cartActionItemId || clearingCart) {
      return
    }

    setCartActionItemId(item.id)

    try {
      const updatedCart = await deleteCartItem(cart.id, item.id, participantToken)

      latestCartRef.current = updatedCart
      setState((current) =>
        current.status === 'ready' ? { ...current, cart: updatedCart } : current,
      )
      toast.success(`${item.name} removed from cart`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not remove item')
    } finally {
      setCartActionItemId(null)
    }
  }

  const clearCart = async () => {
    if (cart.status !== 'Active' || cartActionItemId || clearingCart || cart.items.length === 0) {
      return
    }

    setClearingCart(true)

    try {
      const updatedCart = await clearCartItems(cart.id, participantToken)

      latestCartRef.current = updatedCart
      setState((current) =>
        current.status === 'ready' ? { ...current, cart: updatedCart } : current,
      )
      toast.success('Cart cleared')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not clear cart')
    } finally {
      setClearingCart(false)
    }
  }

  const saveCartNote = async (note: string) => {
    if (cart.status !== 'Active' || cartActionItemId || clearingCart || savingCartNote) {
      return
    }

    setSavingCartNote(true)

    try {
      const updatedCart = await updateCartNote(cart.id, participantToken, note)

      latestCartRef.current = updatedCart
      setState((current) =>
        current.status === 'ready' ? { ...current, cart: updatedCart } : current,
      )
      toast.success(note.trim() ? 'Order note saved' : 'Order note removed')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save order note')
      throw error
    } finally {
      setSavingCartNote(false)
    }
  }

  const handleCheckout = async () => {
    if (checkingOut || clearingCart) return

    if (!context.restaurant.isOrderingAvailable) {
      toast.error(context.restaurant.orderingStatusMessage)
      return
    }

    setCheckingOut(true)
    try {
      const result = await checkoutCart(cart.id, participantToken)
      rememberGuestOrder(result.order.id)
      const returnPath = qrToken
        ? `/table/${encodeURIComponent(qrToken)}`
        : `/r/${encodeURIComponent(context.restaurant.id)}/menu`

      navigate('/checkout', {
        state: {
          order: result.order,
          cartId: cart.id,
          participantToken,
          currency: context.restaurant.currency,
          restaurantName: context.restaurant.name,
          tableNumber: context.table?.tableNumber ?? null,
          paymentPolicy: context.restaurant.paymentPolicy,
          returnPath,
        } satisfies CheckoutNavigationState,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start checkout')
      setCheckingOut(false)
    }
  }

  return (
    <main className="min-h-svh bg-background pb-28 text-foreground">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-3 py-4 sm:px-6 lg:px-8">
        <header className="overflow-hidden rounded-[2rem] border bg-card shadow-sm">
          <div className="relative min-h-[230px] overflow-hidden bg-muted sm:min-h-[280px]">
            {restaurantImageUrl ? (
              <img
                src={restaurantImageUrl}
                alt={`${context.restaurant.name} restaurant`}
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-orange-100 via-background to-muted dark:from-orange-950/40 dark:via-background dark:to-muted">
                <div className="grid size-24 place-items-center rounded-full border border-white/40 bg-background/75 text-3xl font-semibold shadow-xl backdrop-blur">
                  {getInitials(context.restaurant.name)}
                </div>
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-black/10" />
            <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 p-4 sm:p-5">
              {context.table ? (
                <Badge variant="outline" className="h-9 gap-1.5 rounded-full border-white/50 bg-background/95 px-3 text-sm text-foreground shadow-lg">
                  <Utensils className="size-3.5" />
                  Table {context.table.tableNumber}
                </Badge>
              ) : (
                <Select
                  value={cart.orderType}
                  disabled={selectingOrderType}
                  onValueChange={(value) => {
                    if (value === 'DineIn' || value === 'Takeaway') {
                      void switchOrderType(value)
                    }
                  }}
                >
                  <SelectTrigger size="sm" aria-label="Order type" className="h-10 rounded-full border-white/50 bg-background/95 px-3 text-foreground shadow-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" align="start">
                    {context.availableOrderTypes.includes('DineIn') ? (
                      <SelectItem value="DineIn">
                        <Utensils className="size-3.5" />
                        Dine in
                      </SelectItem>
                    ) : null}
                    {context.availableOrderTypes.includes('Takeaway') ? (
                      <SelectItem value="Takeaway">
                        <ShoppingBag className="size-3.5" />
                        Takeaway
                      </SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
              )}
              <div className="flex shrink-0 items-center gap-2">
                <RestaurantOperatingStatusButton restaurant={context.restaurant} />
                <CartViewerButton
                  viewer={user}
                  onLogout={() => {
                    logout()
                    navigate('/login')
                  }}
                />
              </div>
            </div>
            <div className="absolute inset-x-0 bottom-0 z-10 space-y-3 p-5 text-white sm:p-7">
              <div className="space-y-1">
                <BrandLogo className="public-menu-brand-logo" />
                <h1 className="font-heading max-w-3xl text-4xl font-semibold leading-none tracking-tight sm:text-6xl">
                  {context.restaurant.name}
                </h1>
              </div>
              <div className="flex flex-wrap gap-2 text-sm font-medium">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-white ring-1 ring-white/25 backdrop-blur">
                  {cart.orderType === 'DineIn' ? <Utensils className="size-3.5" /> : <ShoppingBag className="size-3.5" />}
                  {orderTypeLabel}
                </span>
                <span className="rounded-full bg-white/15 px-3 py-1 text-white ring-1 ring-white/25 backdrop-blur">
                  {context.restaurant.currency}
                </span>
                <span className="rounded-full bg-white/15 px-3 py-1 text-white ring-1 ring-white/25 backdrop-blur">
                  {paymentPolicyLabel}
                </span>
              </div>
            </div>
          </div>

          <div className="p-4 text-sm text-muted-foreground sm:p-5">
            <div className="flex min-w-0 items-center gap-2">
              <MapPin className="size-4 shrink-0" />
              <span className="truncate">{context.restaurant.address || 'Restaurant address unavailable'}</span>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-[118px_minmax(0,1fr)] items-start gap-3 sm:grid-cols-[190px_minmax(0,1fr)] lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-6">
          <CategorySidebar
            categories={categorySummaries}
            activeCategoryId={activeCategoryId}
            onSelect={scrollToCategory}
          />

          <div className="min-w-0 space-y-6">
            <div className="sticky top-3 z-10 rounded-2xl border bg-card/95 p-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/85">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value)
                      setActiveCategoryId('all')
                    }}
                    placeholder="Search dishes, drinks, or add-ons"
                    className="h-12 rounded-xl border-muted bg-background/80 pl-10 pr-10 text-base shadow-inner shadow-black/[0.02] focus-visible:ring-2"
                  />
                  {search && (
                    <button
                      type="button"
                      aria-label="Clear search"
                      onClick={() => { setSearch(''); setActiveCategoryId('all') }}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
                <div className="flex shrink-0 items-center justify-between gap-2 rounded-xl bg-muted/60 px-3 py-2 text-xs font-semibold text-muted-foreground sm:min-w-28 sm:justify-center">
                  <span>{visibleMenuItemCount} shown</span>
                  <span className="text-muted-foreground/60">/</span>
                  <span>{totalMenuItemCount} total</span>
                </div>
              </div>
            </div>

            {!hasMenu ? (
              <EmptyMenuState />
            ) : visibleCategories.length === 0 ? (
              <NoResultsState onReset={() => {
                setSearch('')
                setActiveCategoryId('all')
              }} />
            ) : (
              <div className="space-y-7">
                {visibleCategories.map((category) => (
                  <MenuCategorySection
                    key={category.id}
                    category={category}
                    currencyFormatter={currencyFormatter}
                    onOpenItem={openItemDetail}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <CartSummaryBar
        cart={cart}
        currencyFormatter={currencyFormatter}
        menuItemsById={menuItemsById}
        open={cartOpen}
        updatingItemId={cartActionItemId}
        isClearingCart={clearingCart}
        isSavingNote={savingCartNote}
        isCheckingOut={checkingOut}
        onOpenChange={setCartOpen}
        onQuantityChange={updateCartLineQuantity}
        onOptionQuantityChange={updateCartLineOptionQuantity}
        onModifyItem={openCartItemModifier}
        onRemoveItem={removeCartLine}
        onClearCart={clearCart}
        onOrderNoteSave={saveCartNote}
        onCheckout={() => void handleCheckout()}
      />

      <ItemDetailOverlay
        item={selectedItem}
        quantity={selectedItemQuantity}
        note={selectedItemNote}
        selectedOptionIds={selectedOptionIds}
        currencyFormatter={currencyFormatter}
        isAdding={selectedItem ? addingItemId === selectedItem.id : false}
        isEditing={Boolean(editingCartItem)}
        onClose={closeItemDetail}
        onQuantityChange={setSelectedItemQuantity}
        onNoteChange={setSelectedItemNote}
        onToggleOption={toggleSelectedOption}
        onOptionQuantityChange={changeSelectedOptionQuantity}
        onAddToCart={addSelectedItem}
      />

      {cartActivityBanners.some(Boolean) && (
        <div className="cart-activity-banner-lanes" aria-live="polite">
          {cartActivityBanners.map((banner, index) => (
            <div key={index} className="cart-activity-banner-lane">
              {banner && <CartActivityBannerView banner={banner} />}
            </div>
          ))}
        </div>
      )}
    </main>
  )
}

async function loadOrJoinCart(
  context: PublicOrderingContext,
  storageKeySuffix: string,
  orderType: 'DineIn' | 'Takeaway',
): Promise<{ cart: Cart; participantToken: string; participantId: string }> {
  if (!context.restaurant.isOrderingAvailable) {
    throw new Error(context.restaurant.orderingStatusMessage)
  }

  const storageKey = `${cartSessionPrefix}.${storageKeySuffix}`
  const stored = readStoredCartSession(storageKey)

  if (stored) {
    try {
      const cart = await getCart(stored.cartId, stored.participantToken)

      if (cart.status === 'Active') {
        return {
          cart,
          participantToken: stored.participantToken,
          participantId: stored.participantId,
        }
      }
    } catch {
      sessionStorage.removeItem(storageKey)
    }
  }

  const joined = await joinCart(
    context.table
      ? { tableQrToken: context.menuEntryUrl.replace('/table/', '') }
      : { restaurantId: context.restaurant.id, orderType },
  )

  sessionStorage.setItem(
    storageKey,
    JSON.stringify({
      cartId: joined.cart.id,
      participantToken: joined.participantToken,
      participantId: joined.participantId,
    } satisfies StoredCartSession),
  )

  return {
    cart: joined.cart,
    participantToken: joined.participantToken,
    participantId: joined.participantId,
  }
}

function RestaurantOperatingStatusButton({ restaurant }: { restaurant: PublicOrderingContext['restaurant'] }) {
  const [open, setOpen] = useState(false)
  const status = getPublicRestaurantStatus(restaurant)
  const openingHours = parsePublicOpeningHours(restaurant.openingHoursJson)
  const specialOpeningDays = parsePublicSpecialOpeningDays(restaurant.specialOpeningDaysJson)
  const todayKey = getRestaurantDateKey(restaurant.timezone)
  const todaySpecial = specialOpeningDays.find((day) => day.date === todayKey)
  const todayRegular = openingHours.find((day) => day.dayOfWeek === getDayOfWeekFromDateKey(todayKey))
  const todayIsOpen = todaySpecial ? !todaySpecial.isClosed : Boolean(todayRegular?.isOpen)
  const todayWindows = todaySpecial
    ? todaySpecial.windows
    : todayRegular?.isOpen
      ? todayRegular.windows
      : []
  const upcomingSpecialDays = specialOpeningDays
    .filter((day) => day.date >= todayKey)
    .slice(0, 6)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(
                'h-10 rounded-full border-white/50 bg-background/95 px-3 text-foreground shadow-lg backdrop-blur hover:bg-background',
                status.tone === 'open' && 'border-emerald-200/80 text-emerald-800 dark:border-emerald-400/40 dark:text-emerald-100',
                status.tone === 'closed' && 'border-red-200/80 text-red-700 dark:border-red-400/40 dark:text-red-100',
                status.tone === 'paused' && 'border-amber-200/80 text-amber-800 dark:border-amber-400/40 dark:text-amber-100',
              )}
              onClick={() => setOpen(true)}
            >
              <span
                className={cn(
                  'size-2 rounded-full',
                  status.tone === 'open' && 'bg-emerald-500',
                  status.tone === 'closed' && 'bg-red-500',
                  status.tone === 'paused' && 'bg-amber-500',
                )}
                aria-hidden="true"
              />
              <Clock3 className="size-3.5" />
              <span>{status.label}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end" sideOffset={8}>
            Click to view operating hours
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-5" />
            Operating hours
          </DialogTitle>
          <DialogDescription>
            Times use {restaurant.name}'s timezone: {restaurant.timezone}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div
            className={cn(
              'rounded-xl border p-4',
              status.tone === 'open' && 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-50',
              status.tone === 'closed' && 'border-red-200 bg-red-50 text-red-950 dark:border-red-400/25 dark:bg-red-400/10 dark:text-red-50',
              status.tone === 'paused' && 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-50',
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Current status</p>
                <p className="mt-1 text-2xl font-semibold">{status.label}</p>
              </div>
              <Badge variant={todayIsOpen ? 'secondary' : 'destructive'} className="rounded-full">
                {todaySpecial ? 'Special today' : 'Today'}
              </Badge>
            </div>
            <p className="mt-3 text-sm opacity-80">{status.description}</p>
          </div>

          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Today</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {todaySpecial ? 'Special schedule override' : 'Weekly schedule'}
                </p>
              </div>
              <p className="text-right text-sm font-semibold text-foreground">
                {formatPublicOpeningWindows(todayWindows)}
              </p>
            </div>
            {todaySpecial?.note ? (
              <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">{todaySpecial.note}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold text-foreground">Weekly hours</p>
            <div className="overflow-hidden rounded-xl border">
              {publicOpeningDayLabels.map((label, dayOfWeek) => {
                const day = openingHours.find((entry) => entry.dayOfWeek === dayOfWeek)
                return (
                  <div key={label} className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 border-b px-3 py-2.5 text-sm last:border-b-0">
                    <span className="font-medium text-foreground">{label}</span>
                    <span className="text-right text-muted-foreground">
                      {day?.isOpen ? formatPublicOpeningWindows(day.windows) : 'Closed'}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold text-foreground">Special days</p>
            {upcomingSpecialDays.length > 0 ? (
              <div className="overflow-hidden rounded-xl border">
                {upcomingSpecialDays.map((day) => (
                  <div key={day.date} className="grid gap-1 border-b px-3 py-2.5 text-sm last:border-b-0">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-foreground">{formatPublicSpecialDate(day.date)}</span>
                      <span className={cn('text-right font-semibold', day.isClosed ? 'text-red-600 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300')}>
                        {day.isClosed ? 'Closed' : formatPublicOpeningWindows(day.windows)}
                      </span>
                    </div>
                    {day.note ? <span className="text-muted-foreground">{day.note}</span> : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
                No upcoming special days are published.
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function readStoredCartSession(storageKey: string) {
  try {
    const rawValue = sessionStorage.getItem(storageKey)

    if (!rawValue) {
      return null
    }

    const parsed = JSON.parse(rawValue) as Partial<StoredCartSession>

    if (!parsed.cartId || !parsed.participantToken || !parsed.participantId) {
      return null
    }

    return {
      cartId: parsed.cartId,
      participantToken: parsed.participantToken,
      participantId: parsed.participantId,
    }
  } catch {
    return null
  }
}

function detectCartAddition(previousCart: Cart, nextCart: Cart) {
  const previousQuantities = new Map<string, number>()

  previousCart.items.forEach((item) => {
    previousQuantities.set(getCartItemKey(item), item.quantity)
  })

  for (const item of nextCart.items) {
    const previousQuantity = previousQuantities.get(getCartItemKey(item)) ?? 0
    const addedQuantity = item.quantity - previousQuantity

    if (addedQuantity > 0) {
      return {
        name: item.name,
        quantity: addedQuantity,
      }
    }
  }

  return null
}

function getCartItemKey(item: CartItem) {
  const optionKey = item.selectedOptions
    .map((option) => `${option.menuItemOptionId ?? `${option.groupNameSnapshot}:${option.optionNameSnapshot}`}x${option.quantity ?? 1}`)
    .join(',')

  return `${item.menuItemId}:${optionKey}:${item.note ?? ''}`
}

function getCartItemSelectedOptionIds(item: CartItem) {
  return item.selectedOptions.flatMap((option) => {
    if (!option.menuItemOptionId) {
      return []
    }

    return Array.from({ length: option.quantity ?? 1 }, () => option.menuItemOptionId!)
  })
}

function findPublicMenuOption(menuItem: PublicMenuItem | null, optionId: string | null) {
  if (!menuItem || !optionId) {
    return null
  }

  for (const group of getAvailableOptionGroups(menuItem)) {
    const option = group.options.find((entry) => entry.id === optionId)

    if (option) {
      return { group, option }
    }
  }

  return null
}

function getAvailableOptionGroups(item: PublicMenuItem) {
  return [...(item.optionGroups ?? [])]
    .filter((group) => group.isActive && group.options.some((option) => option.isAvailable))
    .sort((first, second) => first.displayOrder - second.displayOrder || first.name.localeCompare(second.name))
    .map((group) => ({
      ...group,
      options: [...group.options]
        .filter((option) => option.isAvailable)
        .sort((first, second) => first.displayOrder - second.displayOrder || first.name.localeCompare(second.name)),
    }))
}

function getDefaultSelectedOptionIds(item: PublicMenuItem) {
  return getAvailableOptionGroups(item)
    .flatMap((group) => {
      if (!group.isRequired) {
        return []
      }

      const selectedIds: string[] = []
      for (const option of group.options) {
        const remainingSelections = group.minSelections - selectedIds.length
        if (remainingSelections <= 0) {
          break
        }

        selectedIds.push(...Array.from(
          { length: Math.min(option.maxQuantity, remainingSelections) },
          () => option.id,
        ))
      }

      return selectedIds
    })
}

function getOptionQuantity(selectedOptionIds: string[], optionId: string) {
  return selectedOptionIds.filter((selectedOptionId) => selectedOptionId === optionId).length
}

function getSelectedCountInGroup(selectedOptionIds: string[], group: PublicMenuOptionGroup) {
  const groupOptionIds = new Set(group.options.map((option) => option.id))
  return selectedOptionIds.filter((optionId) => groupOptionIds.has(optionId)).length
}

function getOrderedSelectedOptions(item: PublicMenuItem, selectedOptionIds: string[]) {
  const selectedQuantities = selectedOptionIds.reduce<Map<string, number>>((map, optionId) => {
    map.set(optionId, (map.get(optionId) ?? 0) + 1)
    return map
  }, new Map())

  return getAvailableOptionGroups(item)
    .flatMap((group) => group.options.map((option) => ({ group, option })))
    .flatMap(({ group, option }) => {
      const quantity = selectedQuantities.get(option.id) ?? 0
      return quantity > 0 ? [{ group, option, quantity }] : []
    })
}

function getOrderedSelectedOptionIds(item: PublicMenuItem, selectedOptionIds: string[]) {
  return getOrderedSelectedOptions(item, selectedOptionIds)
    .flatMap(({ option, quantity }) => Array.from({ length: quantity }, () => option.id))
}

function setOptionQuantity(
  selectedOptionIds: string[],
  group: PublicMenuOptionGroup,
  option: PublicMenuOption,
  nextQuantity: number,
) {
  if (group.maxSelections <= 1) {
    const groupOptionIds = new Set(group.options.map((entry) => entry.id))
    const withoutGroup = selectedOptionIds.filter((optionId) => !groupOptionIds.has(optionId))
    return nextQuantity > 0 ? [...withoutGroup, option.id] : withoutGroup
  }

  const currentQuantity = getOptionQuantity(selectedOptionIds, option.id)
  const selectedInGroup = getSelectedCountInGroup(selectedOptionIds, group)
  const availableGroupSlots = group.maxSelections - (selectedInGroup - currentQuantity)
  const clampedQuantity = Math.max(0, Math.min(nextQuantity, option.maxQuantity, availableGroupSlots))
  const withoutOption = selectedOptionIds.filter((optionId) => optionId !== option.id)

  return [
    ...withoutOption,
    ...Array.from({ length: clampedQuantity }, () => option.id),
  ]
}

function toggleOptionSelection(
  selectedOptionIds: string[],
  group: PublicMenuOptionGroup,
  option: PublicMenuOption,
) {
  const currentQuantity = getOptionQuantity(selectedOptionIds, option.id)
  return setOptionQuantity(selectedOptionIds, group, option, currentQuantity > 0 ? 0 : 1)
}

function getOptionSelectionError(item: PublicMenuItem, selectedOptionIds: string[]) {
  for (const group of getAvailableOptionGroups(item)) {
    const selectedInGroup = getSelectedCountInGroup(selectedOptionIds, group)

    if (group.isRequired && selectedInGroup < group.minSelections) {
      return `${group.name} requires at least ${group.minSelections} selection${group.minSelections === 1 ? '' : 's'}.`
    }

    if (selectedInGroup > group.maxSelections) {
      return `${group.name} allows at most ${group.maxSelections} selection${group.maxSelections === 1 ? '' : 's'}.`
    }

    for (const option of group.options) {
      const selectedQuantity = getOptionQuantity(selectedOptionIds, option.id)
      if (selectedQuantity > option.maxQuantity) {
        return `${option.name} allows at most ${option.maxQuantity}.`
      }
    }
  }

  return null
}

function calculateItemUnitPrice(item: PublicMenuItem, selectedOptionIds: string[]) {
  return getOrderedSelectedOptions(item, selectedOptionIds)
    .reduce((unitPrice, { option, quantity }) => {
      if (option.adjustmentType === 2) {
        return option.priceAdjustment
      }

      return unitPrice + option.priceAdjustment * quantity
    }, item.price)
}

function getSelectionRule(group: PublicMenuOptionGroup) {
  if (group.minSelections === group.maxSelections) {
    return group.minSelections === 1 ? 'Choose 1' : `Choose ${group.minSelections}`
  }

  if (group.minSelections === 0) {
    return `Up to ${group.maxSelections}`
  }

  return `Choose ${group.minSelections}-${group.maxSelections}`
}

function getOptionAdjustmentLabel(option: PublicMenuOption, currencyFormatter: Intl.NumberFormat) {
  if (option.adjustmentType === 2) {
    return `Set ${currencyFormatter.format(option.priceAdjustment)}`
  }

  if (option.priceAdjustment === 0) {
    return 'Included'
  }

  if (option.adjustmentType === 1 || option.priceAdjustment < 0) {
    return currencyFormatter.format(option.priceAdjustment)
  }

  return `+${currencyFormatter.format(option.priceAdjustment)}`
}

function CartActivityBannerView({ banner }: { banner: CartActivityBanner }) {
  const quantityText = banner.quantity > 1 ? ` x ${banner.quantity}` : ''

  return (
    <div className="cart-activity-banner" role="status" aria-live="polite">
      <ShoppingBag className="size-5" />
      <div>
        <strong>{banner.actorName} added {banner.itemName}{quantityText}</strong>
        <span>The shared cart has been updated.</span>
      </div>
    </div>
  )
}

function CategorySidebar({
  categories,
  activeCategoryId,
  onSelect,
}: {
  categories: Array<{ id: string; name: string; count: number }>
  activeCategoryId: string | 'all'
  onSelect: (categoryId: string | 'all') => void
}) {
  const totalItems = categories.reduce((total, category) => total + category.count, 0)

  return (
    <aside className="sticky top-3 h-[calc(100svh-8rem)] overflow-hidden rounded-2xl border bg-card/95 shadow-sm supports-[backdrop-filter]:bg-card/85">
      <div className="flex h-full flex-col">
        <div className="border-b bg-muted/25 px-2 py-2 sm:px-3">
          <div className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-background/70 px-2 sm:justify-between sm:px-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="hidden size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary sm:flex">
                <Utensils className="size-4" />
              </span>
              <div className="min-w-0 text-center sm:text-left">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Menu
                </p>
                <p className="hidden truncate text-[11px] text-muted-foreground sm:block">
                  {categories.length} categories
                </p>
              </div>
            </div>
            <Badge variant="secondary" className="hidden shrink-0 sm:inline-flex">
              {totalItems}
            </Badge>
          </div>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto p-1.5 sm:p-2.5">
          <button
            type="button"
            title="All"
            aria-label="All categories"
            className={cn(
              'group flex min-h-12 w-full items-center justify-start gap-2 rounded-xl px-3 text-sm font-semibold transition-all sm:justify-between',
              activeCategoryId === 'all'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
            )}
            onClick={() => onSelect('all')}
          >
            <span className="truncate">All items</span>
            <Badge
              variant={activeCategoryId === 'all' ? 'secondary' : 'outline'}
              className={cn(
                'hidden shrink-0 sm:inline-flex',
                activeCategoryId !== 'all' && 'bg-background/80',
              )}
            >
              {totalItems}
            </Badge>
          </button>

          <div className="mt-1.5 space-y-1">
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                title={category.name}
                aria-label={category.name}
                className={cn(
                  'group relative flex min-h-12 w-full items-center justify-start gap-2 overflow-hidden rounded-xl px-3 text-sm font-semibold transition-all sm:min-h-11 sm:justify-between',
                  activeCategoryId === category.id
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                )}
                onClick={() => onSelect(category.id)}
              >
                <span
                  className={cn(
                    'absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-primary opacity-0 transition-opacity',
                    activeCategoryId !== category.id && 'group-hover:opacity-70',
                  )}
                />
                <span className="line-clamp-2 min-w-0 text-left text-[13px] leading-tight sm:truncate sm:text-sm">
                  {category.name}
                </span>
                <Badge
                  variant={activeCategoryId === category.id ? 'secondary' : 'outline'}
                  className={cn(
                    'hidden shrink-0 sm:inline-flex',
                    activeCategoryId !== category.id && 'bg-background/80',
                  )}
                >
                  {category.count}
                </Badge>
              </button>
            ))}
          </div>
        </nav>
      </div>
    </aside>
  )
}

function MenuCategorySection({
  category,
  currencyFormatter,
  onOpenItem,
}: {
  category: PublicMenuCategory
  currencyFormatter: Intl.NumberFormat
  onOpenItem: (item: PublicMenuItem) => void
}) {
  return (
    <section id={getCategorySectionId(category.id)} className="scroll-mt-28 space-y-3">
      <div className="flex items-end justify-between gap-3 rounded-2xl border bg-card/70 px-4 py-3 shadow-sm">
        <div className="min-w-0 space-y-1">
        <h2 className="font-heading text-xl font-semibold tracking-tight">{category.name}</h2>
        {category.description ? (
          <p className="text-sm text-muted-foreground">{category.description}</p>
        ) : null}
        </div>
        <Badge variant="secondary" className="shrink-0">
          {category.items.length}
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {category.items.map((item) => {
          const disabled = item.isSoldOut || !item.isAvailable
          const imageUrl = resolvePublicAssetUrl(item.imageUrl)
          const unavailableLabel = getMenuItemUnavailableLabel(item)

          return (
            <Card
              key={item.id}
              role="button"
              tabIndex={0}
              className={cn(
                'overflow-hidden rounded-2xl py-0 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/25 hover:bg-muted/20 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                disabled && 'bg-muted/35 text-muted-foreground hover:translate-y-0 hover:border-border hover:shadow-sm',
              )}
              onClick={() => onOpenItem(item)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onOpenItem(item)
                }
              }}
            >
              <CardContent className="grid gap-3 p-2.5 sm:p-3 lg:grid-cols-[116px_minmax(0,1fr)]">
                <div className="relative aspect-[4/3] overflow-hidden rounded-xl border bg-muted lg:aspect-square">
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt=""
                      className={cn(
                        'size-full object-contain p-1.5',
                        disabled && 'grayscale',
                      )}
                    />
                  ) : (
                    <div className="flex size-full items-center justify-center">
                      <Store className="size-8 text-muted-foreground" />
                    </div>
                  )}
                  {item.isSoldOut ? (
                    <SoldOutImageBadge compact className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)]" />
                  ) : null}
                </div>

                <div className="flex min-w-0 flex-col gap-3 lg:min-h-[116px]">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                      <h3 className="min-w-0 text-base font-semibold leading-snug">
                        <span className="line-clamp-2 break-words">{item.name}</span>
                      </h3>
                      <PriceText
                        value={item.price}
                        currencyFormatter={currencyFormatter}
                        variant="menu"
                        className="max-w-[8rem] sm:max-w-[9rem]"
                      />
                    </div>
                    {item.description ? (
                      <p className="line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground">
                        {item.description}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      variant={disabled ? 'secondary' : 'default'}
                      disabled={disabled}
                      className="h-9 min-w-20 rounded-full px-3 shadow-sm sm:min-w-24"
                      onClick={(event) => {
                        event.stopPropagation()
                        onOpenItem(item)
                      }}
                    >
                      {disabled ? (
                        <MinusCircle className="size-4" />
                      ) : (
                        <Plus className="size-4" />
                      )}
                      {unavailableLabel ?? 'Add'}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </section>
  )
}

function ItemDetailOverlay({
  item,
  quantity,
  note,
  selectedOptionIds,
  currencyFormatter,
  isAdding,
  isEditing,
  onClose,
  onQuantityChange,
  onNoteChange,
  onToggleOption,
  onOptionQuantityChange,
  onAddToCart,
}: {
  item: PublicMenuItem | null
  quantity: number
  note: string
  selectedOptionIds: string[]
  currencyFormatter: Intl.NumberFormat
  isAdding: boolean
  isEditing: boolean
  onClose: () => void
  onQuantityChange: (quantity: number) => void
  onNoteChange: (note: string) => void
  onToggleOption: (group: PublicMenuOptionGroup, option: PublicMenuOption) => void
  onOptionQuantityChange: (group: PublicMenuOptionGroup, option: PublicMenuOption, quantity: number) => void
  onAddToCart: () => Promise<void> | void
}) {
  const isMobile = useIsMobile()

  if (!item) {
    return null
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose()
    }
  }

  const description = item.isSoldOut || !item.isAvailable
    ? 'This item is currently unavailable.'
    : isEditing
      ? 'Update options, quantity, and item notes for this cart item.'
      : item.optionGroups?.length
      ? 'Choose your options, quantity, and any item notes.'
      : 'Choose quantity and add optional item notes.'

  if (isMobile) {
    return (
      <Drawer open onOpenChange={handleOpenChange}>
        <DrawerContent className="max-h-[88svh] overflow-hidden">
          <DrawerHeader className="shrink-0 border-b bg-muted/20 text-left">
            <DrawerTitle className="font-heading text-2xl leading-tight tracking-tight">{item.name}</DrawerTitle>
            <DrawerDescription>{description}</DrawerDescription>
          </DrawerHeader>
          <ItemDetailContent
            item={item}
            quantity={quantity}
            note={note}
            selectedOptionIds={selectedOptionIds}
            currencyFormatter={currencyFormatter}
            isAdding={isAdding}
            isEditing={isEditing}
            onQuantityChange={onQuantityChange}
            onNoteChange={onNoteChange}
            onToggleOption={onToggleOption}
            onOptionQuantityChange={onOptionQuantityChange}
            onAddToCart={onAddToCart}
            className="min-h-0 flex-1"
            bodyClassName="px-4 pb-4"
          />
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[90svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 border-b bg-muted/20 px-5 pt-5 pr-12 pb-4">
          <DialogTitle className="font-heading text-2xl leading-tight tracking-tight">{item.name}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ItemDetailContent
          item={item}
          quantity={quantity}
          note={note}
          selectedOptionIds={selectedOptionIds}
          currencyFormatter={currencyFormatter}
          isAdding={isAdding}
          isEditing={isEditing}
          onQuantityChange={onQuantityChange}
          onNoteChange={onNoteChange}
          onToggleOption={onToggleOption}
          onOptionQuantityChange={onOptionQuantityChange}
          onAddToCart={onAddToCart}
          className="min-h-0 flex-1"
          bodyClassName="px-5 pb-5"
        />
      </DialogContent>
    </Dialog>
  )
}

function ItemDetailContent({
  item,
  quantity,
  note,
  selectedOptionIds,
  currencyFormatter,
  isAdding,
  isEditing,
  onQuantityChange,
  onNoteChange,
  onToggleOption,
  onOptionQuantityChange,
  onAddToCart,
  className,
  bodyClassName,
}: {
  item: PublicMenuItem
  quantity: number
  note: string
  selectedOptionIds: string[]
  currencyFormatter: Intl.NumberFormat
  isAdding: boolean
  isEditing: boolean
  onQuantityChange: (quantity: number) => void
  onNoteChange: (note: string) => void
  onToggleOption: (group: PublicMenuOptionGroup, option: PublicMenuOption) => void
  onOptionQuantityChange: (group: PublicMenuOptionGroup, option: PublicMenuOption, quantity: number) => void
  onAddToCart: () => Promise<void> | void
  className?: string
  bodyClassName?: string
}) {
  const disabled = item.isSoldOut || !item.isAvailable
  const unavailableLabel = getMenuItemUnavailableLabel(item)
  const imageUrl = resolvePublicAssetUrl(item.imageUrl)
  const optionGroups = getAvailableOptionGroups(item)
  const selectedOptions = getOrderedSelectedOptions(item, selectedOptionIds)
  const optionSelectionError = getOptionSelectionError(item, selectedOptionIds)
  const unitPrice = calculateItemUnitPrice(item, selectedOptionIds)
  const lineTotal = unitPrice * quantity

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div className={cn('min-h-0 flex-1 overflow-y-auto', bodyClassName)}>
        <div className="grid gap-5 sm:grid-cols-[240px_minmax(0,1fr)]">
          <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border bg-gradient-to-br from-muted to-background shadow-sm sm:aspect-square">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              className={cn('size-full object-contain p-4', disabled && 'grayscale')}
            />
          ) : (
            <div className="flex size-full items-center justify-center">
              <Store className="size-10 text-muted-foreground" />
            </div>
          )}
          {item.isSoldOut ? (
            <SoldOutImageBadge className="absolute inset-x-4 bottom-4" />
          ) : null}
          {!item.isAvailable && !item.isSoldOut ? (
            <Badge className="absolute bottom-4 left-4 rounded-full border bg-background/90 px-3 py-1 shadow-sm" variant="secondary">
              Unavailable
            </Badge>
          ) : null}
        </div>

        <div className="min-w-0 space-y-4">
          <div className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <PriceText value={item.price} currencyFormatter={currencyFormatter} variant="detail" />
              <MenuAvailabilityPill item={item} />
            </div>
            {item.description ? (
              <p className="text-sm leading-6 text-muted-foreground">{item.description}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No description provided.</p>
            )}
            {selectedOptions.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {selectedOptions.map(({ group, option, quantity: optionQuantity }) => (
                  <Badge key={option.id} variant="secondary" className="h-auto rounded-full px-2 py-1 text-xs">
                    {group.name}: {option.name}
                    {optionQuantity > 1 ? ` x${optionQuantity}` : ''}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>

          {optionGroups.length > 0 ? (
            <div className="space-y-3">
              {optionGroups.map((group) => {
                const selectedInGroup = getSelectedCountInGroup(selectedOptionIds, group)
                const maxReached = selectedInGroup >= group.maxSelections

                return (
                  <div key={group.id} className="overflow-hidden rounded-3xl border bg-card shadow-sm">
                    <div className="border-b bg-muted/20 px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-heading font-semibold leading-tight">{group.name}</p>
                          <p className="text-xs text-muted-foreground">{getSelectionRule(group)}</p>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className="rounded-full bg-background/80 text-xs">
                            {selectedInGroup}/{group.maxSelections} selected
                          </Badge>
                          <Badge
                            variant="outline"
                            className={cn(
                              'rounded-full text-xs',
                              group.isRequired
                                ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100'
                                : 'bg-background/80 text-muted-foreground',
                            )}
                          >
                            {group.isRequired ? 'Required' : 'Optional'}
                          </Badge>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-2.5 p-3">
                      {group.options.map((option) => {
                        const selectedQuantity = getOptionQuantity(selectedOptionIds, option.id)
                        const selected = selectedQuantity > 0
                        const optionDisabled = disabled || isAdding || (!selected && maxReached)
                        const canDecrease = selected && !disabled && !isAdding
                        const canIncrease = !disabled &&
                          !isAdding &&
                          selected &&
                          selectedQuantity < option.maxQuantity &&
                          selectedInGroup < group.maxSelections

                        return (
                          <div
                            key={option.id}
                            className={cn(
                              'relative grid min-h-16 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 overflow-hidden rounded-2xl border bg-background p-3 text-left shadow-sm transition-all',
                              !selected && !optionDisabled && 'hover:border-primary/30 hover:bg-muted/20 hover:shadow',
                              selected && 'border-primary/60 bg-primary/[0.07] shadow-md shadow-primary/10 ring-1 ring-primary/10',
                              optionDisabled && 'cursor-not-allowed opacity-55',
                            )}
                          >
                            {selected ? <span className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-primary" /> : null}
                            <button
                              type="button"
                              className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] items-center gap-3 text-left"
                              disabled={optionDisabled}
                              aria-pressed={selected}
                              onClick={() => onToggleOption(group, option)}
                            >
                              <span className={cn(
                                'flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors',
                                selected
                                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                                  : 'border-muted-foreground/25 bg-muted/40 text-muted-foreground',
                              )}>
                                {selected ? <Check className="size-4" /> : <Plus className="size-4" />}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold text-foreground">{option.name}</span>
                                {option.maxQuantity > 1 ? (
                                  <span className="mt-0.5 block text-xs text-muted-foreground">
                                    Max {option.maxQuantity}
                                    {selectedQuantity > 1 ? ` - selected ${selectedQuantity}` : ''}
                                  </span>
                                ) : null}
                              </span>
                            </button>
                            <span className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
                              {selected && option.maxQuantity > 1 ? (
                                <span className="flex items-center gap-1 rounded-full border bg-background/80 p-0.5 shadow-sm">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-7"
                                    disabled={!canDecrease}
                                    aria-label={`Decrease ${option.name}`}
                                    onClick={() => onOptionQuantityChange(group, option, selectedQuantity - 1)}
                                  >
                                    <Minus className="size-3.5" />
                                  </Button>
                                  <span className="min-w-5 text-center text-xs font-semibold text-foreground">
                                    {selectedQuantity}
                                  </span>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-7"
                                    disabled={!canIncrease}
                                    aria-label={`Increase ${option.name}`}
                                    onClick={() => onOptionQuantityChange(group, option, selectedQuantity + 1)}
                                  >
                                    <Plus className="size-3.5" />
                                  </Button>
                                </span>
                              ) : null}
                              <span
                                className={cn(
                                  'rounded-full px-2.5 py-1 text-xs font-semibold leading-none',
                                  option.priceAdjustment === 0
                                    ? 'bg-muted text-muted-foreground'
                                    : 'bg-amber-50 text-amber-900 ring-1 ring-amber-200/80 dark:bg-amber-400/10 dark:text-amber-100 dark:ring-amber-400/25',
                                  option.adjustmentType === 2 && 'bg-primary/10 text-primary ring-1 ring-primary/20',
                                )}
                              >
                                {getOptionAdjustmentLabel(option, currencyFormatter)}
                              </span>
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
              {optionSelectionError ? (
                <p className="flex items-center gap-1.5 rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertCircle className="size-4" />
                  {optionSelectionError}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="rounded-2xl border bg-card p-3.5 shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">Quantity</p>
              <span className="text-xs text-muted-foreground">Choose how many</span>
            </div>
            <div className="flex w-fit items-center gap-2 rounded-full border bg-muted/20 p-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Decrease quantity"
                className="size-9"
                disabled={quantity <= 1 || isAdding}
                onClick={() => onQuantityChange(Math.max(1, quantity - 1))}
              >
                <Minus className="size-4" />
              </Button>
              <span className="w-10 text-center text-base font-semibold">{quantity}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Increase quantity"
                className="size-9"
                disabled={isAdding}
                onClick={() => onQuantityChange(quantity + 1)}
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-2 rounded-2xl border bg-card p-3.5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm font-medium" htmlFor="customer-item-note">
                Item note
              </label>
              <span className="text-xs text-muted-foreground">
                {note.length}/{itemNoteMaxLength}
              </span>
            </div>
            <Textarea
              id="customer-item-note"
              value={note}
              maxLength={itemNoteMaxLength}
              rows={3}
              placeholder="Less spicy, no onion, sauce on the side..."
              disabled={isAdding || disabled}
              onChange={(event) => onNoteChange(event.target.value)}
            />
            <QuickNotePresetGroups
              groups={itemNotePresetGroups}
              note={note}
              maxLength={itemNoteMaxLength}
              disabled={isAdding || disabled}
              onNoteChange={onNoteChange}
            />
          </div>
        </div>
      </div>
      </div>

      <div className="shrink-0 border-t bg-background/95 px-4 py-3 shadow-[0_-12px_30px_rgba(0,0,0,0.06)] backdrop-blur sm:px-5">
        <Button
          type="button"
          className="h-12 w-full rounded-xl text-base shadow-sm"
          disabled={disabled || isAdding || Boolean(optionSelectionError)}
          onClick={() => void onAddToCart()}
        >
          {isAdding ? (
            <Loader2 className="size-4 animate-spin" />
          ) : disabled ? (
            <MinusCircle className="size-4" />
          ) : isEditing ? (
            <Check className="size-4" />
          ) : (
            <ShoppingBag className="size-4" />
          )}
          {unavailableLabel ?? `${isEditing ? 'Save changes' : 'Add'} ${currencyFormatter.format(lineTotal)}`}
        </Button>
      </div>
    </div>
  )
}

function QuickNotePresetGroups({
  groups,
  note,
  maxLength,
  disabled,
  onNoteChange,
}: {
  groups: NotePresetGroup[]
  note: string
  maxLength: number
  disabled: boolean
  onNoteChange: (note: string) => void
}) {
  const noteIsFull = note.trim().length >= maxLength

  return (
    <div className="space-y-3 rounded-2xl border bg-muted/25 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-muted-foreground">Quick notes</p>
        <p className="text-[11px] text-muted-foreground">Tap to append</p>
      </div>
      {groups.map((group) => (
        <div key={group.label} className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {group.label}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {group.items.map((preset) => {
              const applied = isNotePresetApplied(note, preset)

              return (
                <Button
                  key={preset}
                  type="button"
                  variant={applied ? 'secondary' : 'outline'}
                  size="sm"
                  aria-pressed={applied}
                  className={cn(
                    'h-auto min-h-8 rounded-full px-3 py-1 text-xs',
                    applied ? 'border-primary/20 bg-primary/10 text-primary' : '',
                  )}
                  disabled={disabled || noteIsFull}
                  onClick={() => onNoteChange(appendNotePreset(note, preset, maxLength))}
                >
                  {applied ? <Check className="size-3" /> : <Plus className="size-3" />}
                  {preset}
                </Button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function CartSummaryBar({
  cart,
  currencyFormatter,
  menuItemsById,
  open,
  updatingItemId,
  isClearingCart,
  isSavingNote,
  isCheckingOut,
  onOpenChange,
  onQuantityChange,
  onOptionQuantityChange,
  onModifyItem,
  onRemoveItem,
  onClearCart,
  onOrderNoteSave,
  onCheckout,
}: {
  cart: Cart
  currencyFormatter: Intl.NumberFormat
  menuItemsById: Map<string, PublicMenuItem>
  open: boolean
  updatingItemId: string | null
  isClearingCart: boolean
  isSavingNote: boolean
  isCheckingOut: boolean
  onOpenChange: (open: boolean) => void
  onQuantityChange: (item: CartItem, nextQuantity: number) => Promise<void> | void
  onOptionQuantityChange: (
    item: CartItem,
    group: PublicMenuOptionGroup,
    option: PublicMenuOption,
    nextQuantity: number,
  ) => Promise<void> | void
  onModifyItem: (item: CartItem) => void
  onRemoveItem: (item: CartItem) => Promise<void> | void
  onClearCart: () => Promise<void> | void
  onOrderNoteSave: (note: string) => Promise<void> | void
  onCheckout: () => void
}) {
  const hasItems = cart.items.length > 0
  const isReadOnly = cart.status !== 'Active'
  const [orderNoteHasUnsavedChanges, setOrderNoteHasUnsavedChanges] = useState(false)
  const [unsavedNoteDialogOpen, setUnsavedNoteDialogOpen] = useState(false)

  const requestCheckout = () => {
    if (orderNoteHasUnsavedChanges) {
      setUnsavedNoteDialogOpen(true)
      return
    }

    onCheckout()
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/85 p-3 shadow-[0_-18px_45px_rgba(0,0,0,0.08)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl flex-col gap-3">
        {open ? (
          <Card className="overflow-hidden rounded-3xl border shadow-2xl shadow-black/10">
            <CardContent className="p-0">
              <div className="flex items-start justify-between gap-3 border-b bg-muted/20 p-4">
                <div className="min-w-0 flex-1">
                  <div className="min-w-0 space-y-1">
                    <h2 className="font-heading flex items-center gap-2 text-xl font-semibold tracking-tight">
                      <span className="flex size-9 items-center justify-center rounded-full border bg-muted text-foreground">
                        <ShoppingBag className="size-5" />
                      </span>
                      Cart
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {hasItems
                        ? `${cart.itemCount} item${cart.itemCount === 1 ? '' : 's'} in this order`
                        : 'Your cart is empty.'}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {hasItems && !isReadOnly ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          disabled={isClearingCart || isCheckingOut}
                        >
                          {isClearingCart ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Trash2 className="size-4" />
                          )}
                          Clear
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent size="sm">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Clear cart?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This removes every item from this cart. You can add dishes again before checkout.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel disabled={isClearingCart}>
                            Keep cart
                          </AlertDialogCancel>
                          <AlertDialogAction
                            variant="destructive"
                            disabled={isClearingCart}
                            onClick={() => void onClearCart()}
                          >
                            Clear cart
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : null}

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Collapse cart"
                    className="size-9 shrink-0"
                    onClick={() => onOpenChange(false)}
                  >
                    <ChevronDown className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="max-h-[52svh] overflow-y-auto bg-background/80 p-4">
                {hasItems ? (
                  <div className="space-y-3">
                    {cart.items.map((item) => (
                      <CartSummaryLine
                        key={item.id}
                        item={item}
                        menuItem={menuItemsById.get(item.menuItemId) ?? null}
                        currencyFormatter={currencyFormatter}
                        isReadOnly={isReadOnly}
                        isUpdating={updatingItemId === item.id}
                        onQuantityChange={onQuantityChange}
                        onOptionQuantityChange={onOptionQuantityChange}
                        onModifyItem={onModifyItem}
                        onRemoveItem={onRemoveItem}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/30 p-6 text-center">
                    <ShoppingBag className="size-8 text-muted-foreground" />
                    <div>
                      <p className="font-semibold">No items yet</p>
                      <p className="text-sm text-muted-foreground">
                        Add dishes from the menu to start this order.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-3 border-t bg-card p-4">
                <CartOrderNoteEditor
                  note={cart.customerNote ?? ''}
                  isReadOnly={isReadOnly}
                  isSaving={isSavingNote}
                  onSave={onOrderNoteSave}
                  onDirtyChange={setOrderNoteHasUnsavedChanges}
                />

                <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted/35 px-4 py-3">
                  <span className="text-sm font-semibold text-muted-foreground">Total</span>
                  <PriceText value={cart.total} currencyFormatter={currencyFormatter} variant="total" />
                </div>

                {isReadOnly ? (
                  <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                    This cart is no longer editable.
                  </p>
                ) : null}

                <Button
                  type="button"
                  className="h-12 w-full rounded-xl text-base shadow-sm"
                  disabled={!hasItems || isReadOnly || isCheckingOut || isClearingCart || isSavingNote}
                  onClick={requestCheckout}
                >
                  {isCheckingOut ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ArrowRight className="size-4" />
                  )}
                  {isCheckingOut ? 'Starting checkout…' : 'Go to checkout'}
                </Button>

                <AlertDialog open={unsavedNoteDialogOpen} onOpenChange={setUnsavedNoteDialogOpen}>
                  <AlertDialogContent size="sm">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Continue without saving note?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Your order note has unsaved changes. Save it first if the kitchen should see it.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="flex flex-col-reverse gap-2 sm:flex-col-reverse sm:justify-stretch group-data-[size=sm]/alert-dialog-content:flex group-data-[size=sm]/alert-dialog-content:flex-col-reverse">
                      <AlertDialogCancel className="h-auto min-h-10 w-full whitespace-normal text-center leading-snug">
                        Go back and save
                      </AlertDialogCancel>
                      <AlertDialogAction className="h-auto min-h-10 w-full whitespace-normal text-center leading-snug" onClick={onCheckout}>
                        Checkout anyway
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Button
          type="button"
          variant="secondary"
          className="min-h-14 flex-1 justify-between rounded-2xl border border-border bg-card px-5 py-3 text-base text-foreground shadow-lg shadow-black/10 hover:bg-muted"
          onClick={() => onOpenChange(!open)}
        >
          <span className="flex items-center gap-3">
            <span className="flex size-8 items-center justify-center rounded-md border bg-muted text-foreground">
              <ShoppingBag className="size-5" />
            </span>
            <span className="font-heading text-lg font-semibold">Cart</span>
            {open ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </span>
          <span className="flex items-center gap-4">
            <Badge variant="secondary" className="h-7 min-w-7 justify-center rounded-full border bg-muted px-2 text-foreground">
              {cart.itemCount}
            </Badge>
            <PriceText value={cart.total} currencyFormatter={currencyFormatter} variant="bar" className="text-foreground" />
          </span>
        </Button>
      </div>
    </div>
  )
}

function CartOrderNoteEditor({
  note,
  isReadOnly,
  isSaving,
  onSave,
  onDirtyChange,
}: {
  note: string
  isReadOnly: boolean
  isSaving: boolean
  onSave: (note: string) => Promise<void> | void
  onDirtyChange?: (hasUnsavedChanges: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [draftState, setDraftState] = useState(() => ({
    sourceNote: note,
    draft: note,
    saveError: null as string | null,
  }))
  const draft = draftState.sourceNote === note ? draftState.draft : note
  const saveError = draftState.sourceNote === note ? draftState.saveError : null
  const normalizedNote = note.trim()
  const normalizedDraft = draft.trim()
  const hasChanges = normalizedDraft !== normalizedNote

  useEffect(() => {
    onDirtyChange?.(open && hasChanges)
  }, [hasChanges, onDirtyChange, open])

  const updateDraft = (nextDraft: string) => {
    setDraftState({
      sourceNote: note,
      draft: nextDraft,
      saveError: null,
    })
  }

  const updateSaveError = (nextSaveError: string | null) => {
    setDraftState((current) => ({
      sourceNote: note,
      draft: current.sourceNote === note ? current.draft : note,
      saveError: nextSaveError,
    }))
  }

  const handleCancel = () => {
    updateDraft(note)
    setOpen(false)
  }

  const handleSave = async () => {
    updateSaveError(null)

    try {
      await onSave(draft)
      setOpen(false)
    } catch (error) {
      updateSaveError(error instanceof Error ? error.message : 'Could not save order note')
    }
  }

  if (isReadOnly && !normalizedNote) {
    return null
  }

  return (
    <div className="rounded-lg border bg-muted/25 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <ClipboardList className="size-4" />
            Order note
          </p>
          <p className="text-xs text-muted-foreground">
            Add instructions for the whole order, like cutlery, allergies, or delivery timing.
          </p>
        </div>

        {!open && !isReadOnly ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => {
              updateSaveError(null)
              setOpen(true)
            }}
          >
            <Plus className="size-4" />
            {normalizedNote ? 'Edit note' : 'Add note'}
          </Button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-3 space-y-2">
          <Textarea
            value={draft}
            maxLength={orderNoteMaxLength}
            rows={3}
            placeholder="Please bring extra cutlery, keep all spicy dishes mild, allergy notes..."
            disabled={isReadOnly || isSaving}
            onChange={(event) => {
              updateDraft(event.target.value)
            }}
          />
          <QuickNotePresetGroups
            groups={orderNotePresetGroups}
            note={draft}
            maxLength={orderNoteMaxLength}
            disabled={isReadOnly || isSaving}
            onNoteChange={(nextNote) => {
              updateDraft(nextNote)
            }}
          />
          {hasChanges ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>This order note is not saved yet.</span>
            </div>
          ) : null}
          {saveError ? (
            <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{saveError}</span>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {draft.length}/{orderNoteMaxLength}
            </span>
            {!isReadOnly ? (
              <span className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isSaving}
                  onClick={handleCancel}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="min-w-28"
                  disabled={isSaving || !hasChanges}
                  onClick={() => void handleSave()}
                >
                  {isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
                  Save note
                </Button>
              </span>
            ) : null}
          </div>
        </div>
      ) : normalizedNote ? (
        <p className="mt-3 rounded-md bg-background/80 px-3 py-2 text-sm text-muted-foreground">
          {normalizedNote}
        </p>
      ) : null}
    </div>
  )
}

function CartViewerPill({ viewer }: { viewer: CartViewer }) {
  if (!viewer) {
    return (
      <div className="inline-flex items-center rounded-full border bg-muted/35 px-3 py-1.5 text-sm font-semibold">
        Guest
      </div>
    )
  }

  const displayName = viewer?.fullName?.trim() || viewer?.email?.trim() || 'User'
  const secondaryText = viewer.email && viewer.email !== displayName ? viewer.email : 'Signed in'

  return (
    <div className="flex min-w-0 max-w-full items-center gap-2 rounded-full border bg-muted/35 px-2.5 py-1.5 text-left sm:max-w-72">
      <Avatar className="size-10 overflow-hidden">
        {viewer.avatarUrl ? (
          <AvatarImage src={viewer.avatarUrl} alt={`${displayName} avatar`} />
        ) : null}
        <AvatarFallback className="absolute inset-0 grid size-auto place-items-center p-0 text-center leading-none">
          {getInitials(displayName)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold leading-tight">
          {displayName}
        </p>
        <p className="truncate text-xs text-muted-foreground">{secondaryText}</p>
      </div>
    </div>
  )
}

function CartViewerButton({ viewer, onLogout }: { viewer: CartViewer; onLogout: () => void }) {
  const displayName = viewer?.fullName?.trim() || viewer?.email?.trim() || 'Guest'
  const canUseAdminArea = Boolean(viewer?.roles.some((role) =>
    ['PlatformOwner', 'RestaurantOwner', 'Admin', 'Staff'].includes(role),
  ))

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-12 shrink-0 rounded-full p-1"
          aria-label={`Ordering as ${displayName}`}
        >
          <Avatar className="size-9">
            {viewer?.avatarUrl ? (
              <AvatarImage src={viewer.avatarUrl} alt={`${displayName} avatar`} />
            ) : null}
            <AvatarFallback className="absolute inset-0 grid size-auto place-items-center p-0 text-center leading-none">
              {getInitials(displayName)}
            </AvatarFallback>
          </Avatar>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-2 p-3">
        <CartViewerPill viewer={viewer} />
        <Separator />
        {viewer ? (
          <div className="grid gap-1">
            <Button variant="ghost" className="justify-start" asChild>
              <Link to="/me"><UserRound />User Center</Link>
            </Button>
            <Button variant="ghost" className="justify-start" asChild>
              <Link to={canUseAdminArea ? '/admin/orders' : '/my-orders'}>
                <ClipboardList />My Orders
              </Link>
            </Button>
            {canUseAdminArea && (
              <Button variant="ghost" className="justify-start" asChild>
                <Link to="/admin"><LayoutDashboard />Admin Dashboard</Link>
              </Button>
            )}
            <Separator />
            <Button type="button" variant="ghost" className="justify-start text-destructive" onClick={onLogout}>
              <LogOut />Sign out
            </Button>
          </div>
        ) : (
          <div className="grid gap-1">
            <Button variant="ghost" className="justify-start" asChild>
              <Link to="/login"><LogIn />Sign in</Link>
            </Button>
            <Button variant="ghost" className="justify-start" asChild>
              <Link to="/register"><UserPlus />Create account</Link>
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function CartSummaryLine({
  item,
  menuItem,
  currencyFormatter,
  isReadOnly,
  isUpdating,
  onQuantityChange,
  onOptionQuantityChange,
  onModifyItem,
  onRemoveItem,
}: {
  item: CartItem
  menuItem: PublicMenuItem | null
  currencyFormatter: Intl.NumberFormat
  isReadOnly: boolean
  isUpdating: boolean
  onQuantityChange: (item: CartItem, nextQuantity: number) => Promise<void> | void
  onOptionQuantityChange: (
    item: CartItem,
    group: PublicMenuOptionGroup,
    option: PublicMenuOption,
    nextQuantity: number,
  ) => Promise<void> | void
  onModifyItem: (item: CartItem) => void
  onRemoveItem: (item: CartItem) => Promise<void> | void
}) {
  const itemUnavailable = !item.isAvailable || item.isSoldOut
  const unavailableLabel = getMenuItemUnavailableLabel(item)
  const imageUrl = resolvePublicAssetUrl(item.imageUrl)
  const basePrice = getCartItemBasePrice(item)

  return (
    <div className="rounded-2xl border bg-card p-3 shadow-sm">
      <div className="grid min-w-0 grid-cols-[56px_minmax(0,1fr)_auto] gap-3">
        <div className="relative size-14 overflow-hidden rounded-xl border bg-muted">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              className={cn('size-full object-contain p-1.5', itemUnavailable && 'grayscale')}
            />
          ) : (
            <div className="flex size-full items-center justify-center">
              <Store className="size-5 text-muted-foreground" />
            </div>
          )}
        </div>
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="min-w-0 font-semibold leading-tight">
              <span className="line-clamp-2 break-words">{item.name}</span>
            </p>
            {unavailableLabel ? (
              <Badge
                variant="outline"
                className={cn(
                  'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                  item.isSoldOut
                    ? 'border-amber-200 bg-amber-50 text-amber-900 shadow-sm shadow-amber-900/5 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100'
                    : 'border-muted-foreground/20 bg-muted/70 text-muted-foreground',
                )}
              >
                {unavailableLabel}
              </Badge>
            ) : null}
          </div>
          <p className="text-sm font-medium text-muted-foreground">
            {item.quantity} x {currencyFormatter.format(basePrice)}
          </p>
          {item.selectedOptions.length > 0 ? (
            <div className="mt-2 rounded-2xl border border-border/70 bg-muted/20 px-2.5 py-2">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Selected options
              </p>
              <div className="grid gap-1.5">
                {item.selectedOptions.map((cartOption) => {
                  const optionDefinition = findPublicMenuOption(menuItem, cartOption.menuItemOptionId)
                  const selectedOptionIds = getCartItemSelectedOptionIds(item)
                  const selectedInGroup = optionDefinition
                    ? getSelectedCountInGroup(selectedOptionIds, optionDefinition.group)
                    : 0
                  const optionQuantity = cartOption.quantity ?? 1
                  const canRemoveOption = Boolean(
                    optionDefinition &&
                    !isReadOnly &&
                    !isUpdating &&
                    selectedInGroup - optionQuantity >= optionDefinition.group.minSelections,
                  )
                  const canAdjustQuantity = Boolean(
                    optionDefinition &&
                    optionDefinition.option.maxQuantity > 1 &&
                    !isReadOnly &&
                    !isUpdating,
                  )
                  const canDecreaseOption = canAdjustQuantity && (optionQuantity > 1 || canRemoveOption)
                  const canIncreaseOption = Boolean(
                    optionDefinition &&
                    canAdjustQuantity &&
                    optionQuantity < optionDefinition.option.maxQuantity &&
                    selectedInGroup < optionDefinition.group.maxSelections,
                  )

                  return (
                    <div
                      key={`${cartOption.menuItemOptionId ?? `${cartOption.groupNameSnapshot}:${cartOption.optionNameSnapshot}`}x${optionQuantity}`}
                      className="rounded-2xl border bg-background px-2.5 py-2 text-xs shadow-sm"
                    >
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="min-w-0 truncate font-semibold text-foreground">
                          {cartOption.optionNameSnapshot}
                        </span>
                        {canAdjustQuantity ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border bg-muted/30 p-0.5">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-6"
                              disabled={!canDecreaseOption}
                              aria-label={`Decrease ${cartOption.optionNameSnapshot}`}
                              onClick={() => optionDefinition && onOptionQuantityChange(
                                item,
                                optionDefinition.group,
                                optionDefinition.option,
                                optionQuantity - 1,
                              )}
                            >
                              <Minus className="size-3" />
                            </Button>
                            <span className="min-w-5 text-center text-xs font-semibold text-foreground">
                              {optionQuantity}
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-6"
                              disabled={!canIncreaseOption}
                              aria-label={`Increase ${cartOption.optionNameSnapshot}`}
                              onClick={() => optionDefinition && onOptionQuantityChange(
                                item,
                                optionDefinition.group,
                                optionDefinition.option,
                                optionQuantity + 1,
                              )}
                            >
                              <Plus className="size-3" />
                            </Button>
                          </span>
                        ) : optionQuantity > 1 ? (
                          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-foreground">
                            x{optionQuantity}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                            cartOption.priceAdjustmentSnapshot === 0
                              ? 'bg-muted text-muted-foreground'
                              : 'bg-amber-50 text-amber-900 ring-1 ring-amber-200/80 dark:bg-amber-400/10 dark:text-amber-100 dark:ring-amber-400/25',
                          )}
                        >
                          {formatCartOptionPriceAdjustment(cartOption, currencyFormatter)}
                        </span>
                        {canRemoveOption && optionDefinition ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 rounded-full px-2 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                            disabled={isUpdating}
                            onClick={() => onOptionQuantityChange(
                              item,
                              optionDefinition.group,
                              optionDefinition.option,
                              0,
                            )}
                          >
                            Remove option
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}
          {item.note ? (
            <p className="line-clamp-2 rounded-md bg-muted/50 px-2 py-1 text-sm text-muted-foreground">
              {item.note}
            </p>
          ) : null}
        </div>

        <PriceText value={item.lineTotal} currencyFormatter={currencyFormatter} variant="cart" />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-full border bg-muted/20 p-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Decrease ${item.name} quantity`}
            className="size-8"
            disabled={isReadOnly || isUpdating || item.quantity <= 1}
            onClick={() => void onQuantityChange(item, item.quantity - 1)}
          >
            <Minus className="size-4" />
          </Button>
          <span className="w-8 text-center text-sm font-semibold">{item.quantity}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Increase ${item.name} quantity`}
            className="size-8"
            disabled={isReadOnly || isUpdating}
            onClick={() => void onQuantityChange(item, item.quantity + 1)}
          >
            {isUpdating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 rounded-full"
            disabled={isReadOnly || isUpdating || !menuItem}
            onClick={() => onModifyItem(item)}
          >
            <Pencil className="size-4" />
            Modify
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={isReadOnly || isUpdating}
            onClick={() => void onRemoveItem(item)}
          >
            {isUpdating ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            Remove
          </Button>
        </div>
      </div>
    </div>
  )
}

function PublicOrderTypeChooser({
  context,
  loading,
  onSelect,
}: {
  context: PublicOrderingContext
  loading: boolean
  onSelect: (orderType: 'DineIn' | 'Takeaway') => void
}) {
  const orderingUnavailable = !context.restaurant.isOrderingAvailable

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-lg space-y-6">
        <div className="space-y-2 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Public ordering</p>
          <h1 className="text-3xl font-semibold">{context.restaurant.name}</h1>
          <p className="text-sm text-muted-foreground">
            {orderingUnavailable ? 'Ordering is currently unavailable.' : 'How would you like to order today?'}
          </p>
        </div>

        {orderingUnavailable ? (
          <Card className="rounded-lg border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-50">
            <CardContent className="flex gap-3 p-4">
              <AlertCircle className="mt-0.5 size-5 shrink-0" />
              <div>
                <p className="font-semibold">
                  {context.restaurant.orderingUnavailableReason === 'Paused' ? 'Ordering paused' : 'Closed for ordering'}
                </p>
                <p className="mt-1 text-sm opacity-80">{context.restaurant.orderingStatusMessage}</p>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          {context.availableOrderTypes.includes('DineIn') ? (
            <Card><CardContent className="p-3">
              <Button type="button" variant="ghost" className="h-auto w-full flex-col items-start gap-3 whitespace-normal p-4 text-left" disabled={loading || orderingUnavailable} onClick={() => onSelect('DineIn')}>
                <span className="flex size-10 items-center justify-center rounded-full bg-muted"><Utensils className="size-5" /></span>
                <span>
                  <strong className="block text-base">Dine in</strong>
                  <span className="mt-1 block text-sm font-normal text-muted-foreground">Order for dining at the restaurant. No table QR required.</span>
                </span>
              </Button>
            </CardContent></Card>
          ) : null}

          {context.availableOrderTypes.includes('Takeaway') ? (
            <Card><CardContent className="p-3">
              <Button type="button" variant="ghost" className="h-auto w-full flex-col items-start gap-3 whitespace-normal p-4 text-left" disabled={loading || orderingUnavailable} onClick={() => onSelect('Takeaway')}>
                <span className="flex size-10 items-center justify-center rounded-full bg-muted"><ShoppingBag className="size-5" /></span>
                <span>
                  <strong className="block text-base">Takeaway</strong>
                  <span className="mt-1 block text-sm font-normal text-muted-foreground">Order ahead and collect your meal from the restaurant.</span>
                </span>
              </Button>
            </CardContent></Card>
          ) : null}
        </div>

        {loading ? <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Starting your order...</div> : null}
      </div>
    </main>
  )
}

function CustomerMenuLoading() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <Loader2 className="size-8 animate-spin" />
        <div>
          <h1 className="text-xl font-semibold">Loading menu</h1>
          <p className="text-sm text-muted-foreground">Preparing the ordering experience.</p>
        </div>
      </div>
    </main>
  )
}

function CustomerMenuError({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md rounded-lg">
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-1 size-5 shrink-0 text-destructive" />
            <div className="space-y-1">
              <h1 className="text-xl font-semibold">{title}</h1>
              <p className="text-sm text-muted-foreground">{message}</p>
            </div>
          </div>
          {onRetry ? (
            <Button variant="outline" className="w-full" onClick={onRetry}>
              <RefreshCw className="size-4" />
              Try again
            </Button>
          ) : null}
          <Button asChild className="w-full">
            <Link to="/login">Go to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}

function EmptyMenuState() {
  return (
    <Card className="rounded-lg">
      <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
        <Store className="size-8 text-muted-foreground" />
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Menu is empty</h2>
          <p className="text-sm text-muted-foreground">
            This restaurant has not published menu items yet.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function NoResultsState({ onReset }: { onReset: () => void }) {
  return (
    <Card className="rounded-lg">
      <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
        <Search className="size-8 text-muted-foreground" />
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">No items found</h2>
          <p className="text-sm text-muted-foreground">
            Try another category or search term.
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={onReset}>
          Clear filters
        </Button>
      </CardContent>
    </Card>
  )
}

type MenuAvailabilityState = {
  isAvailable: boolean
  isSoldOut: boolean
}

function getMenuItemUnavailableLabel(item: MenuAvailabilityState) {
  if (item.isSoldOut) {
    return 'Sold out'
  }

  if (!item.isAvailable) {
    return 'Unavailable'
  }

  return null
}

function SoldOutImageBadge({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div
      className={cn(
        'pointer-events-none flex items-center justify-center gap-1.5 rounded-full border border-amber-200/80 bg-amber-50/95 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-amber-950 shadow-lg shadow-amber-950/10 backdrop-blur',
        'dark:border-amber-400/30 dark:bg-amber-400/15 dark:text-amber-100',
        compact && 'w-fit px-2.5 py-1 text-[10px] leading-none tracking-[0.14em] shadow-md',
        className,
      )}
    >
      <span className={cn('rounded-full bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.18)]', compact ? 'size-1' : 'size-1.5')} />
      Sold out
    </div>
  )
}

function MenuAvailabilityPill({ item }: { item: MenuAvailabilityState }) {
  const unavailableLabel = getMenuItemUnavailableLabel(item)

  if (!unavailableLabel) {
    return (
      <Badge
        variant="outline"
        className="rounded-full border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-100"
      >
        Available
      </Badge>
    )
  }

  if (item.isSoldOut) {
    return (
      <Badge
        variant="outline"
        className="rounded-full border-amber-200 bg-amber-50 px-3 py-1 font-semibold text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100"
      >
        <MinusCircle className="size-3.5" />
        {unavailableLabel}
      </Badge>
    )
  }

  return (
    <Badge variant="secondary" className="rounded-full px-3 py-1">
      {unavailableLabel}
    </Badge>
  )
}

function getCartItemBasePrice(item: CartItem) {
  if (Number.isFinite(item.basePrice)) {
    return item.basePrice
  }

  const optionAdjustmentTotal = item.selectedOptions.reduce((total, option) => {
    return total + option.priceAdjustmentSnapshot * (option.quantity ?? 1)
  }, 0)

  return Math.max(0, item.unitPrice - optionAdjustmentTotal)
}

function formatCartOptionPriceAdjustment(
  option: CartItem['selectedOptions'][number],
  currencyFormatter: Intl.NumberFormat,
) {
  const amount = option.priceAdjustmentSnapshot * (option.quantity ?? 1)

  if (amount === 0) {
    return 'Included'
  }

  return amount > 0
    ? `+${currencyFormatter.format(amount)}`
    : currencyFormatter.format(amount)
}

type PriceTextVariant = 'menu' | 'cart' | 'detail' | 'total' | 'bar'

function PriceText({
  value,
  currencyFormatter,
  variant = 'menu',
  className,
}: {
  value: number
  currencyFormatter: Intl.NumberFormat
  variant?: PriceTextVariant
  className?: string
}) {
  const parts = currencyFormatter.formatToParts(value)

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-baseline justify-end whitespace-nowrap tabular-nums text-amber-950 dark:text-amber-100',
        variant === 'menu' &&
          'rounded-full bg-amber-50 px-2.5 py-1 text-sm font-semibold leading-none shadow-sm ring-1 ring-amber-200/80 dark:bg-amber-400/10 dark:ring-amber-400/25',
        variant === 'cart' &&
          'self-start justify-self-end rounded-full bg-amber-50 px-3 py-1.5 text-sm font-semibold leading-none shadow-sm ring-1 ring-amber-200/80 dark:bg-amber-400/10 dark:ring-amber-400/25',
        variant === 'detail' &&
          'font-heading text-3xl font-semibold leading-none tracking-tight text-foreground',
        variant === 'total' &&
          'font-heading text-3xl font-semibold leading-none tracking-tight text-foreground',
        variant === 'bar' &&
          'text-base font-semibold leading-none text-foreground',
        className,
      )}
    >
      {parts.map((part, index) => (
        <span
          key={`${part.type}-${index}`}
          className={cn(
            part.type === 'currency' &&
              cn(
                'mr-0.5 text-[0.7em] font-semibold',
                variant === 'bar' ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-200/80',
              ),
            part.type === 'decimal' &&
              cn('mx-px text-[0.85em]', variant === 'bar' ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-200/80'),
            part.type === 'fraction' && 'text-[0.82em]',
          )}
        >
          {part.value}
        </span>
      ))}
    </span>
  )
}

function createCurrencyFormatter(currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency || 'AUD',
  })
}

function resolveRestaurantHeroImageUrl(imageUrl: string | null) {
  const resolvedImageUrl = resolvePublicAssetUrl(imageUrl)

  if (!resolvedImageUrl || /\/seed-menu\/[^/?]+\.svg(?:$|\?)/i.test(resolvedImageUrl)) {
    return defaultRestaurantHeroImageUrl
  }

  return resolvedImageUrl
}

function getInitials(value?: string | null) {
  const source = value?.trim() || 'U'
  const words = source.split(/\s+/).filter(Boolean)

  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase()
  }

  return source.slice(0, 2).toUpperCase()
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }

    return window.matchMedia('(max-width: 767px)').matches
  })

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    const query = window.matchMedia('(max-width: 767px)')
    const update = () => setIsMobile(query.matches)

    update()
    query.addEventListener('change', update)

    return () => query.removeEventListener('change', update)
  }, [])

  return isMobile
}

function getCategorySectionId(categoryId: string) {
  return `menu-category-${categoryId}`
}
