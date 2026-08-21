import { describe, expect, it } from 'vitest'

import { compactIdentifier, identifierCompactAbove } from './providerIdentifier'

/**
 * A Checkout Session id is about 66 characters of base-58 noise. Printed whole in a table it is the
 * widest thing in the row, so the columns a person actually reads — amount, status, time — get
 * squeezed around a string nobody reads and everybody copies.
 */
describe('shortening a provider identifier', () => {
  const session = 'cs_test_a1FaKeSeSsIoNiDeNtIfIeRpAdDiNgToSiXtySixCharsLong0123456789abc'

  it('keeps the ends, which are the parts that identify it', () => {
    // The prefix says what kind of object it is and which mode it was made in; the tail is what
    // gets matched against Stripe's dashboard.
    const compact = compactIdentifier(session)

    expect(compact.startsWith('cs_test_a1')).toBe(true)
    expect(session.endsWith(compact.slice(-7))).toBe(true)
  })

  it('is unmistakably shortened rather than silently cut', () => {
    // A truncated id that looks whole is worse than a long one: it gets pasted into a search.
    expect(compactIdentifier(session)).toContain('…')
    expect(compactIdentifier(session).length).toBeLessThan(session.length / 2)
  })

  it('leaves a short identifier alone', () => {
    // Shortening something already readable only hides it.
    expect(compactIdentifier('pi_3abc')).toBe('pi_3abc')
  })

  it('does not shorten at the threshold itself', () => {
    const exact = 'x'.repeat(identifierCompactAbove)

    expect(compactIdentifier(exact)).toBe(exact)
    expect(compactIdentifier(`${exact}y`)).not.toBe(`${exact}y`)
  })

  it('never returns something longer than what it was given', () => {
    for (const length of [1, 5, 22, 23, 40, 66]) {
      const value = 'a'.repeat(length)

      expect(compactIdentifier(value).length).toBeLessThanOrEqual(value.length)
    }
  })
})
