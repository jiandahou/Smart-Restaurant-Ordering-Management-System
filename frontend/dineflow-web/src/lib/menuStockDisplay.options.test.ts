import { describe, expect, it } from 'vitest'

import { optionPerItemLimit, optionUnitsInCart } from './menuStockDisplay'

/**
 * A modifier with two left showed "Max 3" and let all three be chosen, because the panel only ever
 * knew the recipe rule. The number the customer can act on is the lower of the two, and it changes
 * with the dish quantity and with the rest of the cart — none of which "Max 3" can express.
 */
describe('how many lots of a modifier fit on one dish', () => {
  it('stops at the stock when the recipe allows more', () => {
    // The reported defect: allows three per dish, two in the kitchen.
    expect(optionPerItemLimit(3, 2, 0, 1)).toBe(2)
  })

  it('stops at the recipe when the kitchen has plenty', () => {
    expect(optionPerItemLimit(2, 40, 0, 1)).toBe(2)
  })

  it('divides by the dish quantity, because the order multiplies', () => {
    // Three lots left, two dishes: one each. Undivided this reads three and oversells.
    expect(optionPerItemLimit(3, 3, 0, 2)).toBe(1)
  })

  it('counts what the rest of the cart has already spoken for', () => {
    expect(optionPerItemLimit(3, 3, 2, 1)).toBe(1)
  })

  it('reaches zero rather than going negative when the cart holds it all', () => {
    expect(optionPerItemLimit(3, 2, 5, 1)).toBe(0)
  })

  it('leaves an uncounted modifier to its recipe rule alone', () => {
    expect(optionPerItemLimit(3, null, 99, 10)).toBe(3)
  })
})

describe('what the cart already commits', () => {
  const line = (id: string, quantity: number, options: [string, number][]) => ({
    id,
    quantity,
    selectedOptions: options.map(([menuItemOptionId, optionQuantity]) => ({
      menuItemOptionId,
      quantity: optionQuantity,
    })),
  })

  it('multiplies each line by its own quantity', () => {
    // Two dishes each taking two lots commit four, not two.
    const units = optionUnitsInCart([line('a', 2, [['truffle', 2]])], null)

    expect(units.get('truffle')).toBe(4)
  })

  it('adds up across lines', () => {
    const units = optionUnitsInCart(
      [line('a', 2, [['truffle', 2]]), line('b', 1, [['truffle', 1], ['aioli', 3]])],
      null,
    )

    expect(units.get('truffle')).toBe(5)
    expect(units.get('aioli')).toBe(3)
  })

  it('leaves out the line being edited, which is replaced rather than added to', () => {
    // Counted as competing with itself, a line holding the last portions could only be reduced.
    const lines = [line('a', 2, [['truffle', 1]]), line('b', 1, [['truffle', 1]])]

    expect(optionUnitsInCart(lines, null).get('truffle')).toBe(3)
    expect(optionUnitsInCart(lines, 'a').get('truffle')).toBe(1)
  })

  it('ignores a modifier that has since been deleted', () => {
    // The line keeps a snapshot of it; there is no stock left to count against.
    const orphan = { id: 'a', quantity: 2, selectedOptions: [{ menuItemOptionId: null, quantity: 1 }] }

    expect(optionUnitsInCart([orphan], null).size).toBe(0)
  })
})
