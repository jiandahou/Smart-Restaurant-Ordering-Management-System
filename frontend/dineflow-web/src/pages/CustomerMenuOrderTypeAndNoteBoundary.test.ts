import { describe, expect, it } from 'vitest'

// Vite hands the file over as text; this small wiring test guards the page-level integration while
// the validation rule and URL builder keep their own behavioural unit tests.
import page from './CustomerMenuPage.tsx?raw'

function functionBody(startMarker: string, endMarker: string) {
  const start = page.indexOf(startMarker)
  const end = page.indexOf(endMarker, start)

  expect(start, `Could not find ${startMarker}`).toBeGreaterThan(-1)
  expect(end, `Could not find ${endMarker}`).toBeGreaterThan(start)
  return page.slice(start, end)
}

describe('restaurant order-type URL synchronisation', () => {
  it.each([
    ['initial selection', 'const chooseOrderType', 'const switchOrderType'],
    ['cart switch', 'const switchOrderType', 'const requestOrderTypeSwitch'],
  ])('replaces the URL after %s succeeds', (_name, start, end) => {
    const body = functionBody(start, end)

    expect(body).toContain(
      'navigate(buildRestaurantMenuPath(state.context.restaurant.id, orderType), { replace: true })',
    )
    expect(body.indexOf('await loadOrJoinCart(')).toBeLessThan(body.indexOf('navigate('))
  })

  it('continues to refuse order-type switching for table QR carts', () => {
    const body = functionBody('const switchOrderType', 'const requestOrderTypeSwitch')

    expect(body).toContain('state.context.table')
  })
})

describe('order-note length defence', () => {
  it('validates before the cart note API path can start saving', () => {
    const body = functionBody('const saveCartNote', 'const handleCheckout')

    expect(body.indexOf('validateOrderNote(note)')).toBeLessThan(body.indexOf('setSavingCartNote(true)'))
  })

  it('disables Save note for a draft rejected by validation', () => {
    const editor = functionBody('function CartOrderNoteEditor', 'function CartViewerPill')

    expect(editor).toContain('aria-invalid={Boolean(validationError)}')
    expect(editor).toContain('disabled={isSaving || !hasChanges || Boolean(validationError)}')
  })
})
