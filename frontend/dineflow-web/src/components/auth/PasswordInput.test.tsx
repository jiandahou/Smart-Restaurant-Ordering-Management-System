import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PasswordInput } from './PasswordInput'

describe('the password visibility control', () => {
  it('starts hidden', () => {
    render(<PasswordInput aria-label="Password" />)

    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('reveals and hides the value, keeping what was typed', async () => {
    // Swapping the element out instead of its type would lose the value and the caret.
    const user = userEvent.setup()
    render(<PasswordInput aria-label="Password" />)
    const field = screen.getByLabelText('Password')
    await user.type(field, 'Sunshine1!')

    await user.click(screen.getByRole('button', { name: 'Show password' }))

    expect(field).toHaveAttribute('type', 'text')
    expect(field).toHaveValue('Sunshine1!')

    await user.click(screen.getByRole('button', { name: 'Hide password' }))

    expect(field).toHaveAttribute('type', 'password')
    expect(field).toHaveValue('Sunshine1!')
  })

  it('reports its state to assistive technology, not just through the icon', async () => {
    const user = userEvent.setup()
    render(<PasswordInput aria-label="Password" />)

    await user.click(screen.getByRole('button', { name: 'Show password' }))

    const toggle = screen.getByRole('button', { name: 'Hide password' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
  })

  it('never submits the form it sits in', async () => {
    // A bare <button> inside a form defaults to type="submit", which would send the form on toggle.
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
    const user = userEvent.setup()
    render(
      <form onSubmit={onSubmit}>
        <PasswordInput aria-label="Password" />
      </form>,
    )

    await user.click(screen.getByRole('button', { name: 'Show password' }))

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('stays out of the tab order between the field and the submit button', async () => {
    const user = userEvent.setup()
    render(
      <form>
        <PasswordInput aria-label="Password" />
        <button type="submit">Sign in</button>
      </form>,
    )

    screen.getByLabelText('Password').focus()
    await user.tab()

    expect(screen.getByRole('button', { name: 'Sign in' })).toHaveFocus()
  })
})
