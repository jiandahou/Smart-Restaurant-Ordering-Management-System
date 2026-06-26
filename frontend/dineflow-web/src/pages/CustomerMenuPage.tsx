import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowRight,
  Check,
  ClipboardList,
  ChevronDown,
  ChevronUp,
  LayoutDashboard,
  Loader2,
  LogIn,
  LogOut,
  Minus,
  MapPin,
  MinusCircle,
  Plus,
  Search,
  ShoppingBag,
  Store,
  Trash2,
  Utensils,
  UserPlus,
  UserRound,
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
import { rememberGuestOrder } from '@/lib/guestOrders'
import { cn } from '@/lib/utils'

type StoredCartSession = {
  cartId: string
  participantToken: string
  participantId: string
}

type CartViewer = Pick<AuthUser, 'fullName' | 'email' | 'avatarUrl' | 'roles'> | null

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
  }, [restaurantId, qrToken])

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
    return <CustomerMenuError title={state.title} message={state.message} />
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
  const hasMenu = menu.categories.some((category) => category.items.length > 0)
  const categorySummaries = menu.categories.map((category) => ({
    id: category.id,
    name: category.name,
    count: category.items.length,
  }))

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
    }
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

  const addSelectedItem = async () => {
    if (!selectedItem) {
      return
    }

    const validationMessage = getOptionSelectionError(selectedItem, selectedOptionIds)

    if (validationMessage) {
      toast.error(validationMessage)
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
    if (cart.status !== 'Active' || cartActionItemId || clearingCart) {
      return
    }

    if (nextQuantity < 1) {
      return
    }

    setCartActionItemId(item.id)

    try {
      const updatedCart = await updateCartItem(cart.id, item.id, participantToken, {
        quantity: nextQuantity,
        ...(item.note ? { note: item.note } : {}),
      })

      latestCartRef.current = updatedCart
      setState((current) =>
        current.status === 'ready' ? { ...current, cart: updatedCart } : current,
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update cart')
    } finally {
      setCartActionItemId(null)
    }
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
        <header className="flex flex-col gap-4 border-b pb-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              {context.table ? (
                <Badge variant="outline" className="h-7 gap-1.5 px-3 text-sm">
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
                  <SelectTrigger size="sm" aria-label="Order type" className="rounded-full px-3">
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
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground">DineFlow</p>
                <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">
                  {context.restaurant.name}
                </h1>
              </div>
            </div>
            <CartViewerButton
              viewer={user}
              onLogout={() => {
                logout()
                navigate('/login')
              }}
            />
          </div>

          <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="flex min-w-0 items-center gap-2">
              <MapPin className="size-4 shrink-0" />
              <span className="truncate">{context.restaurant.address || 'Restaurant address unavailable'}</span>
            </div>
            <span>{context.restaurant.currency}</span>
          </div>
        </header>

        <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-2 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-3 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-5">
          <CategorySidebar
            categories={categorySummaries}
            activeCategoryId={activeCategoryId}
            onSelect={scrollToCategory}
          />

          <div className="min-w-0 space-y-5">
            <div className="sticky top-0 z-10 -mx-1 border-b bg-background/95 px-1 py-3 backdrop-blur">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value)
                    setActiveCategoryId('all')
                  }}
                  placeholder="Search menu"
                  className="h-11 pl-9"
                />
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
        open={cartOpen}
        updatingItemId={cartActionItemId}
        isClearingCart={clearingCart}
        isSavingNote={savingCartNote}
        isCheckingOut={checkingOut}
        onOpenChange={setCartOpen}
        onQuantityChange={updateCartLineQuantity}
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
    .map((option) => `${option.menuItemOptionId ?? `${option.groupNameSnapshot}:${option.optionNameSnapshot}`}×${option.quantity ?? 1}`)
    .join(',')

  return `${item.menuItemId}:${optionKey}:${item.note ?? ''}`
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
  return (
    <aside className="sticky top-3 h-[calc(100svh-7rem)] overflow-hidden rounded-lg border bg-card">
      <div className="flex h-full flex-col">
        <div className="border-b px-1.5 py-2.5 sm:px-3 sm:py-3">
          <p className="hidden text-xs font-semibold uppercase text-muted-foreground sm:block">
            Categories
          </p>
          <p className="text-center text-xs font-semibold uppercase text-muted-foreground sm:hidden">
            Menu
          </p>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto p-1.5 sm:p-2">
          <button
            type="button"
            title="All"
            aria-label="All categories"
            className={cn(
              'flex min-h-11 w-full items-center justify-start gap-2 rounded-md px-3 text-sm font-medium transition-colors sm:justify-between',
              activeCategoryId === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
            onClick={() => onSelect('all')}
          >
            <span className="truncate">All</span>
            <Badge
              variant={activeCategoryId === 'all' ? 'secondary' : 'outline'}
              className="hidden shrink-0 sm:inline-flex"
            >
              {categories.reduce((total, category) => total + category.count, 0)}
            </Badge>
          </button>

          <div className="mt-1 space-y-1">
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                title={category.name}
                aria-label={category.name}
                className={cn(
                  'flex min-h-12 w-full items-center justify-start gap-2 rounded-md px-3 text-sm font-medium transition-colors sm:min-h-11 sm:justify-between',
                  activeCategoryId === category.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
                onClick={() => onSelect(category.id)}
              >
                <span className="line-clamp-2 min-w-0 text-left text-[13px] leading-tight sm:truncate sm:text-sm">
                  {category.name}
                </span>
                <Badge
                  variant={activeCategoryId === category.id ? 'secondary' : 'outline'}
                  className="hidden shrink-0 sm:inline-flex"
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
    <section id={getCategorySectionId(category.id)} className="scroll-mt-20 space-y-3">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">{category.name}</h2>
        {category.description ? (
          <p className="text-sm text-muted-foreground">{category.description}</p>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {category.items.map((item) => {
          const disabled = item.isSoldOut || !item.isAvailable
          const imageUrl = resolvePublicAssetUrl(item.imageUrl)

          return (
            <Card
              key={item.id}
              role="button"
              tabIndex={0}
              className={cn(
                'rounded-lg py-0 transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                disabled && 'bg-muted/35 text-muted-foreground',
              )}
              onClick={() => onOpenItem(item)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onOpenItem(item)
                }
              }}
            >
              <CardContent className="grid gap-2 p-2 sm:gap-3 sm:p-3 lg:grid-cols-[112px_minmax(0,1fr)]">
                <div className="relative aspect-[4/3] overflow-hidden rounded-md border bg-muted lg:aspect-square">
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
                      <Store className="size-7 text-muted-foreground" />
                    </div>
                  )}
                  {item.isSoldOut ? (
                    <Badge className="absolute left-1.5 top-1.5" variant="destructive">
                      Sold out
                    </Badge>
                  ) : null}
                </div>

                <div className="flex min-w-0 flex-col gap-3 lg:min-h-[112px]">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                      <h3 className="min-w-0 text-base font-semibold leading-snug">
                        <span className="line-clamp-2 break-words">{item.name}</span>
                      </h3>
                      <span className="max-w-[7.5rem] shrink-0 text-right text-sm font-semibold leading-snug sm:max-w-[8rem] sm:text-base">
                        {currencyFormatter.format(item.price)}
                      </span>
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
                      className="h-9 min-w-20 px-3 sm:min-w-24"
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
                      {disabled ? 'Unavailable' : 'Add'}
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
    : item.optionGroups?.length
      ? 'Choose your options, quantity, and any item notes.'
      : 'Choose quantity and add optional item notes.'

  if (isMobile) {
    return (
      <Drawer open onOpenChange={handleOpenChange}>
        <DrawerContent className="max-h-[88svh] overflow-hidden">
          <DrawerHeader className="shrink-0 text-left">
            <DrawerTitle className="text-xl leading-tight">{item.name}</DrawerTitle>
            <DrawerDescription>{description}</DrawerDescription>
          </DrawerHeader>
          <ItemDetailContent
            item={item}
            quantity={quantity}
            note={note}
            selectedOptionIds={selectedOptionIds}
            currencyFormatter={currencyFormatter}
            isAdding={isAdding}
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
      <DialogContent className="flex max-h-[90svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 px-5 pt-5 pr-12 pb-4">
          <DialogTitle className="text-xl leading-tight">{item.name}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ItemDetailContent
          item={item}
          quantity={quantity}
          note={note}
          selectedOptionIds={selectedOptionIds}
          currencyFormatter={currencyFormatter}
          isAdding={isAdding}
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
  onQuantityChange: (quantity: number) => void
  onNoteChange: (note: string) => void
  onToggleOption: (group: PublicMenuOptionGroup, option: PublicMenuOption) => void
  onOptionQuantityChange: (group: PublicMenuOptionGroup, option: PublicMenuOption, quantity: number) => void
  onAddToCart: () => Promise<void> | void
  className?: string
  bodyClassName?: string
}) {
  const disabled = item.isSoldOut || !item.isAvailable
  const imageUrl = resolvePublicAssetUrl(item.imageUrl)
  const optionGroups = getAvailableOptionGroups(item)
  const selectedOptions = getOrderedSelectedOptions(item, selectedOptionIds)
  const optionSelectionError = getOptionSelectionError(item, selectedOptionIds)
  const unitPrice = calculateItemUnitPrice(item, selectedOptionIds)
  const lineTotal = unitPrice * quantity

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div className={cn('min-h-0 flex-1 overflow-y-auto', bodyClassName)}>
        <div className="grid gap-4 sm:grid-cols-[220px_minmax(0,1fr)]">
          <div className="relative aspect-[4/3] overflow-hidden rounded-lg border bg-muted sm:aspect-square">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              className={cn('size-full object-contain p-3', disabled && 'grayscale')}
            />
          ) : (
            <div className="flex size-full items-center justify-center">
              <Store className="size-10 text-muted-foreground" />
            </div>
          )}
          {item.isSoldOut ? (
            <Badge className="absolute left-3 top-3" variant="destructive">
              Sold out
            </Badge>
          ) : null}
          {!item.isAvailable && !item.isSoldOut ? (
            <Badge className="absolute left-3 top-3" variant="secondary">
              Unavailable
            </Badge>
          ) : null}
        </div>

        <div className="min-w-0 space-y-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-2xl font-semibold">{currencyFormatter.format(item.price)}</p>
              <Badge variant={disabled ? 'secondary' : 'outline'}>
                {disabled ? 'Not orderable' : 'Available'}
              </Badge>
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
                    {optionQuantity > 1 ? ` ×${optionQuantity}` : ''}
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
                  <div key={group.id} className="rounded-lg border bg-muted/20 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium leading-tight">{group.name}</p>
                        <p className="text-xs text-muted-foreground">{getSelectionRule(group)}</p>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          'rounded-full',
                          group.isRequired
                            ? 'border-amber-300 bg-amber-50 text-amber-900'
                            : 'bg-muted/50 text-muted-foreground',
                        )}
                      >
                        {group.isRequired ? 'Required' : 'Optional'}
                      </Badge>
                    </div>

                    <div className="grid gap-2">
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
                              'flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-left transition-colors',
                              selected && 'border-primary bg-primary/5',
                              optionDisabled && 'cursor-not-allowed opacity-55',
                            )}
                          >
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                              disabled={optionDisabled}
                              onClick={() => onToggleOption(group, option)}
                            >
                              <span className={cn(
                                'flex size-5 shrink-0 items-center justify-center rounded-full border',
                                selected ? 'border-primary bg-primary text-primary-foreground' : 'bg-background',
                              )}>
                                {selected ? <Check className="size-3" /> : null}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold">{option.name}</span>
                                {option.maxQuantity > 1 ? (
                                  <span className="block text-xs text-muted-foreground">Max {option.maxQuantity}</span>
                                ) : null}
                              </span>
                            </button>
                            <span className="flex shrink-0 items-center gap-2 text-sm font-semibold text-muted-foreground">
                              {selected && option.maxQuantity > 1 ? (
                                <span className="flex items-center gap-1 rounded-full border bg-muted/40 p-0.5">
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
                              <span>{getOptionAdjustmentLabel(option, currencyFormatter)}</span>
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

          <div className="space-y-2">
            <p className="text-sm font-medium">Quantity</p>
            <div className="flex w-fit items-center gap-2 rounded-lg border bg-muted/20 p-1">
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

          <div className="space-y-2">
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

      <div className="shrink-0 border-t bg-popover/95 px-4 py-3 backdrop-blur sm:px-5">
        <Button
          type="button"
          className="h-12 w-full rounded-lg text-base"
          disabled={disabled || isAdding || Boolean(optionSelectionError)}
          onClick={() => void onAddToCart()}
        >
          {isAdding ? (
            <Loader2 className="size-4 animate-spin" />
          ) : disabled ? (
            <MinusCircle className="size-4" />
          ) : (
            <ShoppingBag className="size-4" />
          )}
          {disabled ? 'Unavailable' : `Add ${currencyFormatter.format(lineTotal)}`}
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
    <div className="space-y-2 rounded-lg border bg-background/70 p-2.5">
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
                    'h-auto min-h-7 rounded-full px-2.5 py-1 text-xs',
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
  open,
  updatingItemId,
  isClearingCart,
  isSavingNote,
  isCheckingOut,
  onOpenChange,
  onQuantityChange,
  onRemoveItem,
  onClearCart,
  onOrderNoteSave,
  onCheckout,
}: {
  cart: Cart
  currencyFormatter: Intl.NumberFormat
  open: boolean
  updatingItemId: string | null
  isClearingCart: boolean
  isSavingNote: boolean
  isCheckingOut: boolean
  onOpenChange: (open: boolean) => void
  onQuantityChange: (item: CartItem, nextQuantity: number) => Promise<void> | void
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
    <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-3 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-col gap-3">
        {open ? (
          <Card className="overflow-hidden rounded-lg shadow-lg">
            <CardContent className="p-0">
              <div className="flex items-start justify-between gap-3 border-b p-4">
                <div className="min-w-0 flex-1">
                  <div className="min-w-0 space-y-1">
                    <h2 className="flex items-center gap-2 text-lg font-semibold">
                      <ShoppingBag className="size-5" />
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

              <div className="max-h-[52svh] overflow-y-auto p-4">
                {hasItems ? (
                  <div className="space-y-3">
                    {cart.items.map((item) => (
                      <CartSummaryLine
                        key={item.id}
                        item={item}
                        currencyFormatter={currencyFormatter}
                        isReadOnly={isReadOnly}
                        isUpdating={updatingItemId === item.id}
                        onQuantityChange={onQuantityChange}
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

              <div className="space-y-3 border-t p-4">
                <CartOrderNoteEditor
                  note={cart.customerNote ?? ''}
                  isReadOnly={isReadOnly}
                  isSaving={isSavingNote}
                  onSave={onOrderNoteSave}
                  onDirtyChange={setOrderNoteHasUnsavedChanges}
                />

                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">Total</span>
                  <span className="text-xl font-semibold">
                    {currencyFormatter.format(cart.total)}
                  </span>
                </div>

                {isReadOnly ? (
                  <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                    This cart is no longer editable.
                  </p>
                ) : null}

                <Button
                  type="button"
                  className="h-11 w-full rounded-lg"
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
          className="min-h-14 flex-1 justify-between rounded-xl px-5 py-3 text-base"
          onClick={() => onOpenChange(!open)}
        >
          <span className="flex items-center gap-3">
            <span className="flex size-8 items-center justify-center rounded-md border border-primary-foreground/25 bg-primary-foreground/10">
              <ShoppingBag className="size-5" />
            </span>
            Cart
            {open ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </span>
          <span className="flex items-center gap-4">
            <Badge variant="secondary" className="h-7 min-w-7 justify-center rounded-full bg-primary-foreground px-2 text-primary">
              {cart.itemCount}
            </Badge>
            <span className="font-semibold">{currencyFormatter.format(cart.total)}</span>
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
  const [draft, setDraft] = useState(note)
  const [saveError, setSaveError] = useState<string | null>(null)
  const normalizedNote = note.trim()
  const normalizedDraft = draft.trim()
  const hasChanges = normalizedDraft !== normalizedNote

  useEffect(() => {
    setDraft(note)
    setSaveError(null)
  }, [note])

  useEffect(() => {
    onDirtyChange?.(open && hasChanges)
  }, [hasChanges, onDirtyChange, open])

  const handleCancel = () => {
    setDraft(note)
    setSaveError(null)
    setOpen(false)
  }

  const handleSave = async () => {
    setSaveError(null)

    try {
      await onSave(draft)
      setOpen(false)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save order note')
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
              setSaveError(null)
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
              setDraft(event.target.value)
              setSaveError(null)
            }}
          />
          <QuickNotePresetGroups
            groups={orderNotePresetGroups}
            note={draft}
            maxLength={orderNoteMaxLength}
            disabled={isReadOnly || isSaving}
            onNoteChange={(nextNote) => {
              setDraft(nextNote)
              setSaveError(null)
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
  currencyFormatter,
  isReadOnly,
  isUpdating,
  onQuantityChange,
  onRemoveItem,
}: {
  item: CartItem
  currencyFormatter: Intl.NumberFormat
  isReadOnly: boolean
  isUpdating: boolean
  onQuantityChange: (item: CartItem, nextQuantity: number) => Promise<void> | void
  onRemoveItem: (item: CartItem) => Promise<void> | void
}) {
  const itemUnavailable = !item.isAvailable || item.isSoldOut

  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="min-w-0 font-semibold leading-tight">
              <span className="line-clamp-2 break-words">{item.name}</span>
            </p>
            {itemUnavailable ? (
              <Badge variant="destructive" className="shrink-0">
                Unavailable
              </Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {item.quantity} x {currencyFormatter.format(item.unitPrice)}
          </p>
          {item.selectedOptions.length > 0 ? (
            <div className="space-y-1 rounded-md bg-muted/35 px-2 py-1.5 text-sm text-muted-foreground">
              {item.selectedOptions.map((option) => (
                <div
                  key={`${option.menuItemOptionId ?? `${option.groupNameSnapshot}:${option.optionNameSnapshot}`}×${option.quantity ?? 1}`}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="min-w-0 truncate">
                    {option.groupNameSnapshot}: {option.optionNameSnapshot}
                    {(option.quantity ?? 1) > 1 ? ` ×${option.quantity ?? 1}` : ''}
                  </span>
                  <span className="shrink-0">
                    {option.priceAdjustmentSnapshot === 0
                      ? 'Included'
                      : option.priceAdjustmentSnapshot * (option.quantity ?? 1) > 0
                        ? `+${currencyFormatter.format(option.priceAdjustmentSnapshot * (option.quantity ?? 1))}`
                        : currencyFormatter.format(option.priceAdjustmentSnapshot * (option.quantity ?? 1))}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {item.note ? (
            <p className="line-clamp-2 rounded-md bg-muted/50 px-2 py-1 text-sm text-muted-foreground">
              {item.note}
            </p>
          ) : null}
        </div>

        <p className="shrink-0 text-right font-semibold">
          {currencyFormatter.format(item.lineTotal)}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-md border bg-muted/20 p-1">
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

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 text-destructive hover:text-destructive"
          disabled={isReadOnly || isUpdating}
          onClick={() => void onRemoveItem(item)}
        >
          {isUpdating ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          Remove
        </Button>
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
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-lg space-y-6">
        <div className="space-y-2 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Public ordering</p>
          <h1 className="text-3xl font-semibold">{context.restaurant.name}</h1>
          <p className="text-sm text-muted-foreground">How would you like to order today?</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {context.availableOrderTypes.includes('DineIn') ? (
            <Card><CardContent className="p-3">
              <Button type="button" variant="ghost" className="h-auto w-full flex-col items-start gap-3 whitespace-normal p-4 text-left" disabled={loading} onClick={() => onSelect('DineIn')}>
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
              <Button type="button" variant="ghost" className="h-auto w-full flex-col items-start gap-3 whitespace-normal p-4 text-left" disabled={loading} onClick={() => onSelect('Takeaway')}>
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

function CustomerMenuError({ title, message }: { title: string; message: string }) {
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

function createCurrencyFormatter(currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency || 'AUD',
  })
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
