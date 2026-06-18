import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowRight,
  ChefHat,
  ChevronDown,
  ChevronUp,
  Loader2,
  Minus,
  MapPin,
  MinusCircle,
  Plus,
  Search,
  ShoppingBag,
  Store,
  Trash2,
  Utensils,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  addCartItem,
  checkoutCart,
  deleteCartItem,
  getCart,
  joinCart,
  updateCartItem,
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
  type PublicOrderingContext,
} from '@/api/publicMenu'
import { createCartRealtimeClient, type CartRealtimeClient } from '@/realtime/cartConnection'
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
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type StoredCartSession = {
  cartId: string
  participantToken: string
  participantId: string
}

type CartViewer = Pick<AuthUser, 'fullName' | 'email' | 'avatarUrl'> | null

type CustomerMenuState =
  | { status: 'loading' }
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

export function CustomerMenuPage() {
  const { restaurantId, qrToken } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [state, setState] = useState<CustomerMenuState>({ status: 'loading' })
  const [search, setSearch] = useState('')
  const [activeCategoryId, setActiveCategoryId] = useState<string | 'all'>('all')
  const [addingItemId, setAddingItemId] = useState<string | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [cartActionItemId, setCartActionItemId] = useState<string | null>(null)
  const [checkingOut, setCheckingOut] = useState(false)
  const [selectedItem, setSelectedItem] = useState<PublicMenuItem | null>(null)
  const [selectedItemQuantity, setSelectedItemQuantity] = useState(1)
  const [selectedItemNote, setSelectedItemNote] = useState('')
  const [cartActivityBanners, setCartActivityBanners] = useState<Array<CartActivityBanner | null>>(
    Array.from({ length: cartActivityBannerLaneCount }, () => null),
  )
  const realtimeClientRef = useRef<CartRealtimeClient | null>(null)
  const latestCartRef = useRef<Cart | null>(null)
  const cartActivityBannerTimeoutsRef = useRef<number[]>([])

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

        const [menu, cartSession] = await Promise.all([
          getPublicRestaurantMenu(context.restaurant.id),
          loadOrJoinCart(context, restaurantId ? `restaurant:${restaurantId}` : `table:${qrToken}`),
        ])

        if (cancelled) {
          return
        }

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
      onCartUpdated: ({ cart }) => {
        if (cart) {
          latestCartRef.current = cart
          setState((current) =>
            current.status === 'ready' ? { ...current, cart } : current,
          )
        }
      },
      onCartItemAdded: (update) => {
        if (update.actorParticipantId === state.participantId) {
          return
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

          return [item.name, item.description ?? '']
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

  if (state.status === 'loading') {
    return <CustomerMenuLoading />
  }

  if (state.status === 'error') {
    return <CustomerMenuError title={state.title} message={state.message} />
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
  }

  const closeItemDetail = () => {
    if (!addingItemId) {
      setSelectedItem(null)
      setSelectedItemQuantity(1)
      setSelectedItemNote('')
    }
  }

  const addItem = async (item: PublicMenuItem, quantity = 1, note = '') => {
    if (item.isSoldOut || !item.isAvailable || addingItemId) {
      return false
    }

    setAddingItemId(item.id)
    const normalizedNote = note.trim()

    try {
      const updatedCart = await addCartItem(cart.id, participantToken, {
        menuItemId: item.id,
        quantity,
        ...(normalizedNote ? { note: normalizedNote } : {}),
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

    const added = await addItem(selectedItem, selectedItemQuantity, selectedItemNote)

    if (added) {
      closeItemDetail()
    }
  }

  const updateCartLineQuantity = async (item: CartItem, nextQuantity: number) => {
    if (cart.status !== 'Active' || cartActionItemId) {
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
    if (cart.status !== 'Active' || cartActionItemId) {
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

  const handleCheckout = async () => {
    if (checkingOut) return
    setCheckingOut(true)
    try {
      const result = await checkoutCart(cart.id, participantToken)
      navigate('/checkout', {
        state: {
          order: result.order,
          cartId: cart.id,
          participantToken,
          currency: context.restaurant.currency,
          restaurantName: context.restaurant.name,
          tableNumber: context.table?.tableNumber ?? null,
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
              <Badge variant="outline" className="h-7 gap-1.5 px-3 text-sm">
                {context.table ? <Utensils className="size-3.5" /> : <ShoppingBag className="size-3.5" />}
                {context.table ? `Table ${context.table.tableNumber}` : 'Takeaway'}
              </Badge>
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground">DineFlow</p>
                <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">
                  {context.restaurant.name}
                </h1>
              </div>
            </div>
            <div className="flex size-12 shrink-0 items-center justify-center rounded-full border bg-muted/60">
              <ChefHat className="size-6" />
            </div>
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
        viewer={user}
        currencyFormatter={currencyFormatter}
        open={cartOpen}
        updatingItemId={cartActionItemId}
        isCheckingOut={checkingOut}
        onOpenChange={setCartOpen}
        onQuantityChange={updateCartLineQuantity}
        onRemoveItem={removeCartLine}
        onCheckout={() => void handleCheckout()}
      />

      <ItemDetailOverlay
        item={selectedItem}
        quantity={selectedItemQuantity}
        note={selectedItemNote}
        currencyFormatter={currencyFormatter}
        isAdding={selectedItem ? addingItemId === selectedItem.id : false}
        onClose={closeItemDetail}
        onQuantityChange={setSelectedItemQuantity}
        onNoteChange={setSelectedItemNote}
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
      : { restaurantId: context.restaurant.id },
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
  return `${item.menuItemId}:${item.note ?? ''}`
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
  currencyFormatter,
  isAdding,
  onClose,
  onQuantityChange,
  onNoteChange,
  onAddToCart,
}: {
  item: PublicMenuItem | null
  quantity: number
  note: string
  currencyFormatter: Intl.NumberFormat
  isAdding: boolean
  onClose: () => void
  onQuantityChange: (quantity: number) => void
  onNoteChange: (note: string) => void
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
    : 'Choose quantity and add optional item notes.'

  if (isMobile) {
    return (
      <Drawer open onOpenChange={handleOpenChange}>
        <DrawerContent className="max-h-[88svh]">
          <DrawerHeader className="text-left">
            <DrawerTitle className="text-xl leading-tight">{item.name}</DrawerTitle>
            <DrawerDescription>{description}</DrawerDescription>
          </DrawerHeader>
          <ItemDetailContent
            item={item}
            quantity={quantity}
            note={note}
            currencyFormatter={currencyFormatter}
            isAdding={isAdding}
            onQuantityChange={onQuantityChange}
            onNoteChange={onNoteChange}
            onAddToCart={onAddToCart}
            className="min-h-0 overflow-y-auto px-4 pb-4"
          />
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="px-5 pt-5 pr-12">
          <DialogTitle className="text-xl leading-tight">{item.name}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ItemDetailContent
          item={item}
          quantity={quantity}
          note={note}
          currencyFormatter={currencyFormatter}
          isAdding={isAdding}
          onQuantityChange={onQuantityChange}
          onNoteChange={onNoteChange}
          onAddToCart={onAddToCart}
          className="max-h-[calc(90svh-5.5rem)] overflow-y-auto px-5 pb-5"
        />
      </DialogContent>
    </Dialog>
  )
}

function ItemDetailContent({
  item,
  quantity,
  note,
  currencyFormatter,
  isAdding,
  onQuantityChange,
  onNoteChange,
  onAddToCart,
  className,
}: {
  item: PublicMenuItem
  quantity: number
  note: string
  currencyFormatter: Intl.NumberFormat
  isAdding: boolean
  onQuantityChange: (quantity: number) => void
  onNoteChange: (note: string) => void
  onAddToCart: () => Promise<void> | void
  className?: string
}) {
  const disabled = item.isSoldOut || !item.isAvailable
  const imageUrl = resolvePublicAssetUrl(item.imageUrl)
  const lineTotal = item.price * quantity

  return (
    <div className={cn('space-y-5', className)}>
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
          </div>

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
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 -mx-4 border-t bg-popover/95 px-4 pb-1 pt-4 backdrop-blur sm:static sm:mx-0 sm:bg-transparent sm:px-0 sm:pb-0">
        <Button
          type="button"
          className="h-12 w-full rounded-lg text-base"
          disabled={disabled || isAdding}
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

function CartSummaryBar({
  cart,
  viewer,
  currencyFormatter,
  open,
  updatingItemId,
  isCheckingOut,
  onOpenChange,
  onQuantityChange,
  onRemoveItem,
  onCheckout,
}: {
  cart: Cart
  viewer: CartViewer
  currencyFormatter: Intl.NumberFormat
  open: boolean
  updatingItemId: string | null
  isCheckingOut: boolean
  onOpenChange: (open: boolean) => void
  onQuantityChange: (item: CartItem, nextQuantity: number) => Promise<void> | void
  onRemoveItem: (item: CartItem) => Promise<void> | void
  onCheckout: () => void
}) {
  const hasItems = cart.items.length > 0
  const isReadOnly = cart.status !== 'Active'

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-3 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-col gap-3">
        {open ? (
          <Card className="overflow-hidden rounded-lg shadow-lg">
            <CardContent className="p-0">
              <div className="flex items-start justify-between gap-3 border-b p-4">
                <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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

                  <CartViewerPill viewer={viewer} />
                </div>

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
                  disabled={!hasItems || isReadOnly || isCheckingOut}
                  onClick={onCheckout}
                >
                  {isCheckingOut ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ArrowRight className="size-4" />
                  )}
                  {isCheckingOut ? 'Starting checkout…' : 'Go to checkout'}
                </Button>
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
      <Avatar>
        {viewer.avatarUrl ? (
          <AvatarImage src={viewer.avatarUrl} alt={`${displayName} avatar`} />
        ) : null}
        <AvatarFallback>{getInitials(displayName)}</AvatarFallback>
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
