import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { NoteHealthInfoNotice } from '@/components/ordering/NoteHealthInfoNotice'
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  Check,
  ClipboardList,
  ChevronDown,
  ChevronUp,
  Clock3,
  Flame,
  LayoutDashboard,
  Leaf,
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
  ShieldAlert,
  ShoppingBag,
  Sparkles,
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
  cartFromConflict,
  checkoutCart,
  isTimeout,
  clearCartItems,
  deleteCartItem,
  getCart,
  joinCart,
  updateCartItem,
  updateCartNote,
  type Cart,
  type CartItem,
  type CheckoutCartResponse,
  type SubmittedOrder,
} from '@/api/carts'
import type { AuthUser } from '@/api/auth'
import { cancelCustomerOrder, getGuestOrders, getMyOrders } from '@/api/auth'
import { useAuth } from '@/auth/AuthContext'
import { type CheckoutNavigationState } from '@/pages/CheckoutPage'
import { LEGAL_VERSIONS } from '@/legal/legalConfig'
import {
  getPublicRestaurantMenu,
  getPublicRestaurantMenuStock,
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
  DrawerClose,
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
import { getStoredGuestOrders, rememberGuestOrder } from '@/lib/guestOrders'
import { mergeMenuStock } from '@/lib/menuStockMerge'
import { applyOptionAdjustment, describeOptionAdjustment } from '@/lib/menuOptionPricing'
import {
  describeStock,
  optionPerItemLimit,
  optionUnitsInCart,
  remainingForLine,
} from '@/lib/menuStockDisplay'
import {
  getOptionQuantity,
  getSelectedCountInGroup,
  setOptionQuantity,
} from '@/lib/menuOptionSelection'
import { buildPlateDisclosure, formatAllergenLines, summariseDisclosure } from '@/lib/allergenDisclosure'
import {
  buildRestaurantMenuPath,
  buildViewerMenuPath,
  parseCustomerMenuOrderType,
} from '@/lib/customerMenuNavigation'
import { cn } from '@/lib/utils'
import { cartIdentityOf, cartSessionBelongsToSomeoneElse } from '@/lib/cartSessionIdentity'
import { cartSessionIsGone } from '@/lib/cartSessionRecovery'
import { findUnpaidOrderToPrompt, type UnpaidOrderPrompt } from '@/lib/unpaidOrderPrompt'
import { copyOrderIntoCart, describeCopyFailure } from '@/lib/copyOrderToCart'
import { UnpaidOrderDialog } from '@/components/ordering/UnpaidOrderDialog'

type StoredCartSession = {
  cartId: string
  participantToken: string
  participantId: string
  /** Who this token was issued to — a user id, or `guest`. See lib/cartSessionIdentity. */
  identity: string
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

type MenuFilter = 'available' | 'popular' | 'recommended' | 'vegetarian' | 'vegan' | 'glutenFree' | 'halal' | 'spicy'

const menuFilters: Array<{ id: MenuFilter; label: string }> = [
  { id: 'available', label: 'Available now' },
  { id: 'popular', label: 'Popular' },
  { id: 'recommended', label: 'Recommended' },
  { id: 'vegetarian', label: 'Vegetarian' },
  { id: 'vegan', label: 'Vegan' },
  { id: 'glutenFree', label: 'Gluten-free' },
  { id: 'halal', label: 'Halal' },
  { id: 'spicy', label: 'Spicy' },
]

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
  const [searchParams] = useSearchParams()
  const requestedOrderType = parseCustomerMenuOrderType(searchParams.get('orderType'))
  /** A dish to open as soon as the menu is ready — set by a reorder that needs fresh choices. */
  const requestedItemId = searchParams.get('item')
  const { user, token, logout } = useAuth()
  // Who the cart belongs to right now. Changes the moment someone signs in or out, which is the
  // signal to stop using the participant token issued to whoever was here before.
  const cartIdentity = cartIdentityOf(user)
  const [state, setState] = useState<CustomerMenuState>({ status: 'loading' })
  const [retryKey, setRetryKey] = useState(0)
  const [search, setSearch] = useState('')
  const [activeFilters, setActiveFilters] = useState<MenuFilter[]>([])
  const [activeCategoryId, setActiveCategoryId] = useState<string | 'all'>('all')
  const [addingItemId, setAddingItemId] = useState<string | null>(null)
  /** True from the moment an add starts until it settles. See addItem for why this is not state. */
  const addInFlightRef = useRef(false)
  const [cartOpen, setCartOpen] = useState(false)
  const [cartActionItemId, setCartActionItemId] = useState<string | null>(null)
  const [clearingCart, setClearingCart] = useState(false)
  const [savingCartNote, setSavingCartNote] = useState(false)
  const [checkingOut, setCheckingOut] = useState(false)
  const [selectingOrderType, setSelectingOrderType] = useState(false)
  const [pendingOrderType, setPendingOrderType] = useState<'DineIn' | 'Takeaway' | null>(null)
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

        if (restaurantId && (!requestedOrderType || !context.availableOrderTypes.includes(requestedOrderType))) {
          setState({ status: 'choosing', context, menu })
          return
        }

        const orderType = restaurantId ? requestedOrderType! : 'DineIn'
        const storageKeySuffix = restaurantId
          ? `restaurant:${context.restaurant.id}:${orderType.toLowerCase()}`
          : `table:${qrToken}`
        const cartSession = await loadOrJoinCart(context, storageKeySuffix, orderType, cartIdentity)

        // A checkout that was interrupted after the server committed it. The order exists; take the
        // customer to it rather than showing them a menu they have already ordered from.
        if (cartSession.recoveredOrder) {
          rememberGuestOrder(
            cartSession.recoveredOrder.order.id,
            cartSession.recoveredOrder.guestAccessToken ?? null,
          )
          toast.info('Your order was already placed', {
            description: 'The last attempt went through even though the page did not say so.',
          })
          navigate('/checkout', {
            state: buildCheckoutNavigation(
              { ...context, orderType },
              cartSession.cart,
              cartSession.participantToken,
              cartSession.recoveredOrder.order,
              qrToken,
            ),
            replace: true,
          })
          return
        }

        setState({
          status: 'ready',
          context: { ...context, orderType },
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
    // cartIdentity is a dependency on purpose: signing in or out has to rebuild the cart session,
    // not carry the previous person's participant into the new one.
  }, [restaurantId, qrToken, requestedOrderType, retryKey, cartIdentity, navigate])

  useEffect(() => {
    latestCartRef.current = state.status === 'ready' ? state.cart : null
  }, [state])

  /**
   * An order placed here but never paid for is holding stock and a pickup number until it expires.
   * A customer who bounced off the payment screen and came back would otherwise build a second
   * order on top of the first, and then find the dish sold out by their own forgotten order.
   */
  const [unpaidPrompt, setUnpaidPrompt] = useState<UnpaidOrderPrompt | null>(null)
  // Dismissing is an answer, not a deferral: re-asking on every render would make "leave it for
  // now" impossible to mean.
  const dismissedUnpaidOrdersRef = useRef(new Set<string>())

  const readyRestaurantId = state.status === 'ready' ? state.context.restaurant.id : null

  useEffect(() => {
    if (!readyRestaurantId) {
      return
    }

    const restaurantId = readyRestaurantId
    let cancelled = false

    async function checkForUnpaidOrder() {
      try {
        const orders = token
          ? await getMyOrders()
          : await (async () => {
              const stored = getStoredGuestOrders()
              return stored.length > 0 ? await getGuestOrders(stored) : []
            })()

        if (cancelled) {
          return
        }

        const found = findUnpaidOrderToPrompt(orders, restaurantId)
        setUnpaidPrompt(
          found && !dismissedUnpaidOrdersRef.current.has(found.order.id) ? found : null,
        )
      } catch {
        // Nothing to say. This is a courtesy on top of the menu, and failing to look up past
        // orders must never be what stops somebody ordering.
      }
    }

    void checkForUnpaidOrder()

    return () => {
      cancelled = true
    }
  }, [readyRestaurantId, token])

  /**
   * Opens the dish a reorder could not finish, once the menu has loaded.
   *
   * <p>
   * A reorder sends `?item=` here when the menu has started requiring choices the old order never
   * recorded. Runs once: the id stays in the URL so a reload still works, but reopening the sheet
   * on every re-render would fight anyone who closed it.
   * </p>
   */
  const openedRequestedItemRef = useRef(false)

  useEffect(() => {
    if (!requestedItemId || openedRequestedItemRef.current || state.status !== 'ready') {
      return
    }

    const item = state.menu.categories
      .flatMap((category) => category.items)
      .find((candidate) => candidate.id === requestedItemId)

    if (!item) {
      return
    }

    openedRequestedItemRef.current = true

    // Deferred out of the effect body: opening the sheet is several state updates at once, which
    // is what react-hooks/set-state-in-effect exists to stop happening synchronously here.
    void Promise.resolve().then(() => {
      setEditingCartItem(null)
      setSelectedItem(item)
      setSelectedItemQuantity(1)
      setSelectedItemNote('')
      setSelectedOptionIds(getDefaultSelectedOptionIds(item))
    })
  }, [requestedItemId, state])


  // The realtime and polling effects key off the active cart only. Extracted so their dependency
  // arrays hold plain values the linter can check, instead of ternaries it has to give up on.
  const activeCartId = state.status === 'ready' ? state.cart.id : null
  const activeParticipantToken = state.status === 'ready' ? state.participantToken : null
  const activeParticipantId = state.status === 'ready' ? state.participantId : null

  useEffect(() => {
    if (!activeCartId || !activeParticipantToken) {
      void realtimeClientRef.current?.stop()
      realtimeClientRef.current = null
      return
    }

    const client = createCartRealtimeClient(activeCartId, activeParticipantToken, {
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
        if (update.actorParticipantId === activeParticipantId) {
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
        const refreshed = await getCart(activeCartId, activeParticipantToken)
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
  }, [activeCartId, activeParticipantToken, activeParticipantId])

  useEffect(() => {
    if (!activeCartId || !activeParticipantToken) {
      return undefined
    }

    let stopped = false
    const cartId = activeCartId
    const participantToken = activeParticipantToken

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
  }, [activeCartId, activeParticipantToken])

  /**
   * What is left of the menu, kept current while it sits on screen.
   *
   * <p>
   * A diner opens the menu, reads it, talks to the table, and orders ten minutes later. In between,
   * somebody else took the last portion — and the page went on offering it until the customer
   * happened to reload. Checkout does refuse, so nothing is oversold, but being told at the till
   * that the dish you chose and configured was gone before you started is a bad way to find out.
   * </p>
   *
   * <p>
   * Separate from the cart poll above, and slower: the cart is this diner's own and changes when
   * they or the person opposite touches it, while stock changes at the pace of the whole room. It
   * also runs before there is a cart at all, because reading the menu is exactly when this is
   * wrong. Coming back to the tab asks immediately, since that is the moment a stale menu is most
   * likely and the diner is about to act on it.
   * </p>
   */
  const activeMenuRestaurantId = state.status === 'ready' || state.status === 'choosing'
    ? state.menu.restaurantId
    : null

  useEffect(() => {
    if (!activeMenuRestaurantId) {
      return undefined
    }

    let stopped = false
    const restaurantId = activeMenuRestaurantId

    const refresh = async () => {
      try {
        const stock = await getPublicRestaurantMenuStock(restaurantId)

        if (stopped) {
          return
        }

        setState((current) => {
          if (current.status !== 'ready' && current.status !== 'choosing') {
            return current
          }

          if (current.menu.restaurantId !== restaurantId) {
            return current
          }

          const menu = mergeMenuStock(current.menu, stock)
          // Both identities are kept when nothing moved, so a diner mid-scroll is not re-rendered
          // every fifteen seconds to be shown the same menu.
          return menu === current.menu ? current : { ...current, menu }
        })
      } catch {
        // A missed reading leaves the page showing what it last knew, which is what it showed all
        // the time before this existed. Checkout is still the thing that refuses.
      }
    }

    const intervalId = window.setInterval(() => void refresh(), 15_000)
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        void refresh()
      }
    }

    document.addEventListener('visibilitychange', refreshWhenVisible)

    return () => {
      stopped = true
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [activeMenuRestaurantId])

  const visibleCategories = useMemo(() => {
    if (state.status !== 'ready') {
      return []
    }

    const normalizedSearch = search.trim().toLowerCase()

    return state.menu.categories
      .map((category) => ({
        ...category,
        items: category.items.filter((item) => {
          if (!matchesMenuFilters(item, activeFilters)) {
            return false
          }

          const optionText = getAvailableOptionGroups(item)
            .flatMap((group) => [group.name, ...group.options.map((option) => option.name)])

          return !normalizedSearch || [
            item.name,
            item.description ?? '',
            item.allergens ?? '',
            ...getMenuItemTagLabels(item),
            ...optionText,
          ]
            .join(' ')
            .toLowerCase()
            .includes(normalizedSearch)
        }),
      }))
      .filter((category) => category.items.length > 0)
  }, [activeFilters, search, state])

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
        // Without this the session is stored owning nobody, and the next load discards it as
        // somebody else's and joins a fresh, empty cart.
        cartIdentity,
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
        // Without this the session is stored owning nobody, and the next load discards it as
        // somebody else's and joins a fresh, empty cart.
        cartIdentity,
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

  const requestOrderTypeSwitch = (orderType: 'DineIn' | 'Takeaway') => {
    if (state.status !== 'ready' || state.cart.orderType === orderType) {
      return
    }

    if (state.cart.items.length > 0) {
      setPendingOrderType(orderType)
      return
    }

    void switchOrderType(orderType)
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
  const viewerMenuPath = buildViewerMenuPath(qrToken, context.restaurant.id, cart.orderType)

  /**
   * How many of a dish the cart already holds, across every line.
   *
   * <p>
   * The same dish can sit in several lines with different options or notes, and stock does not care
   * which line it came from. Counting only the line being edited is how a cart quietly ends up
   * holding more of a limited dish than exists.
   * </p>
   */
  const quantityInCartFor = (menuItemId: string | undefined) =>
    menuItemId
      ? cart.items
          .filter((line) => line.menuItemId === menuItemId)
          .reduce((total, line) => total + line.quantity, 0)
      : 0

  // Modifiers are counted the way the server counts them, and the line being edited is left out
  // for the same reason its own portions are: an edit replaces that line rather than adding to it.
  // Plain rather than memoised: this sits below the page's early returns, where a hook cannot go,
  // and a cart holds a handful of lines.
  const optionUnitsElsewhere = optionUnitsInCart(cart.items, editingCartItem?.id ?? null)


  const dismissUnpaidPrompt = () => {
    if (unpaidPrompt) {
      dismissedUnpaidOrdersRef.current.add(unpaidPrompt.order.id)
    }
    setUnpaidPrompt(null)
  }

  const handleContinueUnpaidPayment = () => {
    if (!unpaidPrompt) {
      return
    }
    // Checkout, not My Orders: it is the one screen that offers whichever payment methods the
    // restaurant actually has, so a customer is not sent off to pay a restaurant that cannot
    // currently take a card.
    dismissUnpaidPrompt()
    navigate(`/checkout?order=${encodeURIComponent(unpaidPrompt.order.id)}`)
  }

  /**
   * Puts the unpaid order's items into the live cart so the customer can order the same meal again
   * without hunting down every dish and option — and says plainly what could not be taken, since
   * the commonest reason is that this very order is holding the last of it.
   */
  const handleCopyUnpaidOrderToCart = async () => {
    if (!unpaidPrompt) {
      return
    }

    const result = await copyOrderIntoCart(unpaidPrompt.order, cart.id, participantToken)

    if (result.closedMessage) {
      toast.error('The restaurant is not taking orders', { description: result.closedMessage })
      return
    }

    const refreshed = await getCart(cart.id, participantToken).catch(() => null)
    if (refreshed) {
      setState((current) => (current.status === 'ready' ? { ...current, cart: refreshed } : current))
    }

    if (result.addedCount === 0) {
      toast.error('Nothing could be added', {
        description: result.failures.map(describeCopyFailure).join(' '),
      })
      return
    }

    dismissUnpaidPrompt()
    setCartOpen(true)

    if (result.failures.length > 0) {
      toast.warning(`Added ${result.addedCount} of ${unpaidPrompt.order.orderItems.length}`, {
        description: result.failures.map(describeCopyFailure).join(' '),
      })
    } else {
      toast.success('Added to your cart', {
        description: 'The same items are in your cart, ready to order again.',
      })
    }
  }

  const handleCancelUnpaidOrder = async () => {
    if (!unpaidPrompt) {
      return
    }

    try {
      await cancelCustomerOrder(unpaidPrompt.order.id, { reason: 'Cancelled from the menu.' })
      dismissUnpaidPrompt()
      toast.success('Order cancelled', {
        description: 'Those items are back on the menu.',
      })
    } catch (error) {
      toast.error('Could not cancel the order', {
        description: error instanceof Error ? error.message : 'Try again from My Orders.',
      })
    }
  }
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
    // Guarded by a ref, not by the state below. State updates are not applied until React re-renders,
    // so two taps landing in one batch both read the old value and both fire — which is how a single
    // intent reached the server twice. A ref changes on the line it is assigned.
    if (item.isSoldOut || !item.isAvailable || addInFlightRef.current) {
      return false
    }

    addInFlightRef.current = true
    // Still set, because this is what draws the spinner and disables the button.
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
      addInFlightRef.current = false
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
        // The line as this editor last saw it. The server refuses the edit if it has moved on.
        expectedUpdatedAt: item.updatedAt ?? item.createdAt,
      })

      latestCartRef.current = updatedCart
      setState((current) =>
        current.status === 'ready' ? { ...current, cart: updatedCart } : current,
      )
      return true
    } catch (error) {
      // Someone else at the table changed this line first. The server sends the cart as it now
      // stands, so show that rather than leaving the screen describing a version that is gone.
      const conflictCart = cartFromConflict(error)

      if (conflictCart) {
        latestCartRef.current = conflictCart
        setState((current) =>
          current.status === 'ready' ? { ...current, cart: conflictCart } : current,
        )
        toast.error('Someone else changed this item', {
          description: 'The cart has been refreshed with their version. Try your change again.',
        })
        return false
      }

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
      const result = await checkoutCart(cart.id, participantToken, {
        acceptedCustomerTermsVersion: LEGAL_VERSIONS.customerTerms,
        acknowledgedPrivacyPolicyVersion: LEGAL_VERSIONS.privacyPolicy,
        acknowledgedAllergenNoticeVersion: LEGAL_VERSIONS.allergenNotice,
      })
      // Only chance to capture the token; it is never returned again.
      rememberGuestOrder(result.order.id, result.guestAccessToken ?? null)
      navigate('/checkout', {
        state: buildCheckoutNavigation(context, cart, participantToken, result.order, qrToken),
      })
    } catch (error) {
      setCheckingOut(false)

      // The request gave up waiting; it does not follow that the order was not placed. Saying so
      // plainly matters, because the honest instruction is "press it again" — one cart can only
      // ever produce one order, so a second attempt returns the first one's order rather than
      // creating a second. Telling them it failed would be a guess, and the wrong one half the time.
      if (isTimeout(error)) {
        toast.error('Checkout is taking longer than expected', {
          description:
            'We could not tell whether your order went through. Press Go to checkout again — '
            + 'if it did, you will be taken straight to it, and you will not be charged twice.',
        })
        return
      }

      toast.error(error instanceof Error ? error.message : 'Could not start checkout')
    }
  }

  return (
    <main className={cn('min-h-svh bg-background text-foreground', cart.items.length > 0 ? 'pb-28' : 'pb-8')}>
      <UnpaidOrderDialog
        prompt={unpaidPrompt}
        currencyFormatter={currencyFormatter}
        onlinePaymentsEnabled={context.restaurant.onlinePaymentsEnabled}
        onContinue={handleContinueUnpaidPayment}
        onCancel={handleCancelUnpaidOrder}
        onCopyToCart={handleCopyUnpaidOrderToCart}
        onDismiss={dismissUnpaidPrompt}
      />
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-3 py-4 sm:px-6 lg:px-8">
        <header className="overflow-hidden rounded-[2rem] border bg-card shadow-sm">
          <div className="relative min-h-[190px] overflow-hidden bg-muted sm:min-h-[280px]">
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
            <div className="absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-4 sm:p-5">
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
                      requestOrderTypeSwitch(value)
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
                  menuPath={viewerMenuPath}
                  onLogout={() => {
                    logout()
                    // Back to the menu they were reading, not to a sign-in form. Signing out is
                    // how a customer hands the phone back or orders as a guest; it is not a
                    // request to sign in again, and dropping them on /login stranded them away
                    // from the restaurant they were ordering from.
                    navigate(viewerMenuPath)
                  }}
                />
              </div>
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 space-y-3 p-5 text-white sm:p-7">
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
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <span>{context.restaurant.legalBusinessName || context.restaurant.name}</span>
              {context.restaurant.abn ? <span>ABN {context.restaurant.abn}</span> : null}
              {context.restaurant.gstRegistered ? <span>Prices include GST</span> : null}
              {context.restaurant.customerSurchargeNotice ? <strong className="w-full text-foreground">{context.restaurant.customerSurchargeNotice}</strong> : null}
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
                <div className="hidden shrink-0 items-center justify-between gap-2 rounded-xl bg-muted/60 px-3 py-2 text-xs font-semibold text-muted-foreground sm:flex sm:min-w-28 sm:justify-center">
                  <span>{visibleMenuItemCount} shown</span>
                  <span className="text-muted-foreground/60">/</span>
                  <span>{totalMenuItemCount} total</span>
                </div>
              </div>
              <div className="mt-2 flex gap-2 overflow-x-auto pb-0.5" aria-label="Menu filters">
                {menuFilters.map((filter) => {
                  const active = activeFilters.includes(filter.id)

                  return (
                    <Button
                      key={filter.id}
                      type="button"
                      size="sm"
                      variant={active ? 'default' : 'outline'}
                      aria-pressed={active}
                      className="h-8 shrink-0 rounded-full px-3 text-xs"
                      onClick={() => {
                        setActiveFilters((current) =>
                          current.includes(filter.id)
                            ? current.filter((entry) => entry !== filter.id)
                            : [...current, filter.id],
                        )
                        setActiveCategoryId('all')
                      }}
                    >
                      {filter.label}
                    </Button>
                  )
                })}
                {activeFilters.length > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 shrink-0 rounded-full px-3 text-xs"
                    onClick={() => setActiveFilters([])}
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
            </div>

            {!hasMenu ? (
              <EmptyMenuState />
            ) : visibleCategories.length === 0 ? (
              <NoResultsState onReset={() => {
                setSearch('')
                setActiveFilters([])
                setActiveCategoryId('all')
              }} />
            ) : (
              <div className="space-y-7">
                {visibleCategories.map((category) => (
                  <MenuCategorySection
                    key={category.id}
                    category={category}
                    currencyFormatter={currencyFormatter}
                    quantityInCartFor={quantityInCartFor}
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
        alreadyInCart={quantityInCartFor(selectedItem?.id)}
        editingLineQuantity={editingCartItem?.quantity ?? null}
        optionUnitsInCart={optionUnitsElsewhere}
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

      <AlertDialog
        open={pendingOrderType !== null}
        onOpenChange={(open) => {
          if (!open) setPendingOrderType(null)
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Switch to {pendingOrderType === 'DineIn' ? 'dine in' : 'takeaway'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Your current {cart.orderType === 'DineIn' ? 'dine-in' : 'takeaway'} cart will be kept
              separately. Switching opens the other cart and does not move these items.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current cart</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const nextOrderType = pendingOrderType
                setPendingOrderType(null)
                if (nextOrderType) void switchOrderType(nextOrderType)
              }}
            >
              Switch cart
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

/**
 * Where a placed order sends the customer, and with what.
 *
 * <p>
 * Shared by the checkout button and by recovery, because they are the same arrival: an order
 * exists and the customer has to be standing in front of it. Two copies of this would differ the
 * first time one of them gained a field.
 * </p>
 */
function buildCheckoutNavigation(
  context: PublicOrderingContext,
  cart: Cart,
  participantToken: string,
  order: SubmittedOrder,
  qrToken: string | undefined,
): CheckoutNavigationState {
  return {
    order,
    cartId: cart.id,
    participantToken,
    currency: context.restaurant.currency,
    restaurantName: context.restaurant.name,
    restaurantLegalBusinessName: context.restaurant.legalBusinessName,
    restaurantAbn: context.restaurant.abn,
    gstRegistered: context.restaurant.gstRegistered,
    pricesIncludeGst: context.restaurant.pricesIncludeGst,
    refundContactEmail: context.restaurant.refundContactEmail,
    customerSurchargeNotice: context.restaurant.customerSurchargeNotice,
    tableNumber: context.table?.tableNumber ?? null,
    paymentPolicy: context.restaurant.paymentPolicy,
    onlinePaymentsEnabled: context.restaurant.onlinePaymentsEnabled,
    returnPath: qrToken
      ? `/table/${encodeURIComponent(qrToken)}`
      : buildRestaurantMenuPath(context.restaurant.id, cart.orderType),
  }
}

async function loadOrJoinCart(
  context: PublicOrderingContext,
  storageKeySuffix: string,
  orderType: 'DineIn' | 'Takeaway',
  identity: string,
): Promise<{
  cart: Cart
  participantToken: string
  participantId: string
  /**
   * The order a previous checkout placed, when this cart turns out to have already produced one.
   *
   * <p>
   * Set only on recovery. Its presence means the customer should be taken to their order rather
   * than shown a menu, because the thing they were trying to do already happened.
   * </p>
   */
  recoveredOrder?: CheckoutCartResponse
}> {
  if (!context.restaurant.isOrderingAvailable) {
    throw new Error(context.restaurant.orderingStatusMessage)
  }

  const storageKey = `${cartSessionPrefix}.${storageKeySuffix}`
  const stored = readStoredCartSession(storageKey)

  // Signing in or out makes the stored token somebody else's. Reusing it is what attributed a
  // guest's order to the account that had been signed in a moment earlier.
  if (stored && cartSessionBelongsToSomeoneElse(stored.identity, identity)) {
    sessionStorage.removeItem(storageKey)
  } else if (stored) {
    try {
      const cart = await getCart(stored.cartId, stored.participantToken)

      if (cart.status === 'Active') {
        return {
          cart,
          participantToken: stored.participantToken,
          participantId: stored.participantId,
        }
      }

      // The cart already produced an order. That happens when a checkout was interrupted after the
      // server had committed it — the answer never arrived, and the customer reloaded instead of
      // pressing the button again.
      //
      // Falling through here started a fresh, empty cart and left that order in the kitchen with
      // nobody able to see it: no order number on screen, no way back to it, and twenty minutes
      // later the sweeper cancelled it. Submitting again is how the server hands the order back —
      // one cart can only ever produce one — so ask for it rather than pretending it is not there.
      if (cart.status === 'Submitted') {
        const recoveredOrder = await checkoutCart(cart.id, stored.participantToken, {
          acceptedCustomerTermsVersion: LEGAL_VERSIONS.customerTerms,
          acknowledgedPrivacyPolicyVersion: LEGAL_VERSIONS.privacyPolicy,
          acknowledgedAllergenNoticeVersion: LEGAL_VERSIONS.allergenNotice,
        })

        return {
          cart,
          participantToken: stored.participantToken,
          participantId: stored.participantId,
          recoveredOrder,
        }
      }
    } catch (error) {
      // A restarting backend is not a deleted cart. Discarding the token on any failure is what
      // replaced a customer's full cart with an empty one and stranded the original in the
      // database, so a temporary failure is raised instead — the page offers a retry, and the
      // token is still here when the server comes back.
      if (!cartSessionIsGone(error)) {
        throw error
      }

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
      identity,
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

    if (!parsed.cartId || !parsed.participantToken || !parsed.participantId || !parsed.identity) {
      return null
    }

    return {
      cartId: parsed.cartId,
      participantToken: parsed.participantToken,
      participantId: parsed.participantId,
      identity: parsed.identity,
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

      // Group minimum/maximum values describe how many different choices are selected.
      // Quantity is governed independently by each option's maxQuantity.
      return group.options
        // A required group opens with its first choices already ticked. One that has run out would
        // open the panel already refusable, with nothing saying why.
        .filter((option) => option.remainingStock == null || option.remainingStock > 0)
        .slice(0, group.minSelections)
        .map((option) => option.id)
    })
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

/**
 * Why this plate cannot be ordered as chosen, when a modifier has run short.
 *
 * <p>
 * Separate from the group rules above because it depends on things a selection alone does not know:
 * how many dishes the line holds, and what the rest of the cart has already spoken for. Raising the
 * dish quantity is the usual way a selection that was fine stops being fine.
 * </p>
 */
function getOptionStockError(
  item: PublicMenuItem,
  selectedOptionIds: string[],
  dishQuantity: number,
  unitsElsewhereInCart: Map<string, number>,
) {
  for (const { option, quantity } of getOrderedSelectedOptions(item, selectedOptionIds)) {
    if (option.remainingStock == null) {
      continue
    }

    const ceiling = optionPerItemLimit(
      option.maxQuantity,
      option.remainingStock,
      unitsElsewhereInCart.get(option.id) ?? 0,
      dishQuantity,
    )

    if (quantity > ceiling) {
      const held = unitsElsewhereInCart.get(option.id) ?? 0

      return ceiling === 0
        ? held > 0
          ? `${option.name} is spoken for by the rest of your cart.`
          : `${option.name} has sold out.`
        : `Only ${option.remainingStock} of ${option.name} left — that allows ${ceiling} per dish at this quantity.`
    }
  }

  return null
}

function calculateItemUnitPrice(item: PublicMenuItem, selectedOptionIds: string[]) {
  return getOrderedSelectedOptions(item, selectedOptionIds)
    .reduce((unitPrice, { option, quantity }) => {
      // An option whose type names no pricing rule adds nothing, and its label shows no price
      // either. The server refuses to price such a row at all, so there is no total this could
      // display that the bill would agree with — inventing one is what caused the divergence.
      return applyOptionAdjustment(unitPrice, option, quantity) ?? unitPrice
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
  return describeOptionAdjustment(option, currencyFormatter) ?? ''
}

/**
 * What this modifier brings with it, for the row the customer taps. Silence stays silent: an option
 * that declares nothing says nothing, because the dish's own panel already reports whether the
 * restaurant has declared anything at all.
 */
function describeOptionAllergens(option: PublicMenuOption) {
  const parts = [
    option.allergens?.trim() ? `Contains ${option.allergens.trim()}` : null,
    option.mayContainAllergens?.trim() ? `may contain ${option.mayContainAllergens.trim()}` : null,
    option.crossContactStatement?.trim() || null,
  ].filter(Boolean)

  return parts.join(' - ')
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
  quantityInCartFor,
  onOpenItem,
}: {
  category: PublicMenuCategory
  currencyFormatter: Intl.NumberFormat
  /** Portions of a dish this cart holds, so its stock badge counts down as it is filled. */
  quantityInCartFor: (menuItemId: string) => number
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
            <article
              key={item.id}
              aria-labelledby={`menu-item-${item.id}`}
            >
              <Card
              className={cn(
                'overflow-hidden rounded-2xl border bg-card py-0 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/25 hover:bg-muted/20 hover:shadow-md',
                disabled && 'bg-muted/35 text-muted-foreground hover:translate-y-0 hover:border-border hover:shadow-sm',
              )}
            >
              <CardContent className="grid gap-3 p-2.5 sm:p-3 lg:grid-cols-[116px_minmax(0,1fr)]">
                <button
                  type="button"
                  aria-label={`View details for ${item.name}`}
                  className="relative aspect-[4/3] overflow-hidden rounded-xl border bg-muted text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:aspect-square"
                  onClick={() => onOpenItem(item)}
                >
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
                  ) : (
                    <StockBadge
                      compact
                      remainingStock={item.remainingStock}
                      isSoldOut={item.isSoldOut}
                      alreadyInCart={quantityInCartFor(item.id)}
                      className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)]"
                    />
                  )}
                </button>

                <div className="flex min-w-0 flex-col gap-3 lg:min-h-[116px]">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                      <h3 id={`menu-item-${item.id}`} className="min-w-0 text-base font-semibold leading-snug">
                        <button
                          type="button"
                          className="line-clamp-2 break-words text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => onOpenItem(item)}
                        >
                          {item.name}
                        </button>
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
                    <MenuItemTags item={item} compact />
                  </div>

                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      variant={disabled ? 'secondary' : 'default'}
                      disabled={disabled}
                      className="h-9 min-w-20 rounded-full px-3 shadow-sm sm:min-w-24"
                      onClick={() => onOpenItem(item)}
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
            </article>
          )
        })}
      </div>
    </section>
  )
}

function ItemDetailOverlay({
  item,
  quantity,
  alreadyInCart,
  editingLineQuantity,
  optionUnitsInCart,
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
  alreadyInCart: number
  /** Portions this line already holds while it is being edited, or null while adding. */
  editingLineQuantity: number | null
  /** Lots of each tracked modifier the cart's other lines already commit. */
  optionUnitsInCart: Map<string, number>
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
          <DrawerHeader className="relative shrink-0 border-b bg-muted/20 pr-14 text-left">
            <DrawerTitle className="font-heading text-2xl leading-tight tracking-tight">{item.name}</DrawerTitle>
            <DrawerDescription>{description}</DrawerDescription>
            <DrawerClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Close item details"
                className="absolute right-3 top-3 size-9 rounded-full"
              >
                <X className="size-4" />
              </Button>
            </DrawerClose>
          </DrawerHeader>
          <ItemDetailContent
            item={item}
            quantity={quantity}
            alreadyInCart={alreadyInCart}
            editingLineQuantity={editingLineQuantity}
            optionUnitsInCart={optionUnitsInCart}
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
          alreadyInCart={alreadyInCart}
          editingLineQuantity={editingLineQuantity}
          optionUnitsInCart={optionUnitsInCart}
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
  alreadyInCart,
  editingLineQuantity,
  optionUnitsInCart,
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
  /** How many of this dish the cart already holds, so the stepper can stop at what is left. */
  alreadyInCart: number
  editingLineQuantity: number | null
  /** Lots of each tracked modifier the cart's other lines already commit. */
  optionUnitsInCart: Map<string, number>
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
  // Recomputed as options are ticked, so the panel below describes the plate being ordered rather
  // than the dish as listed.
  const plateDisclosure = buildPlateDisclosure(
    item,
    selectedOptions.map(({ option }) => option),
  )
  // What stays on screen while the panel is shut.
  const allergenSummary = summariseDisclosure(plateDisclosure)
  const optionSelectionError = getOptionSelectionError(item, selectedOptionIds) ??
    getOptionStockError(item, selectedOptionIds, quantity, optionUnitsInCart)
  const unitPrice = calculateItemUnitPrice(item, selectedOptionIds)
  const lineTotal = unitPrice * quantity
  // Null when the dish is unlimited. Stops the stepper where the server would refuse anyway, so
  // the ceiling is discovered while choosing rather than at the moment of adding.
  const addableNow = remainingForLine(item.remainingStock, alreadyInCart, editingLineQuantity)

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div className={cn('min-h-0 flex-1 overflow-y-auto', bodyClassName)}>
        <div className="grid gap-5 sm:grid-cols-[240px_minmax(0,1fr)]">
          <div className="relative h-40 overflow-hidden rounded-2xl border bg-gradient-to-br from-muted to-background shadow-sm sm:h-auto sm:aspect-square">
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
          ) : (
            <StockBadge
              remainingStock={item.remainingStock}
              isSoldOut={item.isSoldOut}
              alreadyInCart={alreadyInCart}
              className="absolute bottom-4 left-4"
            />
          )}
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
            <MenuItemTags item={item} />
            {(item.servingSize || item.calories != null) ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {item.servingSize ? <span>Serving: {item.servingSize}</span> : null}
                {item.calories != null ? <span>{item.calories} kcal</span> : null}
              </div>
            ) : null}
            {/* Absence of allergen information used to render as nothing at all, which is
                indistinguishable from a dish confirmed to contain no allergens — so "not declared"
                is still said out loud. The panel folds shut by default because the standing wording
                below it, which is the same on every dish, was pushing the price and the options off
                a phone screen. The declaration itself does not fold: it is the summary line, on
                screen whether the panel is open or not. */}
            <details className="group rounded-xl border border-amber-300/70 bg-amber-50 text-sm text-amber-950 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-100">
              <summary className="flex cursor-pointer list-none items-start gap-2 p-3 [&::-webkit-details-marker]:hidden">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className={allergenSummary.declared ? 'font-semibold' : 'font-medium opacity-90'}>
                    {allergenSummary.headline}
                  </span>
                  {plateDisclosure.hasModifierDisclosure ? (
                    <span className="block text-xs font-semibold">
                      Some of this comes from the options you selected. Deselecting them removes it.
                    </span>
                  ) : null}
                  <span className="block text-xs opacity-80 group-open:hidden">Allergen details</span>
                </span>
                <ChevronDown className="mt-0.5 size-4 shrink-0 transition-transform group-open:rotate-180" />
              </summary>
              <div className="border-t border-amber-300/60 px-3 py-2.5 dark:border-amber-400/20">
                <p className="font-semibold">Contains</p>
                <p>{formatAllergenLines(plateDisclosure.allergens) || 'Not declared by the restaurant.'}</p>
                <p className="mt-1 font-semibold">May contain</p>
                <p>{formatAllergenLines(plateDisclosure.mayContain) || 'Not declared by the restaurant.'}</p>
                {plateDisclosure.crossContact.length > 0
                  ? <p className="mt-1 text-xs">{formatAllergenLines(plateDisclosure.crossContact)}</p>
                  : <p className="mt-1 text-xs">The restaurant has not described how this dish is prepared or what it shares equipment with.</p>}
                <p className="mt-1 text-xs font-medium opacity-90">For a severe allergy, contact the restaurant before ordering. Order notes cannot guarantee prevention of cross-contact.</p>
              </div>
            </details>
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
                const isSingleChoice = group.maxSelections === 1

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

                    <div
                      className="grid gap-2.5 p-3"
                      role={isSingleChoice ? 'radiogroup' : undefined}
                      aria-label={isSingleChoice ? group.name : undefined}
                    >
                      {group.options.map((option) => {
                        const selectedQuantity = getOptionQuantity(selectedOptionIds, option.id)
                        const selected = selectedQuantity > 0
                        // The recipe rule and the shelf, whichever is lower. Shown and enforced
                        // here so the stepper stops where the server's refusal would have been.
                        const optionCeiling = optionPerItemLimit(
                          option.maxQuantity,
                          option.remainingStock,
                          optionUnitsInCart.get(option.id) ?? 0,
                          quantity,
                        )
                        const optionSoldOut = optionCeiling < 1
                        const optionDisabled = disabled ||
                          isAdding ||
                          (!selected && optionSoldOut) ||
                          (!selected && maxReached && !isSingleChoice)
                        const canDecrease = selected && !disabled && !isAdding
                        const canIncrease = !disabled &&
                          !isAdding &&
                          selected &&
                          selectedQuantity < optionCeiling

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
                              role={isSingleChoice ? 'radio' : undefined}
                              aria-checked={isSingleChoice ? selected : undefined}
                              aria-pressed={isSingleChoice ? undefined : selected}
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
                                {option.maxQuantity > 1 || option.remainingStock != null ? (
                                  <span
                                    className={cn(
                                      'mt-0.5 block text-xs',
                                      optionSoldOut ? 'font-medium text-destructive' : 'text-muted-foreground',
                                    )}
                                    data-testid={`option-limit-${option.id}`}
                                  >
                                    {/* The count is the part a customer can act on; "Max 3" beside
                                        two left would be telling them something untrue. */}
                                    {option.remainingStock != null
                                      ? optionSoldOut
                                        ? 'Sold out'
                                        : `${optionCeiling} available`
                                      : `Max ${option.maxQuantity}`}
                                    {!optionSoldOut && selectedQuantity > 1 ? ` - selected ${selectedQuantity}` : ''}
                                  </span>
                                ) : null}
                                {/* On the row itself, so it can be read before selecting rather
                                    than noticed afterwards in a panel further up. */}
                                {describeOptionAllergens(option) ? (
                                  <span className="mt-0.5 flex items-start gap-1 text-xs font-medium text-amber-800 dark:text-amber-200">
                                    <ShieldAlert className="mt-0.5 size-3 shrink-0" />
                                    <span>{describeOptionAllergens(option)}</span>
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
              <span
                className={cn(
                  'text-xs',
                  addableNow !== null && quantity >= addableNow ? 'font-medium text-rose-600 dark:text-rose-400' : 'text-muted-foreground',
                )}
              >
                {addableNow === null
                  ? 'Choose how many'
                  // "More" is only true while adding. An edit sets the whole line, so the number is
                  // what this line may hold, not what may be added on top of it.
                  : isEditing
                    ? `${addableNow} available`
                    : alreadyInCart > 0
                      ? `${addableNow} more available`
                      : `${addableNow} available`}
              </span>
            </div>
            <div className="flex w-fit items-center gap-2 rounded-full border bg-muted/20 p-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Decrease quantity"
                className="size-9"
                disabled={disabled || quantity <= 1 || isAdding}
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
                disabled={disabled || isAdding || (addableNow !== null && quantity >= addableNow)}
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
            <NoteHealthInfoNotice scope="item" />
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

function MenuItemTags({ item, compact = false }: { item: PublicMenuItem; compact?: boolean }) {
  const tags = getMenuItemTags(item)
  const visibleTags = compact ? tags.slice(0, 3) : tags

  if (visibleTags.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Dietary and menu tags">
      {visibleTags.map((tag) => (
        <Badge
          key={tag.label}
          variant="outline"
          className={cn(
            'h-auto rounded-full bg-background/80 px-2 py-0.5 text-[11px] font-medium',
            tag.tone === 'accent' && 'border-primary/25 bg-primary/10 text-primary',
            tag.tone === 'warning' && 'border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-100',
          )}
        >
          {tag.icon === 'sparkles' ? <Sparkles className="size-3" /> : null}
          {tag.icon === 'leaf' ? <Leaf className="size-3" /> : null}
          {tag.icon === 'flame' ? <Flame className="size-3" /> : null}
          {tag.label}
        </Badge>
      ))}
      {compact && tags.length > visibleTags.length ? (
        <Badge variant="outline" className="h-auto rounded-full px-2 py-0.5 text-[11px]">
          +{tags.length - visibleTags.length}
        </Badge>
      ) : null}
    </div>
  )
}

function getMenuItemTags(item: PublicMenuItem) {
  const tags: Array<{
    label: string
    icon?: 'sparkles' | 'leaf' | 'flame'
    tone?: 'accent' | 'warning'
  }> = []

  if (item.isRecommended) tags.push({ label: 'Recommended', icon: 'sparkles', tone: 'accent' })
  if (item.isPopular) tags.push({ label: 'Popular', tone: 'accent' })
  if (item.isVegan) {
    tags.push({ label: 'Vegan', icon: 'leaf' })
  } else if (item.isVegetarian) {
    tags.push({ label: 'Vegetarian', icon: 'leaf' })
  }
  if (item.isGlutenFree) tags.push({ label: 'Gluten-free' })
  if (item.isHalal) tags.push({ label: 'Halal' })
  if (item.spiceLevel > 0) {
    tags.push({
      label: ['', 'Mild', 'Medium spicy', 'Hot'][item.spiceLevel] ?? 'Spicy',
      icon: 'flame',
      tone: 'warning',
    })
  }

  return tags
}

function getMenuItemTagLabels(item: PublicMenuItem) {
  return getMenuItemTags(item).map((tag) => tag.label)
}

function matchesMenuFilters(item: PublicMenuItem, filters: MenuFilter[]) {
  return filters.every((filter) => {
    switch (filter) {
      case 'available':
        return item.isAvailable && !item.isSoldOut
      case 'popular':
        return item.isPopular
      case 'recommended':
        return item.isRecommended
      case 'vegetarian':
        return item.isVegetarian
      case 'vegan':
        return item.isVegan
      case 'glutenFree':
        return item.isGlutenFree
      case 'halal':
        return item.isHalal
      case 'spicy':
        return item.spiceLevel > 0
    }
  })
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

/**
 * Exported for the Clear-cart regression test. The confirmation this component guards is the only
 * thing standing between a tap and an emptied cart, so it is worth testing on its own rather than
 * only through the whole page.
 */
export function CartSummaryBar({
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
  // The server's own verdict, not a guess assembled from two flags here. Checkout would refuse
  // these, so offering the button would only produce a rejection the customer cannot act on.
  const unorderableItems = cart.items.filter((item) => item.isOrderable === false)
  const hasUnorderableItems = unorderableItems.length > 0
  const isReadOnly = cart.status !== 'Active'
  const [orderNoteHasUnsavedChanges, setOrderNoteHasUnsavedChanges] = useState(false)
  const [unsavedNoteDialogOpen, setUnsavedNoteDialogOpen] = useState(false)
  /**
   * How far the panel has been dragged down, in pixels. A bottom sheet that only closes from a
   * small chevron is a bottom sheet people fight with on a phone; swiping it away is the gesture
   * they already expect, and following the finger is what makes it feel like one rather than a
   * hidden shortcut.
   */
  const [dragOffset, setDragOffset] = useState(0)
  // Rendered from, so it is state rather than a ref: the transition below is chosen during render,
  // and a ref read there would not re-render when it changed.
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef<number | null>(null)
  // Far enough that a stray downward flick while reaching for Clear does not close the cart.
  const dismissThresholdPx = 80

  const handleDragStart = (event: React.TouchEvent) => {
    dragStartRef.current = event.touches[0]?.clientY ?? null
    setIsDragging(dragStartRef.current !== null)
  }

  const handleDragMove = (event: React.TouchEvent) => {
    const start = dragStartRef.current

    if (start === null) {
      return
    }

    // Downward only: dragging up should do nothing rather than lift the panel off the bottom.
    setDragOffset(Math.max(0, (event.touches[0]?.clientY ?? start) - start))
  }

  const handleDragEnd = () => {
    if (dragStartRef.current === null) {
      return
    }

    dragStartRef.current = null
    setIsDragging(false)

    if (dragOffset > dismissThresholdPx) {
      onOpenChange(false)
    }

    // Reset either way: on dismissal the panel unmounts, and otherwise it springs back.
    setDragOffset(0)
  }

  const requestCheckout = () => {
    if (orderNoteHasUnsavedChanges) {
      setUnsavedNoteDialogOpen(true)
      return
    }

    onCheckout()
  }

  return (
    // Pinned to the bottom, so anything taller than the screen overflows off the *top* — where
    // nothing can scroll to it. The panel used to be unbounded: a header, a list capped at 52svh
    // and a footer of note, total, button and terms easily exceeded the viewport on a phone, and
    // the cart's own heading, item count and Clear button ended up above the screen for good.
    <div className={cn(
      'fixed bottom-0 z-20 flex max-h-dvh flex-col p-3',
      hasItems || open
        ? 'inset-x-0 border-t bg-background/85 shadow-[0_-18px_45px_rgba(0,0,0,0.08)] backdrop-blur-xl'
        : 'right-0',
    )}>
      <div className={cn('flex min-h-0 flex-col gap-3', hasItems || open ? 'mx-auto w-full max-w-6xl' : 'items-end')}>
        {open ? (
          <Card
            className="flex min-h-0 flex-col overflow-hidden rounded-3xl border shadow-2xl shadow-black/10"
            style={{
              transform: dragOffset ? `translateY(${dragOffset}px)` : undefined,
              // Only while the finger is up, so the panel tracks the drag exactly and springs back
              // smoothly when released.
              transition: isDragging ? undefined : 'transform 200ms ease-out',
            }}
          >
            <CardContent className="flex min-h-0 flex-col p-0">
              <div
                className="flex shrink-0 touch-pan-y flex-col gap-3 border-b bg-card p-4"
                onTouchStart={handleDragStart}
                onTouchMove={handleDragMove}
                onTouchEnd={handleDragEnd}
                onTouchCancel={handleDragEnd}
              >
                {/* The grab handle. Phone only: a swipe target nobody can see is a swipe target
                    nobody uses, and on a pointer device the chevron is the obvious control. */}
                <span
                  aria-hidden="true"
                  className="mx-auto -mt-1 h-1 w-10 shrink-0 rounded-full bg-border sm:hidden"
                />
              <div className="flex items-start justify-between gap-3">
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
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background/80 p-4">
                {hasItems ? (
                  <div className="space-y-3">
                    {cart.items.map((item) => (
                      <CartSummaryLine
                        key={item.id}
                        item={item}
                        menuItem={menuItemsById.get(item.menuItemId) ?? null}
                        // Excluding itself: this stepper sets the line's own quantity.
                        optionUnitsElsewhere={optionUnitsInCart(cart.items, item.id)}
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

                <div className="mt-3">
                  <CartOrderNoteEditor
                    note={cart.customerNote ?? ''}
                    isReadOnly={isReadOnly}
                    isSaving={isSavingNote}
                    onSave={onOrderNoteSave}
                    onDirtyChange={setOrderNoteHasUnsavedChanges}
                  />
                </div>
              </div>

              {/* Stays put: the total and the button are what the customer acts on, and they are
                  short enough to pin at any viewport height. */}
              {/* Capped in viewport units, not per cent: a percentage max-height needs a definite
                  height on the parent, and this parent is a flex item that has none — so it
                  resolved to nothing and the bar clipped instead of scrolling. On a normal phone
                  the cap is well above the bar's natural height and never engages. */}
              <div className="max-h-[50dvh] shrink-0 space-y-3 overflow-y-auto border-t bg-card p-4">
                <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted/35 px-4 py-3">
                  <span className="text-sm font-semibold text-muted-foreground">Total</span>
                  <PriceText value={cart.total} currencyFormatter={currencyFormatter} variant="total" />
                </div>

                {isReadOnly ? (
                  <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                    This cart is no longer editable.
                  </p>
                ) : null}

                {hasUnorderableItems ? (
                  <div className="flex gap-2 rounded-xl border border-amber-300/70 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-100">
                    <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                    <div>
                      <p className="font-semibold">
                        {unorderableItems.length === 1
                          ? 'One item can no longer be ordered'
                          : `${unorderableItems.length} items can no longer be ordered`}
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {unorderableItems.map((item) => (
                          <li key={item.id}>
                            {item.name} — {item.unavailableReason ?? 'No longer available.'}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1 text-xs">Remove them to continue.</p>
                    </div>
                  </div>
                ) : null}

                <Button
                  type="button"
                  className="h-12 w-full rounded-xl text-base shadow-sm"
                  disabled={!hasItems || isReadOnly || isCheckingOut || isClearingCart || isSavingNote || hasUnorderableItems}
                  onClick={requestCheckout}
                >
                  {isCheckingOut ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ArrowRight className="size-4" />
                  )}
                  {isCheckingOut ? 'Starting checkout…' : 'Go to checkout'}
                </Button>

                {/* Consent rides on the checkout action itself; the accepted versions are still
                    recorded against the order. */}
                <p className="text-center text-xs leading-5 text-muted-foreground">
                  Placing this order means you accept the <Link to="/terms/customer" target="_blank" className="underline">Customer Terms</Link> and acknowledge the <Link to="/privacy" target="_blank" className="underline">Privacy Policy</Link> and <Link to="/allergen-information" target="_blank" className="underline">allergen notice</Link>.
                </p>

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
          aria-label={hasItems ? 'Open cart' : 'Open empty cart'}
          className={cn(
            'rounded-2xl border border-border bg-card text-foreground shadow-lg shadow-black/10 hover:bg-muted',
            hasItems || open
              ? 'min-h-14 flex-1 justify-between px-5 py-3 text-base'
              : 'size-14 justify-center rounded-full p-0',
          )}
          onClick={() => onOpenChange(!open)}
        >
          <span className={cn('flex items-center', hasItems || open ? 'gap-3' : '')}>
            <span className="flex size-8 items-center justify-center rounded-md border bg-muted text-foreground">
              <ShoppingBag className="size-5" />
            </span>
            {hasItems || open ? <span className="font-heading text-lg font-semibold">Cart</span> : null}
            {hasItems || open ? (open ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />) : null}
          </span>
          {hasItems || open ? <span className="flex items-center gap-4">
            <Badge variant="secondary" className="h-7 min-w-7 justify-center rounded-full border bg-muted px-2 text-foreground">
              {cart.itemCount}
            </Badge>
            <PriceText value={cart.total} currencyFormatter={currencyFormatter} variant="bar" className="text-foreground" />
          </span> : null}
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
          {/* The moment the cross-contact limit actually matters is while an allergy is being
              typed into the note, not inside a checkbox further down the cart. */}
          <NoteHealthInfoNotice scope="order" />
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

function CartViewerButton({
  viewer,
  onLogout,
  menuPath,
}: {
  viewer: CartViewer
  onLogout: () => void
  /** Where "back to menu" should lead from the orders page. */
  menuPath: string
}) {
  const displayName = viewer?.fullName?.trim() || viewer?.email?.trim() || 'Guest'
  const canUseAdminArea = Boolean(viewer?.roles.some((role) =>
    ['PlatformOwner', 'RestaurantOwner', 'Admin', 'Staff'].includes(role),
  ))
  // Carried in the URL rather than in router state so it survives a reload — somebody who reloads
  // their orders page should not lose the way back to the menu they came from.
  const myOrdersPath = `/my-orders?returnTo=${encodeURIComponent(menuPath)}`

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
              <Link to={myOrdersPath}>
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
              <Link to={myOrdersPath}><ClipboardList />My Orders</Link>
            </Button>
            <Separator />
            <Button variant="ghost" className="justify-start" asChild>
              <Link to={`/login?returnTo=${encodeURIComponent(menuPath)}`}><LogIn />Sign in</Link>
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
  optionUnitsElsewhere,
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
  /** Lots of each tracked modifier the cart's other lines commit, so this stepper stops in time. */
  optionUnitsElsewhere: Map<string, number>
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
      <div className="grid min-w-0 grid-cols-[56px_minmax(0,1fr)] gap-3 sm:grid-cols-[56px_minmax(0,1fr)_auto]">
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
            <div className="mt-2 flex min-w-0 flex-wrap gap-1.5" aria-label="Selected options">
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
                  selectedInGroup - 1 >= optionDefinition.group.minSelections,
                )
                const canAdjustQuantity = Boolean(
                  optionDefinition &&
                  optionDefinition.option.maxQuantity > 1 &&
                  !isReadOnly &&
                  !isUpdating,
                )
                const canDecreaseOption = canAdjustQuantity && (optionQuantity > 1 || canRemoveOption)
                // The same two ceilings the item sheet applies. Capped at the recipe rule alone,
                // this stepper walks straight past a modifier the kitchen has run out of.
                const optionCeiling = optionDefinition
                  ? optionPerItemLimit(
                      optionDefinition.option.maxQuantity,
                      optionDefinition.option.remainingStock,
                      optionUnitsElsewhere.get(optionDefinition.option.id) ?? 0,
                      item.quantity,
                    )
                  : 0
                const canIncreaseOption = Boolean(
                  optionDefinition &&
                  canAdjustQuantity &&
                  optionQuantity < optionCeiling,
                )

                return (
                  <div
                    key={`${cartOption.menuItemOptionId ?? `${cartOption.groupNameSnapshot}:${cartOption.optionNameSnapshot}`}x${optionQuantity}`}
                    className="inline-flex max-w-full min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border border-border/70 bg-muted/30 px-2 py-1 text-xs leading-4"
                  >
                    <span className="min-w-0 break-words font-medium text-foreground">
                      <span className="text-muted-foreground">{cartOption.groupNameSnapshot}:</span>{' '}
                      {cartOption.optionNameSnapshot}
                    </span>

                    {canAdjustQuantity ? (
                      <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full border bg-background p-0.5 shadow-sm">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-5 rounded-full"
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
                        <span className="min-w-4 text-center text-[11px] font-semibold text-foreground">
                          {optionQuantity}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-5 rounded-full"
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
                      <span className="shrink-0 font-semibold text-foreground">x{optionQuantity}</span>
                    ) : null}

                    <span
                      className={cn(
                        'shrink-0 text-[11px] font-semibold',
                        cartOption.priceAdjustmentSnapshot === 0
                          ? 'text-muted-foreground'
                          : 'text-amber-800 dark:text-amber-200',
                      )}
                    >
                      {formatCartOptionPriceAdjustment(cartOption, currencyFormatter)}
                    </span>
                    {canRemoveOption && optionDefinition ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        // Framed for the same reason as the stepper beside it: a bare glyph on a
                        // tinted chip reads as decoration, and nobody presses decoration.
                        className="size-5 shrink-0 rounded-full border border-destructive/40 bg-background text-destructive shadow-sm hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`Remove ${cartOption.optionNameSnapshot}`}
                        disabled={isUpdating}
                        onClick={() => onOptionQuantityChange(
                          item,
                          optionDefinition.group,
                          optionDefinition.option,
                          0,
                        )}
                      >
                        <X className="size-3" />
                      </Button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : null}
          {item.note ? (
            <p className="line-clamp-2 rounded-md bg-muted/50 px-2 py-1 text-sm text-muted-foreground">
              {item.note}
            </p>
          ) : null}
        </div>

        <PriceText
          value={item.lineTotal}
          currencyFormatter={currencyFormatter}
          variant="cart"
          className="col-start-2 row-start-2 justify-self-start sm:col-start-3 sm:row-start-1 sm:justify-self-end"
        />
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

/**
 * How many portions of a limited dish are left.
 *
 * <p>
 * Shaped like the sold-out badge so the two read as the same kind of fact, but never shown beside
 * it: a sold-out dish has nothing to count. Amber belongs to sold out, so a dish running low takes
 * rose — the more urgent colour for the more urgent news — and a comfortable count stays neutral,
 * present but not shouting.
 * </p>
 */
function StockBadge({
  remainingStock,
  isSoldOut,
  alreadyInCart = 0,
  className,
  compact = false,
}: {
  remainingStock: number | null | undefined
  isSoldOut: boolean
  /** Portions this cart already holds, so the count reads as what is still takeable. */
  alreadyInCart?: number
  className?: string
  compact?: boolean
}) {
  const stock = describeStock(remainingStock, isSoldOut, alreadyInCart)

  if (!stock) {
    return null
  }

  const low = stock.tone === 'low'
  // Nothing left to take because the customer took it. Their own doing, not a shortage, so it
  // wears the brand colour rather than the warning one.
  const held = stock.tone === 'held'

  return (
    <div
      className={cn(
        'pointer-events-none flex w-fit items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide shadow-lg backdrop-blur',
        low && 'border-rose-200/80 bg-rose-50/95 text-rose-950 shadow-rose-950/10 dark:border-rose-400/30 dark:bg-rose-400/15 dark:text-rose-100',
        held && 'border-primary/25 bg-primary/10 text-primary shadow-primary/10 dark:bg-primary/20',
        !low && !held && 'border-border/70 bg-background/90 text-foreground/80 shadow-foreground/5',
        compact && 'px-2.5 py-1 text-[10px] leading-none tracking-[0.14em] shadow-md',
        className,
      )}
    >
      {stock.inCart > 0 ? (
        <ShoppingBag className={cn('shrink-0', compact ? 'size-2.5' : 'size-3')} />
      ) : (
        <span
          className={cn(
            'rounded-full',
            low ? 'bg-rose-500 shadow-[0_0_0_3px_rgba(244,63,94,0.18)]' : 'bg-muted-foreground/50',
            compact ? 'size-1' : 'size-1.5',
          )}
        />
      )}
      <span aria-hidden="true">
        {compact ? stock.shortLabel : stock.label}
        {/* On a thumbnail there is no room for "· 1 in cart", so the bag icon carries it. */}
        {compact && stock.inCart > 0 ? ` · ${stock.inCart}` : ''}
      </span>
      <span className="sr-only">{stock.srLabel}</span>
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
