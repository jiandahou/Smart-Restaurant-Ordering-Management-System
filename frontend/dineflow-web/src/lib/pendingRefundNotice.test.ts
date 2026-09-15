import { describe, expect, it } from 'vitest'

import type { AdminOrderPendingRefundRequest } from '@/api/auth'
import { buildPendingRefundNotice } from './pendingRefundNotice'

function request(overrides: Partial<AdminOrderPendingRefundRequest> = {}): AdminOrderPendingRefundRequest {
  return {
    id: 'req-1',
    requestedAmountCents: 2_550,
    currency: 'AUD',
    reason: 'Ordered the wrong dish',
    createdAt: '2026-08-15T09:00:00Z',
    fullRefundWouldCancelOrder: false,
    ...overrides,
  }
}

/**
 * Refund requests were only visible on the payments screen, so a kitchen could be preparing an order
 * the customer had already asked to have refunded while the order screen showed nothing.
 */
describe('what an order screen says about a refund being asked for', () => {
  it('says nothing when nobody has asked', () => {
    expect(buildPendingRefundNotice(null)).toBeNull()
    expect(buildPendingRefundNotice(undefined)).toBeNull()
  })

  it('leads with the amount and the customer’s reason', () => {
    const notice = buildPendingRefundNotice(request())!

    expect(notice.badge).toBe('Refund requested')
    expect(notice.summary).toContain('25.50')
    expect(notice.summary).toContain('Ordered the wrong dish')
  })

  it('still states the amount when no reason was given', () => {
    const notice = buildPendingRefundNotice(request({ reason: null }))!

    expect(notice.reason).toBeNull()
    expect(notice.summary).toContain('25.50')
  })

  it('treats a blank reason as none', () => {
    expect(buildPendingRefundNotice(request({ reason: '   ' }))!.reason).toBeNull()
  })

  /** Staff deciding mid-service should not learn the kitchen was stood down by noticing afterwards. */
  it('warns when approving in full would call the order off', () => {
    expect(buildPendingRefundNotice(request({ fullRefundWouldCancelOrder: true }))!
      .warnsOrderWouldBeCancelled).toBe(true)
    expect(buildPendingRefundNotice(request())!.warnsOrderWouldBeCancelled).toBe(false)
  })

  it('formats in the order’s own currency', () => {
    const notice = buildPendingRefundNotice(request({ currency: 'INR', requestedAmountCents: 34_000 }))!

    expect(notice.summary).toMatch(/340/)
  })
})
