import { z } from 'zod'

/**
 * The password rules, in one place, so the form validation and the live checklist the user reads
 * can never disagree. Kept in step with the ASP.NET Identity options in Program.cs — a password
 * this file accepts must be one the server accepts, or the user is told they are done and then
 * rejected on submit.
 */
export const passwordMinimumLength = 8

/**
 * Hashing cost grows with the input, so an unbounded password is work anyone can ask the server
 * for. Long enough that no real passphrase is affected, and rejected rather than truncated —
 * silently hashing a prefix would let a shorter password open the account. Matches
 * AccountFieldLimits.PasswordMaxLength on the server.
 */
export const passwordMaximumLength = 128

export type PasswordRule = {
  id: string
  /** Phrased as the requirement, so it reads correctly whether met or not. */
  label: string
  isMet: (password: string) => boolean
}

export const passwordRules: readonly PasswordRule[] = [
  {
    id: 'length',
    label: `At least ${passwordMinimumLength} characters`,
    isMet: (password) => password.length >= passwordMinimumLength,
  },
  {
    id: 'lowercase',
    label: 'A lowercase letter',
    isMet: (password) => /[a-z]/.test(password),
  },
  {
    id: 'uppercase',
    label: 'An uppercase letter',
    isMet: (password) => /[A-Z]/.test(password),
  },
  {
    id: 'digit',
    label: 'A number',
    isMet: (password) => /[0-9]/.test(password),
  },
  {
    id: 'symbol',
    label: 'A symbol (for example ! ? # @)',
    isMet: (password) => /[^a-zA-Z0-9]/.test(password),
  },
]

export type PasswordRuleState = {
  id: string
  label: string
  met: boolean
}

export function evaluatePassword(password: string): PasswordRuleState[] {
  return passwordRules.map((rule) => ({
    id: rule.id,
    label: rule.label,
    met: rule.isMet(password),
  }))
}

export function isPasswordAcceptable(password: string): boolean {
  return passwordRules.every((rule) => rule.isMet(password))
}

/**
 * Every unmet rule at once. Zod reports one issue per field, which would drip-feed the
 * requirements one submit at a time; the checklist shows the whole picture instead.
 */
export function describeMissingPasswordRules(password: string): string[] {
  return passwordRules.filter((rule) => !rule.isMet(password)).map((rule) => rule.label)
}

export const passwordSchema = z.string().superRefine((password, context) => {
  if (password.length > passwordMaximumLength) {
    context.addIssue({
      code: 'custom',
      message: `Password must be ${passwordMaximumLength} characters or fewer.`,
    })
    return
  }

  const missing = describeMissingPasswordRules(password)

  if (missing.length === 0) {
    return
  }

  context.addIssue({
    code: 'custom',
    message: `Password still needs: ${missing.join(', ').toLowerCase()}.`,
  })
})
