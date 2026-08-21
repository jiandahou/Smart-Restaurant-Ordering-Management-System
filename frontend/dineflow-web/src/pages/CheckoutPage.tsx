import { useEffect, useState } from 'react'
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Banknote, CheckCircle, CreditCard, Loader2, Receipt, ShoppingBag, Utensils } from 'lucide-react'
import { toast } from 'sonner'
import { createPublicPaymentSession, selectOrderPaymentMethod, type SubmittedOrder } from '@/api/carts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { rememberGuestOrder } from '@/lib/guestOrders'
import { buildRestaurantMenuPath } from '@/lib/customerMenuNavigation'
import { beginHostedCheckoutHandoff } from '@/lib/hostedCheckoutHandoff'
import { resolveCheckoutResumeState } from '@/lib/checkoutPageState'
import { buildCheckoutViewFromOrder, isCheckoutReopenable } from '@/lib/checkoutFromOrder'
import {
  changeOrderPaymentMethod,
  createOrderCheckoutSession,
  getGuestOrders,
  getMyOrders,
  getStoredToken,
} from '@/api/auth'
import { getStoredGuestOrders } from '@/lib/guestOrders'

export type CheckoutNavigationState = {
  order: SubmittedOrder
  cartId: string
  participantToken: string
  currency: string
  restaurantName: string
  restaurantLegalBusinessName: string
  restaurantAbn: string | null
  gstRegistered: boolean
  pricesIncludeGst: boolean
  refundContactEmail: string
  customerSurchargeNotice: string | null
  tableNumber: string | null
  paymentPolicy: 'PrepayRequired' | 'PayAtCounterAllowed'
  onlinePaymentsEnabled: boolean
  returnPath?: string
}

type PageState =
  | { status: 'ready' }
  | { status: 'paying'; method: 'online' | 'counter' }
  /** Checkout is open in another tab and this one is the way back if it goes wrong. */
  | { status: 'awaiting_online_payment' }
  | { status: 'pay_offline' }
  | { status: 'error'; message: string }

export function CheckoutPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const handedOver = location.state as CheckoutNavigationState | null
  /**
   * An order id in the URL means this page was reopened from My Orders or the menu prompt rather
   * than reached at the end of a cart. Everything it needs is on the order itself — except the
   * cart, which is why the payment actions below fall back to the order-level routes.
   */
  const reopenOrderId = searchParams.get('order')
  const [reopened, setReopened] = useState<CheckoutNavigationState | null>(null)
  const [reopenError, setReopenError] = useState<string | null>(null)
  const routerState = handedOver ?? reopened

  useEffect(() => {
    if (handedOver || !reopenOrderId) {
      return
    }

    let cancelled = false

    async function reopen() {
      try {
        // Read straight from storage rather than through the auth context: this page is mostly
        // used by guests, and pulling in Redux for one boolean would make it unmountable without
        // a store.
        const orders = getStoredToken()
          ? await getMyOrders()
          : await (async () => {
              const stored = getStoredGuestOrders()
              return stored.length > 0 ? await getGuestOrders(stored) : []
            })()
        const order = orders.find((candidate) => candidate.id === reopenOrderId)

        if (cancelled) return

        if (!order) {
          setReopenError('That order could not be found on this device.')
          return
        }

        if (!isCheckoutReopenable(order)) {
          setReopenError('This order has already been dealt with.')
          return
        }

        setReopened(buildCheckoutViewFromOrder(order) as unknown as CheckoutNavigationState)
      } catch (error) {
        if (!cancelled) {
          setReopenError(error instanceof Error ? error.message : 'Could not load this order.')
        }
      }
    }

    void reopen()

    return () => {
      cancelled = true
    }
  }, [handedOver, reopenOrderId])
  // Derived, not defaulted: a refresh must not offer to take payment for an order the customer
  // already chose to settle at the counter.
  const [pageState, setPageState] = useState<PageState>(
    () => ({ status: resolveCheckoutResumeState(routerState?.order) }),
  )

  useEffect(() => {
    rememberGuestOrder(routerState?.order.id)
  }, [routerState?.order.id])

  if (!routerState?.order) {
    // Still fetching, or the fetch failed: either way there is nothing to bill for yet, and
    // redirecting mid-load would throw away an order the customer asked to reopen.
    if (reopenOrderId) {
      return <CheckoutReopenScreen error={reopenError} onLeave={() => navigate('/my-orders')} />
    }

    return <Navigate to="/" replace />
  }

  const {
    order,
    cartId,
    participantToken,
    currency,
    restaurantName,
    restaurantLegalBusinessName,
    restaurantAbn,
    gstRegistered,
    refundContactEmail,
    customerSurchargeNotice,
    tableNumber,
    paymentPolicy,
    onlinePaymentsEnabled,
  } = routerState
  const returnPath = routerState.returnPath
    ?? (order.restaurantId ? buildRestaurantMenuPath(order.restaurantId, order.orderType) : '/')
  const isDineIn = order.orderType === 0
  const displayedTableNumber = order.tableNumber ?? tableNumber
  const orderScope = displayedTableNumber
    ? `Table ${displayedTableNumber}`
    : isDineIn
      ? 'Dine in'
      : 'Takeaway'
  const currencyFormatter = createCurrencyFormatter(currency)

  /**
   * What proves a guest owns this order once the cart behind it is gone. Orders saved before tokens
   * existed are stored with a null one, which is the same as having none to send.
   */
  const guestAccessTokenForOrder = (): string | undefined =>
    getStoredGuestOrders().find((entry) => entry.orderId === order.id)?.guestAccessToken ?? undefined

  const handlePay = async () => {
    // Claimed before the await: browsers only honour window.open while the click is still being
    // handled, and creating the session is a round trip.
    const handoff = beginHostedCheckoutHandoff()
    setPageState({ status: 'paying', method: 'online' })
    try {
      // No cart when the page was reopened from an order, so the order-level route is used. It
      // reuses a live checkout session rather than minting a second one, same as the cart route.
      const result = cartId && participantToken
        ? await createPublicPaymentSession(cartId, participantToken)
        : await createOrderCheckoutSession({
            orderId: order.id,
            returnTo: returnPath,
            guestAccessToken: guestAccessTokenForOrder(),
          })
      rememberGuestOrder(result.orderId)

      if (handoff.complete(result.checkoutUrl) === 'new-tab') {
        // This page survives, so a customer who meets Stripe's expired dead end still has somewhere
        // to come back to. When the popup was blocked we are navigating away and must not touch
        // state — there is no page left to render it on.
        setPageState({ status: 'awaiting_online_payment' })
      }
    } catch (error) {
      handoff.abort()
      const message = error instanceof Error ? error.message : 'Could not start payment'
      setPageState({ status: 'error', message })
      toast.error('Payment failed', { description: message })
    }
  }

  const handlePayAtCounter = async () => {
    setPageState({ status: 'paying', method: 'counter' })
    try {
      const updated = cartId && participantToken
        ? (await selectOrderPaymentMethod(cartId, participantToken, 'PayAtCounter')).order
        : await changeOrderPaymentMethod(order.id, 'PayAtCounter', guestAccessTokenForOrder())
      const result = { order: updated }
      rememberGuestOrder(result.order.id)
      // Written back into history state so a reload reads the order as it now stands. Without this
      // the page would reopen from the snapshot taken at checkout, which still says Online.
      navigate(location.pathname, {
        replace: true,
        state: { ...routerState, order: result.order } satisfies CheckoutNavigationState,
      })
      setPageState({ status: 'pay_offline' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not select counter payment'
      setPageState({ status: 'error', message })
      toast.error('Payment method could not be changed', { description: message })
    }
  }

  const handleBack = () => {
    navigate(returnPath)
  }

  if (pageState.status === 'awaiting_online_payment') {
    return (
      <main className="flex min-h-svh flex-col items-center justify-start bg-background px-4 pt-6 pb-12">
        <div className="w-full max-w-lg space-y-4">
          <CheckoutBackButton onClick={handleBack} />
          <OrderContextHeader restaurantName={restaurantName} tableNumber={displayedTableNumber} isDineIn={isDineIn} />
          <Card size="sm">
            <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                <CreditCard className="size-6" />
              </div>
              <div className="space-y-1">
                <h2 className="font-heading text-lg font-semibold">Payment opened in a new tab</h2>
                <p className="text-sm leading-5 text-muted-foreground">
                  Finish paying for <span className="font-medium text-foreground">{order.orderNumber}</span> there.
                  Keep this page open — if the payment page expires or you close it by mistake, come back here.
                </p>
              </div>
              <Badge variant="secondary" className="h-8 px-3 text-sm">
                {currencyFormatter.format(order.totalAmount)}
              </Badge>
              <div className="flex w-full flex-col gap-2">
                <Button
                  type="button"
                  className="h-12 w-full rounded-xl"
                  onClick={() => void handlePay()}
                >
                  Start payment again
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 w-full rounded-xl"
                  onClick={() => navigate('/my-orders')}
                >
                  <Receipt className="size-4" />
                  Check this order
                </Button>
              </div>
              <p className="text-xs leading-4 text-muted-foreground">
                Starting again replaces the previous payment page, so you are only ever asked to pay once.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    )
  }

  if (pageState.status === 'pay_offline') {
    return (
      <main className="flex min-h-svh flex-col items-center justify-start bg-background px-4 pt-6 pb-12">
        <div className="w-full max-w-lg space-y-4">
          <CheckoutBackButton onClick={handleBack} />
          <OrderContextHeader restaurantName={restaurantName} tableNumber={displayedTableNumber} isDineIn={isDineIn} />
          <Card size="sm">
            <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-green-100 text-green-600">
                <CheckCircle className="size-6" />
              </div>
              <div className="space-y-1">
                <h2 className="font-heading text-lg font-semibold">Order placed</h2>
                <p className="text-sm leading-5 text-muted-foreground">
                  Your order <span className="font-medium text-foreground">{order.orderNumber}</span> has been
                  received. {isDineIn
                    ? 'Enjoy your meal and pay at the counter when you are ready.'
                    : 'We will prepare it now. Pay at the counter when you pick it up.'}
                </p>
              </div>
              <Badge variant="secondary" className="h-8 px-3 text-sm">
                {currencyFormatter.format(order.totalAmount)}
              </Badge>
            </CardContent>
          </Card>
        </div>
      </main>
    )
  }

  const isPaying = pageState.status === 'paying'
  const isOnlinePaying = pageState.status === 'paying' && pageState.method === 'online'
  const isCounterPaying = pageState.status === 'paying' && pageState.method === 'counter'

  return (
    <main className="flex min-h-svh flex-col items-center justify-start bg-background px-4 pt-6 pb-12">
      <div className="w-full max-w-lg space-y-4">
        <CheckoutBackButton onClick={handleBack} />
        <OrderContextHeader restaurantName={restaurantName} tableNumber={displayedTableNumber} isDineIn={isDineIn} />

        <Card size="sm">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Receipt className="size-4" />
                Order {order.orderNumber}
              </CardTitle>
              <Badge variant="outline">{orderScope}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2.5">
              {order.orderItems.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium leading-snug">{item.itemNameSnapshot}</p>
                    {item.selectedOptions.length > 0 ? (
                      <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs leading-5 text-muted-foreground">
                        {item.selectedOptions.map((option, index) => (
                          <span key={`${option.menuItemOptionId ?? `${option.groupNameSnapshot}:${option.optionNameSnapshot}`}-${index}`}>
                            {option.groupNameSnapshot}: {option.optionNameSnapshot}
                            {(option.quantity ?? 1) > 1 ? ` x${option.quantity ?? 1}` : ''}
                            {option.priceAdjustmentSnapshot === 0
                              ? ''
                              : ` (${option.priceAdjustmentSnapshot * (option.quantity ?? 1) > 0 ? '+' : ''}${currencyFormatter.format(option.priceAdjustmentSnapshot * (option.quantity ?? 1))})`}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {item.note ? (
                      <p className="text-xs leading-5 text-muted-foreground">{item.note}</p>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right text-sm tabular-nums">
                    <span className="text-muted-foreground">{item.quantity} x</span>{' '}
                    <span className="font-medium">{currencyFormatter.format(item.unitPrice)}</span>
                  </div>
                </div>
              ))}
            </div>

            {order.customerNote ? (
              <>
                <Separator />
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Order note</p>
                  <p className="text-sm leading-5">{order.customerNote}</p>
                </div>
              </>
            ) : null}

            <Separator />

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="font-heading text-2xl font-semibold leading-none tabular-nums">
                {currencyFormatter.format(order.totalAmount)}
              </span>
            </div>
            {/* Consumer prices in Australia are shown GST-inclusive, so the charged total is the
                only honest base — pricesIncludeGst does not change what was charged. */}
            {gstRegistered ? <p className="text-right text-xs text-muted-foreground">Total price includes GST</p> : null}
          </CardContent>
        </Card>

        <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground">
          <p>Supplier: {restaurantLegalBusinessName || restaurantName}{restaurantAbn ? ` · ABN ${restaurantAbn}` : ''}</p>
          {customerSurchargeNotice ? <p className="font-semibold text-foreground">{customerSurchargeNotice}</p> : null}
          {refundContactEmail ? <p>Refund enquiries: {refundContactEmail}</p> : null}
        </div>

        {pageState.status === 'error' ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="flex-1 space-y-2">
              <p className="text-sm text-destructive">{pageState.message}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPageState({ status: 'ready' })}
                className="h-7 border-destructive/40 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                Dismiss and try again
              </Button>
            </div>
          </div>
        ) : null}

        <Button
          type="button"
          className="h-12 w-full rounded-xl text-base"
          disabled={isPaying || !onlinePaymentsEnabled}
          onClick={() => void handlePay()}
        >
          {isOnlinePaying ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <CreditCard className="size-5" />
          )}
          {!onlinePaymentsEnabled
            ? 'Online payment unavailable'
            : isOnlinePaying
            ? 'Redirecting to payment...'
            : `Pay ${currencyFormatter.format(order.totalAmount)}`}
        </Button>

        {paymentPolicy === 'PayAtCounterAllowed' ? (
          <Button
            type="button"
            variant="outline"
            // Stacked so the icon travels with the title as one centred row, the way the online
            // button above carries its own icon and label. Keeping the icon beside the whole text
            // block instead let the wrapping second line stretch the block to full width, which
            // pinned the icon to the left edge and left the two choices visibly out of line.
            className="h-auto min-h-14 w-full flex-col justify-center gap-1 rounded-xl px-3 py-3 text-center font-normal whitespace-normal sm:px-5 sm:py-2.5"
            disabled={isPaying}
            onClick={() => void handlePayAtCounter()}
          >
            <span className="flex min-w-0 max-w-full items-center justify-center gap-2 sm:gap-3">
              <span className="flex size-5 shrink-0 items-center justify-center">
                {isCounterPaying ? <Loader2 className="size-5 animate-spin" /> : <Banknote className="size-5" />}
              </span>
              <span className="min-w-0 break-words text-base font-medium leading-5">
                {isDineIn ? 'Pay at counter after your meal' : 'Pay at counter on pickup'}
              </span>
            </span>
            <span className="w-full break-words text-xs font-normal leading-4 text-muted-foreground">
              {isDineIn ? 'Confirm this order now and settle the bill when you are ready' : 'Confirm this order now and pay when you collect it'}
            </span>
          </Button>
        ) : null}

        <p className="text-center text-xs leading-5 text-muted-foreground">
          {!onlinePaymentsEnabled
            ? paymentPolicy === 'PayAtCounterAllowed'
              ? 'Online payment is not configured yet. You can still place the order and pay at the counter.'
              : 'This restaurant must finish Stripe setup before it can accept prepaid orders.'
            : paymentPolicy === 'PrepayRequired'
            ? 'Online payment is required before the restaurant can process this order.'
            : 'Choose secure online payment or settle this order at the counter.'}
        </p>
        <p className="text-center text-xs leading-5 text-muted-foreground">
          Your acceptance was recorded when the order was submitted.{' '}
          <a className="underline" href="/terms/customer" target="_blank">Terms</a>
          {' · '}
          <a className="underline" href="/privacy" target="_blank">Privacy</a>
          {' · '}
          <a className="underline" href="/refunds-and-cancellations" target="_blank">Refunds &amp; cancellations</a>
          {' · '}
          <a className="underline" href="/allergen-information" target="_blank">Allergen information</a>
        </p>
      </div>
    </main>
  )
}

/**
 * Shown while an order is being fetched back, and when it cannot be.
 *
 * <p>
 * Redirecting on a failed load would silently drop the customer somewhere else with no idea why
 * the order they tapped did not open.
 * </p>
 */
function CheckoutReopenScreen({ error, onLeave }: { error: string | null; onLeave: () => void }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-background px-4">
      <Card size="sm" className="w-full max-w-sm">
        <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
          {error ? (
            <>
              <div className="flex size-12 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                <AlertCircle className="size-6" />
              </div>
              <p className="text-sm leading-5 text-muted-foreground">{error}</p>
              <Button type="button" className="h-11 w-full rounded-xl" onClick={onLeave}>
                Go to my orders
              </Button>
            </>
          ) : (
            <>
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
              <p className="text-sm leading-5 text-muted-foreground">Opening your order…</p>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  )
}

function CheckoutBackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="-ml-2 h-9 w-fit gap-2 rounded-full px-2 text-muted-foreground hover:text-foreground"
      onClick={onClick}
    >
      <ArrowLeft className="size-4" />
      Back to menu
    </Button>
  )
}

function OrderContextHeader({
  restaurantName,
  tableNumber,
  isDineIn,
}: {
  restaurantName: string
  tableNumber: string | null
  isDineIn: boolean
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full border bg-muted/60">
        {isDineIn ? <Utensils className="size-5" /> : <ShoppingBag className="size-5" />}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Checkout</p>
        {/* The page heading: a screen reader arriving here needs to know which restaurant and
            table this checkout belongs to, not just that it is a checkout. */}
        <h1 className="font-heading truncate text-lg font-semibold leading-tight">
          {restaurantName}
          {tableNumber ? (
            <span className="font-sans text-sm font-normal text-muted-foreground"> · Table {tableNumber}</span>
          ) : null}
        </h1>
      </div>
    </div>
  )
}

function createCurrencyFormatter(currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency || 'AUD',
  })
}
