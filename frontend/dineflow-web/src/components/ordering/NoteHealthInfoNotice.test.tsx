import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { NoteHealthInfoNotice } from './NoteHealthInfoNotice'

/**
 * What a customer is told at the moment they are asked for an allergy.
 *
 * <p>
 * Both note fields offer one-tap buttons labelled <i>Allergies</i>, so the product asks for health
 * information outright. The item note said nothing at all; the order note covered the safety limit
 * and nothing about what then happens to what was written. The privacy policy explains that the note
 * goes to restaurant staff, is printed on the kitchen ticket, and is kept with the order — but a
 * policy page nobody opened is not a notice at the point of collection, which is the only point
 * where the customer can still decide what to write.
 * </p>
 */
function show(scope: 'item' | 'order') {
  return render(
    <MemoryRouter>
      <NoteHealthInfoNotice scope={scope} />
    </MemoryRouter>,
  )
}

describe('the notice beside a note field', () => {
  it.each(['item', 'order'] as const)('says what happens to a %s note', (scope) => {
    show(scope)

    const privacy = screen.getByTestId(`note-privacy-notice-${scope}`)

    // The three things a customer cannot otherwise know: who sees it, that it is printed, that it
    // is kept.
    expect(privacy).toHaveTextContent(/restaurant staff/i)
    expect(privacy).toHaveTextContent(/printed on the kitchen ticket/i)
    expect(privacy).toHaveTextContent(/kept with your order/i)
  })

  it.each(['item', 'order'] as const)('points a %s note at the policy for the rest', (scope) => {
    show(scope)

    const link = within(screen.getByTestId(`note-privacy-notice-${scope}`))
      .getByRole('link', { name: /privacy policy/i })

    expect(link).toHaveAttribute('href', '/privacy')
  })

  /** Asks for the minimum, rather than inviting a medical history into a kitchen ticket. */
  it.each(['item', 'order'] as const)('asks a %s note to stay to what is needed', (scope) => {
    show(scope)

    expect(screen.getByTestId(`note-privacy-notice-${scope}`))
      .toHaveTextContent(/only what the kitchen needs/i)
  })

  /**
   * The safety limit stays where it was: it belongs beside the allergy being typed, and the item
   * note never had it.
   */
  it.each(['item', 'order'] as const)('keeps the cross-contact limit on a %s note', (scope) => {
    show(scope)

    expect(screen.getByText(/cannot guarantee prevention of/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /allergen cross-contact/i }))
      .toHaveAttribute('href', '/allergen-information')
    expect(screen.getByText(/contact the restaurant before ordering/i)).toBeInTheDocument()
  })
})
