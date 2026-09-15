import { formatReceiptMoney, type ReceiptDocument } from '@/lib/receipt'

/**
 * The printable receipt, shared by the front counter and the customer's own order page so both
 * hand over the same document. Hidden on screen by default; `body.printing-receipt` reveals it
 * for `window.print()`. Pass `visible` to also show it inline (the customer preview).
 */
export function ReceiptDocumentView({
  receipt,
  visible = false,
}: {
  receipt: ReceiptDocument
  visible?: boolean
}) {
  return (
    <section
      className={`receipt-print${visible ? ' receipt-print-visible' : ''}`}
      aria-label={`${receipt.documentTitle} ${receipt.code}`}
    >
      <header className="receipt-header">
        <span>{receipt.documentTitle}</span>
        <h1>{receipt.code}</h1>
        <p>{receipt.supplier.restaurantName}</p>
        {receipt.supplier.legalBusinessName
          && receipt.supplier.legalBusinessName !== receipt.supplier.restaurantName
          ? <p>{receipt.supplier.legalBusinessName}</p>
          : null}
        {receipt.supplier.abn ? <p>ABN {receipt.supplier.abn}</p> : null}
        {receipt.supplier.address ? <p>{receipt.supplier.address}</p> : null}
        {receipt.supplier.phone ? <p>{receipt.supplier.phone}</p> : null}
        <p>{receipt.scopeLabel}</p>
      </header>

      <dl className="receipt-meta">
        {receipt.meta.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>

      <div className="receipt-items">
        {receipt.items.map((item) => (
          <article key={item.id} className="receipt-item">
            {/* The headline amount is the dish's own price; extras are itemised below it so the
                customer can see what each one added. */}
            <div className="receipt-item-main">
              <strong>{item.quantity}x</strong>
              <span>{item.name}</span>
              <small>{formatReceiptMoney(item.baseAmount ?? item.totalPrice, receipt.currency)}</small>
            </div>

            {item.optionGroups.length > 0 ? (
              <div className="receipt-options">
                {item.optionGroups.map((group) => (
                  <div key={group.groupName}>
                    <strong>{group.groupName}</strong>
                    <span>{group.options.join(', ')}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {item.modifiers.map((modifier) => (
              <div key={modifier.label} className="receipt-item-modifier">
                <span>{modifier.amount > 0 ? '+' : ''}{modifier.label}</span>
                <small>{formatReceiptMoney(modifier.amount, receipt.currency)}</small>
              </div>
            ))}

            {item.note ? (
              <p className="receipt-note">
                <strong>Note:</strong> {item.note}
              </p>
            ) : null}

            {item.modifiers.length > 0 ? (
              <div className="receipt-item-modifier receipt-item-line-total">
                <span>Line total</span>
                <small>{formatReceiptMoney(item.totalPrice, receipt.currency)}</small>
              </div>
            ) : null}
          </article>
        ))}
      </div>

      <dl className="receipt-total">
        <div>
          <dt>Total</dt>
          <dd>{formatReceiptMoney(receipt.totalAmount, receipt.currency)}</dd>
        </div>
        {/* The ATO accepts either the GST amount or a "total includes GST" statement; printing
            both leaves nothing for the customer to work out. */}
        {receipt.gstAmount !== null ? (
          <div>
            <dt>GST included</dt>
            <dd>{formatReceiptMoney(receipt.gstAmount, receipt.currency)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Amount due</dt>
          <dd>{formatReceiptMoney(receipt.amountDue, receipt.currency)}</dd>
        </div>
      </dl>

      <footer className="receipt-footer">
        {receipt.gstAmount !== null ? <p>Total price includes GST.</p> : null}
        {receipt.surchargeNotice ? <p>{receipt.surchargeNotice}</p> : null}
        {receipt.refundContactEmail ? <p>Refund enquiries: {receipt.refundContactEmail}</p> : null}
        <p>Thank you</p>
      </footer>
    </section>
  )
}
