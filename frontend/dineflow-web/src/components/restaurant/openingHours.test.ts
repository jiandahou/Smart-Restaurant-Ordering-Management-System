import { describe, expect, it } from 'vitest'
import { formatOpeningWindows, getSpecialDayMode } from './openingHours'

describe('formatOpeningWindows', () => {
  it('describes a midnight-to-midnight window as open 24 hours', () => {
    expect(formatOpeningWindows([{ opensAt: '00:00', closesAt: '00:00' }])).toBe('Open 24 hours')
  })

  it('keeps normal and split service windows concise', () => {
    expect(formatOpeningWindows([
      { opensAt: '09:00', closesAt: '14:00' },
      { opensAt: '17:00', closesAt: '22:00' },
    ])).toBe('09:00-14:00, 17:00-22:00')
  })

  it('labels an empty schedule as closed', () => {
    expect(formatOpeningWindows([])).toBe('Closed')
  })
})

describe('getSpecialDayMode', () => {
  it('distinguishes the weekly baseline, special hours and a full-day closure', () => {
    expect(getSpecialDayMode(null)).toBe('normal')
    expect(getSpecialDayMode({
      date: '2026-07-29',
      isClosed: false,
      note: '',
      windows: [{ opensAt: '12:00', closesAt: '18:00' }],
    })).toBe('special')
    expect(getSpecialDayMode({
      date: '2026-07-29',
      isClosed: true,
      note: '',
      windows: [],
    })).toBe('closed')
  })
})
