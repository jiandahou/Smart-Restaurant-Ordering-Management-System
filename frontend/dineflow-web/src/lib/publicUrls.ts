import { buildRestaurantMenuPath } from './customerMenuNavigation'

export const publicAppBaseUrl = (import.meta.env.VITE_PUBLIC_APP_BASE_URL || window.location.origin).replace(/\/$/, '')

export function buildTakeawayPublicUrl(restaurantId: string) {
  return `${publicAppBaseUrl}${buildRestaurantMenuPath(restaurantId, 'Takeaway')}`
}

export function buildTablePublicUrl(qrToken: string) {
  return `${publicAppBaseUrl}/table/${encodeURIComponent(qrToken)}`
}
