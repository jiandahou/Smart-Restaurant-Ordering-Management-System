import { ChevronDown } from 'lucide-react'
import type { CustomerRefundRequest } from '../../api/auth'
import { formatMoney } from '../../lib/formatMoney'
import { refundedItemLabel } from './refundedItemLabel'

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

/**
 * One refund request, as the customer asked it and as the restaurant answered.
 *
 * <p>
 * Staff can approve less than was asked, so the settled figure is the one that actually left the
 * account and the requested figure is never allowed to stand in for it.
 * </p>
 */
function RefundRequestPanel({ request }: { request: CustomerRefundRequest }) {
  const settledCents = request.refundStatus === 'Succeeded' ? request.refundedAmountCents : null
  const isPartial = settledCents !== null && settledCents < request.requestedAmountCents

  return (
    <div className={`my-order-refund-state my-order-refund-state-${request.status.toLowerCase()}`}>
      <details className="refund-state-details">
        <summary>
          <div className="refund-state-heading">
            <strong>Refund request {request.status.toLowerCase()}</strong>
            <span>
              {settledCents !== null ? (
                <>
                  <b className="refund-state-settled">{formatMoney(settledCents / 100, request.currency)}</b>
                  {isPartial
                    ? ` refunded of ${formatMoney(request.requestedAmountCents / 100, request.currency)} requested`
                    : ' refunded'}
                </>
              ) : (
                <>
                  {formatMoney(request.requestedAmountCents / 100, request.currency)}
                  {' requested on '}
                  {formatDate(request.createdAt)}
                </>
              )}
            </span>
          </div>
          <ChevronDown className="refund-state-chevron" size={18} aria-hidden="true" />
        </summary>
        <div className="refund-state-body">
          {isPartial ? (
            <p className="refund-state-partial">
              The restaurant approved a partial refund:{' '}
              <strong>{formatMoney(settledCents! / 100, request.currency)}</strong>
              {' of the '}
              {formatMoney(request.requestedAmountCents / 100, request.currency)}
              {' you asked for.'}
            </p>
          ) : null}

          <div className="refund-state-section">
            <h4>Items you asked to refund</h4>
            {request.items.length > 0 ? (
              <ul className="refund-state-items">
                {request.items.map((item, index) => (
                  <li key={`${item.menuItemNameSnapshot}-${index}`}>
                    <span>
                      {refundedItemLabel(item)}
                      {item.quantity > 1 ? ` × ${item.quantity}` : null}
                    </span>
                    <strong>{formatMoney(item.amountCents / 100, request.currency)}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="refund-state-empty">This request was submitted for the whole order.</p>
            )}
          </div>

          <div className="refund-state-section">
            <h4>Your message</h4>
            {request.reason ? (
              <p className="refund-state-note">{request.reason}</p>
            ) : (
              <p className="refund-state-empty">You did not leave a message.</p>
            )}
          </div>
        </div>
      </details>
      {request.adminNote ? (
        <div className="refund-state-reply">
          <h4>Restaurant reply</h4>
          <p>{request.adminNote}</p>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Everything that has happened to this order's money, on the order's own card.
 */
/*
 * The card used to show the newest refund request and nothing else, which meant a customer's own
 * record of a refund was overwritten by their next question about the same order. On this database
 * that hid eight of fourteen requests, seven of them approved: one order carried five approved
 * refunds totalling A$10.48 and displayed the newest A$1.96, and another displayed a rejected one
 * cent standing in front of an approved A$11.46.
 *
 * The total leads, because "did I get my money back, and how much" is the question being asked, and
 * it is answered by the payment rather than by any one request — a refund the restaurant issued on
 * its own, such as the automatic one when a paid order is turned away, is money returned and belongs
 * in that figure even though no request will ever mention it. Until now the total appeared only
 * inside the "request a refund" dialog, so an order past refunding showed it nowhere at all.
 *
 * Older requests are folded rather than hidden behind a dialog: an order carries a handful of them,
 * not a table's worth, and a dialog on top of an already-expanded order row is a second thing to
 * open before reading the first.
 */
export function OrderRefundHistory({
  requests,
  refundedTotalCents,
  currency,
}: {
  requests: CustomerRefundRequest[]
  refundedTotalCents: number
  currency: string
}) {
  const [latest, ...earlier] = requests

  if (!latest && refundedTotalCents <= 0) {
    return null
  }

  return (
    <section className="my-order-refunds">
      {refundedTotalCents > 0 ? (
        <p className="my-order-refund-total">
          <span>Refunded to you</span>
          <strong>{formatMoney(refundedTotalCents / 100, currency)}</strong>
        </p>
      ) : null}

      {latest ? <RefundRequestPanel request={latest} /> : null}

      {earlier.length > 0 ? (
        <details className="my-order-refund-earlier">
          <summary>
            <span>
              {earlier.length} earlier {earlier.length === 1 ? 'request' : 'requests'} on this order
            </span>
            <ChevronDown className="refund-state-chevron" size={18} aria-hidden="true" />
          </summary>
          <div className="my-order-refund-earlier-list">
            {earlier.map((request) => (
              <RefundRequestPanel key={request.id} request={request} />
            ))}
          </div>
        </details>
      ) : null}
    </section>
  )
}
