import { describe, expect, it } from 'vitest'

import { shouldSoundKitchenAlert } from './kitchenAlertPolicy'

/**
 * The alert fired the moment any order was created. An online order arrives unpaid, and the staff
 * screen refuses to let anyone start on it — so the sound called the kitchen to a ticket they were
 * not allowed to touch, once for every abandoned checkout too.
 */
describe('deciding when the kitchen should hear an alert', () => {
  it('stays quiet for an online order nobody has paid for yet', () => {
    expect(shouldSoundKitchenAlert({ paymentStatus: 'Unpaid', paymentMethod: 'Online' })).toBe(false)
  })

  it('sounds once the online payment lands', () => {
    expect(shouldSoundKitchenAlert({ paymentStatus: 'Paid', paymentMethod: 'Online' })).toBe(true)
  })

  /**
   * A counter order is a commitment to pay at the till, and the kitchen is expected to cook now —
   * waiting for money that arrives after the meal would mean it never rang at all.
   */
  it('sounds for a counter order straight away', () => {
    expect(shouldSoundKitchenAlert({ paymentStatus: 'Unpaid', paymentMethod: 'PayAtCounter' })).toBe(true)
  })

  it('stays quiet while a card payment is still in flight', () => {
    expect(shouldSoundKitchenAlert({ paymentStatus: 'Pending', paymentMethod: 'Online' })).toBe(false)
  })

  it('stays quiet for a payment that failed or expired', () => {
    expect(shouldSoundKitchenAlert({ paymentStatus: 'Failed', paymentMethod: 'Online' })).toBe(false)
    expect(shouldSoundKitchenAlert({ paymentStatus: 'Expired', paymentMethod: 'Online' })).toBe(false)
    expect(shouldSoundKitchenAlert({ paymentStatus: 'Cancelled', paymentMethod: 'Online' })).toBe(false)
  })

  /** A partly refunded order is still a meal that was paid for and may still be cooking. */
  it('sounds for the payment states that still count as settled', () => {
    expect(shouldSoundKitchenAlert({ paymentStatus: 'PartiallyRefunded', paymentMethod: 'Online' })).toBe(true)
    expect(shouldSoundKitchenAlert({ paymentStatus: 'NotRequired', paymentMethod: 'Online' })).toBe(true)
  })

  /** An unrecognised status must not be read as "paid". */
  it('stays quiet for anything it does not recognise', () => {
    expect(shouldSoundKitchenAlert({ paymentStatus: 'paid', paymentMethod: 'Online' })).toBe(false)
    expect(shouldSoundKitchenAlert({ paymentStatus: '', paymentMethod: '' })).toBe(false)
  })
})
