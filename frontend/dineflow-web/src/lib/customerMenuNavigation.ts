export type CustomerMenuOrderType = 'DineIn' | 'Takeaway'

export function normalizeCustomerMenuOrderType(orderType: number | string): CustomerMenuOrderType {
  return orderType === 0 || orderType === 'DineIn' ? 'DineIn' : 'Takeaway'
}

export function parseCustomerMenuOrderType(value: string | null): CustomerMenuOrderType | null {
  return value === 'DineIn' || value === 'Takeaway' ? value : null
}

export function buildRestaurantMenuPath(restaurantId: string, orderType: number | string) {
  const params = new URLSearchParams({
    orderType: normalizeCustomerMenuOrderType(orderType),
  })

  return `/r/${encodeURIComponent(restaurantId)}/menu?${params.toString()}`
}
