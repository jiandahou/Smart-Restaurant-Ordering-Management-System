import { useState } from 'react'
import { toast } from 'sonner'

import { approveAdminRefundRequest, rejectAdminRefundRequest, type AdminOrder } from '@/api/auth'

/**
 * The decision itself, shared by every screen that can answer a refund request.
 *
 * <p>
 * Kept with the dialog rather than in each page: approving can also stand the kitchen down, and the
 * wording that says so has to be the same wherever the decision is made. Two copies would drift.
 * </p>
 */
export function useRefundRequestReview(onReviewed: () => Promise<void> | void) {
  const [order, setOrder] = useState<AdminOrder | null>(null)
  const [note, setNote] = useState('')
  // Blank means the whole request; staff may grant less, which the server also allows.
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const close = () => {
    setOrder(null)
    setNote('')
    setAmount('')
  }

  const decide = async (
    decision: 'approve' | 'reject',
    reviewNote: string,
    approvedCents: number | null,
  ) => {
    const requestId = order?.pendingRefundRequest?.id

    if (!order || !requestId) {
      return
    }

    setSubmitting(true)
    try {
      const payload = { note: reviewNote.trim() || undefined }

      if (decision === 'approve') {
        await approveAdminRefundRequest(requestId, {
          ...payload,
          ...(approvedCents === null ? {} : { amountCents: approvedCents }),
        })
        toast.success('Refund approved', {
          // Said out loud. Approving can also call the order off, and staff should not have to
          // infer that from the order quietly changing colour behind the dialog.
          description: order.pendingRefundRequest?.fullRefundWouldCancelOrder
            && approvedCents === order.pendingRefundRequest.requestedAmountCents
            ? `${order.orderNumber} has been refunded and cancelled.`
            : `${order.orderNumber} has been refunded.`,
        })
      } else {
        await rejectAdminRefundRequest(requestId, payload)
        toast.success('Refund declined', { description: `${order.orderNumber} was not refunded.` })
      }

      close()
      await onReviewed()
    } catch (error) {
      toast.error(decision === 'approve' ? 'Could not approve the refund' : 'Could not decline the refund', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return { order, note, amount, submitting, open: setOrder, close, setNote, setAmount, decide }
}
