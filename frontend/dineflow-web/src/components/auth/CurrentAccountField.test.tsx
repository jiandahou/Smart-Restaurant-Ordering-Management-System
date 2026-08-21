import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CurrentAccountField } from './CurrentAccountField'

/**
 * An email field followed by a password field reads as a sign-in form. On the change-email form a
 * password manager holding several logins for this site filled one of them over the top of what had
 * been typed — another account's address as the "new email", that account's password as the
 * "current password".
 */
describe('naming the account a form belongs to', () => {
  const field = () => document.querySelector('input[autocomplete="username"]')

  it('carries the current address as the username', () => {
    render(<CurrentAccountField email="owner@dineflow.com" />)

    expect(field()).toHaveValue('owner@dineflow.com')
  })

  it('cannot be typed into or tabbed to', () => {
    render(<CurrentAccountField email="owner@dineflow.com" />)

    expect(field()).toHaveAttribute('readonly')
    expect(field()).toHaveAttribute('tabindex', '-1')
  })

  it('is hidden from assistive technology, having nothing to say to it', () => {
    render(<CurrentAccountField email="owner@dineflow.com" />)

    expect(field()).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('stays rendered rather than display:none, which managers skip', () => {
    render(<CurrentAccountField email="owner@dineflow.com" />)

    expect(field()).toHaveClass('sr-only')
    expect(field()).not.toHaveAttribute('hidden')
  })

  it('renders nothing when there is no account address to name', () => {
    const { container } = render(<CurrentAccountField email={null} />)

    expect(container).toBeEmptyDOMElement()
  })
})

describe('the forms that need it', () => {
  const profilePage = (import.meta.glob('../../pages/ProfilePage.tsx', {
    query: '?raw', import: 'default', eager: true,
  }) as Record<string, string>)['../../pages/ProfilePage.tsx']

  /** The markup of one inline form on the profile page. */
  const formNamed = (handler: string) => {
    const start = profilePage.indexOf(handler)
    expect(start).toBeGreaterThanOrEqual(0)
    return profilePage.slice(start, profilePage.indexOf('</form>', start))
  }

  it('the change-email form names the account', () => {
    expect(formNamed('emailChangeForm.handleSubmit')).toContain('<CurrentAccountField')
  })

  it('the change-email form does not ask for an email to be autofilled', () => {
    // autoComplete="email" beside a password field is exactly what invites the wrong credential.
    const form = formNamed('emailChangeForm.handleSubmit')

    expect(form).toContain('autoComplete="off"')
    expect(form).not.toContain('autoComplete="email"')
  })

  it('the password form names the account, so the right entry is updated', () => {
    expect(formNamed('directPasswordResetForm.handleSubmit')).toContain('<CurrentAccountField')
  })
})
