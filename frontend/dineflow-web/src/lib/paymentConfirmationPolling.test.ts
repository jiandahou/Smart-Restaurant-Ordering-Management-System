import { describe, expect, it } from 'vitest'

import { isTerminalConfirmationFailure } from './paymentConfirmationPolling'

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
