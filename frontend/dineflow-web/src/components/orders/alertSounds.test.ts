import { describe, expect, it } from 'vitest'

/**
 * FS-017. The overdue alert has to be tellable apart from the arrival chime by ear, without
 * anyone having to think about it — replaying the arrival sound would say "a new order came in"
 * when the truth is the opposite.
 */
const source = (import.meta.glob('../../printing/RestaurantPrintingContext.tsx', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>)['../../printing/RestaurantPrintingContext.tsx']

function frequenciesOf(functionName: string): number[] {
  const start = source.indexOf(`function ${functionName}(`)
  expect(start).toBeGreaterThanOrEqual(0)
  const body = source.slice(start, source.indexOf('\n}', start))
  // Every numeric literal above 50 in these functions is a frequency: gains are fractions and
  // timings are fractions of a second. Reading only setValueAtTime(...) missed the overdue
  // pattern, whose pitches live in an array — and made two of the tests below pass on an empty
  // list without asserting anything.
  return [...body.matchAll(/\b(\d+(?:\.\d+)?)\b/g)]
    .map((match) => Number(match[1]))
    .filter((value) => value > 50)
}

describe('order alert sounds', () => {
  it('the arrival chime rises and the overdue alert falls', () => {
    const arrival = frequenciesOf('playNewOrderSound')
    const overdue = frequenciesOf('playOverdueOrderSound')

    // Rising reads as "something arrived"; falling reads as "something is wrong".
    expect(arrival.length).toBeGreaterThanOrEqual(2)
    expect(arrival[0]).toBeLessThan(arrival[1])

    expect(overdue.length).toBeGreaterThanOrEqual(3)
    expect(overdue).toEqual([...overdue].sort((a, b) => b - a))
  })

  it('the two patterns share no pitch, so they cannot be confused', () => {
    const arrival = new Set(frequenciesOf('playNewOrderSound'))
    const overdue = frequenciesOf('playOverdueOrderSound')

    expect(overdue.some((frequency) => arrival.has(frequency))).toBe(false)
  })

  it('the overdue alert sits below the arrival chime', () => {
    const arrival = frequenciesOf('playNewOrderSound')
    const overdue = frequenciesOf('playOverdueOrderSound')

    expect(Math.max(...overdue)).toBeLessThan(Math.min(...arrival))
  })

  it('the overdue alert uses a different timbre', () => {
    expect(source).toContain("oscillator.type = 'triangle'")
    expect(source).toContain("first.type = 'sine'")
  })
})

/**
 * The two alerts answer different questions — "did a new order arrive" and "is an order being
 * left waiting" — so a kitchen has to be able to silence one without losing the other.
 */
describe('alert toggles', () => {
  const context = (import.meta.glob('../../printing/RestaurantPrintingContext.tsx', {
    query: '?raw', import: 'default', eager: true,
  }) as Record<string, string>)['../../printing/RestaurantPrintingContext.tsx']

  it('exposes a toggle for each sound', () => {
    expect(context).toContain('toggleAudio')
    expect(context).toContain('toggleOverdueAlert')
    expect(context).toContain('overdueAlertEnabled: boolean')
  })

  it('the overdue alert is gated on its own switch, not the arrival one', () => {
    const start = context.indexOf('const playOverdueAlertSound')
    const body = context.slice(start, context.indexOf('}, [])', start))

    expect(body).toContain('overdueAlertEnabledRef')
    expect(body).not.toContain('audioEnabledRef')
  })

  it('previews the sound when switched on, so staff learn it outside an incident', () => {
    const start = context.indexOf('const toggleOverdueAlert')
    const body = context.slice(start, context.indexOf('}, [])', start))

    expect(body).toContain('playOverdueOrderSound')
  })
})
