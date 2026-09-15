import { describe, expect, it } from 'vitest'
import { buildRefundQueueNotice, refundRequestOverdueMs } from './refundQueueNotice'

const now = new Date('2026-09-08T12:00:00Z').getTime()
const ago = (ms: number) => new Date(now - ms).toISOString()

describe('buildRefundQueueNotice', () => {
  it('says nothing when nothing is waiting', () => {
    expect(buildRefundQueueNotice(0, null, now)).toBeNull()
  })

  it('reads as work in hand while the queue is fresh', () => {
    const notice = buildRefundQueueNotice(3, ago(2 * 60 * 60 * 1000), now)!

    expect(notice.severity).toBe('warning')
    expect(notice.title).toBe('3 refund requests are waiting')
    expect(notice.message).toContain('2 hours')
  })

  /** The age is what separates a queue being worked from money held with nobody looking. */
  it('escalates once the oldest has waited past a day', () => {
    const notice = buildRefundQueueNotice(1, ago(refundRequestOverdueMs), now)!

    expect(notice.severity).toBe('error')
    expect(notice.title).toBe('1 refund request is waiting')
    expect(notice.message).toContain('1 day')
    expect(notice.message).toContain('no answer')
  })

  it('counts the wait in days once it runs past one', () => {
    expect(buildRefundQueueNotice(1, ago(50 * 60 * 60 * 1000), now)!.message).toContain('2 days')
  })

  it('does not claim an age it cannot support', () => {
    const notice = buildRefundQueueNotice(2, null, now)!

    expect(notice.severity).toBe('warning')
    expect(notice.message).not.toMatch(/hour|day/)
  })

  /** A clock running ahead of the server must not produce a negative wait. */
  it('treats a future timestamp as no wait rather than a negative one', () => {
    const notice = buildRefundQueueNotice(1, new Date(now + 60_000).toISOString(), now)!

    expect(notice.severity).toBe('warning')
    expect(notice.message).toContain('less than an hour')
  })
})
