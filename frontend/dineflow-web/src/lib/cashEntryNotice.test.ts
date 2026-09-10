import { describe, expect, it } from 'vitest'
import { getCashEntryNotice } from './cashEntryNotice'

const money = (amount: number) => `A$${amount.toFixed(2)}`

describe('getCashEntryNotice', () => {
  /**
   * The bug. Confirm greyed itself out and the screen said nothing at all — a dead button and a red
   * ring for a sighted cashier, and for one using a screen reader, "invalid" and no more.
   */
  it('says how much is actually owed', () => {
    expect(getCashEntryNotice('5.00', 8, money)).toBe('Cash received must be at least A$8.00.')
  })

  it('is satisfied by the exact amount', () => {
    expect(getCashEntryNotice('8', 8, money)).toBeNull()
    expect(getCashEntryNotice('8.00', 8, money)).toBeNull()
    expect(getCashEntryNotice('20', 8, money)).toBeNull()
  })

  /** Nothing typed yet is not a mistake, and saying so before they start is how a form nags. */
  it('says nothing to a cashier who has not typed anything', () => {
    expect(getCashEntryNotice('', 8, money)).toBeNull()
    expect(getCashEntryNotice('   ', 8, money)).toBeNull()
  })

  it('names the problem when the entry is not a number at all', () => {
    expect(getCashEntryNotice('abc', 8, money)).toBe('Enter the cash amount as a number.')
  })

  /** An order with nothing owing has no cash to check. */
  it('has nothing to say when nothing is owed', () => {
    expect(getCashEntryNotice('0', 0, money)).toBeNull()
  })

  /** The wording is the server's own, so the screen and a refused request cannot disagree. */
  it('reads the way the server would have answered', () => {
    expect(getCashEntryNotice('1', 25.5, money)).toBe('Cash received must be at least A$25.50.')
  })
})
