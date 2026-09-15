import { describe, expect, it, vi } from 'vitest'
import { rethrowIfSecondFactorRefused } from '../auth/sensitiveAction'

vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../hooks', () => ({ useAppDispatch: () => vi.fn(), useAppSelector: () => null }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

/**
 * Each action caught its own failure and turned it into a toast, so the verification dialog saw a
 * resolved promise, called it success and closed. A mistyped code therefore threw away the whole
 * action and it had to be started again from the beginning — the one failure that can be corrected
 * on the spot was the one that could not be.
 */
describe('a refused second factor', () => {
  it('is raised again so the dialog keeps it', () => {
    const refused = { name: 'Error', message: 'MFA verification is required to change passkeys.', code: 'mfa_verification_required' }

    expect(() => rethrowIfSecondFactorRefused(refused)).toThrow()
  })

  it('is recognised on a real Error as well as a serialised one', () => {
    const refused = Object.assign(new Error('Refused.'), { code: 'mfa_verification_required' })

    expect(() => rethrowIfSecondFactorRefused(refused)).toThrow('Refused.')
  })

  it('leaves the action alone when the action itself failed', () => {
    // Nothing about a passkey the browser refused can be fixed by retyping a code.
    expect(() => rethrowIfSecondFactorRefused({ name: 'NotAllowedError', message: 'Cancelled.' })).not.toThrow()
    expect(() => rethrowIfSecondFactorRefused(new Error('Email is already in use.'))).not.toThrow()
    expect(() => rethrowIfSecondFactorRefused(null)).not.toThrow()
  })
})

describe('the actions that run behind a verification prompt', () => {
  const page = (import.meta.glob('./ProfilePage.tsx', {
    query: '?raw', import: 'default', eager: true,
  }) as Record<string, string>)['./ProfilePage.tsx']

  /** Each action's catch block, keyed by the toast it raises. */
  const catchBlockOf = (toastTitle: string) => {
    const at = page.indexOf(toastTitle)
    expect(at).toBeGreaterThanOrEqual(0)
    return page.slice(page.lastIndexOf('} catch', at), at)
  }

  it.each([
    "'Could not add passkey'",
    "'Could not rename passkey'",
    "'Could not delete passkey'",
    "'Could not disable MFA'",
    "'Could not request email change'",
  ])('%s re-raises a refused second factor before swallowing the failure', (toastTitle) => {
    expect(catchBlockOf(toastTitle)).toContain('rethrowIfSecondFactorRefused')
  })
})
