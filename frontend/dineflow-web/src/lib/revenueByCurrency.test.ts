import { describe, expect, it } from 'vitest'
import { describeRevenue } from './revenueByCurrency'

/**
 * The summary used to add every paid order together regardless of currency and label the result
 * with whichever currency the first active restaurant happened to use: AUD 325.50 + INR 616.00 +
 * NPR 1113.00 was shown as "A$2054.50", roughly six times the actual Australian revenue.
 */
describe('describing paid revenue', () => {
  it('keeps each currency apart rather than inventing a total', () => {
    const described = describeRevenue([
      { currency: 'AUD', amount: 325.5, orders: 4 },
      { currency: 'INR', amount: 616, orders: 3 },
      { currency: 'NPR', amount: 1113, orders: 2 },
    ])

    expect(described).toContain('325.50')
    expect(described).toContain('616.00')
    expect(described).toContain('1,113.00')
    // The number that never existed.
    expect(described).not.toContain('2054.50')
    expect(described).not.toContain('2,054.50')
  })

  it('reads as one figure when the platform trades in one currency', () => {
    expect(describeRevenue([{ currency: 'AUD', amount: 325.5, orders: 4 }])).toBe('A$325.50')
  })

  it('says there is nothing rather than showing a zero in a guessed currency', () => {
    expect(describeRevenue([])).toBe('No paid orders')
    expect(describeRevenue(undefined)).toBe('No paid orders')
  })

  it('formats each amount in its own currency', () => {
    const described = describeRevenue([
      { currency: 'AUD', amount: 10, orders: 1 },
      { currency: 'INR', amount: 10, orders: 1 },
    ])

    expect(described).not.toBe('A$10.00 · A$10.00')
  })
})
