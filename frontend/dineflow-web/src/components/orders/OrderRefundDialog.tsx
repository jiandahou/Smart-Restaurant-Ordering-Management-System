import type { AdminOrder } from '../../api/auth'
import { isValidDirectRefundAmount, parseRefundAmountCents } from './refundAmount'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'

function formatPaymentAmount(amountCents: number, currencyCode?: string | null) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: (currencyCode || 'AUD').toUpperCase(),
  }).format(amountCents / 100)
}

export type RefundMode = 'full' | 'partial'

export function OrderRefundDialog({
  order,
  reason,
  mode,
  amount,
  submitting,
  onReasonChange,
  onModeChange,
  onAmountChange,
  onOpenChange,
  onConfirm,
}: {
  order: AdminOrder | null
  reason: string
  mode: RefundMode
  amount: string
  submitting: boolean
  onReasonChange: (value: string) => void
  onModeChange: (mode: RefundMode) => void
  onAmountChange: (value: string) => void
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const refundableAmountCents = order?.latestPayment?.refundableAmountCents ?? 0
  const currency = order?.latestPayment?.currency ?? order?.currency
  const parsedAmountCents = parseRefundAmountCents(amount)
  const isPartialAmountValid = isValidDirectRefundAmount(parsedAmountCents, refundableAmountCents)

  return (
    <Dialog open={order !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refund order</DialogTitle>
          <DialogDescription>
            {order
              ? `Up to ${formatPaymentAmount(refundableAmountCents, currency)} is available to refund to the original Stripe payment for ${order.orderNumber}.`
              : 'Refund this order to the original Stripe payment.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={mode === 'full' ? 'default' : 'outline'}
              aria-pressed={mode === 'full'}
              disabled={submitting}
              onClick={() => onModeChange('full')}
            >
              Refund full amount
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === 'partial' ? 'default' : 'outline'}
              aria-pressed={mode === 'partial'}
              disabled={submitting}
              onClick={() => onModeChange('partial')}
            >
              Refund partial amount
            </Button>
          </div>
          {mode === 'partial' ? (
            <div className="space-y-1">
              <label className="text-sm font-semibold" htmlFor="refund-amount">Refund amount</label>
              <Input
                id="refund-amount"
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(event) => onAmountChange(event.target.value)}
                disabled={submitting}
              />
              <p className="text-xs text-muted-foreground">
                Up to {formatPaymentAmount(refundableAmountCents, currency)} available to refund.
              </p>
            </div>
          ) : null}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-semibold" htmlFor="refund-reason">Refund reason</label>
          <Textarea
            id="refund-reason"
            rows={4}
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            placeholder="Optional note for the refund record"
            disabled={submitting}
            maxLength={1000}
          />
          <p className="text-xs text-muted-foreground">
            This creates a Stripe refund and records the refund transaction for later audit.
          </p>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            Keep payment
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={
              submitting ||
              !order ||
              refundableAmountCents <= 0 ||
              (mode === 'partial' && !isPartialAmountValid)
            }
            onClick={onConfirm}
          >
            {submitting ? 'Refunding' : 'Confirm refund'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
