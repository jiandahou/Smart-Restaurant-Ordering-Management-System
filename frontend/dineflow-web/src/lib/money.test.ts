import { describe, expect, it } from 'vitest'
import { isWholeCents } from './money'

describe('isWholeCents', () => {
  it('rejects amounts finer than a cent', () => {
    expect(isWholeCents(9.999)).toBe(false)
    expect(isWholeCents(0.001)).toBe(false)
    expect(isWholeCents(10.005)).toBe(false)
  })

  it('accepts amounts that can be charged', () => {
    expect(isWholeCents(9.99)).toBe(true)
    expect(isWholeCents(10)).toBe(true)
    expect(isWholeCents(0.01)).toBe(true)
    expect(isWholeCents(1_000_000)).toBe(true)
  })

  it('does not fail amounts that binary floating point cannot hold exactly', () => {
    // 1.15 * 100 is 114.99999999999999 in IEEE 754. Testing the product against its rounded value
    // rather than the decimal text keeps prices like this one usable.
    expect(isWholeCents(1.15)).toBe(true)
    expect(isWholeCents(70.07)).toBe(true)
    expect(isWholeCents(1.005)).toBe(false)
  })

  it('rejects values that are not numbers at all', () => {
    // The field feeds valueAsNumber, which is NaN while the input is empty.
    expect(isWholeCents(Number.NaN)).toBe(false)
    expect(isWholeCents(Number.POSITIVE_INFINITY)).toBe(false)
  })
})
