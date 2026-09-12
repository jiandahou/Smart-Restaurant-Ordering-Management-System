import { describe, expect, it } from 'vitest'

// Vite hands the file over as text; reading it through node would drag node's types into an app
// config that deliberately does not carry them.
import page from './CustomerMenuPage.tsx?raw'

/**
 * That the edit sheet is actually told which line it is editing.
 *
 * <p>
 * The rule's own tests check the arithmetic; this checks it is fed. Passing the whole cart's count
 * without saying which line is being replaced is what made the ceiling come out below the quantity
 * already on screen — the plus button was dead from the moment the sheet opened, and a rule that is
 * never given the right input passes every test about the rule.
 * </p>
 */
describe('the item sheet while editing a cart line', () => {
  it('is told how many the line being edited already holds', () => {
    expect(page).toContain('editingLineQuantity={editingCartItem?.quantity ?? null}')
  })

  it('works the ceiling out from that, not from the whole cart', () => {
    expect(page).toContain('remainingForLine(item.remainingStock, alreadyInCart, editingLineQuantity)')
  })

  /**
   * "More available" is only true while adding. An edit replaces the line, so the number is what the
   * line may hold in total.
   */
  it('does not say "more" when the line is being replaced', () => {
    const label = page.slice(page.indexOf('Choose how many'), page.indexOf('Choose how many') + 500)

    expect(label).toContain('isEditing')
    expect(label).toContain('more available')
  })
})

describe('the item sheet for an unavailable dish', () => {
  it('disables both quantity controls together with the rest of the ordering form', () => {
    expect(page).toMatch(
      /aria-label="Decrease quantity"[\s\S]{0,160}disabled=\{disabled \|\| quantity <= 1 \|\| isAdding\}/,
    )
    expect(page).toMatch(
      /aria-label="Increase quantity"[\s\S]{0,160}disabled=\{disabled \|\| isAdding \|\| \(addableNow !== null && quantity >= addableNow\)\}/,
    )
  })
})
