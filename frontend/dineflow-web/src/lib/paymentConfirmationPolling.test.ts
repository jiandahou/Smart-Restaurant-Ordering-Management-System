import { describe, expect, it } from 'vitest'

import {
  isTerminalConfirmationFailure,
  settledRecheckWindowMs,
  shouldRecheckSettled,
} from './paymentConfirmationPolling'

/**
 * Which failures are statements about the session and which are statements about the moment. The
 * page treated every one as the latter, so an answer that was final on the first attempt was
 * retried for the full budget under a heading that said it was still confirming.
 */
describe('a failed confirmation attempt', () => {
  it.each([
    [400, 'the id is not a session id at all'],
    [403, 'the session belongs to someone else'],
    [404, 'no such session was created here'],
    [410, 'it has since been disposed of'],
  ])('is final at %i — %s', (status) => {
    expect(isTerminalConfirmationFailure(Object.assign(new Error('no'), { status }))).toBe(true)
  })

  it.each([408, 429, 500, 502, 503, 504])('is worth retrying at %i', (status) => {
    // These say nothing about whether the payment settled, and the webhook may still be on its way.
    expect(isTerminalConfirmationFailure(Object.assign(new Error('later'), { status }))).toBe(false)
  })

  it('is worth retrying when it carries no status at all', () => {
    // A dropped connection throws a plain Error. Treating that as final would strand a customer
    // whose payment did go through.
    expect(isTerminalConfirmationFailure(new Error('Failed to fetch'))).toBe(false)
    expect(isTerminalConfirmationFailure(null)).toBe(false)
    expect(isTerminalConfirmationFailure(undefined)).toBe(false)
  })

  it('ignores a status that is not a number', () => {
    expect(isTerminalConfirmationFailure({ status: '404' })).toBe(false)
  })
})

/**
 * Confirming the payment used to end the page's curiosity. But staff can reject an order seconds
 * after the money lands, and the customer was left reading a green tick about food that was not
 * coming.
 */
describe('looking again after the payment has settled', () => {
  it('keeps watching a confirmed payment, because the order can still be turned away', () => {
    expect(shouldRecheckSettled('confirmed', 0)).toBe(true)
    expect(shouldRecheckSettled('confirmed', settledRecheckWindowMs - 1)).toBe(true)
  })

  it('stops once the order is known to be closed, which nothing will undo', () => {
    expect(shouldRecheckSettled('turnedAway', 0)).toBe(false)
  })

  it('leaves the unsettled states to their own schedule', () => {
    for (const state of ['confirming', 'processing', 'failed', 'unmatched']) {
      expect(shouldRecheckSettled(state, 0)).toBe(false)
    }
  })

  /** The page is one people leave open on a table, or in a tab until morning. */
  it('gives up rather than asking forever', () => {
    expect(shouldRecheckSettled('confirmed', settledRecheckWindowMs)).toBe(false)
    expect(shouldRecheckSettled('confirmed', settledRecheckWindowMs * 2)).toBe(false)
  })
})
