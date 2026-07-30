import { AlertTriangle, ShieldCheck } from 'lucide-react'
import type { AdminRefundRequest, PaymentEnvironment } from '../../api/auth'
import { Badge } from '../ui/badge'
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
import { canConfirmRefundApproval } from './refundApproval'

function formatPaymentAmount(amountCents: number, currencyCode?: string | null) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: (currencyCode || 'AUD').toUpperCase(),
  }).format(amountCents / 100)
}

export function ApproveRefundRequestDialog({
  request,
  environmentMode,
  note,
  confirmation,
  submitting,
  onNoteChange,
  onConfirmationChange,
  onOpenChange,
  onConfirm,
}: {
  request: AdminRefundRequest | null
  environmentMode: PaymentEnvironment['mode'] | null
  note: string
  confirmation: string
  submitting: boolean
  onNoteChange: (value: string) => void
  onConfirmationChange: (value: string) => void
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const isLive = environmentMode === 'Live'
  const canConfirm = canConfirmRefundApproval(request, environmentMode, confirmation)

  return (
    <Dialog open={request !== null} onOpenChange={onOpenChange}>
      <DialogContent className="refund-approval-dialog">
        <DialogHeader>
          <div className="refund-approval-title-row">
            <DialogTitle>Approve refund</DialogTitle>
            <Badge
              variant={isLive ? 'destructive' : 'outline'}
              className={environmentMode === 'Test' ? 'payment-environment-test' : undefined}
            >
              Stripe {environmentMode ?? 'Checking'}
            </Badge>
          </div>
          <DialogDescription>
            This sends the refund to Stripe immediately. A successful refund cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {request && (
          <div className="refund-approval-content">
            <div className="refund-approval-warning" role="alert">
              <AlertTriangle size={18} />
              <div>
                <strong>{formatPaymentAmount(request.requestedAmountCents, request.currency)}</strong>
                <span>will be returned to the original payment for {request.orderNumber}.</span>
              </div>
            </div>

            <dl className="refund-approval-grid">
              <div><dt>Restaurant</dt><dd>{request.restaurantName || 'Unknown restaurant'}</dd></div>
              <div><dt>Customer</dt><dd>{request.customerName || request.customerEmail || 'Guest / unknown'}</dd></div>
              <div><dt>Original payment</dt><dd>{formatPaymentAmount(request.originalPaymentAmountCents, request.currency)}</dd></div>
              <div><dt>Already refunded</dt><dd>{formatPaymentAmount(request.alreadyRefundedAmountCents, request.currency)}</dd></div>
              <div><dt>Refundable balance</dt><dd>{formatPaymentAmount(request.refundableAmountCents, request.currency)}</dd></div>
              <div><dt>Previous refunds</dt><dd>{request.previousRefundCount}</dd></div>
              <div className="refund-approval-grid-wide">
                <dt>Payment intent</dt>
                <dd title={request.providerPaymentIntentId || undefined}>
                  {request.providerPaymentIntentId || 'No Stripe payment intent'}
                </dd>
              </div>
              <div className="refund-approval-grid-wide">
                <dt>Customer reason</dt>
                <dd>{request.reason || 'No customer reason provided'}</dd>
              </div>
            </dl>

            <div className="space-y-2">
              <label className="text-sm font-semibold" htmlFor="refund-approval-note">Internal approval note</label>
              <Textarea
                id="refund-approval-note"
                rows={3}
                value={note}
                onChange={(event) => onNoteChange(event.target.value)}
                placeholder="Optional note stored in the audit trail"
                maxLength={1000}
                disabled={submitting}
              />
            </div>

            {isLive && (
              <div className="space-y-2">
                <label className="text-sm font-semibold" htmlFor="refund-approval-confirmation">
                  Type {request.orderNumber} to confirm this live refund
                </label>
                <Input
                  id="refund-approval-confirmation"
                  value={confirmation}
                  onChange={(event) => onConfirmationChange(event.target.value)}
                  autoComplete="off"
                  disabled={submitting}
                />
              </div>
            )}

            {environmentMode === 'Unconfigured' && (
              <p className="refund-approval-unavailable">
                Stripe is not configured. Refund approval is disabled.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            Keep pending
          </Button>
          <Button type="button" variant="destructive" disabled={submitting || !canConfirm} onClick={onConfirm}>
            <ShieldCheck size={16} />
            {submitting ? 'Submitting refund' : 'Confirm Stripe refund'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
