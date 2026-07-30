import type { AdminOrder, OrderTransitionAction } from '../api/auth'

export type AdminOrderSortKey =
  | 'createdAt'
  | 'orderNumber'
  | 'restaurantName'
  | 'status'
  | 'paymentStatus'
  | 'totalAmount'

export const adminOrderSortKeys = [
  'createdAt',
  'orderNumber',
  'restaurantName',
  'status',
  'paymentStatus',
  'totalAmount',
] as const satisfies readonly AdminOrderSortKey[]

export const adminOrderPageSizes = [10, 20, 50, 100] as const

const expectedNextAction: Partial<Record<string, OrderTransitionAction>> = {
  Pending: 'Accept',
  Accepted: 'StartPreparing',
  Preparing: 'MarkReady',
  Ready: 'Complete',
}

export function getAdminOrderArrayValue<T extends string>(
  value: string | null,
  values: readonly T[],
  fallback: T,
): T {
  return values.includes(value as T) ? (value as T) : fallback
}

export function getAdminOrderPage(value: string | null) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

export function getAdminOrderPageSize(value: string | null) {
  const parsed = Number(value)
  return adminOrderPageSizes.includes(parsed as (typeof adminOrderPageSizes)[number])
    ? parsed
    : 20
}

export function splitAdminOrderActions(order: AdminOrder) {
  const actions = order.availableActions ?? []
  const expected = expectedNextAction[order.status]
  const primary = expected && actions.includes(expected) ? expected : null

  return {
    primary,
    secondary: actions.filter((action) => action !== primary),
  }
}

export function adminOrderTransitionNeedsConfirmation(
  order: AdminOrder,
  action: OrderTransitionAction,
) {
  return action === 'Complete'
    || (order.status === 'Pending' && action === 'MarkReady')
}
