import { describe, expect, it } from 'vitest'
import { refundRequestSummary } from './refundRequestSummary'

/**
 * A refund request for $1.96 beside one for $32.52 reads as a mistake until you know the first is a
 * sauce. The list showed the amount and the customer's reason and nothing about what was asked for.
 */
describe('summarising a refund request for a list', () => {
  it('names the item when there is one', () => {
    expect(refundRequestSummary([{ menuItemNameSnapshot: 'Chicken Wings' }]))
      .toBe('Chicken Wings')
  })

  it('names the extra and the dish it was on', () => {
    expect(refundRequestSummary([
      { menuItemNameSnapshot: 'Butter Chicken', optionNameSnapshot: 'Extra gravy' },
    ])).toBe('Extra gravy on Butter Chicken')
  })

  /** The first item answers "what is this", and the count carries the rest without wrapping. */
  it('counts the rest rather than listing them', () => {
    expect(refundRequestSummary([
      { menuItemNameSnapshot: 'Butter Chicken', optionNameSnapshot: 'Extra gravy' },
      { menuItemNameSnapshot: 'Chicken Wings' },
      { menuItemNameSnapshot: 'Garlic Bread' },
    ])).toBe('Extra gravy on Butter Chicken +2 more')
  })

  /** Older requests carry no lines, and a row saying "no items" is worse than one saying nothing. */
  it('says nothing when there is nothing to say', () => {
    expect(refundRequestSummary([])).toBe('')
  })
})
