import { describe, expect, it } from 'vitest'

import { remainingForLine } from './menuStockDisplay'

/**
 * What a limited dish lets you set when you go back and edit the line.
 *
 * <p>
 * Editing replaces the line's quantity; it does not add to it. Counting the edited line's own
 * portions as "already in the cart" made the ceiling smaller than the quantity already on screen —
 * so the plus button was dead the moment the sheet opened, and the only direction was down. The
 * server excludes the edited line for this reason, and the screen has to agree with it.
 * </p>
 */
describe('how many a limited dish allows while editing a line', () => {
  const stock = 3

  /** Adding: the cart's existing portions are a ceiling on top of what is there. */
  it('counts what the cart holds when adding', () => {
    expect(remainingForLine(stock, 2, null)).toBe(1)
  })

  /** Editing: the line being replaced is not competing with itself. */
  it('does not count the line being replaced', () => {
    expect(remainingForLine(stock, 2, 2)).toBe(3)
  })

  /** Other lines of the same dish still count against it. */
  it('still counts the other lines in the cart', () => {
    // This line holds 2, another line holds 1.
    expect(remainingForLine(stock, 3, 2)).toBe(2)
  })

  /**
   * The ceiling never lands below what the line already holds — that is what left the plus button
   * dead and made the only direction down.
   */
  it('never lands below the quantity already on screen', () => {
    for (const held of [1, 2, 3]) {
      expect(remainingForLine(stock, held, held)).toBeGreaterThanOrEqual(held)
    }
  })

  /** An unlimited dish has no ceiling in either mode. */
  it('says nothing about a dish that is not limited', () => {
    expect(remainingForLine(null, 4, 2)).toBeNull()
    expect(remainingForLine(undefined, 4, null)).toBeNull()
  })
})
