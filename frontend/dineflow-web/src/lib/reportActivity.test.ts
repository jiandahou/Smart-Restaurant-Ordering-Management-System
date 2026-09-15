import { describe, expect, it } from 'vitest'
import {
  formatMinorCurrency,
  humanActorType,
  shortReportId,
  toUtcDateBoundary,
} from './reportActivity'

describe('report activity helpers', () => {
  it('creates inclusive restaurant-day UTC boundaries', () => {
    const from = toUtcDateBoundary('2026-07-29', false, 'Asia/Kathmandu')
    const to = toUtcDateBoundary('2026-07-29', true, 'Asia/Kathmandu')

    expect(from).toBe('2026-07-28T18:15:00.000Z')
    expect(to).toBe('2026-07-29T18:14:59.999Z')
  })

  it('uses the real DST offset at each end of a restaurant day', () => {
    const from = toUtcDateBoundary('2026-10-04', false, 'Australia/Adelaide')
    const to = toUtcDateBoundary('2026-10-04', true, 'Australia/Adelaide')

    expect(from).toBe('2026-10-03T14:30:00.000Z')
    expect(to).toBe('2026-10-04T13:29:59.999Z')
    expect(new Date(to!).getTime() - new Date(from!).getTime() + 1).toBe(23 * 60 * 60 * 1000)
  })

  it('formats minor currency values for people', () => {
    expect(formatMinorCurrency(4250, 'AUD')).toContain('42.50')
  })

  it('shortens technical identifiers and labels providers', () => {
    expect(shortReportId('1234567890abcdefgh')).toBe('12345678...efgh')
    expect(humanActorType('Provider')).toBe('Payment provider')
  })
})
