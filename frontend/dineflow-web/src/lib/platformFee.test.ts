import { describe, expect, it } from 'vitest'
import { buildFeePreview, calculateOrderFeeCents, percentToBasisPoints } from './platformFee'

describe('calculateOrderFeeCents', () => {
  it('matches the server for the rate that caused the confusion', () => {
    // 10 bps = 0.1%. An $18.50 order really does yield 2 cents, which is what was observed.
    expect(calculateOrderFeeCents(1850, 10)).toBe(2)
    expect(calculateOrderFeeCents(1450, 10)).toBe(1)
  })

  it('scales as expected at a normal commission rate', () => {
    expect(calculateOrderFeeCents(1850, 1000)).toBe(185) // 10%
    expect(calculateOrderFeeCents(1850, 100)).toBe(19) // 1%, rounded from 18.5
  })

  it('rounds halves away from zero like the server', () => {
    // 1850 * 10 / 10000 = 1.85 -> 2 ; 500 * 10 / 10000 = 0.5 -> 1
    expect(calculateOrderFeeCents(500, 10)).toBe(1)
  })

  it('never reaches the full charge amount', () => {
    // Stripe rejects an application fee equal to or above the charge.
    expect(calculateOrderFeeCents(1000, 10_000)).toBe(999)
  })

  it('returns zero for unusable inputs', () => {
    expect(calculateOrderFeeCents(0, 100)).toBe(0)
    expect(calculateOrderFeeCents(1, 100)).toBe(0)
    expect(calculateOrderFeeCents(1850, 0)).toBe(0)
    expect(calculateOrderFeeCents(1850, -5)).toBe(0)
  })
})

describe('percentToBasisPoints', () => {
  it('converts the percent field to stored basis points', () => {
    expect(percentToBasisPoints(0.1)).toBe(10)
    expect(percentToBasisPoints(1)).toBe(100)
    expect(percentToBasisPoints(10)).toBe(1000)
  })
})

describe('buildFeePreview', () => {
  it('shows nothing when no fee is charged', () => {
    expect(buildFeePreview(0, 'AUD')).toBeNull()
    expect(buildFeePreview(Number.NaN, 'AUD')).toBeNull()
  })

  it('spells out the real amounts so a percent cannot be read as dollars', () => {
    const preview = buildFeePreview(0.1, 'AUD')

    expect(preview).toContain('0.02')
    expect(preview).toContain('0.10')
  })

  it('warns when a rate is so small it rounds away', () => {
    expect(buildFeePreview(0.001, 'AUD')).toContain('Rounds to zero')
  })
})
