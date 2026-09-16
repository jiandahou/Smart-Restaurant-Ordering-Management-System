import { describe, expect, it } from 'vitest'
import { getCashEntryNotice, maximumChangeFor } from './cashEntryNotice'

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

  /**
   * A digit too many is the ordinary slip, and the change is what leaves the drawer. A$5000 keyed
   * against a A$24 order used to be accepted, with A$4976 offered back.
   */
  it('refuses a tender that would hand back more change than the order can owe', () => {
    expect(getCashEntryNotice('5000', 24, money)).toBe(
      'That would give back A$4976.00 in change. '
      + 'Check the amount — this order can give back at most A$500.00.',
    )
    expect(getCashEntryNotice('1000000000000000', 24, money)).not.toBeNull()
  })

  /** Handing over a round note is not a slip, whatever multiple of the bill it happens to be. */
  it('still accepts the ordinary way people pay cash', () => {
    expect(getCashEntryNotice('100', 5, money)).toBeNull()     // a note for a coffee
    expect(getCashEntryNotice('100', 24, money)).toBeNull()
    expect(getCashEntryNotice('524', 24, money)).toBeNull()    // exactly at the ceiling
  })

  /** A big table settling a big bill is still plainly real, so the bill raises its own ceiling. */
  it('lets a larger bill give back proportionally more', () => {
    expect(getCashEntryNotice('1500', 800, money)).toBeNull()  // A$700 change on an A$800 bill
    expect(getCashEntryNotice('1601', 800, money)).not.toBeNull()
  })

  it('reports the ceiling an order actually has', () => {
    expect(maximumChangeFor(24)).toBe(500)
    expect(maximumChangeFor(800)).toBe(800)
  })
})
