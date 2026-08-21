import { describe, expect, it } from 'vitest'

import { resolveCheckoutResumeState } from './checkoutPageState'

/**
 * Choosing to pay at the counter used to live only in React state, so a refresh put the page back
 * to its opening screen — offering to take payment for an order already settled at the counter.
 */
describe('deciding what the checkout page reopens on', () => {
  it('confirms the order rather than billing again once counter payment was chosen', () => {
    expect(resolveCheckoutResumeState({ paymentMethod: 'PayAtCounter' })).toBe('pay_offline')
  })

  it('still offers payment for an order that is set to pay online', () => {
    expect(resolveCheckoutResumeState({ paymentMethod: 'Online' })).toBe('ready')
  })

  /** A missing or unrecognised method must not be read as "already dealt with". */
  it('offers payment when the order does not say', () => {
    expect(resolveCheckoutResumeState({})).toBe('ready')
    expect(resolveCheckoutResumeState({ paymentMethod: null })).toBe('ready')
    expect(resolveCheckoutResumeState(null)).toBe('ready')
    expect(resolveCheckoutResumeState(undefined)).toBe('ready')
  })

  /** The value comes from the server verbatim; a near-miss is not a match. */
  it('does not treat a lookalike value as counter payment', () => {
    expect(resolveCheckoutResumeState({ paymentMethod: 'payatcounter' })).toBe('ready')
    expect(resolveCheckoutResumeState({ paymentMethod: 'Counter' })).toBe('ready')
  })
})
