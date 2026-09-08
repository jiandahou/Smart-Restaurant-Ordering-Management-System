import { describe, expect, it } from 'vitest'
import { refundedItemLabel } from './refundedItemLabel'

/**
 * "1 × Chicken Wings — 0.74" reads as the whole plate returned for 74 cents. It was the sauce on it,
 * and saying which is the one thing a refund record exists for.
 */
describe('naming what a refund was for', () => {
  it('names the extra and the dish it was on', () => {
    expect(refundedItemLabel({ menuItemNameSnapshot: 'Chicken Wings', optionNameSnapshot: 'Smoky BBQ' }))
      .toBe('Smoky BBQ on Chicken Wings')
  })

  it('names the dish alone when the refund was for the whole line', () => {
    expect(refundedItemLabel({ menuItemNameSnapshot: 'Chicken Wings', optionNameSnapshot: null }))
      .toBe('Chicken Wings')
  })

  /** Rows written before extras could be named carry no field at all, and still read correctly. */
  it('reads a record from before extras could be named', () => {
    expect(refundedItemLabel({ menuItemNameSnapshot: 'Chicken Wings' })).toBe('Chicken Wings')
  })
})
