import { refundedItemLabel } from './refundedItemLabel'

type SummarisableItem = {
  menuItemNameSnapshot: string
  optionNameSnapshot?: string | null
}

/**
 * What a refund request is for, in one line for a list.
 *
 * <p>
 * The amount alone stopped explaining itself once extras could be refunded on their own: a request
 * for $1.96 sitting beside one for $32.52 reads as a mistake until you know the first is a sauce.
 * Naming the first item answers that at a glance, and the count carries the rest rather than
 * wrapping the row.
 * </p>
 *
 * <p>
 * Empty for a request with no itemised lines — older requests, and refunds asked for as a lump sum.
 * The caller shows nothing rather than a placeholder, because a row that says "no items" is worse
 * than a row that says nothing.
 * </p>
 */
export function refundRequestSummary(items: SummarisableItem[]): string {
  if (items.length === 0) {
    return ''
  }

  const first = refundedItemLabel(items[0])
  const rest = items.length - 1

  return rest > 0 ? `${first} +${rest} more` : first
}
