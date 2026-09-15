import { describe, expect, it } from 'vitest'
import type { AdminOrder } from '@/api/auth'
import {
  acceptanceUrgency,
  acceptanceWaitMs,
  compareByAcceptanceUrgency,
  formatWaitDuration,
  isAwaitingAcceptance,
  pendingStatusLabel,
} from './orderAcceptance'

const now = new Date('2026-08-09T12:00:00Z').getTime()

function order(overrides: Partial<AdminOrder> = {}): AdminOrder {
  return {
    status: 'Pending',
    paymentStatus: 'Paid',
    createdAt: new Date(now - 60 * 60_000).toISOString(),
    latestPayment: { paidAt: new Date(now - 3 * 60_000).toISOString() },
    ...overrides,
  } as AdminOrder
}

describe('awaiting acceptance', () => {
  it.each([
    ['Paid', true],
    ['PartiallyRefunded', true],
    ['Unpaid', false],
    ['Failed', false],
  ] as const)('treats a Pending order paid %s as awaiting=%s', (paymentStatus, expected) => {
    expect(isAwaitingAcceptance(order({ paymentStatus }))).toBe(expected)
  })

  it('is not awaiting once the restaurant has accepted', () => {
    expect(isAwaitingAcceptance(order({ status: 'Accepted' }))).toBe(false)
  })
})

describe('pendingStatusLabel', () => {
  it('says what the order is actually waiting for', () => {
    // "Pending" alone reads the same whether the kitchen must act or has nothing to do.
    expect(pendingStatusLabel(order({ paymentStatus: 'Paid' }))).toBe('Awaiting acceptance')
    expect(pendingStatusLabel(order({ paymentStatus: 'Unpaid' }))).toBe('Awaiting payment')
  })

  it('leaves every other status alone', () => {
    expect(pendingStatusLabel(order({ status: 'Preparing' }))).toBeNull()
  })
})

describe('the acceptance clock', () => {
  it('runs from settlement, not from when the order was placed', () => {
    // Placed an hour ago, paid three minutes ago: three minutes of waiting.
    expect(acceptanceWaitMs(order(), now)).toBe(3 * 60_000)
  })

  it('falls back to order creation when nothing recorded the settlement', () => {
    expect(acceptanceWaitMs(order({ latestPayment: null }), now)).toBe(60 * 60_000)
  })

  it.each([
    [4, 'waiting'],
    [5, 'approaching'],
    [9, 'approaching'],
    [10, 'overdue'],
  ] as const)('after %i minutes the urgency is %s', (minutes, expected) => {
    const paidAt = new Date(now - minutes * 60_000).toISOString()
    expect(acceptanceUrgency(order({ latestPayment: { paidAt } } as Partial<AdminOrder>), now)).toBe(expected)
  })
})

describe('formatWaitDuration', () => {
  it.each([
    [0, '0m'],
    [59_000, '0m'],
    [7 * 60_000, '7m'],
    [65 * 60_000, '1h 05m'],
  ])('formats %ims as %s', (ms, expected) => {
    expect(formatWaitDuration(ms)).toBe(expected)
  })
})

describe('sorting', () => {
  it('puts awaiting-acceptance orders first, longest wait leading', () => {
    const fresh = order({ id: 'fresh', latestPayment: { paidAt: new Date(now - 60_000).toISOString() } } as Partial<AdminOrder>)
    const stale = order({ id: 'stale', latestPayment: { paidAt: new Date(now - 15 * 60_000).toISOString() } } as Partial<AdminOrder>)
    const unpaid = order({ id: 'unpaid', paymentStatus: 'Unpaid' })

    const sorted = [fresh, unpaid, stale].sort((a, b) => compareByAcceptanceUrgency(a, b, now))

    expect(sorted.map((item) => item.id)).toEqual(['stale', 'fresh', 'unpaid'])
  })
})
