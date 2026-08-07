import { describe, expect, it } from 'vitest'
import {
  buildRestaurantMenuPath,
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
