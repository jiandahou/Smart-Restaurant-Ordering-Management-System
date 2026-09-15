import { describe, expect, it } from 'vitest'
import {
  describeMissingPasswordRules,
  evaluatePassword,
  isPasswordAcceptable,
  passwordMinimumLength,
  passwordSchema,
} from './passwordPolicy'

describe('password policy', () => {
  it('requires eight characters, both cases, a number and a symbol', () => {
    expect(passwordMinimumLength).toBe(8)
    expect(isPasswordAcceptable('Aa1!aaaa')).toBe(true)
  })

  it('rejects a seven-character password that satisfies every other rule', () => {
    // The old policy accepted six characters; this is the boundary that moved.
    expect(isPasswordAcceptable('Aa1!aaa')).toBe(false)
    expect(describeMissingPasswordRules('Aa1!aaa')).toEqual(['At least 8 characters'])
  })

  it('names every unmet rule at once rather than one per attempt', () => {
    expect(describeMissingPasswordRules('password')).toEqual([
      'An uppercase letter',
      'A number',
      'A symbol (for example ! ? # @)',
    ])
  })

  it('reports an empty password as failing every rule', () => {
    const rules = evaluatePassword('')

    expect(rules).not.toHaveLength(0)
    expect(rules.every((rule) => !rule.met)).toBe(true)
  })

  it('counts a non-ASCII symbol as a symbol', () => {
    expect(isPasswordAcceptable('Passwörd1£')).toBe(true)
  })

  it('surfaces the missing rules through the shared zod schema', () => {
    const result = passwordSchema.safeParse('short1')

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe(
      'Password still needs: at least 8 characters, an uppercase letter, a symbol (for example ! ? # @).',
    )
  })

  it('accepts a compliant password through the schema', () => {
    expect(passwordSchema.safeParse('ChangeMe123!').success).toBe(true)
  })
})
