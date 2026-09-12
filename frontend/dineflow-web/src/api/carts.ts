import { getRequestErrorMessage } from '@/lib/requestErrorMessage'
import { getStoredToken } from './auth'
import { createUuid } from '../lib/uuid'


export const cartParticipantTokenHeader = 'X-Cart-Participant-Token'
/** Identifies one intended mutation, so retries of it are applied once. */
export const idempotencyKeyHeader = 'Idempotency-Key'

export type CartItem = {
  id: string
  menuItemId: string
  name: string
  imageUrl: string | null
  quantity: number
  basePrice: number
  unitPrice: number
  lineTotal: number
  note: string | null
  selectedOptions: CartItemOption[]
  /** Mirrors the restaurant's visibility toggle only — see `isOrderable`. */
  isAvailable: boolean
  isSoldOut: boolean
  /**
   * Whether checkout would accept this line. The two flags above each answer part of that question
   * and neither answers all of it: a line can be `isAvailable` and still be refused because its
   * menu section was archived.
   */
  isOrderable: boolean
  /** Why not, in words a customer can act on. Null when the line is fine. */
  unavailableReason: string | null
  createdAt: string
  updatedAt: string | null
}

export type CartItemOption = {
  menuItemOptionId: string | null
  groupNameSnapshot: string
  optionNameSnapshot: string
  priceAdjustmentSnapshot: number
  allergensSnapshot?: string | null
  mayContainAllergensSnapshot?: string | null
  crossContactStatementSnapshot?: string | null
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
  /**
   * Returned once, only for orders placed without signing in. The server keeps just a hash, so if
   * the client loses this the order can never be looked up again.
   */
  guestAccessToken?: string | null
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
  selectedOptionIds?: string[]
  /**
   * The line's `updatedAt` as it stood when the edit began. A dine-in cart is shared, and this edit
   * sets an absolute quantity — without the version, two people editing one line both succeed and
   * the later write silently replaces the earlier. Required by the server.
   */
  expectedUpdatedAt: string
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

/**
 * Adds to the cart, once, however many times the request is sent.
 *
 * <p>
 * Adding is the one cart operation that is not repeatable — the server adds to what is already
 * there. A phone that loses signal after the server committed but before the response arrived
 * cannot tell that apart from a request that never landed, so it retries, and the customer ends up
 * with two of something they tapped once. The key identifies the intent rather than the attempt, so
 * every retry of the same tap collapses to one.
 * </p>
 *
 * <p>
 * Generated here, not by the caller: the guarantee is worth nothing if a caller forgets, and no
 * caller has a better idea of what "the same tap" means than the function they called once.
 * </p>
 */
export async function addCartItem(
  cartId: string,
  participantToken: string,
  request: AddCartItemRequest,
  idempotencyKey: string = createUuid(),
) {
  return cartRequest<Cart>(
    `/api/public/carts/${cartId}/items`,
    {
      method: 'POST',
      body: JSON.stringify(request),
      headers: { [idempotencyKeyHeader]: idempotencyKey },
    },
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

export type CheckoutCartRequest = {
  acceptedCustomerTermsVersion: string
  acknowledgedPrivacyPolicyVersion: string
  acknowledgedAllergenNoticeVersion: string
}

/**
 * Long enough for a slow connection to finish an ordinary checkout, short enough that a stalled one
 * gives the screen back while the person is still looking at it.
 */
export const checkoutTimeoutMs = 20_000

/**
 * Submits the cart.
 *
 * <p>
 * Timing out here does not mean the order was not placed — only that the answer never arrived. The
 * caller may safely submit again: one cart can produce only one order, so a second attempt returns
 * the order the first one created rather than making another.
 * </p>
 */
export async function checkoutCart(cartId: string, participantToken: string, request: CheckoutCartRequest) {
  return cartRequest<CheckoutCartResponse>(
    `/api/public/carts/${cartId}/checkout`,
    { method: 'POST', body: JSON.stringify(request) },
    participantToken,
    checkoutTimeoutMs,
  )
}

/** True when a request gave up waiting rather than being answered. */
export function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'TimeoutError'
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
  timeoutMs?: number,
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

  // A request with no deadline is one the caller can never recover from: fetch waits on the
  // browser's own timeout, which on a stalled mobile connection can be minutes, and until then the
  // screen is frozen with nothing to act on.
  const response = await fetch(path, {
    ...options,
    headers,
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
  })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null)
    const error = new Error(getRequestErrorMessage(response.status, errorBody))

    // The body carried more than a message — a code, and for a conflict the cart as it now stands.
    // Throwing only the sentence discarded exactly what the caller needed to recover.
    return Promise.reject(Object.assign(error, {
      status: response.status,
      code: typeof errorBody?.code === 'string' ? errorBody.code : undefined,
      details: errorBody ?? undefined,
    }))
  }

  return (await response.json()) as T
}

/**
 * The cart a conflict response carried, or null when this was not one.
 *
 * <p>
 * A rejected edit is only half an answer. The other half is what the cart looks like now, so the
 * screen can stop describing a version that no longer exists.
 * </p>
 */
export function cartFromConflict(error: unknown): Cart | null {
  if ((error as { code?: string })?.code !== 'cart_item_conflict') {
    return null
  }

  const cart = (error as { details?: { cart?: unknown } })?.details?.cart

  return cart && typeof cart === 'object' && 'id' in cart ? (cart as Cart) : null
}
