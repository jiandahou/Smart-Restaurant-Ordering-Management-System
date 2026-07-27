import { describe, expect, it } from 'vitest'
import { detectBackgroundBrowser, getBackgroundBrowserGuidance } from './backgroundBrowser'

describe('background browser guidance', () => {
  it('detects Edge before Chrome from a Chromium Edge user agent', () => {
    const userAgent =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0'

    expect(detectBackgroundBrowser(userAgent)).toBe('edge')
    expect(getBackgroundBrowserGuidance(userAgent).supportsSiteException).toBe(true)
  })

  it.each([
    ['Chrome', 'Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36', 'chrome'],
    ['Firefox', 'Mozilla/5.0 Firefox/148.0', 'firefox'],
    ['Safari', 'Mozilla/5.0 Version/26.0 Safari/605.1.15', 'safari'],
  ])('detects %s', (_label, userAgent, expected) => {
    expect(detectBackgroundBrowser(userAgent)).toBe(expected)
  })

  it('only offers the site exception workflow where the browser supports it', () => {
    expect(getBackgroundBrowserGuidance('Chrome/150.0.0.0').settingsPath).toContain('Always keep these sites active')
    expect(getBackgroundBrowserGuidance('Firefox/148.0').settingsPath).toBeNull()
  })
})
