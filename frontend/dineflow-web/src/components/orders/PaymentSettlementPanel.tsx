import { AlertTriangle, ExternalLink, Mail, ReceiptText, RefreshCw } from 'lucide-react'
import type { AdminOrderPayment } from '../../api/auth'
import { buildStripeDashboardUrl } from '../../lib/stripeDashboard'
import { Button } from '../ui/button'

function formatAmount(amountCents: number, currencyCode?: string | null) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: (currencyCode || 'AUD').toUpperCase(),
  }).format(amountCents / 100)
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return null
  }

  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    .format(new Date(value))
}

/**
 * Settlement and provider-truth panel. Stripe's fee and the net figure only exist on the charge's
 * balance transaction, so they stay null until the payment has been synced at least once — the
 * panel says so explicitly rather than rendering a misleading zero.
 */
export function PaymentSettlementPanel({
  payment,
  fallbackCurrency,
  isLiveMode,
  syncing,
  resendingReceipt,
  onSync,
  onResendReceipt,
}: {
  payment: AdminOrderPayment | null
  fallbackCurrency: string
  isLiveMode: boolean
  syncing: boolean
  resendingReceipt: boolean
  onSync: () => void
  onResendReceipt: () => void
}) {
  if (!payment) {
    return null
  }

  const currency = payment.currency || fallbackCurrency
  const lastWebhook = formatTimestamp(payment.lastProviderEventCreatedAt ?? null)
  const lastSynced = formatTimestamp(payment.lastSyncedAt ?? null)
  // Treat a missing field the same as an unsynced null rather than formatting undefined into NaN.
  const stripeFeeCents = payment.stripeFeeAmountCents ?? null
  const netCents = payment.netAmountCents ?? null
  const platformFeeCents = payment.platformFeeAmountCents ?? 0
  const paymentIntentUrl = buildStripeDashboardUrl(payment.providerPaymentIntentId, payment.stripeAccountId, isLiveMode)
  const chargeUrl = buildStripeDashboardUrl(payment.providerChargeId, payment.stripeAccountId, isLiveMode)
  const hasSettlement = stripeFeeCents !== null || netCents !== null
  const isDisputed = Boolean(payment.disputeStatus)
  const evidenceDueBy = formatTimestamp(payment.disputeEvidenceDueBy ?? null)
  const disputeUrl = buildStripeDashboardUrl(
    payment.disputeId,
    payment.stripeAccountId,
    isLiveMode,
    'disputes',
  )
  const isStalled = payment.status === 'Pending' || payment.status === 'Failed'
  const canSync = Boolean(payment.providerPaymentIntentId)
    && !payment.providerPaymentIntentId?.includes('_demo_')

  return (
    <div className="payment-settlement">
      {isDisputed ? (
        <div className="payment-settlement-alert is-dispute" role="alert">
          <AlertTriangle size={16} />
          <div>
            <strong>
              Disputed with the cardholder's bank
              {payment.disputeAmountCents !== null && payment.disputeAmountCents !== undefined
                ? ` · ${formatAmount(payment.disputeAmountCents, currency)}`
                : null}
            </strong>
            {/* The deadline is the urgent part: miss it and Stripe closes the dispute against
                the restaurant automatically. */}
            {evidenceDueBy ? (
              <strong className="payment-settlement-deadline">
                Respond in Stripe by {evidenceDueBy}
              </strong>
            ) : null}
            <span>
              Status {payment.disputeStatus}
              {payment.disputeReason ? ` · ${payment.disputeReason}` : null}
              {payment.disputedAt ? ` · opened ${formatTimestamp(payment.disputedAt)}` : null}
              {'. Refunding now can mean losing the money twice — resolve the dispute in Stripe first.'}
            </span>
            {disputeUrl ? (
              <a href={disputeUrl} target="_blank" rel="noopener noreferrer">
                Open the dispute in Stripe
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      {isStalled ? (
        <div className="payment-settlement-alert is-stalled" role="status">
          <AlertTriangle size={16} />
          <div>
            <strong>Payment is {payment.status.toLowerCase()}</strong>
            <span>
              If the customer says they paid, a webhook was probably missed. Re-sync to pull the
              real state from Stripe.
            </span>
          </div>
        </div>
      ) : null}

      <div className="payment-settlement-grid">
        <span>Charged</span>
        <strong>{formatAmount(payment.amountCents, currency)}</strong>
        <span>Platform fee</span>
        <strong>-{formatAmount(platformFeeCents, currency)}</strong>
        <span>Stripe fee</span>
        <strong>
          {stripeFeeCents === null
            ? <em className="payment-settlement-unknown">Not synced</em>
            : `-${formatAmount(stripeFeeCents, currency)}`}
        </strong>
        <span>Net to restaurant</span>
        <strong>
          {netCents === null
            ? <em className="payment-settlement-unknown">Not synced</em>
            : formatAmount(netCents, currency)}
        </strong>
      </div>

      {!hasSettlement && canSync ? (
        <p className="payment-settlement-hint">
          Stripe only reports its fee once the charge settles. Re-sync to pull it in.
        </p>
      ) : null}

      <div className="payment-settlement-meta">
        <span>Last webhook: {lastWebhook ?? 'none received'}</span>
        <span>Last synced: {lastSynced ?? 'never'}</span>
        <span>Receipt sent to: {payment.receiptEmail || 'no email on file'}</span>
      </div>

      <div className="payment-settlement-actions">
        {paymentIntentUrl ? (
          <Button asChild type="button" variant="outline" size="sm">
            <a href={paymentIntentUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} />
              Payment intent
            </a>
          </Button>
        ) : null}
        {chargeUrl ? (
          <Button asChild type="button" variant="outline" size="sm">
            <a href={chargeUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} />
              Charge
            </a>
          </Button>
        ) : null}
        {payment.providerReceiptUrl ? (
          <Button asChild type="button" variant="outline" size="sm">
            <a href={payment.providerReceiptUrl} target="_blank" rel="noopener noreferrer">
              <ReceiptText size={14} />
              Receipt
            </a>
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={resendingReceipt || !payment.providerReceiptUrl || !payment.receiptEmail}
          onClick={onResendReceipt}
          title={
            !payment.providerReceiptUrl
              ? 'No Stripe receipt yet — re-sync this payment first.'
              : !payment.receiptEmail
                ? 'No customer email on file for this payment.'
                : undefined
          }
        >
          <Mail size={14} />
          {resendingReceipt ? 'Sending' : 'Resend receipt'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={syncing || !canSync}
          onClick={onSync}
          title={canSync ? undefined : 'This payment has no live Stripe payment intent.'}
        >
          <RefreshCw size={14} className={syncing ? 'animate-spin' : undefined} />
          {syncing ? 'Syncing' : 'Re-sync from Stripe'}
        </Button>
      </div>
    </div>
  )
}
