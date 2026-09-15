import { describe, expect, it } from 'vitest'

import { buildReceiptPaymentSummary } from './receipt'

/**
 * My Orders labelled an order Refunded and the receipt it opened said Paid, showed only the
 * original total and A$0.00 due, and mentioned the refund nowhere. A customer holding a document
 * that says Paid for money that has been given back has the wrong record of the transaction — and
 * it is the document they will produce in a dispute.
 */
const summary = (overrides: Partial<Parameters<typeof buildReceiptPaymentSummary>[0]> = {}) =>
  buildReceiptPaymentSummary({
    paymentStatus: 'Paid',
    paymentMethod: 'Online',
    totalAmount: 14.5,
    refundedAmountCents: 0,
    ...overrides,
  })

describe('what the receipt says about the money', () => {
  it('says refunded rather than paid once the money went back', () => {
    expect(summary({ paymentStatus: 'Refunded', refundedAmountCents: 1450 }).statusLabel)
      .toBe('Refunded')
  })

  it('distinguishes a partial refund from a full one', () => {
    // Flattened to "Paid", these two were indistinguishable on the document.
    expect(summary({ paymentStatus: 'PartiallyRefunded', refundedAmountCents: 500 }).statusLabel)
      .toBe('Partially refunded')
  })

  it('keeps saying paid when nothing came back', () => {
    expect(summary().statusLabel).toBe('Paid')
  })

  it('reports what came back and what the customer is out of pocket', () => {
    const result = summary({ paymentStatus: 'PartiallyRefunded', refundedAmountCents: 500 })

    expect(result.hasRefund).toBe(true)
    expect(result.refundedAmount).toBe(5)
    expect(result.netPaidAmount).toBe(9.5)
  })

  it('does not net the refund away from the original', () => {
    // A tax invoice records the supply that happened; what came back is a second fact, not an edit
    // to the first. The caller passes the total through unchanged and this must not fight it.
    const result = summary({ paymentStatus: 'Refunded', refundedAmountCents: 1450 })

    expect(result.netPaidAmount).toBe(0)
    expect(result.refundedAmount).toBe(14.5)
  })

  it('stays on whole cents', () => {
    // Subtracting a cents-derived figure from a decimal total is exactly where a receipt picks up
    // a stray fraction of a cent.
    expect(summary({ totalAmount: 26.61, refundedAmountCents: 137 }).netPaidAmount).toBe(25.24)
  })

  it('says nothing about a refund when there was none', () => {
    // A "Refunded: A$0.00" line on every receipt teaches people to skip the row that matters.
    expect(summary().hasRefund).toBe(false)
  })

  it('owes nothing once the money was taken, whatever came back afterwards', () => {
    expect(summary({ paymentStatus: 'Refunded', refundedAmountCents: 1450 }).amountDue).toBe(0)
    expect(summary({ paymentStatus: 'Unpaid' }).amountDue).toBe(14.5)
  })

  it('names how it was paid, which a refund enquiry needs first', () => {
    expect(summary({ paymentMethod: 'PayAtCounter' }).methodLabel).toBe('Paid at counter')
    expect(summary({ paymentMethod: 'Online' }).methodLabel).toBe('Card (online)')
  })

  it.each(['Paid', 'PartiallyRefunded', 'Refunded', 'NotRequired'])(
    'treats %s as a supply that was paid for',
    (paymentStatus) => {
      // Drives RECEIPT against BILL. A refunded order was still a completed sale.
      expect(summary({ paymentStatus }).isPaid).toBe(true)
    },
  )

  it.each(['Unpaid', 'Pending', 'Failed', 'Cancelled', 'Expired'])(
    'treats %s as still owing',
    (paymentStatus) => {
      expect(summary({ paymentStatus }).isPaid).toBe(false)
    },
  )

  it('passes an unknown status through rather than inventing a word for it', () => {
    expect(summary({ paymentStatus: 'Disputed' }).statusLabel).toBe('Disputed')
  })
})
