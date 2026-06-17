import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  AlertCircle,
  ChefHat,
  Loader2,
  MapPin,
  MinusCircle,
  Plus,
  Search,
  ShoppingBag,
  Store,
  Utensils,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  addCartItem,
  getCart,
  joinCart,
  type Cart,
} from '@/api/carts'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type StoredCartSession = {
  cartId: string
  participantToken: string
}

type CustomerMenuState =
  | { status: 'loading' }
  | { status: 'ready'; context: PublicOrderingContext; menu: PublicMenu; cart: Cart; participantToken: string }
  | { status: 'error'; title: string; message: string }

const cartSessionPrefix = 'dineflow.customer-cart'

export function CustomerMenuPage() {
  const { restaurantId, qrToken } = useParams()
  const [state, setState] = useState<CustomerMenuState>({ status: 'loading' })
  const [search, setSearch] = useState('')
  const [activeCategoryId, setActiveCategoryId] = useState<string | 'all'>('all')
  const [addingItemId, setAddingItemId] = useState<string | null>(null)
  const realtimeClientRef = useRef<CartRealtimeClient | null>(null)

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
    if (state.status !== 'ready') {
      void realtimeClientRef.current?.stop()
      realtimeClientRef.current = null
      return
    }

    const client = createCartRealtimeClient(state.cart.id, state.participantToken, {
      onCartUpdated: ({ cart }) => {
        if (cart) {
          setState((current) =>
            current.status === 'ready' ? { ...current, cart } : current,
          )
        }
      },
      onCartSubmitted: ({ cart }) => {
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
  }, [state.status === 'ready' ? state.cart.id : null, state.status === 'ready' ? state.participantToken : null])

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

  const addItem = async (item: PublicMenuItem) => {
    if (item.isSoldOut || !item.isAvailable || addingItemId) {
      return
    }

    setAddingItemId(item.id)

    try {
      const updatedCart = await addCartItem(cart.id, participantToken, {
        menuItemId: item.id,
        quantity: 1,
      })
      setState((current) =>
        current.status === 'ready' ? { ...current, cart: updatedCart } : current,
      )
      toast.success(`${item.name} added to cart`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add item')
    } finally {
      setAddingItemId(null)
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

        <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-3 sm:grid-cols-[180px_minmax(0,1fr)] lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-5">
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
                    addingItemId={addingItemId}
                    onAddItem={addItem}
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
        onClick={() => toast.info('Cart page is coming next.')}
      />
    </main>
  )
}

async function loadOrJoinCart(
  context: PublicOrderingContext,
  storageKeySuffix: string,
): Promise<{ cart: Cart; participantToken: string }> {
  const storageKey = `${cartSessionPrefix}.${storageKeySuffix}`
  const stored = readStoredCartSession(storageKey)

  if (stored) {
    try {
      const cart = await getCart(stored.cartId, stored.participantToken)

      if (cart.status === 'Active') {
        return { cart, participantToken: stored.participantToken }
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
    } satisfies StoredCartSession),
  )

  return joined
}

function readStoredCartSession(storageKey: string) {
  try {
    const rawValue = sessionStorage.getItem(storageKey)

    if (!rawValue) {
      return null
    }

    const parsed = JSON.parse(rawValue) as Partial<StoredCartSession>

    if (!parsed.cartId || !parsed.participantToken) {
      return null
    }

    return {
      cartId: parsed.cartId,
      participantToken: parsed.participantToken,
    }
  } catch {
    return null
  }
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
              'flex min-h-11 w-full items-center justify-center gap-2 rounded-md px-1.5 text-sm font-medium transition-colors sm:justify-between sm:px-3',
              activeCategoryId === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
            onClick={() => onSelect('all')}
          >
            <span className="hidden truncate sm:inline">All</span>
            <span className="text-sm font-semibold sm:hidden">All</span>
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
                  'flex min-h-11 w-full items-center justify-center gap-2 rounded-md px-1.5 text-sm font-medium transition-colors sm:justify-between sm:px-3',
                  activeCategoryId === category.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
                onClick={() => onSelect(category.id)}
              >
                <span className="hidden line-clamp-2 text-center leading-tight sm:block sm:truncate sm:text-left">
                  {category.name}
                </span>
                <span className="text-sm font-semibold uppercase sm:hidden">
                  {getCategoryShortLabel(category.name)}
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
  addingItemId,
  onAddItem,
}: {
  category: PublicMenuCategory
  currencyFormatter: Intl.NumberFormat
  addingItemId: string | null
  onAddItem: (item: PublicMenuItem) => void
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
              className={cn(
                'rounded-lg py-0',
                disabled && 'bg-muted/35 text-muted-foreground',
              )}
            >
              <CardContent className="grid gap-3 p-3 lg:grid-cols-[112px_minmax(0,1fr)]">
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
                      disabled={disabled || addingItemId === item.id}
                      className="h-9 min-w-24"
                      onClick={() => onAddItem(item)}
                    >
                      {addingItemId === item.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : disabled ? (
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

function CartSummaryBar({
  cart,
  currencyFormatter,
  onClick,
}: {
  cart: Cart
  currencyFormatter: Intl.NumberFormat
  onClick: () => void
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-3 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3">
        <Button
          type="button"
          className="h-12 flex-1 justify-between rounded-lg px-4"
          onClick={onClick}
        >
          <span className="flex items-center gap-2">
            <ShoppingBag className="size-5" />
            Cart
          </span>
          <span className="flex items-center gap-3">
            <Badge variant="secondary" className="bg-primary-foreground text-primary">
              {cart.itemCount}
            </Badge>
            {currencyFormatter.format(cart.total)}
          </span>
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

function getCategorySectionId(categoryId: string) {
  return `menu-category-${categoryId}`
}

function getCategoryShortLabel(name: string) {
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (words.length >= 2) {
    return words
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
  }

  return name.slice(0, 2)
}
