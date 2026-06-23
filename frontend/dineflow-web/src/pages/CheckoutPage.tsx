import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { AlertCircle, Banknote, CheckCircle, CreditCard, Loader2, Receipt, ShoppingBag, Utensils } from 'lucide-react'
import { toast } from 'sonner'
import { createPublicPaymentSession, selectOrderPaymentMethod, type SubmittedOrder } from '@/api/carts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

export type CheckoutNavigationState = {
  order: SubmittedOrder
  cartId: string
  participantToken: string
  currency: string
  restaurantName: string
  tableNumber: string | null
  paymentPolicy: 'PrepayRequired' | 'PayAtCounterAllowed'
}

type PageState =
  | { status: 'ready' }
  | { status: 'paying' }
  | { status: 'pay_offline' }
  | { status: 'error'; message: string }

export function CheckoutPage() {
  const location = useLocation()
  const routerState = location.state as CheckoutNavigationState | null
  const [pageState, setPageState] = useState<PageState>({ status: 'ready' })

  if (!routerState?.order) {
    return <Navigate to="/" replace />
  }

  const { order, cartId, participantToken, currency, restaurantName, tableNumber, paymentPolicy } = routerState
  const isDineIn = order.orderType === 0
  const displayedTableNumber = order.tableNumber ?? tableNumber
  const orderScope = displayedTableNumber
    ? `Table ${displayedTableNumber}`
    : isDineIn
      ? 'Dine in'
      : 'Takeaway'
  const currencyFormatter = createCurrencyFormatter(currency)

  const handlePay = async () => {
    setPageState({ status: 'paying' })
    try {
      const result = await createPublicPaymentSession(cartId, participantToken)
      window.location.assign(result.checkoutUrl)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start payment'
      setPageState({ status: 'error', message })
      toast.error('Payment failed', { description: message })
    }
  }

  const handlePayAtCounter = async () => {
    setPageState({ status: 'paying' })
    try {
      await selectOrderPaymentMethod(cartId, participantToken, 'PayAtCounter')
      setPageState({ status: 'pay_offline' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not select counter payment'
      setPageState({ status: 'error', message })
      toast.error('Payment method could not be changed', { description: message })
    }
  }

  if (pageState.status === 'pay_offline') {
    return (
      <main className="flex min-h-svh flex-col items-center justify-start bg-background px-4 pt-8 pb-16">
        <div className="w-full max-w-lg space-y-5">
          <OrderContextHeader restaurantName={restaurantName} tableNumber={displayedTableNumber} isDineIn={isDineIn} />
          <Card>
            <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-green-100 text-green-600">
                <CheckCircle className="size-7" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-semibold">Order placed</h2>
                <p className="text-sm text-muted-foreground">
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

  return (
    <main className="flex min-h-svh flex-col items-center justify-start bg-background px-4 pt-8 pb-16">
      <div className="w-full max-w-lg space-y-5">
        <OrderContextHeader restaurantName={restaurantName} tableNumber={displayedTableNumber} isDineIn={isDineIn} />

        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Receipt className="size-4" />
                Order {order.orderNumber}
              </CardTitle>
              <Badge variant="outline">{orderScope}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              {order.orderItems.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    <p className="font-medium leading-snug">{item.itemNameSnapshot}</p>
                    {item.note ? (
                      <p className="text-xs text-muted-foreground">{item.note}</p>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right text-sm">
                    <span className="text-muted-foreground">{item.quantity} ×</span>{' '}
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
                  <p className="text-sm">{order.customerNote}</p>
                </div>
              </>
            ) : null}

            <Separator />

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="text-xl font-semibold">{currencyFormatter.format(order.totalAmount)}</span>
            </div>
          </CardContent>
        </Card>

        {pageState.status === 'error' ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{pageState.message}</p>
          </div>
        ) : null}

        <Button
          type="button"
          className="h-14 w-full rounded-xl text-base"
          disabled={isPaying}
          onClick={() => void handlePay()}
        >
          {isPaying ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <CreditCard className="size-5" />
          )}
          {isPaying
            ? 'Redirecting to payment…'
            : `Pay ${currencyFormatter.format(order.totalAmount)}`}
        </Button>

        {paymentPolicy === 'PayAtCounterAllowed' ? (
          <Button
            type="button"
            variant="outline"
            className="h-auto min-h-16 w-full items-start justify-center gap-3 rounded-xl px-5 py-3 text-left font-normal"
            disabled={isPaying}
            onClick={() => void handlePayAtCounter()}
          >
            <span className="flex size-5 shrink-0 items-center justify-center">
              <Banknote className="size-5" />
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

        <p className="text-center text-xs text-muted-foreground">
          {paymentPolicy === 'PrepayRequired'
            ? 'Online payment is required before the restaurant can process this order.'
            : 'Choose secure online payment or settle this order at the counter.'}
        </p>
      </div>
    </main>
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
      <div className="flex size-11 shrink-0 items-center justify-center rounded-full border bg-muted/60">
        {isDineIn ? <Utensils className="size-5" /> : <ShoppingBag className="size-5" />}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase text-muted-foreground">Checkout</p>
        <p className="truncate font-semibold leading-snug">
          {restaurantName}
          {tableNumber ? (
            <span className="font-normal text-muted-foreground"> · Table {tableNumber}</span>
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
