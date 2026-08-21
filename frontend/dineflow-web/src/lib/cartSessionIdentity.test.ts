import { describe, expect, it } from 'vitest'
import { cartIdentityOf, cartSessionBelongsToSomeoneElse, guestIdentity } from './cartSessionIdentity'

describe('who a cart session belongs to', () => {
  it('is the signed-in user', () => {
    expect(cartIdentityOf({ id: 'user-1' })).toBe('user-1')
  })

  it('is the guest identity when nobody is signed in', () => {
    expect(cartIdentityOf(null)).toBe(guestIdentity)
    expect(cartIdentityOf(undefined)).toBe(guestIdentity)
  })
})

/**
 * The reported case: after signing out the tab kept the participant token issued while signed in,
 * so the page said "Ordering as Guest" while the order carried the previous customer's identity.
 */
describe('deciding whether a stored session can still be used', () => {
  it('rejects a session issued before signing out', () => {
    expect(cartSessionBelongsToSomeoneElse('user-1', guestIdentity)).toBe(true)
  })

  it('rejects a session issued before signing in', () => {
    expect(cartSessionBelongsToSomeoneElse(guestIdentity, 'user-1')).toBe(true)
  })

  it('rejects a session issued to a different account', () => {
    expect(cartSessionBelongsToSomeoneElse('user-1', 'user-2')).toBe(true)
  })

  it('keeps a session belonging to the same person', () => {
    expect(cartSessionBelongsToSomeoneElse('user-1', 'user-1')).toBe(false)
    expect(cartSessionBelongsToSomeoneElse(guestIdentity, guestIdentity)).toBe(false)
  })

  it('rejects a session that never recorded an identity', () => {
    // Written by a build that predates this. It cannot be vouched for, and a token whose owner is
    // unknown is exactly the thing this check exists to stop being reused.
    expect(cartSessionBelongsToSomeoneElse(undefined, guestIdentity)).toBe(true)
    expect(cartSessionBelongsToSomeoneElse(null, 'user-1')).toBe(true)
  })
})
