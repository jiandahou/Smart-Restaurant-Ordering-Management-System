const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

export type PublicOrderingRestaurant = {
  id: string
  name: string
  address: string
  phone: string
  timezone: string
  currency: string
  paymentPolicy: 'PrepayRequired' | 'PayAtCounterAllowed'
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
  displayOrder: number
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

export function getPublicRestaurantMenu(restaurantId: string) {
  return publicRequest<PublicMenu>(
    `/api/public/menu/restaurants/${encodeURIComponent(restaurantId)}`,
  )
}

export function resolvePublicAssetUrl(url: string | null) {
  if (!url) {
    return null
  }

  if (/^https?:\/\//i.test(url)) {
    return url
  }

  if (url.startsWith('/')) {
    return `${apiBaseUrl}${url}`
  }

  return url
}

async function publicRequest<T>(path: string) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null)
    throw new Error(errorBody?.message || `Request failed with HTTP ${response.status}`)
  }

  return (await response.json()) as T
}
