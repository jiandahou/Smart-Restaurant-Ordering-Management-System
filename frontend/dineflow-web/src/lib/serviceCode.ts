/**
 * The number staff call out and the customer holds. Dine-in, takeaway and scheduled orders all
 * draw from one per-restaurant daily sequence, so this reads unambiguously across the venue.
 *
 * Deliberately NOT a replacement for orderNumber in back-office views: the pickup sequence resets
 * every business day, so it is only unique within a restaurant-day, while payment, refund and
 * audit records all key off the order number.
 */
export type ServiceCodeOrder = {
  orderNumber: string
  pickupNumber: number | null
  tableNumber: string | null
}

export function formatPickupNumber(pickupNumber: number | null): string | null {
  if (pickupNumber === null || !Number.isFinite(pickupNumber) || pickupNumber <= 0) {
    return null
  }

  return String(Math.trunc(pickupNumber)).padStart(3, '0')
}

/**
 * Returns `P2-007` when the order is seated at a table, `007` otherwise, and falls back to the
 * order number for historical orders placed before pickup numbers existed.
 */
export function formatServiceCode(order: ServiceCodeOrder): string {
  const pickup = formatPickupNumber(order.pickupNumber)
  if (pickup === null) {
    return order.orderNumber
  }

  const table = order.tableNumber?.trim()
  return table ? `${table}-${pickup}` : pickup
}

/** True when formatServiceCode had to fall back, so callers can decide whether to show a hint. */
export function hasServiceCode(order: ServiceCodeOrder): boolean {
  return formatPickupNumber(order.pickupNumber) !== null
}
