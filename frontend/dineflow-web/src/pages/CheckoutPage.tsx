import { useEffect, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Banknote, CheckCircle, CreditCard, Loader2, Receipt, ShoppingBag, Utensils } from 'lucide-react'
import { toast } from 'sonner'
import { createPublicPaymentSession, selectOrderPaymentMethod, type SubmittedOrder } from '@/api/carts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { rememberGuestOrder } from '@/lib/guestOrders'

export type CheckoutNavigationState = {
  order: SubmittedOrder
  cartId: string
  participantToken: string
  currency: string
  restaurantName: string
  tableNumber: string | null
  paymentPolicy: 'PrepayRequired' | 'PayAtCounterAllowed'
  returnPath?: string
}

type PageState =
  | { status: 'ready' }
  | { status: 'paying'; method: 'online' | 'counter' }
  | { status: 'pay_offline' }
  | { status: 'error'; message: string }

export function CheckoutPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const routerState = location.state as CheckoutNavigationState | null
  const [pageState, setPageState] = useState<PageState>({ status: 'ready' })

  useEffect(() => {
    rememberGuestOrder(routerState?.order.id)
  }, [routerState?.order.id])

  if (!routerState?.order) {
    return <Navigate to="/" replace />
  }

  const { order, cartId, participantToken, currency, restaurantName, tableNumber, paymentPolicy } = routerState
  const returnPath = routerState.returnPath ?? (order.restaurantId ? `/r/${encodeURIComponent(order.restaurantId)}/menu` : '/')
  const isDineIn = order.orderType === 0
  const displayedTableNumber = order.tableNumber ?? tableNumber
  const orderScope = displayedTableNumber
    ? `Table ${displayedTableNumber}`
    : isDineIn
      ? 'Dine in'
      : 'Takeaway'
  const currencyFormatter = createCurrencyFormatter(currency)

  const handlePay = async () => {
    setPageState({ status: 'paying', method: 'online' })
    try {
      const result = await createPublicPaymentSession(cartId, participantToken)
      rememberGuestOrder(result.orderId)
      window.location.assign(result.checkoutUrl)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start payment'
      setPageState({ status: 'error', message })
      toast.error('Payment failed', { description: message })
    }
  }

  const handlePayAtCounter = async () => {
    setPageState({ status: 'paying', method: 'counter' })
    try {
      const result = await selectOrderPaymentMethod(cartId, participantToken, 'PayAtCounter')
      rememberGuestOrder(result.order.id)
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
          </CardContent>
        </Card>

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
          disabled={isPaying}
          onClick={() => void handlePay()}
        >
          {isOnlinePaying ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <CreditCard className="size-5" />
          )}
          {isOnlinePaying
            ? 'Redirecting to payment...'
            : `Pay ${currencyFormatter.format(order.totalAmount)}`}
        </Button>

        {paymentPolicy === 'PayAtCounterAllowed' ? (
          <Button
            type="button"
            variant="outline"
            className="h-auto min-h-14 w-full items-center justify-center gap-3 rounded-xl px-5 py-2.5 text-left font-normal"
            disabled={isPaying}
            onClick={() => void handlePayAtCounter()}
          >
            <span className="flex size-5 shrink-0 items-center justify-center">
              {isCounterPaying ? <Loader2 className="size-5 animate-spin" /> : <Banknote className="size-5" />}
            </span>
            <span className="flex flex-col items-start gap-0.5 leading-none">
              <span className="text-base font-medium leading-5">
                {isDineIn ? 'Enjoy your meal now' : 'Place your order now'}
              </span>
              <span className="text-xs font-normal leading-4 text-muted-foreground">
                {isDineIn ? 'Pay at the counter when you are ready' : 'Pay at the counter when you pick it up'}
              </span>
            </span>
          </Button>
        ) : null}

        <p className="text-center text-xs leading-5 text-muted-foreground">
          {paymentPolicy === 'PrepayRequired'
            ? 'Online payment is required before the restaurant can process this order.'
            : 'Choose secure online payment or settle this order at the counter.'}
        </p>
      </div>
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
        <p className="font-heading truncate text-lg font-semibold leading-tight">
          {restaurantName}
          {tableNumber ? (
            <span className="font-sans text-sm font-normal text-muted-foreground"> · Table {tableNumber}</span>
          ) : null}
        </p>
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
