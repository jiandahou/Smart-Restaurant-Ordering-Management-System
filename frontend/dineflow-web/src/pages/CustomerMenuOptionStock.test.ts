import { describe, expect, it } from 'vitest'

// Vite hands the file over as text; reading it through node would drag node's types into an app
// config that deliberately does not carry them.
import page from './CustomerMenuPage.tsx?raw'

/**
 * That the option rows are actually told what is left.
 *
 * <p>
 * The stock was tracked, reserved at checkout and published on every option, and the panel read none
 * of it — so a modifier with two left showed "Max 3", let three be chosen, and was refused at
 * payment. A rule that is never given its input passes every test about the rule.
 * </p>
 */
describe('the option rows in the item sheet', () => {
  const optionRow = () => {
    const start = page.indexOf('{group.options.map((option) => {')

    expect(start).toBeGreaterThan(-1)

    return page.slice(start, start + 6000)
  }

  it('works each modifier out from its stock, not its recipe rule alone', () => {
    expect(optionRow()).toContain('optionPerItemLimit(')
    expect(optionRow()).toContain('option.remainingStock')
  })

  it('stops the plus button at that ceiling', () => {
    // The whole defect in one line: capped at maxQuantity, the stepper walks past the stock.
    expect(optionRow()).toContain('selectedQuantity < optionCeiling')
    expect(optionRow()).not.toContain('selectedQuantity < option.maxQuantity')
  })

  it('counts what the cart already holds, excluding the line being edited', () => {
    expect(page).toContain('optionUnitsInCart(cart.items, editingCartItem?.id ?? null)')
  })

  it('says the count rather than the recipe rule when there is a count', () => {
    // "Max 3" beside two left is telling the customer something the server will refuse.
    const row = optionRow()

    expect(row).toContain('available')
    expect(row).toContain('Sold out')
  })

  it('will not let a sold-out modifier be chosen', () => {
    expect(optionRow()).toContain('!selected && optionSoldOut')
  })

  it('does not open a required group with a sold-out choice already ticked', () => {
    // A required group opens with its first choices ticked; one that has run out would open the
    // panel already refusable, with nothing saying why.
    const defaults = page.slice(
      page.indexOf('function getDefaultSelectedOptionIds'),
      page.indexOf('function getOrderedSelectedOptions'),
    )

    expect(defaults).toContain('option.remainingStock == null || option.remainingStock > 0')
  })

  /**
   * The cart drawer carries its own modifier steppers. Two copies of a ceiling drift, and the one
   * nobody remembered is the one the customer is using — this line is reached by editing from the
   * cart, which is where the defect was reported from.
   */
  it('applies the same ceiling to the steppers in the cart drawer', () => {
    const line = page.slice(
      page.indexOf('function CartSummaryLine'),
      page.indexOf('function CartSummaryLine') + 5000,
    )

    expect(line).toContain('optionPerItemLimit(')
    expect(line).toContain('optionQuantity < optionCeiling')
    expect(line).not.toContain('optionQuantity < optionDefinition.option.maxQuantity')
  })

  it('gives that drawer the rest of the cart, not the line it is on', () => {
    expect(page).toContain('optionUnitsInCart(cart.items, item.id)')
  })

  it('blocks the add button when a raised dish quantity outruns a modifier', () => {
    // The stepper caps each modifier at the current quantity; raising the quantity afterwards is
    // the usual way a selection that was fine stops being fine.
    expect(page).toContain('getOptionStockError(item, selectedOptionIds, quantity, optionUnitsInCart)')
  })
})
