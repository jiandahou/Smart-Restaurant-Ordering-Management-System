import { describe, expect, it } from 'vitest'
import {
  formatMinorCurrency,
  humanActorType,
  shortReportId,
  toUtcDateBoundary,
} from './reportActivity'

describe('report activity helpers', () => {
  it('creates inclusive local-day UTC boundaries', () => {
    const from = toUtcDateBoundary('2026-07-29')
    const to = toUtcDateBoundary('2026-07-29', true)

    expect(from).toBeTruthy()
    expect(to).toBeTruthy()
    expect(new Date(to!).getTime()).toBeGreaterThan(new Date(from!).getTime())
  })

  it('formats minor currency values for people', () => {
    expect(formatMinorCurrency(4250, 'AUD')).toContain('42.50')
  })

  it('shortens technical identifiers and labels providers', () => {
    expect(shortReportId('1234567890abcdefgh')).toBe('12345678...efgh')
    expect(humanActorType('Provider')).toBe('Payment provider')
  })
})
