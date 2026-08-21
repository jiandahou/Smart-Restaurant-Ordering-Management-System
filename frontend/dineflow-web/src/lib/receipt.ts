/**
 * One receipt shape for every surface that has to hand a customer proof of a transaction:
 * the counter's browser print, the counter's thermal print, and the customer's own order page.
 *
 * Australian rules this shape exists to satisfy:
 * - ACL s100 proof of transaction — supplier name and ABN, date of supply, what was supplied,
 *   the price, and the GST amount where one applies.
 * - ATO tax invoice (sales under $1,000) — the words "tax invoice", the seller's identity and
 *   ABN, the issue date, a description of what was sold with quantity and price, and either the
 *   GST amount or a statement that the total includes GST.
 *
 * None of the builders may invent a value: anything the restaurant has not configured is left
 * null and simply does not print.
 */

export type ReceiptSupplier = {
  restaurantName: string
  legalBusinessName: string | null
  abn: string | null
  address: string | null
  phone: string | null
}

export type ReceiptOptionGroup = {
  groupName: string
  /** Already formatted for display, e.g. "Chips +$2.00". */
  options: string[]
}

/** A priced modifier, already multiplied out to what it added to this whole line. */
export type ReceiptModifier = {
  label: string
  amount: number
}

export type ReceiptLine = {
  id: string
  quantity: number
  name: string
  /**
   * What the dish itself cost across this line, before modifiers. Null when the recorded
   * option amounts do not reconcile to the unit price (a "replace"-style option, or legacy
   * data), in which case only the line total is shown rather than a breakdown that does not add up.
   */
  baseAmount: number | null
  /** Priced modifiers. Empty whenever `baseAmount` is null. */
  modifiers: ReceiptModifier[]
  /** Options that cost nothing, kept grouped and compact. */
  optionGroups: ReceiptOptionGroup[]
  totalPrice: number
  note: string | null
}

export type ReceiptMetaRow = {
  label: string
  value: string
}

export type ReceiptDocument = {
  /** "TAX INVOICE" whenever the supplier is GST registered — the ATO requires the words. */
  documentTitle: string
  /** What this particular print is: "Counter receipt", "Table bill", "Pickup receipt"… */
  scopeLabel: string
  /** The number a customer or staff member reads out: service code, order number, or table. */
  code: string
  supplier: ReceiptSupplier
  /** Date of supply / issue — required on both a proof of transaction and a tax invoice. */
  issuedAt: Date
  currency: string
  meta: ReceiptMetaRow[]
  items: ReceiptLine[]
  totalAmount: number
  /** GST contained in the total, or null when the supplier is not GST registered. */
  gstAmount: number | null
  amountDue: number
  surchargeNotice: string | null
  refundContactEmail: string | null
}

export function formatReceiptMoney(amount: number, currencyCode?: string | null): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: (currencyCode || 'AUD').toUpperCase(),
  }).format(amount)
}

export function formatReceiptDateTime(value: string | Date | null): string {
  if (!value) return '-'

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '-'

  return new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

/**
 * A GST-registered supplier issues a tax invoice whether or not the bill has been settled yet;
 * everyone else is issuing a plain receipt, or a bill while money is still owed.
 */
export function resolveReceiptTitle(gstRegistered: boolean, paid: boolean): string {
  if (gstRegistered) return 'TAX INVOICE'
  return paid ? 'RECEIPT' : 'BILL'
}

/**
 * GST contained in a GST-inclusive total, which is what the customer was actually charged.
 * Consumer prices in Australia have to be displayed GST-inclusive, so the total is the
 * only honest base to work back from.
 */
export function gstIncludedInTotal(totalAmount: number, gstRegistered: boolean): number | null {
  if (!gstRegistered) return null
  return Math.round((totalAmount / 11) * 100) / 100
}

export function formatReceiptAdjustment(amount: number, currency: string): string {
  const formatted = formatReceiptMoney(Math.abs(amount), currency)
  return amount > 0 ? `+${formatted}` : `-${formatted}`
}

type SelectedOptionLike = {
  groupNameSnapshot: string
  optionNameSnapshot: string
  priceAdjustmentSnapshot: number
  quantity?: number | null
  allergensSnapshot?: string | null
  mayContainAllergensSnapshot?: string | null
  crossContactStatementSnapshot?: string | null
}

/** Collapses an order line's options into printable per-group text. */
export function buildReceiptOptionGroups(
  options: readonly SelectedOptionLike[],
  currency: string,
): ReceiptOptionGroup[] {
  const groups = new Map<string, SelectedOptionLike[]>()

  for (const option of options) {
    const groupName = option.groupNameSnapshot || 'Options'
    groups.set(groupName, [...(groups.get(groupName) ?? []), option])
  }

  return Array.from(groups.entries()).map(([groupName, groupedOptions]) => ({
    groupName,
    options: groupedOptions.map((option) => {
      const quantity = option.quantity ?? 1
      const adjustment = option.priceAdjustmentSnapshot === 0
        ? ''
        : ` ${formatReceiptAdjustment(option.priceAdjustmentSnapshot, currency)}`
      return `${option.optionNameSnapshot}${quantity > 1 ? ` x${quantity}` : ''}${adjustment}`
    }),
  }))
}

export function receiptItemCount(items: readonly ReceiptLine[]): number {
  return items.reduce((total, item) => total + item.quantity, 0)
}

function toCents(amount: number): number {
  return Math.round(amount * 100)
}

/**
 * Splits an order line into "what the dish cost" plus "what each extra added", so a receipt can
 * show the menu price rather than only the with-everything total.
 *
 * Options are snapshotted without their adjustment type, so an option that *replaces* the price
 * cannot be told apart from one that adds to it. Rather than guess, the breakdown is only
 * produced when base + recorded adjustments reconciles exactly to the charged unit price;
 * otherwise callers fall back to the line total alone.
 */
export function buildReceiptLinePricing(input: {
  quantity: number
  basePrice: number | null | undefined
  unitPrice: number
  options: readonly SelectedOptionLike[]
  currency: string
}): Pick<ReceiptLine, 'baseAmount' | 'modifiers' | 'optionGroups'> {
  const { quantity, basePrice, unitPrice, options, currency } = input

  const reconciles = basePrice !== null
    && basePrice !== undefined
    && toCents(basePrice)
      + options.reduce(
        (total, option) => total + toCents(option.priceAdjustmentSnapshot) * (option.quantity ?? 1),
        0,
      ) === toCents(unitPrice)

  if (!reconciles) {
    return {
      baseAmount: null,
      modifiers: [],
      optionGroups: buildReceiptOptionGroups(options, currency),
    }
  }

  return {
    baseAmount: basePrice * quantity,
    modifiers: options
      .filter((option) => option.priceAdjustmentSnapshot !== 0)
      .map((option) => {
        const optionQuantity = option.quantity ?? 1
        return {
          label: `${option.optionNameSnapshot}${optionQuantity > 1 ? ` x${optionQuantity}` : ''}`,
          amount: option.priceAdjustmentSnapshot * optionQuantity * quantity,
        }
      }),
    // Free options carry no amount, so they stay grouped rather than becoming money lines.
    optionGroups: buildReceiptOptionGroups(
      options.filter((option) => option.priceAdjustmentSnapshot === 0),
      currency,
    ),
  }
}

/**
 * What a receipt says about the money, once refunds are taken into account.
 *
 * <p>
 * The receipt was built from its own idea of "paid": every settled status, including Refunded, was
 * flattened to the word <i>Paid</i>, and the refund was not mentioned anywhere. My Orders, three
 * centimetres away, labelled the same order Refunded. A customer holding a document that says Paid
 * for money that has been given back has the wrong record of the transaction, and it is the
 * document they will produce in a dispute.
 * </p>
 *
 * <p>
 * The original stays on the receipt rather than being netted away. A tax invoice records the supply
 * that happened; what came back afterwards is a second fact, not an edit to the first one.
 * </p>
 */
export type ReceiptPaymentSummary = {
  /** The word beside "Payment" — the authoritative state, not a flattened one. */
  statusLabel: string
  /** How it was taken, which a refund enquiry needs before anything else. */
  methodLabel: string
  /** True once any money has gone back, so a receipt can decide whether to say more. */
  hasRefund: boolean
  refundedAmount: number
  /** Charged less refunded. What the customer is actually out of pocket. */
  netPaidAmount: number
  /** Still owed. Zero once the money has been taken, whatever came back afterwards. */
  amountDue: number
  /** Whether the supply was paid for at all — drives "RECEIPT" against "BILL". */
  isPaid: boolean
}

const settledPaymentStatuses = ['Paid', 'PartiallyRefunded', 'Refunded', 'NotRequired']

const receiptPaymentStatusLabels: Record<string, string> = {
  Paid: 'Paid',
  PartiallyRefunded: 'Partially refunded',
  Refunded: 'Refunded',
  NotRequired: 'No payment required',
  Unpaid: 'Unpaid',
  Pending: 'Pending',
  Failed: 'Failed',
  Cancelled: 'Cancelled',
  Expired: 'Expired',
}

export function buildReceiptPaymentSummary(input: {
  paymentStatus: string
  paymentMethod: 'Online' | 'PayAtCounter'
  totalAmount: number
  refundedAmountCents: number
}): ReceiptPaymentSummary {
  const isPaid = settledPaymentStatuses.includes(input.paymentStatus)
  const refundedAmount = Math.max(0, input.refundedAmountCents) / 100

  return {
    statusLabel: receiptPaymentStatusLabels[input.paymentStatus] ?? input.paymentStatus,
    methodLabel: input.paymentMethod === 'PayAtCounter' ? 'Paid at counter' : 'Card (online)',
    hasRefund: refundedAmount > 0,
    refundedAmount,
    // Rounded to cents at the end: subtracting a cents-derived figure from a decimal total is
    // exactly where a receipt picks up a stray fraction of a cent.
    netPaidAmount: Math.round((input.totalAmount - refundedAmount) * 100) / 100,
    amountDue: isPaid ? 0 : input.totalAmount,
    isPaid,
  }
}
