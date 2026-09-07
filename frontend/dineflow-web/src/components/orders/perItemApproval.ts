import { parseRefundAmountCents } from './refundAmount'

type ApprovableItem = {
  orderItemId: string
  amountCents: number
}

/**
 * What the per-item boxes add up to.
 *
 * <p>
 * The total is derived rather than entered, because the two must agree and only one of them can be
 * the decision. A box left empty or holding something unparseable counts as nothing rather than
 * failing the sum — staff clearing a field is how they say "not this one", and it should read as
 * that immediately rather than as an error.
 * </p>
 */
export function sumPerItemApproval(
  items: ApprovableItem[],
  amounts: Record<string, string>,
): number {
  return items.reduce(
    (total, item) => total + (parseRefundAmountCents(amounts[item.orderItemId] ?? '') ?? 0),
    0,
  )
}

/**
 * What the boxes start at when the per-item view is opened.
 *
 * <p>
 * The amounts the customer asked for. The common approval is "all of it except this one", which is
 * then a single edit; starting from zero would make the ordinary case the most typing.
 * </p>
 */
export function prefillPerItemApproval(items: ApprovableItem[]): Record<string, string> {
  return Object.fromEntries(
    items.map((item) => [item.orderItemId, (item.amountCents / 100).toFixed(2)]),
  )
}
