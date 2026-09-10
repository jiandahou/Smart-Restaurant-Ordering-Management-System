import { describe, expect, it } from 'vitest'
import { buildRefundOwedNotice, refundOwedOverdueMs } from './refundOwedNotice'

const now = new Date('2026-09-10T02:00:00.000Z').getTime()
const minutesAgo = (minutes: number) =>
  new Date(now - minutes * 60 * 1000).toISOString()

describe('buildRefundOwedNotice', () => {
  /** Nothing outstanding adds nothing to the bell — everything in that list is meant to be acted on. */
  it('says nothing when nothing is owed', () => {
    expect(buildRefundOwedNotice(0, 0, null, 'AUD', now)).toBeNull()
    expect(buildRefundOwedNotice(0, 2_550, minutesAgo(10), 'AUD', now)).toBeNull()
  })

  /**
   * The amount leads. One order and forty are the same size on a badge and are not the same size in
   * the till, and the person reading this needs to know which it is before they decide when to look.
   */
  it('names the money, not only the count', () => {
    const notice = buildRefundOwedNotice(3, 25_426, minutesAgo(30), 'AUD', now)

    expect(notice?.title).toContain('254.26')
    expect(notice?.title).toContain('3 orders')
  })

  it('speaks of one customer in the singular', () => {
    const notice = buildRefundOwedNotice(1, 2_550, minutesAgo(30), 'AUD', now)

    expect(notice?.title).toMatch(/owed back to a customer/)
    expect(notice?.title).not.toMatch(/orders/)
  })

  /** Inside a shift this is work in progress. */
  it('is a warning while it is still plausibly being dealt with', () => {
    const notice = buildRefundOwedNotice(1, 2_550, minutesAgo(30), 'AUD', now)

    expect(notice?.severity).toBe('warning')
    expect(notice?.message).toMatch(/30 minutes ago|less than an hour/)
  })

  /** Past one, the money is being held rather than processed, and the bell should say so. */
  it('becomes an error once it has sat longer than a shift', () => {
    const overdue = new Date(now - refundOwedOverdueMs).toISOString()

    expect(buildRefundOwedNotice(1, 2_550, overdue, 'AUD', now)?.severity).toBe('error')
  })

  it('counts a long wait in days', () => {
    const notice = buildRefundOwedNotice(1, 9_900, minutesAgo(58 * 24 * 60), 'AUD', now)

    expect(notice?.message).toContain('58 days')
    expect(notice?.severity).toBe('error')
  })

  /**
   * A clock running ahead of the server must not produce a wait measured in negative hours, and
   * must not quietly promote the notice either.
   */
  it('reads a charge from the future as no wait at all', () => {
    const notice = buildRefundOwedNotice(1, 2_550, minutesAgo(-90), 'AUD', now)

    expect(notice?.severity).toBe('warning')
    expect(notice?.message).toContain('less than an hour')
  })

  /** Without a date the notice still appears, and simply does not claim an age it cannot support. */
  it('still raises money it cannot date', () => {
    const notice = buildRefundOwedNotice(2, 5_000, null, 'AUD', now)

    expect(notice).not.toBeNull()
    expect(notice?.severity).toBe('warning')
    expect(notice?.message).not.toMatch(/ago/)
  })

  it('survives an unparseable date the same way', () => {
    expect(buildRefundOwedNotice(1, 5_000, 'not-a-date', 'AUD', now)?.message).not.toMatch(/ago/)
  })
})
