import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OrderRefundHistory } from './OrderRefundHistory'
import type { CustomerRefundRequest } from '../../api/auth'

function aRequest(overrides: Partial<CustomerRefundRequest> = {}): CustomerRefundRequest {
  return {
    id: crypto.randomUUID(),
    orderId: 'order-1',
    status: 'Approved',
    requestedAmountCents: 1146,
    refundedAmountCents: 1146,
    refundStatus: 'Succeeded',
    currency: 'AUD',
    reason: null,
    adminNote: null,
    createdAt: '2026-09-08T08:00:00Z',
    updatedAt: null,
    reviewedAt: null,
    items: [],
    ...overrides,
  }
}

describe('OrderRefundHistory', () => {
  /**
   * The order this was found on: a rejected one cent standing in front of an approved A$11.46 that
   * had already been paid back, with the card showing only the rejection.
   */
  it('keeps an earlier approved refund visible behind a later rejection', () => {
    render(
      <OrderRefundHistory
        currency="AUD"
        refundedTotalCents={1145}
        requests={[
          aRequest({ status: 'Rejected', requestedAmountCents: 1, refundedAmountCents: null, refundStatus: null }),
          aRequest({ refundedAmountCents: 1145 }),
        ]}
      />,
    )

    expect(screen.getByText('Refund request rejected')).toBeInTheDocument()
    expect(screen.getByText('1 earlier request on this order')).toBeInTheDocument()
    expect(screen.getByText('Refund request approved')).toBeInTheDocument()
  })

  /** The question being asked is how much came back, so it is answered without opening anything. */
  it('shows the total refunded without any disclosure being opened', () => {
    render(<OrderRefundHistory currency="AUD" refundedTotalCents={1048} requests={[aRequest()]} />)

    const total = screen.getByText('Refunded to you').closest('p')
    expect(within(total!).getByText('A$10.48')).toBeInTheDocument()
  })

  /**
   * A refund the restaurant issued on its own — the automatic one when a paid order is turned away —
   * is money returned and has no request to hang under.
   */
  it('reports money returned even when no request was ever filed', () => {
    render(<OrderRefundHistory currency="AUD" refundedTotalCents={900} requests={[]} />)

    expect(screen.getByText('Refunded to you')).toBeInTheDocument()
    expect(screen.queryByText(/earlier request/)).not.toBeInTheDocument()
  })

  it('renders nothing when no money moved and nothing was asked', () => {
    const { container } = render(
      <OrderRefundHistory currency="AUD" refundedTotalCents={0} requests={[]} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  /** Staff can approve less than was asked; the requested figure must never stand in for settled. */
  it('names the settled amount, not the requested one, on a partial approval', () => {
    render(
      <OrderRefundHistory
        currency="AUD"
        refundedTotalCents={1145}
        requests={[aRequest({ requestedAmountCents: 1146, refundedAmountCents: 1145 })]}
      />,
    )

    expect(screen.getByText('A$11.45', { selector: '.refund-state-settled' })).toBeInTheDocument()
    expect(screen.getByText(/refunded of A\$11\.46 requested/)).toBeInTheDocument()
  })

  it('folds several earlier requests into one disclosure', () => {
    render(
      <OrderRefundHistory
        currency="AUD"
        refundedTotalCents={1048}
        requests={[aRequest(), aRequest(), aRequest(), aRequest(), aRequest()]}
      />,
    )

    expect(screen.getByText('4 earlier requests on this order')).toBeInTheDocument()
    expect(screen.getAllByText('Refund request approved')).toHaveLength(5)
  })
})
