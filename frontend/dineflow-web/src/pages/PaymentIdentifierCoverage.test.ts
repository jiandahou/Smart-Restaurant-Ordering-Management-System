import { describe, expect, it } from 'vitest'

// Vite hands the files over as text; reading them through node would drag node's types into an app
// config that deliberately does not carry them.
import adminPayments from './AdminPaymentsPage.tsx?raw'
import approveRefund from '@/components/orders/ApproveRefundRequestDialog.tsx?raw'
import refundHistory from '@/components/orders/PaymentRefundHistory.tsx?raw'

/**
 * The component existed and only two places used it, so the Orders table, the payment detail panel,
 * the refund card, the approval dialog and the refund history all printed raw 66-character ids.
 * A shared component nobody applies is the same defect as no component at all.
 */
describe('every screen that shows a Stripe identifier', () => {
  it.each([
    ['Admin Payments', adminPayments],
    ['the refund approval dialog', approveRefund],
    ['the refund history', refundHistory],
  ])('%s renders it through the shared component', (_name, source) => {
    expect(source).toContain('<ProviderIdentifier')
  })

  it('leaves no raw checkout session id in a cell', () => {
    // The exact pattern the report was filed against.
    expect(adminPayments).not.toContain("{order.latestPayment?.providerCheckoutSessionId || 'No checkout session yet'}")
  })

  it('leaves no raw refund or intent id in the refund card', () => {
    expect(adminPayments).not.toContain('{refund.providerRefundId || refund.id}</strong>')
    expect(adminPayments).not.toContain("{refund.providerPaymentIntentId || 'No payment intent'}")
  })

  it('keeps one copy of the shortening rule rather than a second private one', () => {
    expect(adminPayments).not.toContain('function CompactIdentifier')
  })
})
