import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ProviderIdentifier } from './ProviderIdentifier'

/**
 * The identifier lived inside the payments page, so every other screen printed the raw id and let it
 * dominate the row — including the Orders table the report was filed against. The same fact rendered
 * two ways in one product teaches people that one of the two is unreliable, and they cannot tell
 * which.
 */
const session = 'cs_test_a1FaKeSeSsIoNiDeNtIfIeRpAdDiNgToSiXtySixCharsLong0123456789abc'

describe('a provider identifier on screen', () => {
  it('shows a shortened form', () => {
    render(<ProviderIdentifier value={session} fallback="None" label="checkout session id" />)

    expect(screen.queryByText(session)).not.toBeInTheDocument()
    expect(screen.getByTitle(session)).toBeInTheDocument()
  })

  it('keeps the whole value reachable without copying', () => {
    // Hover and assistive technology both read the title, so nothing is actually lost.
    render(<ProviderIdentifier value={session} fallback="None" label="checkout session id" />)

    expect(screen.getByTitle(session).textContent).toContain('…')
  })

  it('copies the identifier in full, not the shortened form', async () => {
    // An abbreviated id on the clipboard is a trap: it looks pasteable and matches nothing.
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    render(<ProviderIdentifier value={session} fallback="None" label="checkout session id" />)
    await userEvent.click(screen.getByRole('button', { name: /copy checkout session id/i }))

    expect(writeText).toHaveBeenCalledWith(session)
  })

  it('says what is missing rather than showing an empty cell', () => {
    render(<ProviderIdentifier value={null} fallback="No checkout session yet" label="checkout session id" />)

    expect(screen.getByText('No checkout session yet')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
