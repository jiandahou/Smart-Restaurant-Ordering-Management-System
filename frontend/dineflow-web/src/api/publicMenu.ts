import { getRequestErrorMessage } from '@/lib/requestErrorMessage'

export type PublicOrderingRestaurant = {
  id: string
  name: string
  address: string
  phone: string
  legalBusinessName: string
  abn: string | null
  gstRegistered: boolean
  pricesIncludeGst: boolean
  businessContactEmail: string
  refundContactEmail: string
  customerSurchargeNotice: string | null
  imageUrl: string | null
  timezone: string
  currency: string
  paymentPolicy: 'PrepayRequired' | 'PayAtCounterAllowed'
  onlinePaymentsEnabled: boolean
  acceptingOrders: boolean
  openingHoursJson: string
  specialOpeningDaysJson: string
  isWithinOpeningHours: boolean
  isOrderingAvailable: boolean
  orderingUnavailableReason: string
  orderingStatusMessage: string
}

export type PublicOrderingTable = {
  id: string
  tableNumber: string
  capacity: number
}

export type PublicOrderingContext = {
  restaurant: PublicOrderingRestaurant
  table: PublicOrderingTable | null
  orderType: 'DineIn' | 'Takeaway' | string
  availableOrderTypes: Array<'DineIn' | 'Takeaway' | string>
  menuEntryUrl: string
}

export type PublicMenuItem = {
  id: string
  categoryId: string
  name: string
  description: string | null
  price: number
  imageUrl: string | null
  isAvailable: boolean
  isSoldOut: boolean
  /**
   * Portions left on a limited dish. Null when the dish is unlimited or already sold out — in
   * both cases there is no count worth showing.
   */
  remainingStock: number | null
  isVegetarian: boolean
  isVegan: boolean
  isGlutenFree: boolean
  isHalal: boolean
  allergens: string | null
  mayContainAllergens: string | null
  crossContactStatement: string | null
  allergenInfoLastVerifiedAt: string | null
  spiceLevel: number
  servingSize: string | null
  calories: number | null
  isPopular: boolean
  isRecommended: boolean
  displayOrder: number
  optionGroups: PublicMenuOptionGroup[]
}

export type PublicMenuOptionGroup = {
  id: string
  menuItemId: string
  name: string
  isRequired: boolean
  minSelections: number
  maxSelections: number
  displayOrder: number
  isActive: boolean
  options: PublicMenuOption[]
}

export type PublicMenuOption = {
  id: string
  groupId: string
  name: string
  priceAdjustment: number
  adjustmentType: 0 | 1 | 2
  /** The modifier's own allergen declaration, separate from the dish's. */
  allergens: string | null
  mayContainAllergens: string | null
  crossContactStatement: string | null
  maxQuantity: number
  /**
   * Lots of this modifier the kitchen has left, or null when it is not counted. Zero means it has
   * run out — distinct from null, which means there was never a limit.
   */
  remainingStock: number | null
  displayOrder: number
  isAvailable: boolean
}

export type PublicMenuCategory = {
  id: string
  name: string
  description: string | null
  displayOrder: number
  items: PublicMenuItem[]
}

export type PublicMenu = {
  restaurantId: string
  categories: PublicMenuCategory[]
}

export function getPublicRestaurantOrderingContext(restaurantId: string) {
  return publicRequest<PublicOrderingContext>(
    `/api/public/ordering/restaurants/${encodeURIComponent(restaurantId)}`,
  )
}

export function getPublicTableOrderingContext(qrToken: string) {
  return publicRequest<PublicOrderingContext>(
    `/api/public/ordering/tables/${encodeURIComponent(qrToken)}`,
  )
}

/**
 * What is left of a menu, and nothing else.
 *
 * <p>
 * A menu open on a phone shows stock that stopped being true the moment somebody else ordered, and
 * before this the only correction was the diner happening to reload. Re-fetching the whole menu on
 * a timer would fix that by resending every description, allergen statement and option group to
 * every phone in the room, several times a minute, to learn that none of them had changed.
 * </p>
 */
export type PublicMenuStock = {
  restaurantId: string
  items: { id: string; isSoldOut: boolean; remainingStock: number | null }[]
  options: { id: string; remainingStock: number | null }[]
}

export function getPublicRestaurantMenuStock(restaurantId: string) {
  return publicRequest<PublicMenuStock>(
    `/api/public/menu/restaurants/${encodeURIComponent(restaurantId)}/stock`,
  )
}

export function getPublicRestaurantMenu(restaurantId: string, search?: string) {
  const params = new URLSearchParams()
  const normalizedSearch = search?.trim()

  if (normalizedSearch) {
    params.set('search', normalizedSearch)
  }

  const query = params.toString()

  return publicRequest<PublicMenu>(
    `/api/public/menu/restaurants/${encodeURIComponent(restaurantId)}${query ? `?${query}` : ''}`,
  )
}

/**
 * Uploaded assets are normally served either as an absolute S3/CloudFront URL or as a path on this
 * origin. Local MinIO URLs are different: the backend stores them as localhost:9000, but localhost
 * belongs to the viewing device. A phone opening the dev server over the LAN would therefore ask
 * itself for the image. On a non-loopback browser origin, route loopback assets back through the
 * frontend's same-origin development proxy instead.
 */
export function resolvePublicAssetUrl(
  url: string | null,
  browserOrigin = typeof window === 'undefined' ? null : window.location.origin,
) {
  const normalizedUrl = url?.trim()

  if (!normalizedUrl) {
    return null
  }

  let assetUrl: URL
  let currentOrigin: URL

  try {
    assetUrl = new URL(normalizedUrl)
    currentOrigin = new URL(browserOrigin ?? '')
  } catch {
    return normalizedUrl
  }

  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

  if (!loopbackHosts.has(assetUrl.hostname) || loopbackHosts.has(currentOrigin.hostname)) {
    return normalizedUrl
  }

  return `${assetUrl.pathname}${assetUrl.search}${assetUrl.hash}`
}

async function publicRequest<T>(path: string) {
  const response = await fetch(path, {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null)
    throw new Error(getRequestErrorMessage(response.status, errorBody))
  }

  return (await response.json()) as T
}
