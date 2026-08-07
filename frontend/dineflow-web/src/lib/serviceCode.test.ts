import { describe, expect, it } from 'vitest'
import { formatPickupNumber, formatServiceCode, hasServiceCode } from './serviceCode'

const base = {
  orderNumber: 'ORD-20260730-751344',
  pickupNumber: 7,
  tableNumber: null as string | null,
}

describe('formatPickupNumber', () => {
  it('pads to three digits', () => {
    expect(formatPickupNumber(7)).toBe('007')
    expect(formatPickupNumber(42)).toBe('042')
  })

  it('does not truncate numbers past three digits', () => {
    expect(formatPickupNumber(1234)).toBe('1234')
  })

  it('returns null when there is no usable number', () => {
    expect(formatPickupNumber(null)).toBeNull()
    expect(formatPickupNumber(0)).toBeNull()
    expect(formatPickupNumber(-1)).toBeNull()
  })
})

describe('formatServiceCode', () => {
  it('pairs the table with the pickup number for dine-in', () => {
    expect(formatServiceCode({ ...base, tableNumber: 'P2' })).toBe('P2-007')
  })

  it('shows only the pickup number without a table', () => {
    expect(formatServiceCode(base)).toBe('007')
  })

  it('ignores a blank table number', () => {
    expect(formatServiceCode({ ...base, tableNumber: '   ' })).toBe('007')
  })

  it('falls back to the order number for orders predating pickup numbers', () => {
    expect(formatServiceCode({ ...base, pickupNumber: null })).toBe('ORD-20260730-751344')
    expect(formatServiceCode({ ...base, pickupNumber: null, tableNumber: 'P2' }))
      .toBe('ORD-20260730-751344')
  })
})

describe('hasServiceCode', () => {
  it('reports whether a real pickup number was available', () => {
    expect(hasServiceCode(base)).toBe(true)
    expect(hasServiceCode({ ...base, pickupNumber: null })).toBe(false)
  })
})
