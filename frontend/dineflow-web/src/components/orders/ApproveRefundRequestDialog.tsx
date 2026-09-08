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
import { parseRefundAmountCents } from './refundAmount'
import { canConfirmRefundApproval } from './refundApproval'
import { approvalKey, approvalLabel, sumPerItemApproval } from './perItemApproval'
import { ProviderIdentifier } from '@/components/orders/ProviderIdentifier'

/**
 * How much of a refund request staff are approving.
 *
 * <p>
 * 'items' is the one that says which dish. With only a total, a partial approval was spread across
 * every line the customer selected by proportion — figures nobody decided, which then became the
 * balance every later refund on those lines was measured against.
 * </p>
 */
export type RefundMode = 'full' | 'partial' | 'items'

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
  mode,
  amount,
  itemAmounts,
  confirmation,
  submitting,
  onNoteChange,
  onModeChange,
  onAmountChange,
  onItemAmountChange,
  onConfirmationChange,
  onOpenChange,
  onConfirm,
}: {
  request: AdminRefundRequest | null
  environmentMode: PaymentEnvironment['mode'] | null
  note: string
  mode: RefundMode
  amount: string
  itemAmounts: Record<string, string>
  confirmation: string
  submitting: boolean
  onNoteChange: (value: string) => void
  onModeChange: (mode: RefundMode) => void
  onAmountChange: (value: string) => void
  onItemAmountChange: (orderItemId: string, value: string) => void
  onConfirmationChange: (value: string) => void
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const isLive = environmentMode === 'Live'
  const ceilingAmountCents = request
    ? Math.min(request.requestedAmountCents, request.refundableAmountCents)
    : 0
  const perItemTotalCents = sumPerItemApproval(request?.items ?? [], itemAmounts)
  const confirmAmountCents = mode === 'full'
    ? ceilingAmountCents
    : mode === 'items'
      ? perItemTotalCents
      : parseRefundAmountCents(amount)
  const canConfirm = canConfirmRefundApproval(request, environmentMode, confirmation, confirmAmountCents)

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
                <strong>Up to {formatPaymentAmount(request.requestedAmountCents, request.currency)}</strong>
                <span>was requested for {request.orderNumber}.</span>
              </div>
            </div>

            {request.items.length > 0 && mode !== 'items' && (
              <dl className="refund-approval-item-list">
                {request.items.map((item, index) => (
                  <div key={`${approvalKey(item)}-${index}`}>
                    <dt>{approvalLabel(item)} × {item.quantity}</dt>
                    <dd>{formatPaymentAmount(item.amountCents, request.currency)}</dd>
                  </div>
                ))}
              </dl>
            )}

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
                {request.items.length > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant={mode === 'items' ? 'default' : 'outline'}
                    aria-pressed={mode === 'items'}
                    disabled={submitting}
                    onClick={() => onModeChange('items')}
                  >
                    Choose per item
                  </Button>
                ) : null}
              </div>
              {mode === 'items' ? (
                <div className="refund-approval-item-amounts">
                  <p className="text-xs text-muted-foreground">
                    Set what each item is being refunded. Leave one at zero to refund nothing for it.
                  </p>
                  {request.items.map((item) => (
                    <div key={approvalKey(item)} className="space-y-1">
                      <label className="text-sm font-semibold" htmlFor={`refund-item-${approvalKey(item)}`}>
                        {approvalLabel(item)} × {item.quantity}
                      </label>
                      <Input
                        id={`refund-item-${approvalKey(item)}`}
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        value={itemAmounts[approvalKey(item)] ?? ''}
                        onChange={(event) => onItemAmountChange(approvalKey(item), event.target.value)}
                        disabled={submitting}
                      />
                      <p className="text-xs text-muted-foreground">
                        Customer asked for {formatPaymentAmount(item.amountCents, request.currency)}.
                      </p>
                    </div>
                  ))}
                  <p className="text-sm font-semibold">
                    Approving {formatPaymentAmount(perItemTotalCents, request.currency)} in total.
                  </p>
                </div>
              ) : null}
              {mode === 'partial' ? (
                <div className="space-y-1">
                  <label className="text-sm font-semibold" htmlFor="refund-approval-amount">Refund amount</label>
                  <Input
                    id="refund-approval-amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    value={amount}
                    onChange={(event) => onAmountChange(event.target.value)}
                    disabled={submitting}
                  />
                  <p className="text-xs text-muted-foreground">
                    Up to {formatPaymentAmount(ceilingAmountCents, request.currency)} available to approve.
                  </p>
                </div>
              ) : null}
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
                <dd>
                  <ProviderIdentifier
                    value={request.providerPaymentIntentId}
                    fallback="No Stripe payment intent"
                    label="payment intent id"
                  />
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
