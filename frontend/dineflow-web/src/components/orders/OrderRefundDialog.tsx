import type { AdminOrder } from '../../api/auth'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Textarea } from '../ui/textarea'

function formatPaymentAmount(amountCents: number, currencyCode?: string | null) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: (currencyCode || 'AUD').toUpperCase(),
  }).format(amountCents / 100)
}

export function OrderRefundDialog({
  order,
  reason,
  submitting,
  onReasonChange,
  onOpenChange,
  onConfirm,
}: {
  order: AdminOrder | null
  reason: string
  submitting: boolean
  onReasonChange: (value: string) => void
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const refundableAmountCents = order?.latestPayment?.refundableAmountCents ?? 0
  const currency = order?.latestPayment?.currency ?? order?.currency

  return (
    <Dialog open={order !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refund order</DialogTitle>
          <DialogDescription>
            {order
              ? `Refund ${formatPaymentAmount(refundableAmountCents, currency)} to the original Stripe payment for ${order.orderNumber}.`
              : 'Refund this order to the original Stripe payment.'}
          </DialogDescription>
        </DialogHeader>
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
            disabled={submitting || !order || refundableAmountCents <= 0}
            onClick={onConfirm}
          >
            {submitting ? 'Refunding' : 'Confirm refund'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
