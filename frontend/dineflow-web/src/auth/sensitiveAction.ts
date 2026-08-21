import { errorCodeOf } from '../api/auth'

/**
 * Re-raises a refused second factor so the verification dialog keeps it.
 *
 * <p>Each action swallows its own failure into a toast, which the dialog reads as success and
 * closes — so a mistyped code discarded the whole thing and the action had to be started again from
 * the beginning. A wrong code is the one failure the person can fix on the spot.</p>
 */
export function rethrowIfSecondFactorRefused(error: unknown) {
  if (errorCodeOf(error) === 'mfa_verification_required') {
    throw error
  }
}
