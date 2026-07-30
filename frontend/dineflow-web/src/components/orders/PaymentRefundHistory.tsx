import type { AdminOrderPayment, AdminPaymentRefundStatus } from '../../api/auth'
import { Badge } from '../ui/badge'

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
                <span>{refund.providerRefundId || 'No Stripe refund id yet'}</span>
                <span>{formatDate(refund.refundedAt || refund.failedAt || refund.updatedAt || refund.createdAt)}</span>
              </div>
              {refund.reason && (
                <div className="order-refund-reason">
                  <strong>Reason</strong>
                  <span>{refund.reason}</span>
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
