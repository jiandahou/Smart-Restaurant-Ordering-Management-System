import { getStoredToken } from './auth'

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
  selectedOptions: CartItemOption[]
  isAvailable: boolean
  isSoldOut: boolean
  createdAt: string
  updatedAt: string | null
}

export type CartItemOption = {
  menuItemOptionId: string | null
  groupNameSnapshot: string
  optionNameSnapshot: string
  priceAdjustmentSnapshot: number
  quantity: number
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

export type SubmittedOrderItem = {
  id: string
  orderId: string
  menuItemId: string | null
  itemNameSnapshot: string
  quantity: number
  unitPrice: number
  totalPrice: number
  note: string | null
  selectedOptions: CartItemOption[]
  createdAt: string
  updatedAt: string | null
}

export type SubmittedOrder = {
  id: string
  restaurantId: string | null
  tableId: string | null
  tableNumber: string | null
  customerId: string | null
  orderNumber: string
  currency: string
  orderType: number
  status: number
  paymentStatus: string
  paymentMethod: 'Online' | 'PayAtCounter'
  totalAmount: number
  customerNote: string | null
  scheduledTime: string | null
  createdAt: string
  updatedAt: string | null
  orderItems: SubmittedOrderItem[]
}

export type JoinCartRequest =
  | { restaurantId: string; orderType: 'DineIn' | 'Takeaway'; tableQrToken?: never }
  | { restaurantId?: never; tableQrToken: string }

export type JoinCartResponse = {
  participantToken: string
  participantId: string
  cart: Cart
}

export type CheckoutCartResponse = {
  message: string
  order: SubmittedOrder
}

export type AddCartItemRequest = {
  menuItemId: string
  quantity: number
  note?: string
  selectedOptionIds?: string[]
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

export async function clearCartItems(cartId: string, participantToken: string) {
  return cartRequest<Cart>(
    `/api/public/carts/${cartId}/items`,
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

export async function checkoutCart(cartId: string, participantToken: string) {
  return cartRequest<CheckoutCartResponse>(
    `/api/public/carts/${cartId}/checkout`,
    { method: 'POST' },
    participantToken,
  )
}

export type CreatePublicPaymentSessionResponse = {
  message: string
  sessionId: string
  checkoutUrl: string
  orderId: string
  paymentId: string
}

export async function createPublicPaymentSession(cartId: string, participantToken: string) {
  return cartRequest<CreatePublicPaymentSessionResponse>(
    `/api/public/carts/${cartId}/payment-session`,
    { method: 'POST' },
    participantToken,
  )
}

export async function selectOrderPaymentMethod(
  cartId: string,
  participantToken: string,
  paymentMethod: 'Online' | 'PayAtCounter',
) {
  return cartRequest<CheckoutCartResponse>(
    `/api/public/carts/${cartId}/payment-method`,
    { method: 'PUT', body: JSON.stringify({ paymentMethod }) },
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

  const authToken = getStoredToken()
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`)
  }

  const response = await fetch(`${apiBaseUrl}${path}`, { ...options, headers })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null)
    throw new Error(errorBody?.message || `Request failed with HTTP ${response.status}`)
  }

  return (await response.json()) as T
}
