import { describe, expect, it } from 'vitest'

import { buildOrderClosureNotice, type OrderClosure } from './orderClosureNotice'

function closure(overrides: Partial<OrderClosure> = {}): OrderClosure {
  return {
    action: 'Reject',
    reason: 'Item is unavailable',
    endedByCustomer: false,
    at: '2026-08-14T09:05:00Z',
    ...overrides,
  }
}

/**
 * Staff choose a reason when they turn an order away, and it was written to the order's history and
 * went no further: the customer's own page showed the order as Rejected and nothing else, at exactly
 * the moment the reason decides what they do next.
 */
describe('telling a customer why their order ended', () => {
  it('says nothing about an order that is still open', () => {
    expect(buildOrderClosureNotice(null)).toBeNull()
    expect(buildOrderClosureNotice(undefined)).toBeNull()
  })

  it('shows the reason the restaurant recorded', () => {
    expect(buildOrderClosureNotice(closure())).toEqual({
      heading: 'The restaurant could not take this order',
      reason: 'Item is unavailable',
      fallback: null,
    })
  })

  it('distinguishes a cancellation from a refusal', () => {
    const notice = buildOrderClosureNotice(closure({ action: 'Cancel', reason: 'Kitchen closed early' }))

    expect(notice!.heading).toBe('The restaurant cancelled this order')
    expect(notice!.reason).toBe('Kitchen closed early')
  })

  /**
   * Showing a customer their own decision as though the restaurant had made it is a small
   * misattribution that earns a phone call.
   */
  it('does not blame the restaurant for the customer’s own cancellation', () => {
    const notice = buildOrderClosureNotice(closure({ action: 'Cancel', endedByCustomer: true, reason: 'Changed my mind' }))

    expect(notice!.heading).toBe('You cancelled this order')
    expect(notice!.fallback).toBeNull()
  })

  /** Silence reads as a refusal with no explanation, which is worse than admitting none was given. */
  it('admits when no reason was recorded', () => {
    const notice = buildOrderClosureNotice(closure({ reason: null }))

    expect(notice!.reason).toBeNull()
    expect(notice!.fallback).toContain('No reason was given')
  })

  it('treats a blank reason as no reason', () => {
    expect(buildOrderClosureNotice(closure({ reason: '   ' }))!.reason).toBeNull()
  })

  it('trims the wording it was given', () => {
    expect(buildOrderClosureNotice(closure({ reason: '  Duplicate order  ' }))!.reason).toBe('Duplicate order')
  })

  /** A customer who cancelled without typing anything needs no explanation invented for them. */
  it('offers no fallback for a customer’s own cancellation', () => {
    const notice = buildOrderClosureNotice(closure({ endedByCustomer: true, reason: null }))

    expect(notice!.reason).toBeNull()
    expect(notice!.fallback).toBeNull()
  })
})
