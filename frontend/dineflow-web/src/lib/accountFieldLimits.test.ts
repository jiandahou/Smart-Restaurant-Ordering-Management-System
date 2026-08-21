import { describe, expect, it } from 'vitest'
import { fullNameMaximumLength, fullNameSchema, optionalFullNameSchema } from './nameFields'
import { passwordMaximumLength, passwordSchema } from './passwordPolicy'

const validPassword = 'Sunshine1!'

describe('the full name field', () => {
  it('rejects a name of nothing but whitespace', () => {
    // Three spaces passed this check and created a real account with a confirmation email.
    const result = fullNameSchema().safeParse('   ')

    expect(result.success).toBe(false)
    expect(result.error?.issues[0].message).toBe('Full name is required.')
  })

  it.each(['\t\t', '\n', '   '])('rejects other whitespace-only names: %j', (value) => {
    expect(fullNameSchema().safeParse(value).success).toBe(false)
  })

  it('hands on the trimmed value, so padding never reaches the server', () => {
    const result = fullNameSchema().safeParse('  Ada Lovelace  ')

    expect(result.success).toBe(true)
    expect(result.data).toBe('Ada Lovelace')
  })

  it('accepts a name at the maximum and rejects one past it', () => {
    expect(fullNameSchema().safeParse('a'.repeat(fullNameMaximumLength)).success).toBe(true)
    expect(fullNameSchema().safeParse('a'.repeat(fullNameMaximumLength + 1)).success).toBe(false)
  })

  it('measures the length after trimming, not before', () => {
    // Otherwise trailing spaces could fail a name that is actually within the limit.
    const padded = `  ${'a'.repeat(fullNameMaximumLength)}  `

    expect(fullNameSchema().safeParse(padded).success).toBe(true)
  })

  it('lets the admin edit form leave the name untouched, but still bounds it', () => {
    // A blank name there means "leave it as it was" rather than "clear it".
    expect(optionalFullNameSchema().safeParse('').success).toBe(true)
    expect(optionalFullNameSchema().safeParse('a'.repeat(fullNameMaximumLength + 1)).success).toBe(false)
  })
})

describe('the password field', () => {
  it('accepts a compliant password at the maximum', () => {
    const atLimit = validPassword + 'a'.repeat(passwordMaximumLength - validPassword.length)

    expect(atLimit).toHaveLength(passwordMaximumLength)
    expect(passwordSchema.safeParse(atLimit).success).toBe(true)
  })

  it('rejects one character past the maximum', () => {
    // 4096 compliant characters used to pass, leaving the server to hash all of it.
    const tooLong = validPassword + 'a'.repeat(passwordMaximumLength)

    const result = passwordSchema.safeParse(tooLong)

    expect(result.success).toBe(false)
    expect(result.error?.issues[0].message).toContain(`${passwordMaximumLength} characters or fewer`)
  })

  it('reports the length on its own, not buried under the other rules', () => {
    // An over-long password that also lacks a symbol should say what is actionable first.
    const result = passwordSchema.safeParse('a'.repeat(passwordMaximumLength + 1))

    expect(result.success).toBe(false)
    expect(result.error?.issues).toHaveLength(1)
    expect(result.error?.issues[0].message).toContain('characters or fewer')
  })

  it('still applies the composition rules below the maximum', () => {
    expect(passwordSchema.safeParse('alllowercase').success).toBe(false)
    expect(passwordSchema.safeParse(validPassword).success).toBe(true)
  })
})
