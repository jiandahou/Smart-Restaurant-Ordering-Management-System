import { describe, expect, it } from 'vitest'

import { approvalCancelsOrder, resolveRefundReviewAmount } from './refundReviewAmount'

const requested = 2_550

describe('granting a refund request for part of what was asked', () => {
  it('grants the whole request when nothing is typed', () => {
    const amount = resolveRefundReviewAmount('', requested)

    expect(amount.approvedCents).toBe(requested)
    expect(amount.isFull).toBe(true)
  })

  it('grants what was typed', () => {
    expect(resolveRefundReviewAmount('10.00', requested).approvedCents).toBe(1_000)
  })

  /** The server refuses this, and the field should say so before the round trip. */
  it('refuses more than the customer asked for', () => {
    const amount = resolveRefundReviewAmount('30', requested)

    expect(amount.approvedCents).toBeNull()
    expect(amount.error).toContain('more than the customer asked for')
  })

  it('refuses zero and nonsense', () => {
    expect(resolveRefundReviewAmount('0', requested).approvedCents).toBeNull()
    expect(resolveRefundReviewAmount('-5', requested).approvedCents).toBeNull()
    expect(resolveRefundReviewAmount('abc', requested).approvedCents).toBeNull()
  })

  it('treats the exact requested amount as a full grant', () => {
    expect(resolveRefundReviewAmount('25.50', requested).isFull).toBe(true)
  })

  /**
   * The consequence follows the amount, not the request. Warning that a part-refund cancels the
   * order — because the full one would have — teaches staff to ignore the warning.
   */
  it('only warns about cancelling when the whole request is granted', () => {
    expect(approvalCancelsOrder(resolveRefundReviewAmount('', requested), true)).toBe(true)
    expect(approvalCancelsOrder(resolveRefundReviewAmount('10', requested), true)).toBe(false)
    expect(approvalCancelsOrder(resolveRefundReviewAmount('', requested), false)).toBe(false)
  })
})
