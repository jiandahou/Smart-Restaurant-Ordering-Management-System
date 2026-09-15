import { describe, expect, it } from 'vitest'
import { adminHome, adminRoles, customerHome, resolvePostLoginDestination } from './postLoginDestination'

/**
 * An owner signing in with a passkey landed on the customer profile. The explicit navigation was
 * right; the login page's own "already signed in" guard sent everyone to the profile and won the
 * race, because storing the session re-rendered the page before that navigation ran.
 */
describe('where signing in lands', () => {
  it.each(adminRoles)('sends %s to the dashboard', (role) => {
    expect(resolvePostLoginDestination([role])).toBe(adminHome)
  })

  it('sends a customer to their profile', () => {
    expect(resolvePostLoginDestination(['Customer'])).toBe(customerHome)
  })

  it('sends staff to their profile, since the console is not theirs', () => {
    expect(resolvePostLoginDestination(['Staff'])).toBe(customerHome)
  })

  it('takes the console when an account holds both', () => {
    expect(resolvePostLoginDestination(['Customer', 'RestaurantOwner'])).toBe(adminHome)
  })

  it('falls back to the profile rather than throwing when roles are missing', () => {
    // The passkey response was the one where a missing field would have gone unnoticed.
    expect(resolvePostLoginDestination(undefined)).toBe(customerHome)
    expect(resolvePostLoginDestination([])).toBe(customerHome)
  })
})
