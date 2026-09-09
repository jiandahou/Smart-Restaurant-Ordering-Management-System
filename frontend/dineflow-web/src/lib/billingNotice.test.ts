import { describe, expect, it } from 'vitest'
import { buildBillingNotice, billingNoticeLeadTimeMs, billingUrgentWithinMs } from './billingNotice'
import type { RestaurantBillingStanding } from '../api/auth'

const now = new Date('2026-09-08T12:00:00Z').getTime()
const inFuture = (ms: number) => new Date(now + ms).toISOString()

function standing(overrides: Partial<RestaurantBillingStanding> = {}): RestaurantBillingStanding {
  return {
    model: 'OneTimeActivation',
    standing: 'PastDue',
    delinquentSince: new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString(),
    suspendsAt: inFuture(10 * 24 * 60 * 60 * 1000),
    enforcedFrom: null,
    factsSyncedAt: new Date(now).toISOString(),
    subscriptionStatus: null,
    subscriptionCancelAtPeriodEnd: false,
    currentPeriodEndAt: null,
    amountDueCents: 9_900,
    currency: 'aud',
    blocksOrdering: false,
    message: '',
    ...overrides,
  }
}

describe('buildBillingNotice', () => {
  it('says nothing when nothing is owed', () => {
    expect(buildBillingNotice(standing({ standing: 'NotBilled' }), null, now)).toBeNull()
    expect(buildBillingNotice(standing({ standing: 'Current' }), null, now)).toBeNull()
    expect(buildBillingNotice(null, null, now)).toBeNull()
    expect(buildBillingNotice(undefined, null, now)).toBeNull()
  })

  /**
   * The bell holds things to act on now. A deadline four weeks out is not one, and putting it there
   * teaches people the bell contains items they can safely leave.
   */
  it('stays quiet while the deadline is still far off', () => {
    const far = standing({ suspendsAt: inFuture(billingNoticeLeadTimeMs + 60_000) })

    expect(buildBillingNotice(far, null, now)).toBeNull()
  })

  it('warns once the deadline comes into range', () => {
    const notice = buildBillingNotice(
      standing({ suspendsAt: inFuture(billingNoticeLeadTimeMs - 60_000) }),
      null,
      now,
    )!

    expect(notice.severity).toBe('warning')
    expect(notice.title).toContain('13 days')
  })

  it('escalates in the last few days', () => {
    const notice = buildBillingNotice(
      standing({ suspendsAt: inFuture(billingUrgentWithinMs - 60_000) }),
      null,
      now,
    )!

    expect(notice.severity).toBe('error')
  })

  it('counts in hours once it is under two days', () => {
    const notice = buildBillingNotice(standing({ suspendsAt: inFuture(5 * 60 * 60 * 1000) }), null, now)!

    expect(notice.message).toBeTruthy()
    expect(notice.title).toContain('5 hours')
  })

  /**
   * Being suspended is not a countdown, and the message has to answer the two things staff will ask
   * immediately: is my data gone, and what happens when I pay.
   */
  it('states plainly when ordering is already paused', () => {
    const notice = buildBillingNotice(standing({ standing: 'Suspended', blocksOrdering: true }), null, now)!

    expect(notice.severity).toBe('error')
    expect(notice.title).toContain('paused')
    expect(notice.message).toContain('untouched')
    expect(notice.message).toMatch(/reopens|straight away/)
  })

  /** A platform owner watching several restaurants has to be told which one. */
  it('names the restaurant when there is more than one to name', () => {
    const notice = buildBillingNotice(standing({ standing: 'Suspended' }), 'Laneway Noodles', now)!

    expect(notice.title).toContain('Laneway Noodles')
  })

  it('does not invent a deadline it has not been given', () => {
    const notice = buildBillingNotice(standing({ suspendsAt: null }), null, now)!

    expect(notice.severity).toBe('warning')
    expect(notice.title).not.toMatch(/days|hours/)
  })

  /** A deadline already passed must not render as a countdown running backwards. */
  it('treats an elapsed deadline as no time left', () => {
    const notice = buildBillingNotice(
      standing({ suspendsAt: new Date(now - 60_000).toISOString() }),
      null,
      now,
    )!

    expect(notice.severity).toBe('error')
    expect(notice.title).toContain('less than an hour')
    expect(notice.title).not.toContain('-')
  })
})
