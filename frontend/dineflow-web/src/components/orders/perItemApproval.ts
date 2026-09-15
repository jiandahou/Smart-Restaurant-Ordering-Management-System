import { refundSelectionKey } from './refundItemSelection'
import { parseRefundAmountCents } from './refundAmount'

type ApprovableItem = {
  orderItemId: string
  orderItemOptionId?: string | null
  optionNameSnapshot?: string | null
  menuItemNameSnapshot?: string
  amountCents: number
}

/**
 * The key one line of a request is held under.
 *
 * <p>
 * A request can name a dish and one of its extras, or two extras on one dish. Keyed by the line
 * alone those are the same entry, and staff editing one amount would silently move the other.
 * Shared with the customer's picker so both sides agree on what "one selection" is.
 * </p>
 */
export function approvalKey(item: ApprovableItem): string {
  return refundSelectionKey(item.orderItemId, item.orderItemOptionId)
}

/** How the line reads on the approval screen: the extra, and the dish it was on. */
export function approvalLabel(item: ApprovableItem): string {
  const dish = item.menuItemNameSnapshot ?? 'Item'

  return item.optionNameSnapshot ? `${item.optionNameSnapshot} on ${dish}` : dish
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
    (total, item) => total + (parseRefundAmountCents(amounts[approvalKey(item)] ?? '') ?? 0),
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
    items.map((item) => [approvalKey(item), (item.amountCents / 100).toFixed(2)]),
  )
}
