import { describe, expect, it } from 'vitest'
import { isValidDirectRefundAmount, parseRefundAmountCents } from './refundAmount'

describe('parseRefundAmountCents', () => {
  it('converts a dollar string into cents', () => {
    expect(parseRefundAmountCents('25.00')).toBe(2500)
    expect(parseRefundAmountCents('9.99')).toBe(999)
  })

  it('returns null for empty, non-numeric, or blank input', () => {
    expect(parseRefundAmountCents('')).toBeNull()
    expect(parseRefundAmountCents('   ')).toBeNull()
    expect(parseRefundAmountCents('abc')).toBeNull()
  })

  it('rounds fractional cents', () => {
    expect(parseRefundAmountCents('10.005')).toBe(1001)
  })
})

describe('isValidDirectRefundAmount', () => {
  it('rejects null, zero, and negative amounts', () => {
    expect(isValidDirectRefundAmount(null, 1000)).toBe(false)
    expect(isValidDirectRefundAmount(0, 1000)).toBe(false)
    expect(isValidDirectRefundAmount(-100, 1000)).toBe(false)
  })

  it('accepts amounts at or below the refundable ceiling', () => {
    expect(isValidDirectRefundAmount(1000, 1000)).toBe(true)
    expect(isValidDirectRefundAmount(500, 1000)).toBe(true)
  })

  it('rejects amounts above the refundable ceiling', () => {
    expect(isValidDirectRefundAmount(1001, 1000)).toBe(false)
  })
})
