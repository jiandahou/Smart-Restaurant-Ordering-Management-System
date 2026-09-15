import type { AdminOrderPayment, AdminPaymentRefundStatus } from '../../api/auth'
import { Badge } from '../ui/badge'
import { ProviderIdentifier } from '@/components/orders/ProviderIdentifier'
import { refundedItemLabel } from './refundedItemLabel'

const refundStatusLabels: Record<AdminPaymentRefundStatus, string> = {
  Pending: 'Pending',
  Succeeded: 'Succeeded',
  Failed: 'Failed',
}

const refundStatusClasses: Partial<Record<AdminPaymentRefundStatus, string>> = {
  Succeeded: 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
}

function formatPaymentAmount(amountCents: number, currencyCode?: string | null) {
  return new Intl.NumberFormat(document.documentElement.lang || 'en-AU', {
    style: 'currency',
    currency: (currencyCode || 'AUD').toUpperCase(),
  }).format(amountCents / 100)
}

function formatDate(value: string | null) {
  if (!value) {
    return 'Not yet'
  }

  return new Intl.DateTimeFormat(document.documentElement.lang || 'en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function PaymentRefundHistory({
  payment,
  fallbackCurrency,
}: {
  payment: AdminOrderPayment | null
  fallbackCurrency?: string | null
}) {
  if (!payment) {
    return <div className="order-refund-empty">No refunds: this order has no payment attempt.</div>
  }

  const refunds = payment.refunds ?? []
  const currency = payment.currency || fallbackCurrency

  return (
    <div className="order-refund-history">
      <div className="order-refund-summary">
        <span>
          <strong>{formatPaymentAmount(payment.refundedAmountCents, currency)}</strong>
          {' refunded'}
        </span>
        <span>
          <strong>{formatPaymentAmount(payment.refundableAmountCents, currency)}</strong>
          {' still refundable'}
        </span>
      </div>
      {refunds.length > 0 ? (
        <div className="order-refund-list">
          {refunds.map((refund) => (
            <div key={refund.id} className="order-refund-card">
              <div className="order-refund-card-main">
                <strong>{formatPaymentAmount(refund.amountCents, refund.currency || currency)}</strong>
                <Badge
                  variant={refund.status === 'Failed' ? 'destructive' : refund.status === 'Succeeded' ? 'secondary' : 'outline'}
                  className={refundStatusClasses[refund.status] ?? 'order-refund-status'}
                >
                  {refundStatusLabels[refund.status] ?? refund.status}
                </Badge>
              </div>
              <div className="order-refund-meta">
                <ProviderIdentifier
                  value={refund.providerRefundId}
                  fallback="No Stripe refund id yet"
                  label="refund id"
                />
                <span>{formatDate(refund.refundedAt || refund.failedAt || refund.updatedAt || refund.createdAt)}</span>
              </div>
              {refund.reason && (
                <div className="order-refund-reason">
                  <strong>Reason</strong>
                  <span>{refund.reason}</span>
                </div>
              )}
              {(refund.items.length > 0 || refund.unattributedAmountCents > 0) && (
                <div className="mt-2 rounded-md border bg-muted/30 p-2 text-xs">
                  <strong className="mb-1 block">Allocation</strong>
                  {refund.items.map((item) => (
                    <div key={item.orderItemId} className="flex justify-between gap-3">
                      <span>{item.quantity} × {refundedItemLabel(item)}</span>
                      <span>{formatPaymentAmount(item.amountCents, refund.currency || currency)}</span>
                    </div>
                  ))}
                  {refund.unattributedAmountCents > 0 && (
                    <div className="flex justify-between gap-3 text-amber-700 dark:text-amber-300">
                      <span>General / unattributed adjustment</span>
                      <span>{formatPaymentAmount(refund.unattributedAmountCents, refund.currency || currency)}</span>
                    </div>
                  )}
                </div>
              )}
              {refund.failureReason && (
                <div className="order-payment-failure">
                  {refund.failureReason}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="order-refund-empty">No refund has been recorded for this payment.</div>
      )}
    </div>
  )
}
