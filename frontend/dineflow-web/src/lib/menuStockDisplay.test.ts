import { describe, expect, it } from 'vitest'

import { describeStock, remainingAddable } from './menuStockDisplay'

describe('showing how much of a dish is left', () => {
  /** A customer choosing between dishes deserves to know which ones are finite. */
  it('shows the count on a comfortably stocked dish, quietly', () => {
    expect(describeStock(60, false)).toMatchObject({ label: '60 left', tone: 'plenty' })
    expect(describeStock(6, false)).toMatchObject({ label: '6 left', tone: 'plenty' })
  })

  it('raises its voice once the count is low', () => {
    expect(describeStock(5, false)).toMatchObject({ label: 'Only 5 left', tone: 'low' })
    expect(describeStock(2, false)).toMatchObject({ label: 'Only 2 left', tone: 'low' })
  })

  /** "Only 1 left" reads worse than naming it for what it is. */
  it('calls the last portion the last one', () => {
    expect(describeStock(1, false)).toMatchObject({ label: 'Last one', tone: 'low' })
  })

  /** An unlimited dish has no shortage to warn about; a badge on everything would mean nothing. */
  it('says nothing about an unlimited dish', () => {
    expect(describeStock(null, false)).toBeNull()
    expect(describeStock(undefined, false)).toBeNull()
  })

  /** The dish already says sold out; a count beside that contradicts it. */
  it('says nothing about a sold-out dish', () => {
    expect(describeStock(12, true)).toBeNull()
    expect(describeStock(0, false)).toBeNull()
    expect(describeStock(-3, false)).toBeNull()
  })

  /** A thumbnail badge is ~70px wide; "Only 3 left" wraps to two cramped lines there. */
  it('shortens to just the count for a thumbnail-sized badge', () => {
    expect(describeStock(3, false)?.shortLabel).toBe('3 left')
    expect(describeStock(1, false)?.shortLabel).toBe('1 left')
    expect(describeStock(60, false)?.shortLabel).toBe('60 left')
  })

  it('offers a spoken form for anyone not reading the colour', () => {
    expect(describeStock(1, false)?.srLabel).toBe('Last portion available')
    expect(describeStock(3, false)?.srLabel).toBe('Only 3 portions left')
    expect(describeStock(60, false)?.srLabel).toBe('60 portions left')
  })
})

describe('how many more can still be added', () => {
  it('subtracts what the cart already holds', () => {
    expect(remainingAddable(3, 1)).toBe(2)
    expect(remainingAddable(1, 1)).toBe(0)
  })

  it('never goes below zero', () => {
    expect(remainingAddable(1, 5)).toBe(0)
    expect(remainingAddable(-2, 0)).toBe(0)
  })

  it('treats an unlimited dish as having no ceiling', () => {
    expect(remainingAddable(null, 99)).toBeNull()
  })
})

/**
 * The server reports the kitchen's stock, which is not drawn down until checkout. So a customer who
 * put the last portion in their cart was still told "1 left" while the add button refused them.
 */
describe('counting what the customer is already holding', () => {
  it('takes the cart out of the count and says where it went', () => {
    expect(describeStock(3, false, 1)).toMatchObject({
      label: '2 left · 1 in cart',
      shortLabel: '2 left',
      inCart: 1,
    })
  })

  it('degrades the last portion to nothing left once it is in the cart', () => {
    expect(describeStock(1, false, 1)).toMatchObject({
      label: '0 left · 1 in cart',
      shortLabel: '0 left',
      tone: 'held',
      inCart: 1,
    })
  })

  /**
   * Holding the last of something is not the kitchen running out, and should not read like an
   * alarm — the customer has what they wanted.
   */
  it('does not sound the alarm when the shortage is the customer’s own cart', () => {
    expect(describeStock(1, false, 1)?.tone).toBe('held')
    expect(describeStock(1, false, 0)?.tone).toBe('low')
  })

  it('still sounds low while some are left to take', () => {
    expect(describeStock(6, false, 2)).toMatchObject({ label: '4 left · 2 in cart', tone: 'low' })
    expect(describeStock(60, false, 2)).toMatchObject({ label: '58 left · 2 in cart', tone: 'plenty' })
  })

  it('never counts below zero, however the cart got ahead of stock', () => {
    expect(describeStock(1, false, 5)).toMatchObject({ label: '0 left · 5 in cart' })
  })

  it('reads the whole thing aloud for anyone not seeing the badge', () => {
    expect(describeStock(3, false, 1)?.srLabel).toBe('2 left, 1 already in your cart')
  })

  it('is unchanged when the cart holds none of it', () => {
    expect(describeStock(3, false, 0)?.label).toBe('Only 3 left')
    expect(describeStock(3, false)?.label).toBe('Only 3 left')
  })
})
