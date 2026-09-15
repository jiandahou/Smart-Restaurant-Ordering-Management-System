import { describe, expect, it } from 'vitest'
import { prefillPerItemApproval, sumPerItemApproval } from './perItemApproval'

/**
 * Approving a refund used to offer one lever: the total. Staff who knew that one dish was the
 * problem and the other was fine could only lower that total, and the per-line split was then
 * worked out by proportion — figures nobody decided, which were written to the refund and became
 * the balance every later refund on those lines was measured against.
 */
describe('approving a refund item by item', () => {
  const items = [
    { orderItemId: 'wings', amountCents: 1_600 },
    { orderItemId: 'rolls', amountCents: 1_024 },
  ]

  it('starts from what the customer asked for', () => {
    expect(prefillPerItemApproval(items)).toEqual({ wings: '16.00', rolls: '10.24' })
  })

  it('adds the boxes up rather than asking for the total twice', () => {
    expect(sumPerItemApproval(items, { wings: '16.00', rolls: '10.24' })).toBe(2_624)
  })

  /** Clearing a box is how staff say "not this one", and it should read as that at once. */
  it('counts an empty box as nothing rather than as an error', () => {
    expect(sumPerItemApproval(items, { wings: '16.00', rolls: '' })).toBe(1_600)
    expect(sumPerItemApproval(items, { wings: '16.00' })).toBe(1_600)
  })

  it('counts an unparseable box as nothing', () => {
    expect(sumPerItemApproval(items, { wings: '16.00', rolls: 'abc' })).toBe(1_600)
  })

  it('is zero when nothing is being approved, which the dialog refuses to send', () => {
    expect(sumPerItemApproval(items, { wings: '0', rolls: '0' })).toBe(0)
    expect(sumPerItemApproval(items, {})).toBe(0)
  })

  it('ignores amounts for lines that are not on the request', () => {
    expect(sumPerItemApproval(items, { wings: '16.00', rolls: '10.24', chai: '5.00' })).toBe(2_624)
  })

  it('has nothing to prefill when the request carries no lines', () => {
    expect(prefillPerItemApproval([])).toEqual({})
    expect(sumPerItemApproval([], { wings: '16.00' })).toBe(0)
  })
})
