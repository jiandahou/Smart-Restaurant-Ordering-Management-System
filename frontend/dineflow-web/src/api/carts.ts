const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

export const cartParticipantTokenHeader = 'X-Cart-Participant-Token'

export type CartItem = {
  id: string
  menuItemId: string
  name: string
  imageUrl: string | null
  quantity: number
  unitPrice: number
  lineTotal: number
  note: string | null
  isAvailable: boolean
  isSoldOut: boolean
  createdAt: string
  updatedAt: string | null
}

export type Cart = {
  id: string
  restaurantId: string
  tableId: string | null
  tableNumber: string | null
  orderType: string
  status: string
  customerNote: string | null
  expiresAt: string
  createdAt: string
  updatedAt: string | null
  total: number
  itemCount: number
  items: CartItem[]
}

export type JoinCartRequest =
  | { restaurantId: string; tableQrToken?: never }
  | { restaurantId?: never; tableQrToken: string }

export type JoinCartResponse = {
  participantToken: string
  cart: Cart
}

export type AddCartItemRequest = {
  menuItemId: string
  quantity: number
  note?: string
}

export type UpdateCartItemRequest = {
  quantity: number
  note?: string
}

export async function joinCart(request: JoinCartRequest) {
  return cartRequest<JoinCartResponse>('/api/public/carts/join', {
    method: 'POST',
    body: JSON.stringify(request),
  })
}

export async function getCart(cartId: string, participantToken: string) {
  return cartRequest<Cart>(`/api/public/carts/${cartId}`, {}, participantToken)
}

export async function addCartItem(
  cartId: string,
  participantToken: string,
  request: AddCartItemRequest,
) {
  return cartRequest<Cart>(
    `/api/public/carts/${cartId}/items`,
    { method: 'POST', body: JSON.stringify(request) },
    participantToken,
  )
}

export async function updateCartItem(
  cartId: string,
  cartItemId: string,
  participantToken: string,
  request: UpdateCartItemRequest,
) {
  return cartRequest<Cart>(
    `/api/public/carts/${cartId}/items/${cartItemId}`,
    { method: 'PUT', body: JSON.stringify(request) },
    participantToken,
  )
}

export async function deleteCartItem(
  cartId: string,
  cartItemId: string,
  participantToken: string,
) {
  return cartRequest<Cart>(
    `/api/public/carts/${cartId}/items/${cartItemId}`,
    { method: 'DELETE' },
    participantToken,
  )
}

export async function updateCartNote(
  cartId: string,
  participantToken: string,
  note: string,
) {
  return cartRequest<Cart>(
    `/api/public/carts/${cartId}/note`,
    { method: 'PUT', body: JSON.stringify({ note }) },
    participantToken,
  )
}

async function cartRequest<T>(
  path: string,
  options: RequestInit,
  participantToken?: string,
) {
  const headers = new Headers(options.headers)
  headers.set('Accept', 'application/json')

  if (options.body) {
    headers.set('Content-Type', 'application/json')
  }

  if (participantToken) {
    headers.set(cartParticipantTokenHeader, participantToken)
  }

  const response = await fetch(`${apiBaseUrl}${path}`, { ...options, headers })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null)
    throw new Error(errorBody?.message || `Request failed with HTTP ${response.status}`)
  }

  return (await response.json()) as T
}
