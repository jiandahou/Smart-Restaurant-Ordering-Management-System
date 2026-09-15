import { Loader2 } from 'lucide-react'

import type { AdminOrder } from '@/api/auth'
import { buildPendingRefundNotice } from '@/lib/pendingRefundNotice'
import { approvalCancelsOrder, resolveRefundReviewAmount } from '@/lib/refundReviewAmount'
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

/**
 * Answering a customer's refund request, wherever the order is being worked on.
 *
 * <p>
 * Shared rather than written once per screen. Both the order list and the kitchen view need to
 * answer these — the person who sees the request should be the person who can act on it — and two
 * copies of a dialog that moves money would drift apart, which is how one screen ends up warning
 * that the kitchen will be stood down and the other does not.
 * </p>
 */

export type RefundRequestReviewDialogProps = {
  /** The order under review, or null when the dialog is closed. */
  order: AdminOrder | null
  submitting: boolean
  onClose: () => void
  onDecide: (decision: 'approve' | 'reject', note: string, approvedCents: number | null) => void
  note: string
  onNoteChange: (note: string) => void
  /** Blank means the whole request. */
  amount: string
  onAmountChange: (amount: string) => void
}

export function RefundRequestReviewDialog({
  order,
  submitting,
  onClose,
  onDecide,
  note,
  onNoteChange,
  amount,
  onAmountChange,
}: RefundRequestReviewDialogProps) {
  const request = order?.pendingRefundRequest
  const notice = buildPendingRefundNotice(request)
  const resolved = resolveRefundReviewAmount(amount, request?.requestedAmountCents ?? 0)
  const cancelsOrder = approvalCancelsOrder(resolved, request?.fullRefundWouldCancelOrder ?? false)

  return (
    <Dialog
      open={order !== null}
      onOpenChange={(open) => {
        // Not while a decision is in flight: closing would leave staff unsure whether it went
        // through, on the one action where that matters most.
        if (!open && !submitting) {
          onClose()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refund requested</DialogTitle>
          <DialogDescription>
            {order?.orderNumber}
            {notice ? ` — ${notice.summary}` : null}
          </DialogDescription>
        </DialogHeader>

        <label className="form-field">
          <span>Amount to refund</span>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(event) => onAmountChange(event.target.value)}
            placeholder={notice ? `Whole request (${notice.amountLabel})` : 'Whole request'}
            aria-invalid={resolved.error !== null}
          />
          <span className="auth-note">
            {resolved.error
              ?? 'Leave blank to refund the whole request. Staff may approve less, but never more.'}
          </span>
        </label>

        {/* Follows the amount, not the request: granting part of it leaves money on the order, so
            the order is not called off — and warning that it would teaches staff to ignore this. */}
        {cancelsOrder ? (
          <p className="admin-order-refund-request-warning">
            Approving this in full cancels the order, so the kitchen will stop work on it.
          </p>
        ) : (
          <p className="auth-note">
            {resolved.isFull
              ? 'The order itself is unaffected: the food has already been handed over, so only the money changes.'
              : 'A part refund leaves the rest of the order standing, so the kitchen carries on.'}
          </p>
        )}

        <Textarea
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          placeholder="Note for your records (optional). The customer does not see this."
          rows={3}
        />

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => onDecide('reject', note, null)}
          >
            Decline
          </Button>
          <Button
            type="button"
            disabled={submitting || resolved.approvedCents === null}
            onClick={() => onDecide('approve', note, resolved.approvedCents)}
          >
            {submitting ? <Loader2 className="animate-spin" size={16} /> : null}
            {resolved.isFull ? 'Approve refund' : 'Approve part refund'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
