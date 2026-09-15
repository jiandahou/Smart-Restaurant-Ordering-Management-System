import { describe, expect, it } from 'vitest'

import { canSettleAtCounter } from './orderStats'
import type { AdminOrder } from '@/api/auth'

// Vite hands the files over as text; reading them through node would drag node's types into an app
// config that deliberately does not carry them.
import adminOrders from '@/pages/AdminOrdersPage.tsx?raw'
import staffOrders from '@/pages/StaffOrdersPage.tsx?raw'

/**
 * Admin Orders offered "Mark paid" on a cancelled order while Admin Payments, reading the same
 * order, called it not payable. The endpoint refused it either way, so the button could only ever
 * produce an error — and at a counter the error arrives after the cash is already in the drawer.
 */
const order = (overrides: Partial<AdminOrder>) => ({
  paymentMethod: 'PayAtCounter',
  paymentStatus: 'Unpaid',
  status: 'Preparing',
  ...overrides,
}) as AdminOrder

describe('whether cash may still be taken at the counter', () => {
  it('allows an unpaid counter order', () => {
    expect(canSettleAtCounter(order({}))).toBe(true)
  })

  it.each(['Cancelled', 'Rejected'] as const)('refuses a %s order', (status) => {
    // The reported defect, and the one the server was already refusing.
    expect(canSettleAtCounter(order({ status }))).toBe(false)
  })

  it('still allows a completed order', () => {
    // Eating first and paying on the way out is the ordinary case for pay-at-counter.
    expect(canSettleAtCounter(order({ status: 'Completed' }))).toBe(true)
  })

  it.each(['Paid', 'PartiallyRefunded', 'NotRequired', 'Refunded'] as const)(
    'does not ask again for money already accounted for (%s)',
    (paymentStatus) => {
      expect(canSettleAtCounter(order({ paymentStatus }))).toBe(false)
    },
  )

  it('leaves online orders to the online route', () => {
    expect(canSettleAtCounter(order({ paymentMethod: 'Online' }))).toBe(false)
  })
})

describe('the screens that offer it', () => {
  it.each([
    ['Admin Orders', adminOrders],
    ['Staff Orders', staffOrders],
  ])('%s asks the rule rather than deciding for itself', (_name, page) => {
    // The two-clause test each screen used to carry. Four copies is four chances to be wrong once,
    // and all four were wrong the same way.
    expect(page).toContain('canSettleAtCounter(order)')
    expect(page).not.toContain("order.paymentMethod === 'PayAtCounter' && order.paymentStatus !== 'Paid'")
  })
})
