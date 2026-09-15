import { describe, expect, it } from 'vitest'

// Vite hands the file over as text. Reading it through node would drag node's types into an app
// config that deliberately does not carry them.
import page from './CustomerMenuPage.tsx?raw'

/**
 * That the notice is actually beside both note fields.
 *
 * <p>
 * The component's own tests check what it says; this checks that it is there. The reported failure
 * was not wrong wording — it was a note field offering one-tap "Peanut allergy" and "Coeliac"
 * buttons with no notice next to it at all. A component nobody rendered would pass every test about
 * its contents.
 * </p>
 *
 * <p>
 * Read from the source because rendering this page means standing up a menu, a cart and a realtime
 * connection to assert the presence of two elements. What matters is the pairing: a note field and
 * the notice, together.
 * </p>
 */

/** The characters between a note field and whatever follows it. */
function whatFollows(marker: string, span = 900) {
  const at = page.indexOf(marker)
  expect(at, `Could not find ${marker} — has the note field been renamed?`).toBeGreaterThan(-1)
  return page.slice(at, at + span)
}

describe('the customer note fields', () => {
  it('puts the notice beside the item note', () => {
    expect(whatFollows('id="customer-item-note"')).toContain('<NoteHealthInfoNotice scope="item" />')
  })

  it('puts the notice beside the order note', () => {
    expect(whatFollows('placeholder="Please bring extra cutlery'))
      .toContain('<NoteHealthInfoNotice scope="order" />')
  })

  /**
   * Both fields invite an allergy with one tap, which is what makes the notice necessary rather than
   * decorative. If these buttons ever go, the reason for the notice changes and someone should look
   * at it again.
   */
  it('still offers one-tap allergies, which is why the notice is there', () => {
    expect(page).toContain("label: 'Allergies'")
    expect(page).toContain("'Peanut allergy'")
  })
})
