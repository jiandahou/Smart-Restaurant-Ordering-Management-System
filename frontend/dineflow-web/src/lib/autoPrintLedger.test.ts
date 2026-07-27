import { beforeEach, describe, expect, it } from 'vitest'
import {
  markOrderPrinted,
  readAutoPrintLedger,
  resetAutoPrintLedgerForTests,
  setAutoPrintEnabled,
  shouldAutoPrintOrder,
} from './autoPrintLedger'

describe('autoPrintLedger', () => {
  beforeEach(() => {
    resetAutoPrintLedgerForTests()
  })

  it('keeps successful prints across a page-style reload', () => {
    setAutoPrintEnabled(true, new Date('2026-07-26T01:00:00Z'))
    markOrderPrinted('printed-order', new Date('2026-07-26T01:02:00Z'))

    const restored = readAutoPrintLedger(true)

    expect(restored.printedOrderIds.has('printed-order')).toBe(true)
    expect(shouldAutoPrintOrder(
      { id: 'printed-order', createdAt: '2026-07-26T01:01:00Z' },
      restored,
    )).toBe(false)
  })

  it('does not treat the current backlog as handled again after refresh', () => {
    setAutoPrintEnabled(true, new Date('2026-07-26T01:00:00Z'))
    const order = { id: 'not-yet-printed', createdAt: '2026-07-26T01:01:00Z' }

    expect(shouldAutoPrintOrder(order, readAutoPrintLedger(true))).toBe(true)
    expect(shouldAutoPrintOrder(order, readAutoPrintLedger(true))).toBe(true)
  })

  it('protects the backlog that predates the actual enable action', () => {
    setAutoPrintEnabled(true, new Date('2026-07-26T01:00:00Z'))
    const ledger = readAutoPrintLedger(true)

    expect(shouldAutoPrintOrder(
      { id: 'historical', createdAt: '2026-07-26T00:59:59Z' },
      ledger,
    )).toBe(false)
    expect(shouldAutoPrintOrder(
      { id: 'new', createdAt: '2026-07-26T01:00:01Z' },
      ledger,
    )).toBe(true)
  })

  it('creates a durable cutoff when migrating an already-enabled setup', () => {
    const ledger = readAutoPrintLedger(true, new Date('2026-07-26T01:00:00Z'))

    expect(ledger.enabledAt).toBe(Date.parse('2026-07-26T01:00:00Z'))
    expect(shouldAutoPrintOrder(
      { id: 'legacy-active', createdAt: '2026-07-26T00:59:59Z' },
      ledger,
    )).toBe(false)
    expect(shouldAutoPrintOrder(
      { id: 'post-migration', createdAt: '2026-07-26T01:00:01Z' },
      ledger,
    )).toBe(true)
  })

  it('replaces the buggy Unix-epoch cutoff without losing printed IDs', () => {
    setAutoPrintEnabled(true, new Date(0))
    markOrderPrinted('already-recorded', new Date('2026-07-26T00:30:00Z'))

    const ledger = readAutoPrintLedger(true, new Date('2026-07-26T01:00:00Z'))

    expect(ledger.enabledAt).toBe(Date.parse('2026-07-26T01:00:00Z'))
    expect(ledger.printedOrderIds.has('already-recorded')).toBe(true)
  })

  it('stops selecting orders while auto-print is disabled', () => {
    setAutoPrintEnabled(true, new Date('2026-07-26T01:00:00Z'))
    setAutoPrintEnabled(false, new Date('2026-07-26T02:00:00Z'))

    expect(readAutoPrintLedger(false).enabledAt).toBeNull()
  })
})
