import { describe, expect, it } from 'vitest'

// Vite hands the file over as text; reading it through node would drag node's types into an app
// config that deliberately does not carry them.
import page from './MyOrdersPage.tsx?raw'

/**
 * That the receipt is actually built from the refund projection.
 *
 * <p>
 * The summary's own tests check the arithmetic. This checks the page feeds it — the defect was not
 * a wrong calculation but a second, private idea of "paid" living next to the one the list used.
 * </p>
 */
describe('the customer receipt', () => {
  const builder = () => {
    const start = page.indexOf('function buildCustomerReceipt')

    expect(start).toBeGreaterThan(-1)

    return page.slice(start, page.indexOf('\n}\n', start))
  }

  it('reads the same refund balance the order list shows', () => {
    expect(builder()).toContain('order.refundBalance?.alreadyRefundedAmountCents')
  })

  it('keeps no private notion of paid', () => {
    // The whole defect: a local set that flattened Refunded to the word "Paid".
    expect(page).not.toContain("const paidPaymentStatuses = new Set(")
    expect(builder()).toContain('buildReceiptPaymentSummary({')
  })

  it('prints the authoritative payment state, not a flattened one', () => {
    expect(builder()).toContain("{ label: 'Payment', value: payment.statusLabel }")
    expect(builder()).not.toContain("isPaid ? 'Paid' :")
  })

  it('names the refund and the net when there is one', () => {
    const body = builder()

    expect(body).toContain("label: 'Refunded'")
    expect(body).toContain("label: 'Net paid'")
    expect(body).toContain('payment.hasRefund')
  })

  it('names how the money was taken', () => {
    expect(builder()).toContain("{ label: 'Method', value: payment.methodLabel }")
  })

  it('does not claim to have been printed until Print is used', () => {
    // The stamp was set when the dialog opened, so a receipt that was only ever looked at said it
    // had been printed.
    expect(builder()).toContain("wasPrinted ? 'Printed' : 'Generated'")
    expect(page).toContain('setReceiptPrinted(true)')

    // The handler that opens the dialog, not the one that prints — both stamp the time.
    const opensDialog = page.indexOf('setReceiptOrder(order)')
    const openHandler = page.slice(opensDialog - 200, opensDialog)

    expect(openHandler).toContain('setReceiptRenderedAt(new Date())')
    expect(openHandler).toContain('setReceiptPrinted(false)')
  })
})
