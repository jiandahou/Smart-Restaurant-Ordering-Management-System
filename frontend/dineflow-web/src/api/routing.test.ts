import { describe, expect, it } from 'vitest'

/**
 * FS-004. The app had three URL strategies at once: `request()` used bare relative paths, the
 * refresh and logout calls hardcoded their own, and a handful of modules prefixed
 * `VITE_API_BASE_URL`. Locally the Vite proxy hid the split; deployed, half the calls went
 * somewhere the other half did not.
 *
 * The chosen model is same-origin: CloudFront serves the SPA and forwards /api/* — including the
 * SignalR hubs — to the backend, so every request is relative and there is no base-URL variable
 * to configure inconsistently. These tests fail if one creeps back in.
 */
const sources = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const applicationSources = Object.entries(sources)
  .filter(([path]) => !path.includes('.test.'))

describe('API routing model', () => {
  it('reads the application sources', () => {
    expect(applicationSources.length).toBeGreaterThan(50)
  })

  it.each(['VITE_API_BASE_URL', 'VITE_SIGNALR_BASE_URL'])(
    'no module reads %s',
    (variable) => {
      const offenders = applicationSources
        .filter(([, source]) => source.includes(variable))
        .map(([path]) => path)

      expect(offenders, `${variable} is not part of the same-origin model`).toEqual([])
    },
  )

  it('every API call targets this origin', () => {
    // An absolute API URL would reintroduce CORS and split the routing model again.
    const offenders = applicationSources
      .filter(([, source]) => /["'`]https?:\/\/[^"'`]*\/api\//.test(source))
      .map(([path]) => path)

    expect(offenders).toEqual([])
  })

  it('the SignalR hubs are reached on the same origin as the rest of the API', () => {
    const hubUrls = applicationSources
      .flatMap(([, source]) => source.match(/\.withUrl\((['"`])[^'"`]*\1/g) ?? [])

    expect(hubUrls.length).toBeGreaterThan(0)
    for (const hubUrl of hubUrls) {
      expect(hubUrl).toMatch(/\(['"`]\/api\/hubs\//)
    }
  })
})
