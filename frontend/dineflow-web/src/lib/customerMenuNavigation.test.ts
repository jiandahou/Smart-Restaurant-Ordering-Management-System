import { describe, expect, it } from 'vitest'
import {
  buildRestaurantMenuPath,
  buildViewerMenuPath,
  getSafeMenuReturnPath,
  normalizeCustomerMenuOrderType,
  parseCustomerMenuOrderType,
} from './customerMenuNavigation'

describe('customer menu navigation', () => {
  it('maps past dine-in and takeaway orders to their original ordering mode', () => {
    expect(normalizeCustomerMenuOrderType(0)).toBe('DineIn')
    expect(normalizeCustomerMenuOrderType(1)).toBe('Takeaway')
    expect(normalizeCustomerMenuOrderType('DineIn')).toBe('DineIn')
    expect(normalizeCustomerMenuOrderType('Takeaway')).toBe('Takeaway')
  })

  it('treats scheduled orders as takeaway when reopening the menu', () => {
    expect(normalizeCustomerMenuOrderType(2)).toBe('Takeaway')
    expect(normalizeCustomerMenuOrderType('Scheduled')).toBe('Takeaway')
  })

  it('builds a direct menu URL containing the previous ordering mode', () => {
    expect(buildRestaurantMenuPath('restaurant/id', 0))
      .toBe('/r/restaurant%2Fid/menu?orderType=DineIn')
  })

  it('only accepts supported menu query values', () => {
    expect(parseCustomerMenuOrderType('DineIn')).toBe('DineIn')
    expect(parseCustomerMenuOrderType('Takeaway')).toBe('Takeaway')
    expect(parseCustomerMenuOrderType('Scheduled')).toBeNull()
    expect(parseCustomerMenuOrderType(null)).toBeNull()
  })
})

/**
 * A return path arrives in a URL anybody can edit, so an unchecked one turns whatever page carries
 * it into an open redirect. Same-origin is not enough on its own either — a customer following a
 * "back to menu" button should never land in an admin screen.
 */
describe('deciding whether a return path is safe to follow', () => {
  it('accepts a restaurant menu path', () => {
    expect(getSafeMenuReturnPath('/r/abc/menu')).toBe('/r/abc/menu')
    expect(getSafeMenuReturnPath('/r/abc/menu?orderType=Takeaway')).toBe('/r/abc/menu?orderType=Takeaway')
  })

  it('accepts a table QR path', () => {
    expect(getSafeMenuReturnPath('/table/token-1')).toBe('/table/token-1')
  })

  it('refuses another origin however it is written', () => {
    expect(getSafeMenuReturnPath('https://evil.example.com')).toBeNull()
    // Protocol-relative: no scheme, still somebody else's server.
    expect(getSafeMenuReturnPath('//evil.example.com')).toBeNull()
    expect(getSafeMenuReturnPath('javascript:alert(1)')).toBeNull()
  })

  it('refuses a same-origin path that is not a menu', () => {
    // Following a "back to menu" button into the order queue would be its own kind of wrong.
    expect(getSafeMenuReturnPath('/admin/orders')).toBeNull()
    expect(getSafeMenuReturnPath('/me')).toBeNull()
    expect(getSafeMenuReturnPath('/')).toBeNull()
  })

  it('is not fooled by a menu path in the query string', () => {
    expect(getSafeMenuReturnPath('/admin/orders?next=/r/abc/menu')).toBeNull()
    expect(getSafeMenuReturnPath('https://evil.example.com/r/abc/menu')).toBeNull()
  })

  it('treats nothing at all as nothing to go back to', () => {
    expect(getSafeMenuReturnPath(null)).toBeNull()
    expect(getSafeMenuReturnPath(undefined)).toBeNull()
    expect(getSafeMenuReturnPath('   ')).toBeNull()
  })
})
/**
 * Where the account menu points, and where signing out lands. Signing out used to go to `/login`,
 * which stranded a customer on a sign-in form instead of the restaurant they were ordering from.
 */
describe('the menu a customer is currently reading', () => {
  it('keeps a seated diner on their table QR', () => {
    expect(buildViewerMenuPath('token-1', 'restaurant-1', 0)).toBe('/table/token-1')
    // Rewriting this to /r/<id>/menu would drop the token that rejoins the table's shared cart.
    expect(buildViewerMenuPath('token-1', 'restaurant-1', 1)).toBe('/table/token-1')
  })

  it('sends a takeaway customer back to the restaurant menu in the mode they were using', () => {
    expect(buildViewerMenuPath(null, 'restaurant-1', 1)).toBe('/r/restaurant-1/menu?orderType=Takeaway')
    expect(buildViewerMenuPath(undefined, 'restaurant-1', 0)).toBe('/r/restaurant-1/menu?orderType=DineIn')
  })

  it('never sends anybody to a sign-in form', () => {
    for (const path of [
      buildViewerMenuPath('token-1', 'restaurant-1', 0),
      buildViewerMenuPath(null, 'restaurant-1', 1),
    ]) {
      expect(path).not.toBe('/login')
      expect(getSafeMenuReturnPath(path)).toBe(path)
    }
  })

  it('escapes a token that would otherwise change the path', () => {
    expect(buildViewerMenuPath('a/b?c', 'restaurant-1', 0)).toBe('/table/a%2Fb%3Fc')
  })
})
