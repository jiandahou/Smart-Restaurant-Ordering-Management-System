import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { LockKeyhole } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import { MfaScopeSwitch } from './ProfilePage'

vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../hooks', () => ({ useAppDispatch: () => vi.fn(), useAppSelector: () => null }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function renderSwitch(props: Partial<Parameters<typeof MfaScopeSwitch>[0]> = {}) {
  return render(
    <MfaScopeSwitch
      icon={LockKeyhole}
      title="Login"
      description="Ask for MFA when this account signs in."
      checked={false}
      disabled={false}
      onCheckedChange={vi.fn()}
      {...props}
    />,
  )
}

/**
 * The three scope switches sat beside their titles without being connected to them, so a screen
 * reader announced "switch, on" three times with nothing to tell them apart.
 */
describe('an MFA scope switch', () => {
  it('is named by its title', () => {
    renderSwitch()

    expect(screen.getByRole('switch', { name: 'Login' })).toBeInTheDocument()
  })

  it('carries its description too, so the effect is not left to be guessed', () => {
    renderSwitch()

    expect(screen.getByRole('switch', { name: 'Login' }))
      .toHaveAccessibleDescription('Ask for MFA when this account signs in.')
  })

  it('gives each switch its own name when several are shown together', () => {
    render(
      <>
        <MfaScopeSwitch icon={LockKeyhole} title="Login" description="One." checked onCheckedChange={vi.fn()} disabled={false} />
        <MfaScopeSwitch icon={LockKeyhole} title="Sensitive actions" description="Two." checked={false} onCheckedChange={vi.fn()} disabled={false} />
      </>,
    )

    expect(screen.getByRole('switch', { name: 'Login' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Sensitive actions' })).not.toBeChecked()
  })

  it('reports its state rather than only showing it', () => {
    renderSwitch({ checked: true })

    expect(screen.getByRole('switch', { name: 'Login' })).toBeChecked()
  })

  it('can still be operated by name', async () => {
    const onCheckedChange = vi.fn()
    const user = userEvent.setup()
    renderSwitch({ onCheckedChange })

    await user.click(screen.getByRole('switch', { name: 'Login' }))

    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })
})
