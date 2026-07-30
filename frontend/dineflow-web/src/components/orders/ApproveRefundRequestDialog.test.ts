import { describe, expect, it } from 'vitest'
import type { AdminRefundRequest } from '../../api/auth'
import { canConfirmRefundApproval } from './refundApproval'

const request: AdminRefundRequest = {
  id: 'request-1',
  orderId: 'order-1',
  paymentId: 'payment-1',
  paymentRefundId: null,
  restaurantId: 'restaurant-1',
  restaurantName: 'Central Market Table',
  orderNumber: 'ORD-1001',
  customerName: 'Jane Smith',
  customerEmail: 'jane@example.com',
  status: 'Pending',
  requestedAmountCents: 2500,
  originalPaymentAmountCents: 4000,
  alreadyRefundedAmountCents: 0,
  refundableAmountCents: 4000,
  previousRefundCount: 0,
  providerPaymentIntentId: 'pi_test',
  currency: 'aud',
  reason: 'Customer request',
  adminNote: null,
  requestedByUserId: 'customer-1',
  reviewedByUserId: null,
  createdAt: '2026-07-28T00:00:00Z',
  updatedAt: null,
  reviewedAt: null,
}

describe('refund approval confirmation', () => {
  it('allows a reviewed test-mode refund without typed confirmation', () => {
    expect(canConfirmRefundApproval(request, 'Test', '')).toBe(true)
  })

  it('requires the exact order number for live Stripe refunds', () => {
    expect(canConfirmRefundApproval(request, 'Live', '')).toBe(false)
    expect(canConfirmRefundApproval(request, 'Live', 'ORD-1001')).toBe(true)
  })

  it('blocks approval when Stripe is unavailable or the balance has changed', () => {
    expect(canConfirmRefundApproval(request, 'Unconfigured', 'ORD-1001')).toBe(false)
    expect(canConfirmRefundApproval({
      ...request,
      requestedAmountCents: 5000,
      refundableAmountCents: 4000,
    }, 'Test', '')).toBe(false)
  })
})
