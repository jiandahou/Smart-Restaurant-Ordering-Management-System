import { useState } from 'react'
import { ChevronDown, CreditCard, Loader2, Receipt, ShoppingBasket, XCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { describeRemaining, type UnpaidOrderPrompt } from '@/lib/unpaidOrderPrompt'

type Props = {
  prompt: UnpaidOrderPrompt | null
  currencyFormatter: Intl.NumberFormat
  /** Take the customer back to the payment screen for this order. */
  onContinue: () => void
  /** Cancel it now and put the food back on the menu. */
  onCancel: () => Promise<void>
  /** Dismissed — the order stands and expires on its own. */
  onDismiss: () => void
  /**
   * Copy the order's items into the live cart. Absent when there is nowhere to copy them to.
   *
   * <p>
   * Wanting the same meal again otherwise means finding every dish and option by hand, while the
   * unpaid order sits there holding exactly those portions.
   * </p>
   */
  onCopyToCart?: () => Promise<void>
  /**
   * Whether this restaurant can actually take a card right now.
   *
   * <p>
   * "Continue to payment" promises something the restaurant may not offer: with Stripe unconfigured
   * the only way to settle is at the counter, and sending someone off to pay would walk them into a
   * dead end. The checkout screen is where both choices live, so that is where they are sent — and
   * the label says so rather than naming a method that might not exist.
   * </p>
   */
  onlinePaymentsEnabled?: boolean
}

/**
 * Shown when a customer returns to the menu with an order they placed but never paid for.
 *
 * <p>
 * The order is holding stock and a pickup number. Without this, the customer starts a second order
 * on top of the first, and the food they are trying to buy is already reserved by an order they
 * have forgotten about. All three ways out are offered together, including doing nothing, because
 * doing nothing is a legitimate answer once its consequence is stated.
 * </p>
 */
export function UnpaidOrderDialog({
  prompt,
  currencyFormatter,
  onContinue,
  onCancel,
  onDismiss,
  onCopyToCart,
  onlinePaymentsEnabled = true,
}: Props) {
  const [cancelling, setCancelling] = useState(false)
  const [copying, setCopying] = useState(false)
  const busy = cancelling || copying

  if (!prompt) {
    return null
  }

  const { order, remainingMs } = prompt
  const itemCount = order.orderItems.reduce((total, line) => total + line.quantity, 0)

  const handleCancel = async () => {
    setCancelling(true)
    try {
      await onCancel()
    } finally {
      setCancelling(false)
    }
  }

  const handleCopy = async () => {
    if (!onCopyToCart) return
    setCopying(true)
    try {
      await onCopyToCart()
    } finally {
      setCopying(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) {
          onDismiss()
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>You have an order waiting to be paid</DialogTitle>
          <DialogDescription>
            Order <span className="font-medium text-foreground">{order.orderNumber}</span> for{' '}
            <span className="font-medium text-foreground">
              {currencyFormatter.format(order.totalAmount)}
            </span>{' '}
            was placed but not paid for. It is holding your items until it is paid or expires.
          </DialogDescription>
        </DialogHeader>

        {/* Collapsed by default: the decision is about the order as a whole, and a wall of line
            items would bury the three choices below. But "an order" is not something anyone can
            decide about without being able to check what is in it. */}
        <details className="group rounded-xl border border-border bg-muted/30 text-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 font-medium [&::-webkit-details-marker]:hidden">
            <span>
              What is in this order
              <span className="ml-1.5 font-normal text-muted-foreground">
                ({itemCount} {itemCount === 1 ? 'item' : 'items'})
              </span>
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <ul className="space-y-2 border-t border-border/70 px-3 py-2.5">
            {order.orderItems.map((line) => (
              <li key={line.id} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="leading-5 break-words">
                    <span className="font-medium">{line.quantity}×</span> {line.itemNameSnapshot}
                  </p>
                  {line.selectedOptions.length > 0 ? (
                    <p className="text-xs leading-4 text-muted-foreground break-words">
                      {line.selectedOptions.map((option) => option.optionNameSnapshot).join(' · ')}
                    </p>
                  ) : null}
                  {line.note ? (
                    <p className="text-xs leading-4 text-muted-foreground italic break-words">
                      “{line.note}”
                    </p>
                  ) : null}
                </div>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {currencyFormatter.format(line.unitPrice * line.quantity)}
                </span>
              </li>
            ))}
          </ul>
        </details>

        <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm leading-5">
          <p className="flex items-start gap-2">
            <Receipt className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>
              If you do nothing, it expires on its own in{' '}
              <span className="font-medium text-foreground">{describeRemaining(remainingMs)}</span> and
              the items go back on the menu. You will not be charged.
            </span>
          </p>
        </div>

        {/* flex-col, not the footer's default flex-col-reverse: reversing put "Leave it for now"
            at the top and the main action at the bottom, so the weakest choice read as the heading
            of the group and the one most people want was furthest from their thumb. */}
        <DialogFooter className="flex-col sm:flex-col sm:items-stretch sm:justify-start">
          <Button type="button" className="h-11 w-full rounded-xl" onClick={onContinue} disabled={busy}>
            <CreditCard className="size-4" />
            {onlinePaymentsEnabled ? 'Continue to payment' : 'Finish this order'}
          </Button>
          {onCopyToCart ? (
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full rounded-xl"
              onClick={() => void handleCopy()}
              disabled={busy}
            >
              {copying ? <Loader2 className="size-4 animate-spin" /> : <ShoppingBasket className="size-4" />}
              {copying ? 'Adding to cart' : 'Add these items to my cart'}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full rounded-xl"
            onClick={() => void handleCancel()}
            disabled={busy}
          >
            {cancelling ? <Loader2 className="size-4 animate-spin" /> : <XCircle className="size-4" />}
            {cancelling ? 'Cancelling' : 'Cancel this order now'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-11 w-full rounded-xl"
            onClick={onDismiss}
            disabled={busy}
          >
            Leave it for now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
