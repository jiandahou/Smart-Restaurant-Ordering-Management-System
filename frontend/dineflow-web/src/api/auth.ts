export type AuthUser = {
  id: string
  email: string | null
  fullName: string | null
  avatarUrl: string | null
  restaurantId: string | null
  roles: string[]
  hasPassword: boolean
  externalProviders: string[]
}

export type LoginResponse = {
  message: string
  token: string
  refreshToken: string
  user: AuthUser
}

export type MfaRequiredLoginResponse = {
  message: string
  mfaRequired: true
  challengeId: string
  methods: string[]
  preferredMethod: string
}

export type PasswordLoginResponse = LoginResponse | MfaRequiredLoginResponse

export type RegisterCustomerRequest = {
  email: string
  password: string
  fullName: string
}

export type RegisterCustomerResponse = {
  message: string
  userId: string
  email: string | null
  restaurantId: string | null
  emailConfirmed: boolean
  confirmationEmailSent: boolean
  role: 'Customer'
}

export type ConfirmEmailRequest = {
  userId: string
  token: string
}

export type RequestMagicLinkRequest = {
  email: string
}

export type MagicLinkLoginRequest = {
  userId: string
  token: string
}

export type ExchangeOAuthCodeRequest = {
  code: string
}

export type RequestPasswordResetRequest = {
  email: string
}

export type MfaVerification = {
  method: string
  code: string
}

export type RequestCurrentUserPasswordResetRequest = {
  password?: string
  verification?: MfaVerification
}

export type ResetPasswordRequest = {
  userId: string
  token: string
  password: string
}

export type UpdateCurrentUserRequest = {
  fullName: string
}

export type RequestEmailChangeRequest = {
  newEmail: string
  currentPassword: string
}

export type ConfirmEmailChangeRequest = {
  userId: string
  newEmail: string
  token: string
}

export type AuthMessageResponse = {
  message: string
}

export type ConfirmEmailResponse = AuthMessageResponse & Partial<LoginResponse>

export type UpdateCurrentUserResponse = {
  message: string
  user: AuthUser
}

export type CreateAvatarUploadUrlResponse = {
  provider: 'S3' | string
  uploadUrl: string
  objectKey: string
  avatarUrl: string
  expiresAt: string
  headers: Record<string, string>
}

export type UserListItem = AuthUser & {
  createdAt: string
  updatedAt: string | null
}

export type UserListParams = {
  page?: number
  pageSize?: number
  search?: string
  sortBy?: string
  sortDirection?: 'asc' | 'desc'
  role?: string
  restaurantId?: string
  scope?: 'all' | 'platform' | 'restaurant'
}

export type CreateRestaurantUserRole = 'RestaurantOwner' | 'Admin' | 'Staff'
export type ManagedUserRole = CreateRestaurantUserRole | 'Customer'

export type CreateRestaurantUserRequest = {
  email: string
  password: string
  fullName?: string
  restaurantId?: string
  role: CreateRestaurantUserRole
}

export type CreateRestaurantUserResponse = {
  message: string
  userId: string
  email: string | null
  restaurantId: string | null
  role: CreateRestaurantUserRole
}

export type UpdateUserRequest = {
  email?: string
  fullName?: string
  restaurantId?: string | null
  role?: ManagedUserRole
  password?: string
}

export type UpdateUserResponse = {
  message: string
  user: UserListItem
}

export type DeleteUserResponse = {
  message: string
  userId: string
}

export type Restaurant = {
  id: string
  name: string
  address: string
  phone: string
  imageUrl: string | null
  countryCode: string
  timezone: string
  currency: string
  paymentPolicy: RestaurantPaymentPolicy
  isActive: boolean
  acceptingOrders: boolean
  openingHoursJson: string
  specialOpeningDaysJson: string
  createdAt: string
  updatedAt: string | null
}

export type RestaurantPaymentPolicy = 'PrepayRequired' | 'PayAtCounterAllowed'

export type RestaurantListParams = {
  page?: number
  pageSize?: number
  search?: string
  sortBy?: string
  sortDirection?: 'asc' | 'desc'
  isActive?: boolean
  countryCode?: string
  currency?: string
}

export type RestaurantRequest = {
  name: string
  address: string
  phone: string
  imageUrl?: string | null
  countryCode: string
  timezone: string
  currency: string
  paymentPolicy: RestaurantPaymentPolicy
  isActive: boolean
  acceptingOrders: boolean
  openingHoursJson?: string | null
  specialOpeningDaysJson?: string | null
}

export type UpdateRestaurantResponse = {
  message: string
  restaurant: Restaurant
}

export type DeleteRestaurantResponse = {
  message: string
  restaurantId: string
}

export type RestaurantTable = {
  id: string
  restaurantId: string
  tableNumber: string
  qrToken: string | null
  capacity: number
  isActive: boolean
  createdAt: string
  updatedAt: string | null
}

export type UpdateRestaurantTableRequest = {
  tableNumber: string
  capacity: number
  isActive: boolean
}

export type UpdateRestaurantTableResponse = {
  message: string
  table: RestaurantTable
}

export type CreateRestaurantTableResponse = UpdateRestaurantTableResponse

export type MenuCategory = {
  id: string
  restaurantId: string
  name: string
  description: string | null
  displayOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string | null
}

export type CreateMenuCategoryRequest = {
  restaurantId: string
  name: string
  description?: string | null
  displayOrder: number
  isActive: boolean
}

export type UpdateMenuCategoryRequest = Omit<CreateMenuCategoryRequest, 'restaurantId'>

export type MenuCategoryMutationResponse = {
  message: string
  category: MenuCategory
}

export type ReorderMenuCategoriesRequest = {
  restaurantId: string
  categoryIds: string[]
}

export type ReorderMenuCategoriesResponse = {
  message: string
}

export type DeleteMenuCategoryResponse = {
  message: string
  categoryId: string
}

export type MenuOption = {
  id: string
  groupId: string
  name: string
  priceAdjustment: number
  adjustmentType: 0 | 1 | 2
  maxQuantity: number
  displayOrder: number
  isAvailable: boolean
  createdAt: string
  updatedAt: string | null
}

export type MenuOptionGroup = {
  id: string
  menuItemId: string
  name: string
  isRequired: boolean
  minSelections: number
  maxSelections: number
  displayOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string | null
  options: MenuOption[]
}

export type CreateMenuOptionGroupRequest = {
  name: string
  isRequired: boolean
  minSelections: number
  maxSelections: number
  displayOrder: number
}

export type UpdateMenuOptionGroupRequest = CreateMenuOptionGroupRequest & {
  isActive: boolean
}

export type CreateMenuOptionRequest = {
  name: string
  priceAdjustment: number
  adjustmentType: 0 | 1 | 2
  maxQuantity: number
  displayOrder: number
}

export type UpdateMenuOptionRequest = CreateMenuOptionRequest & {
  isAvailable: boolean
}

export type MenuItem = {
  id: string
  restaurantId: string
  categoryId: string
  categoryName: string
  name: string
  description: string | null
  price: number
  imageUrl: string | null
  isAvailable: boolean
  isSoldOut: boolean
  isVegetarian: boolean
  isVegan: boolean
  isGlutenFree: boolean
  isHalal: boolean
  allergens: string | null
  displayOrder: number
  createdAt: string
  updatedAt: string | null
  optionGroups: MenuOptionGroup[]
}

export type CreateMenuItemRequest = {
  restaurantId: string
  categoryId: string
  name: string
  description?: string | null
  price: number
  imageUrl?: string | null
  isAvailable: boolean
  isSoldOut: boolean
  displayOrder: number
}

export type UpdateMenuItemRequest = Omit<CreateMenuItemRequest, 'restaurantId'>

export type MenuItemMutationResponse = {
  message: string
  item: MenuItem
}

export type ReorderMenuItemsRequest = {
  categoryId: string
  itemIds: string[]
}

export type ReorderMenuItemsResponse = {
  message: string
}

export type DeleteMenuItemResponse = {
  message: string
  itemId: string
}

export type UpdateMenuItemAvailabilityResponse = {
  message: string
  itemId: string
  isAvailable: boolean
}

export type UpdateMenuItemSoldOutResponse = {
  message: string
  itemId: string
  isSoldOut: boolean
}

export type CreateMenuItemImageUploadUrlResponse = {
  provider: 'S3' | string
  uploadUrl: string
  objectKey: string
  imageUrl: string
  expiresAt: string
  headers: Record<string, string>
}

export type CompleteMenuItemImageUploadResponse = {
  objectKey: string
  imageUrl: string
}

export type SendTestEmailRequest = {
  to: string
  subject?: string
  message?: string
}

export type SendTestEmailResponse = {
  message: string
}

export type AdminOrderStatus =
  | 'Pending'
  | 'Accepted'
  | 'Preparing'
  | 'Ready'
  | 'Completed'
  | 'Cancelled'
  | 'Rejected'

export type AdminPaymentStatus =
  | 'Unpaid'
  | 'Pending'
  | 'Paid'
  | 'Failed'
  | 'Cancelled'
  | 'Expired'
  | 'Refunded'
  | 'PartiallyRefunded'
  | 'NotRequired'

export type AdminOrderType = 'DineIn' | 'Takeaway' | 'Scheduled'

export type AdminPaymentRefundStatus = 'Pending' | 'Succeeded' | 'Failed'

export type OrderTransitionAction =
  | 'Accept'
  | 'StartPreparing'
  | 'MarkReady'
  | 'Complete'
  | 'Reject'
  | 'Cancel'
  | 'Reopen'

export type AdminOrderItem = {
  id: string
  menuItemId: string | null
  itemNameSnapshot: string
  quantity: number
  unitPrice: number
  totalPrice: number
  note: string | null
  selectedOptions: AdminOrderItemOption[]
}

export type AdminOrderItemOption = {
  id: string
  menuItemOptionId: string | null
  groupNameSnapshot: string
  optionNameSnapshot: string
  priceAdjustmentSnapshot: number
  quantity: number
}

export type AdminOrderPayment = {
  id: string
  provider: string
  status: AdminPaymentStatus
  amountCents: number
  currency: string
  providerCheckoutSessionId: string | null
  providerPaymentIntentId: string | null
  failureReason: string | null
  refundCount: number
  refundedAmountCents: number
  refundableAmountCents: number
  hasPendingRefund: boolean
  refunds: AdminPaymentRefund[]
  createdAt: string
  updatedAt: string | null
  paidAt: string | null
  failedAt: string | null
}

export type AdminPaymentRefund = {
  id: string
  provider: string
  providerRefundId: string | null
  providerPaymentIntentId: string | null
  amountCents: number
  currency: string
  status: AdminPaymentRefundStatus
  reason: string | null
  failureReason: string | null
  requestedByUserId: string | null
  createdAt: string
  updatedAt: string | null
  refundedAt: string | null
  failedAt: string | null
}

export type AdminOrder = {
  id: string
  restaurantId: string | null
  restaurantName: string | null
  currency: string
  tableId: string | null
  tableNumber: string | null
  customerId: string | null
  customerName: string | null
  customerEmail: string | null
  orderNumber: string
  pickupDate: string | null
  pickupNumber: number | null
  pickupCode: string
  tableSessionId: string | null
  orderType: AdminOrderType
  status: AdminOrderStatus
  paymentStatus: AdminPaymentStatus
  paymentMethod: 'Online' | 'PayAtCounter'
  canProcess: boolean
  availableActions: OrderTransitionAction[]
  totalAmount: number
  customerNote: string | null
  scheduledTime: string | null
  createdAt: string
  updatedAt: string | null
  paymentAttempts: number
  latestPayment: AdminOrderPayment | null
  items: AdminOrderItem[]
}

export type FrontCounterListParams = {
  restaurantId?: string
  search?: string
}

export type FrontCounterTakeawayResponse = {
  generatedAt: string
  orders: AdminOrder[]
}

export type FrontCounterTableSessionsResponse = {
  generatedAt: string
  sessions: FrontCounterTableSessionSummary[]
}

export type FrontCounterTablesResponse = {
  generatedAt: string
  tables: FrontCounterTableSummary[]
}

export type FrontCounterTableSummary = {
  restaurantId: string
  restaurantName: string
  tableId: string
  tableNumber: string
  capacity: number
  isActive: boolean
  activeSessionId: string | null
  openedAt: string | null
  currency: string
  activeOrderCount: number
  historyOrderCount: number
  itemCount: number
  totalAmount: number
  amountDue: number
  latestOrderStatus: AdminOrderStatus | ''
  mergedItems: FrontCounterMergedItem[]
  activeOrders: AdminOrder[]
}

export type FrontCounterTableDetail = FrontCounterTableSummary & {
  activeSession: FrontCounterTableSessionDetail | null
  historyOrders: AdminOrder[]
}

export type FrontCounterTableSessionSummary = {
  id: string
  restaurantId: string
  restaurantName: string
  tableId: string
  tableNumber: string
  status: 'Open' | 'Closed'
  openedAt: string
  closedAt: string | null
  currency: string
  activeOrderCount: number
  itemCount: number
  totalAmount: number
  amountDue: number
  latestOrderStatus: AdminOrderStatus | ''
}

export type FrontCounterMergedItem = {
  itemName: string
  quantity: number
  unitPrice: number
  totalPrice: number
  note: string | null
  selectedOptions: AdminOrderItemOption[]
  orderItemIds: string[]
}

export type FrontCounterTableSessionDetail = FrontCounterTableSessionSummary & {
  mergedItems: FrontCounterMergedItem[]
  orders: AdminOrder[]
}

export type FrontCounterSettleOrderResponse = {
  order: AdminOrder
}

export type FrontCounterSettleTableSessionResponse = {
  tableSession: FrontCounterTableSessionDetail
}

export type CustomerOrderItem = {
  id: string
  orderId: string
  menuItemId: string | null
  itemNameSnapshot: string
  quantity: number
  unitPrice: number
  totalPrice: number
  note: string | null
  selectedOptions: CustomerOrderItemOption[]
  createdAt: string
  updatedAt: string | null
}

export type CustomerOrderItemOption = {
  id: string
  menuItemOptionId: string | null
  groupNameSnapshot: string
  optionNameSnapshot: string
  priceAdjustmentSnapshot: number
  quantity: number
}

export type CustomerOrder = {
  id: string
  restaurantId: string | null
  tableId: string | null
  tableNumber: string | null
  customerId: string | null
  orderNumber: string
  pickupDate: string | null
  pickupNumber: number | null
  pickupCode: string
  currency: string
  orderType: number
  status: number
  paymentStatus: AdminPaymentStatus
  paymentMethod: 'Online' | 'PayAtCounter'
  totalAmount: number
  customerNote: string | null
  scheduledTime: string | null
  createdAt: string
  updatedAt: string | null
  latestRefundRequest: CustomerRefundRequest | null
  orderItems: CustomerOrderItem[]
}

export type CustomerRefundRequestStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled'

export type CustomerRefundRequest = {
  id: string
  orderId: string
  status: CustomerRefundRequestStatus
  requestedAmountCents: number
  currency: string
  reason: string | null
  adminNote: string | null
  createdAt: string
  updatedAt: string | null
  reviewedAt: string | null
}

export type PagedResponse<T> = {
  items: T[]
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
  hasPreviousPage: boolean
  hasNextPage: boolean
}

export type ReportLogListParams = {
  page?: number
  pageSize?: number
  search?: string
  sortBy?: string
  sortDirection?: 'asc' | 'desc'
  restaurantId?: string
  action?: string
  eventType?: string
  entityType?: string
  entityId?: string
  orderId?: string
  paymentId?: string
  actorUserId?: string
  createdFrom?: string
  createdTo?: string
}

export type AuditLog = {
  id: string
  restaurantId: string | null
  actorUserId: string | null
  actorEmail: string | null
  actorRoles: string | null
  action: string
  entityType: string
  entityId: string | null
  summary: string | null
  beforeJson: string | null
  afterJson: string | null
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
}

export type OrderEventLog = {
  id: string
  restaurantId: string | null
  orderId: string
  orderNumber: string
  actorUserId: string | null
  actorDisplayName: string | null
  actorRoles: string | null
  eventType: string
  message: string
  dataJson: string | null
  createdAt: string
}

export type PaymentEventLog = {
  id: string
  restaurantId: string | null
  orderId: string | null
  orderNumber: string | null
  paymentId: string | null
  paymentRefundId: string | null
  provider: string
  eventType: string
  providerEventId: string | null
  status: string | null
  message: string
  dataJson: string | null
  actorUserId: string | null
  actorDisplayName: string | null
  actorRoles: string | null
  createdAt: string
}

export type AdminOrderListParams = {
  page?: number
  pageSize?: number
  search?: string
  sortBy?: string
  sortDirection?: 'asc' | 'desc'
  status?: string
  paymentStatus?: string
  orderType?: string
  restaurantId?: string
  payableOnly?: boolean
}

export type AdminPaymentListParams = {
  page?: number
  pageSize?: number
  search?: string
  sortBy?: string
  sortDirection?: 'asc' | 'desc'
  status?: string
  orderStatus?: string
  orderType?: string
  restaurantId?: string
}

export type AdminRefundSummaryParams = {
  restaurantId?: string
  search?: string
  status?: AdminPaymentRefundStatus
}

export type AdminRefundListParams = AdminRefundSummaryParams & {
  page?: number
  pageSize?: number
  sortBy?: string
  sortDirection?: 'asc' | 'desc'
}

export type AdminRefundRequestStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled'

export type AdminRefundRequestListParams = {
  page?: number
  pageSize?: number
  search?: string
  status?: AdminRefundRequestStatus
  restaurantId?: string
  sortBy?: string
  sortDirection?: 'asc' | 'desc'
}

export type AdminPayment = AdminOrderPayment & {
  orderId: string
  orderNumber: string
  restaurantId: string | null
  restaurantName: string | null
  customerName: string | null
  customerEmail: string | null
  orderStatus: AdminOrderStatus
  orderType: AdminOrderType
}

export type AdminRefund = AdminPaymentRefund & {
  paymentId: string
  orderId: string
  orderNumber: string
  restaurantId: string | null
  restaurantName: string | null
  customerName: string | null
  customerEmail: string | null
}

export type AdminRefundRequest = {
  id: string
  orderId: string
  paymentId: string
  paymentRefundId: string | null
  restaurantId: string | null
  restaurantName: string | null
  orderNumber: string
  customerName: string | null
  customerEmail: string | null
  status: AdminRefundRequestStatus
  requestedAmountCents: number
  currency: string
  reason: string | null
  adminNote: string | null
  requestedByUserId: string | null
  reviewedByUserId: string | null
  createdAt: string
  updatedAt: string | null
  reviewedAt: string | null
}

export type AdminOrderSummary = {
  total: number
  activeKitchen: number
  paid: number
  pendingPayment: number
  failedPayment: number
  payable: number
  revenue: number
}

export type AdminRefundCurrencySummary = {
  currency: string
  pendingAmountCents: number
  succeededAmountCents: number
  failedAmountCents: number
}

export type AdminRefundSummary = {
  total: number
  pending: number
  succeeded: number
  failed: number
  amountsByCurrency: AdminRefundCurrencySummary[]
}

export type AdminOrderStatusHistory = {
  id: string
  previousStatus: AdminOrderStatus
  newStatus: AdminOrderStatus
  action: string | null
  reason: string | null
  changedByUserId: string | null
  createdAt: string
}

export type CreateOrderCheckoutSessionRequest = {
  orderId: string
  returnTo?: string
}

export type CreateCheckoutSessionResponse = {
  message: string
  sessionId: string
  checkoutUrl: string
  orderId: string
  paymentId: string
}

export type RefundOrderRequest = {
  reason?: string
}

export type CreateCustomerRefundRequest = {
  reason?: string
  customerName?: string
  customerEmail?: string
}

export type ReviewRefundRequestRequest = {
  note?: string
}

type PublicKeyCredentialDescriptorJson = Omit<PublicKeyCredentialDescriptor, 'id'> & {
  id: string
}

type PublicKeyCredentialCreationOptionsJson = Omit<
  PublicKeyCredentialCreationOptions,
  'challenge' | 'excludeCredentials' | 'user'
> & {
  challenge: string
  excludeCredentials?: PublicKeyCredentialDescriptorJson[]
  user: Omit<PublicKeyCredentialUserEntity, 'id'> & {
    id: string
  }
}

type PublicKeyCredentialRequestOptionsJson = Omit<
  PublicKeyCredentialRequestOptions,
  'allowCredentials' | 'challenge'
> & {
  allowCredentials?: PublicKeyCredentialDescriptorJson[]
  challenge: string
}

export type RegisterPasskeyResponse = {
  message: string
  passkey: {
    id: string
    deviceName: string | null
    createdAt: string
  }
}

export type UserPasskey = {
  id: string
  deviceName: string | null
  credentialType: string | null
  transports: string | null
  isBackedUp: boolean
  createdAt: string
  lastUsedAt: string | null
}

export type UpdatePasskeyResponse = {
  message: string
  passkey: UserPasskey
}

export type DeletePasskeyResponse = {
  message: string
  passkeyId: string
}

export type MfaSettings = {
  enabled: boolean
  methods: string[]
  preferredMethod: string
  requiredFor: {
    login: boolean
    payment: boolean
    sensitiveActions: boolean
  }
  totp: {
    enabled: boolean
    setupStarted: boolean
  }
  email: {
    enabled: boolean
  }
}

export type TotpSetupResponse = {
  message: string
  secret: string
  otpauthUri: string
  digits: number
  period: number
}

export type EnableTotpMfaResponse = {
  message: string
  settings: MfaSettings
}

export type EnableEmailMfaResponse = {
  message: string
  settings: MfaSettings
}

export type DisableMfaResponse = {
  message: string
  settings: MfaSettings
}

export type VerifyMfaLoginRequest = {
  challengeId: string
  method: string
  code: string
}

export type UpdateMfaSettingsRequest = {
  requireForLogin: boolean
  requireForPayment: boolean
  requireForSensitiveActions: boolean
}

export type UpdateMfaSettingsResponse = {
  message: string
  settings: MfaSettings
}

const tokenKey = 'dineflow.auth.token'
const refreshTokenKey = 'dineflow.auth.refreshToken'

export function getStoredToken() {
  return localStorage.getItem(tokenKey)
}

export function storeToken(token: string) {
  localStorage.setItem(tokenKey, token)
}

export function clearStoredToken() {
  localStorage.removeItem(tokenKey)
}

export function getStoredRefreshToken() {
  return localStorage.getItem(refreshTokenKey)
}

export function storeRefreshToken(refreshToken: string) {
  localStorage.setItem(refreshTokenKey, refreshToken)
}

export function clearStoredRefreshToken() {
  localStorage.removeItem(refreshTokenKey)
}

// Single-flight guard: many requests can 401 around the same moment (e.g. a
// batch of calls firing right after the access token expires). Without this,
// each would race its own POST /api/auth/refresh, and the rotating refresh
// token means only the first one to land would succeed — the rest would get
// "reused token" failures and force a real logout. Concurrent callers instead
// await the same in-flight attempt and share its result.
let refreshInFlight: Promise<boolean> | null = null

/**
 * Exchange the stored refresh token for a new access token + refresh token
 * (rotation). Used both by the request()/requestBlob() 401 handler below and
 * by call sites outside this module (e.g. the QZ Tray print-signing request)
 * that need a guaranteed-fresh token before an operation that cannot itself
 * retry. Clears both tokens on failure so the app falls back to a real login.
 */
export function refreshAccessToken(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = performTokenRefresh().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

async function performTokenRefresh(): Promise<boolean> {
  const refreshToken = getStoredRefreshToken()
  if (!refreshToken) {
    return false
  }

  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })

    if (!response.ok) {
      clearStoredToken()
      clearStoredRefreshToken()
      return false
    }

    const payload = await response.json() as LoginResponse
    storeToken(payload.token)
    storeRefreshToken(payload.refreshToken)
    return true
  } catch {
    // Network failure: leave existing tokens in place and let the caller's
    // original request fail normally — a transient blip shouldn't log anyone out.
    return false
  }
}

/** Best-effort server-side revoke of the refresh token; never throws. Local
 * session state is cleared by the caller regardless of whether this succeeds. */
export async function logoutRequest(refreshToken: string): Promise<void> {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
  } catch {
    // Best-effort — the token still expires on its own, and local state is
    // cleared unconditionally by the caller.
  }
}

// Endpoints the 401-retry logic must never touch: retrying /api/auth/refresh
// would recurse into itself, and a 401 from /api/auth/login is "wrong
// password" (a normal outcome to show the user), not an expired session.
const authRetryExemptPaths = ['/api/auth/refresh', '/api/auth/login']

function isAuthRetryExempt(path: string) {
  return authRetryExemptPaths.some((exempt) => path.startsWith(exempt))
}

export async function request<T>(path: string, options: RequestInit = {}) {
  const performFetch = async () => {
    const token = getStoredToken()
    const headers = new Headers(options.headers)
    const body = options.body

    headers.set('Accept', 'application/json')

    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData
    if (isFormData) {
      headers.delete('Content-Type')
    } else if (body != null && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }

    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }

    return fetch(path, { ...options, headers })
  }

  let response = await performFetch()

  // The access token expired mid-session: silently refresh and retry once
  // rather than bouncing the user to the login screen. This is the core of
  // "stay logged in" — as long as the refresh token is still valid, an expired
  // access token is invisible to the user.
  if (response.status === 401 && !isAuthRetryExempt(path)) {
    const refreshed = await refreshAccessToken()
    if (refreshed) {
      response = await performFetch()
    }
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null)
    const errorDetails = Array.isArray(errorBody?.errors)
      ? errorBody.errors
        .map((error: { description?: string; code?: string }) => error.description || error.code)
        .filter(Boolean)
        .join(' ')
      : ''
    const message = [errorBody?.message, errorBody?.detail, errorDetails || undefined]
      .filter(Boolean)
      .join(' ')
      || `Request failed with HTTP ${response.status}`
    throw new Error(message)
  }

  if (response.status === 204) {
    return undefined as T
  }

  const responseText = await response.text()
  return responseText ? JSON.parse(responseText) as T : undefined as T
}

async function requestBlob(path: string, options: RequestInit = {}) {
  const performFetch = async () => {
    const token = getStoredToken()
    const headers = new Headers(options.headers)

    headers.set('Accept', 'text/csv')

    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }

    return fetch(path, { ...options, headers })
  }

  let response = await performFetch()

  if (response.status === 401 && !isAuthRetryExempt(path)) {
    const refreshed = await refreshAccessToken()
    if (refreshed) {
      response = await performFetch()
    }
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    let message = `Request failed with HTTP ${response.status}`

    if (errorText) {
      try {
        const errorBody = JSON.parse(errorText) as { message?: string; detail?: string }
        message = [errorBody.message, errorBody.detail].filter(Boolean).join(' ') || message
      } catch {
        message = errorText
      }
    }

    throw new Error(message)
  }

  return response.blob()
}

export function login(email: string, password: string) {
  return request<PasswordLoginResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export function registerCustomer(payload: RegisterCustomerRequest) {
  return request<RegisterCustomerResponse>('/api/auth/register-customer', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function confirmEmail(payload: ConfirmEmailRequest) {
  return request<ConfirmEmailResponse>('/api/auth/confirm-email', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function resendConfirmationEmail(email: string) {
  return request<AuthMessageResponse>('/api/auth/resend-confirmation-email', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export function requestMagicLink(payload: RequestMagicLinkRequest) {
  return request<AuthMessageResponse>('/api/auth/request-magic-link', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function magicLinkLogin(payload: MagicLinkLoginRequest) {
  return request<LoginResponse>('/api/auth/magic-link-login', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function exchangeOAuthCode(payload: ExchangeOAuthCodeRequest) {
  return request<LoginResponse>('/api/auth/oauth/exchange', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function requestPasswordReset(payload: RequestPasswordResetRequest) {
  return request<AuthMessageResponse>('/api/auth/request-password-reset', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function requestCurrentUserPasswordReset(payload: RequestCurrentUserPasswordResetRequest = {}) {
  return request<AuthMessageResponse>('/api/auth/me/request-password-reset', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function resetPassword(payload: ResetPasswordRequest) {
  return request<AuthMessageResponse>('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getMe() {
  return request<AuthUser>('/api/auth/me')
}

export function updateCurrentUser(payload: UpdateCurrentUserRequest) {
  return request<UpdateCurrentUserResponse>('/api/auth/me', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

function uploadCurrentUserAvatarMultipart(file: File) {
  const formData = new FormData()
  formData.set('file', file)

  return request<UpdateCurrentUserResponse>('/api/auth/me/avatar', {
    method: 'POST',
    body: formData,
  })
}

async function uploadCurrentUserAvatarWithPresignedUrl(file: File) {
  const upload = await request<CreateAvatarUploadUrlResponse>('/api/auth/me/avatar/upload-url', {
    method: 'POST',
    body: JSON.stringify({
      contentType: file.type,
      fileSize: file.size,
    }),
  })
  const response = await fetch(upload.uploadUrl, {
    method: 'PUT',
    headers: upload.headers,
    body: file,
  })

  if (!response.ok) {
    throw new Error(`Avatar storage upload failed with HTTP ${response.status}`)
  }

  return request<UpdateCurrentUserResponse>('/api/auth/me/avatar/complete', {
    method: 'POST',
    body: JSON.stringify({
      objectKey: upload.objectKey,
    }),
  })
}

export async function uploadCurrentUserAvatar(file: File) {
  try {
    return await uploadCurrentUserAvatarWithPresignedUrl(file)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''

    if (message.includes('Presigned avatar uploads are not enabled')) {
      return uploadCurrentUserAvatarMultipart(file)
    }

    throw error
  }
}

export function requestEmailChange(payload: RequestEmailChangeRequest) {
  return request<AuthMessageResponse>('/api/auth/request-email-change', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function confirmEmailChange(payload: ConfirmEmailChangeRequest) {
  return request<AuthMessageResponse>('/api/auth/confirm-email-change', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getRestaurantUserPage(params: UserListParams = {}) {
  return request<PagedResponse<UserListItem>>(`/api/restaurant/users${toQueryString(params)}`)
}

export async function getRestaurantUsers() {
  const response = await getRestaurantUserPage({ pageSize: 100, sortBy: 'email', sortDirection: 'asc' })
  return response.items
}

export function createRestaurantUser({
  role,
  ...payload
}: CreateRestaurantUserRequest) {
  const pathByRole: Record<CreateRestaurantUserRole, string> = {
    RestaurantOwner: '/api/auth/register-restaurant-owner',
    Admin: '/api/auth/register-admin',
    Staff: '/api/auth/register-staff',
  }

  return request<CreateRestaurantUserResponse>(pathByRole[role], {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateUser(userId: string, payload: UpdateUserRequest) {
  return request<UpdateUserResponse>(`/api/users/${userId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function deleteUser(userId: string) {
  return request<DeleteUserResponse>(`/api/users/${userId}`, {
    method: 'DELETE',
  })
}

export function getRestaurantPage(params: RestaurantListParams = {}) {
  return request<PagedResponse<Restaurant>>(`/api/restaurant${toQueryString(params)}`)
}

export async function getRestaurants() {
  const response = await getRestaurantPage({ pageSize: 100, sortBy: 'name', sortDirection: 'asc' })
  return response.items
}

export function createRestaurant(payload: RestaurantRequest) {
  return request<Restaurant>('/api/restaurant', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateRestaurant(restaurantId: string, payload: RestaurantRequest) {
  return request<UpdateRestaurantResponse>(`/api/restaurant/${restaurantId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function updateRestaurantOrderingStatus(restaurantId: string, acceptingOrders: boolean) {
  return request<UpdateRestaurantResponse>(`/api/restaurant/${restaurantId}/ordering-status`, {
    method: 'PATCH',
    body: JSON.stringify({ acceptingOrders }),
  })
}

export function deleteRestaurant(restaurantId: string) {
  return request<DeleteRestaurantResponse>(`/api/restaurant/${restaurantId}`, {
    method: 'DELETE',
  })
}

export function getRestaurantTables(restaurantId: string) {
  return request<RestaurantTable[]>(`/api/table/restaurant/${restaurantId}`)
}

export function createRestaurantTable(restaurantId: string, payload: UpdateRestaurantTableRequest) {
  return request<CreateRestaurantTableResponse>(`/api/table/restaurant/${restaurantId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateRestaurantTable(tableId: string, payload: UpdateRestaurantTableRequest) {
  return request<UpdateRestaurantTableResponse>(`/api/table/${tableId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function getAdminMenuCategories(restaurantId: string) {
  return request<MenuCategory[]>(`/api/admin/menu/categories?restaurantId=${encodeURIComponent(restaurantId)}`)
}

export function getAdminMenuCategory(categoryId: string) {
  return request<MenuCategory>(`/api/admin/menu/categories/${categoryId}`)
}

export function createMenuCategory(payload: CreateMenuCategoryRequest) {
  return request<MenuCategoryMutationResponse>('/api/admin/menu/categories', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateMenuCategory(categoryId: string, payload: UpdateMenuCategoryRequest) {
  return request<MenuCategoryMutationResponse>(`/api/admin/menu/categories/${categoryId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function deleteMenuCategory(categoryId: string) {
  return request<DeleteMenuCategoryResponse>(`/api/admin/menu/categories/${categoryId}`, {
    method: 'DELETE',
  })
}

export function reorderMenuCategories(payload: ReorderMenuCategoriesRequest) {
  return request<ReorderMenuCategoriesResponse>('/api/admin/menu/categories/reorder', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getAdminMenuItems(restaurantId: string, categoryId?: string) {
  const search = new URLSearchParams({ restaurantId })
  if (categoryId) search.set('categoryId', categoryId)

  return request<MenuItem[]>(`/api/admin/menu/items?${search.toString()}`)
}

export function getAdminMenuItem(itemId: string) {
  return request<MenuItem>(`/api/admin/menu/items/${itemId}`)
}

export function createMenuItem(payload: CreateMenuItemRequest) {
  return request<MenuItemMutationResponse>('/api/admin/menu/items', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateMenuItem(itemId: string, payload: UpdateMenuItemRequest) {
  return request<MenuItemMutationResponse>(`/api/admin/menu/items/${itemId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function reorderMenuItems(payload: ReorderMenuItemsRequest) {
  return request<ReorderMenuItemsResponse>('/api/admin/menu/items/reorder', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateMenuItemAvailability(itemId: string, isAvailable: boolean) {
  return request<UpdateMenuItemAvailabilityResponse>(`/api/admin/menu/items/${itemId}/availability`, {
    method: 'PATCH',
    body: JSON.stringify({ isAvailable }),
  })
}

export function updateMenuItemSoldOut(itemId: string, isSoldOut: boolean) {
  return request<UpdateMenuItemSoldOutResponse>(`/api/admin/menu/items/${itemId}/sold-out`, {
    method: 'PATCH',
    body: JSON.stringify({ isSoldOut }),
  })
}

export function deleteMenuItem(itemId: string) {
  return request<DeleteMenuItemResponse>(`/api/admin/menu/items/${itemId}`, {
    method: 'DELETE',
  })
}

export function createMenuOptionGroup(itemId: string, payload: CreateMenuOptionGroupRequest) {
  return request<MenuOptionGroup>(`/api/menu/items/${itemId}/option-groups`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateMenuOptionGroup(itemId: string, groupId: string, payload: UpdateMenuOptionGroupRequest) {
  return request<MenuOptionGroup>(`/api/menu/items/${itemId}/option-groups/${groupId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function archiveMenuOptionGroup(itemId: string, groupId: string) {
  return request<void>(`/api/menu/items/${itemId}/option-groups/${groupId}/archive`, {
    method: 'POST',
  })
}

export function deleteMenuOptionGroup(itemId: string, groupId: string) {
  return request<void>(`/api/menu/items/${itemId}/option-groups/${groupId}`, {
    method: 'DELETE',
  })
}

export function createMenuOption(itemId: string, groupId: string, payload: CreateMenuOptionRequest) {
  return request<MenuOption>(`/api/menu/items/${itemId}/option-groups/${groupId}/options`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateMenuOption(itemId: string, groupId: string, optionId: string, payload: UpdateMenuOptionRequest) {
  return request<MenuOption>(`/api/menu/items/${itemId}/option-groups/${groupId}/options/${optionId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function archiveMenuOption(itemId: string, groupId: string, optionId: string) {
  return request<void>(`/api/menu/items/${itemId}/option-groups/${groupId}/options/${optionId}/archive`, {
    method: 'POST',
  })
}

export function deleteMenuOption(itemId: string, groupId: string, optionId: string) {
  return request<void>(`/api/menu/items/${itemId}/option-groups/${groupId}/options/${optionId}`, {
    method: 'DELETE',
  })
}

export async function uploadMenuItemImage(restaurantId: string, file: File) {
  const upload = await request<CreateMenuItemImageUploadUrlResponse>('/api/admin/menu/items/image-upload-url', {
    method: 'POST',
    body: JSON.stringify({
      restaurantId,
      contentType: file.type,
      fileSize: file.size,
    }),
  })
  const uploadResponse = await fetch(upload.uploadUrl, {
    method: 'PUT',
    headers: upload.headers,
    body: file,
  })

  if (!uploadResponse.ok) {
    throw new Error(`Menu image storage upload failed with HTTP ${uploadResponse.status}`)
  }

  return request<CompleteMenuItemImageUploadResponse>('/api/admin/menu/items/image-upload-complete', {
    method: 'POST',
    body: JSON.stringify({
      restaurantId,
      objectKey: upload.objectKey,
    }),
  })
}

export function sendTestEmail(payload: SendTestEmailRequest) {
  return request<SendTestEmailResponse>('/api/email/test', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

function toQueryString(params: Record<string, string | number | boolean | undefined>) {
  const query = new URLSearchParams()

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') {
      query.set(key, String(value))
    }
  })

  const value = query.toString()
  return value ? `?${value}` : ''
}

export function getAdminOrders(params: AdminOrderListParams = {}) {
  return request<PagedResponse<AdminOrder>>(`/api/admin/orders${toQueryString(params)}`)
}

export function getStaffOrders(params: AdminOrderListParams = {}) {
  return request<PagedResponse<AdminOrder>>(`/api/staff/orders${toQueryString(params)}`)
}

export function getFrontCounterTakeaway(params: FrontCounterListParams = {}) {
  return request<FrontCounterTakeawayResponse>(`/api/staff/front-counter/takeaway${toQueryString(params)}`)
}

export function getFrontCounterTableSessions(params: FrontCounterListParams = {}) {
  return request<FrontCounterTableSessionsResponse>(`/api/staff/front-counter/table-sessions${toQueryString(params)}`)
}

export function getFrontCounterTables(params: FrontCounterListParams = {}) {
  return request<FrontCounterTablesResponse>(`/api/staff/front-counter/tables${toQueryString(params)}`)
}

export function getFrontCounterTable(tableId: string, params: { restaurantId?: string } = {}) {
  return request<FrontCounterTableDetail>(
    `/api/staff/front-counter/tables/${tableId}${toQueryString(params)}`,
  )
}

export function getFrontCounterTableSession(sessionId: string, params: { restaurantId?: string } = {}) {
  return request<FrontCounterTableSessionDetail>(
    `/api/staff/front-counter/table-sessions/${sessionId}${toQueryString(params)}`,
  )
}

export function getAdminOrderSummary() {
  return request<AdminOrderSummary>('/api/admin/orders/summary')
}

export function getAdminOrderStatusHistory(orderId: string) {
  return request<AdminOrderStatusHistory[]>(`/api/admin/orders/${orderId}/status-history`)
}

export function recordCounterPayment(orderId: string) {
  return request<AdminOrder>(`/api/admin/orders/${orderId}/counter-payment`, {
    method: 'POST',
  })
}

export function settleCompleteFrontCounterOrder(orderId: string, params: { restaurantId?: string } = {}) {
  return request<FrontCounterSettleOrderResponse>(
    `/api/staff/front-counter/orders/${orderId}/settle-complete${toQueryString(params)}`,
    {
      method: 'POST',
    },
  )
}

export function settleCompleteFrontCounterTableSession(sessionId: string, params: { restaurantId?: string } = {}) {
  return request<FrontCounterSettleTableSessionResponse>(
    `/api/staff/front-counter/table-sessions/${sessionId}/settle-complete${toQueryString(params)}`,
    {
      method: 'POST',
    },
  )
}

export function refundAdminOrder(orderId: string, payload: RefundOrderRequest = {}) {
  return request<AdminOrder>(`/api/admin/orders/${orderId}/refund`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function requestCustomerRefund(orderId: string, payload: CreateCustomerRefundRequest = {}) {
  return request<CustomerRefundRequest>(`/api/order/${orderId}/refund-requests`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function transitionAdminOrder(
  orderId: string,
  action: OrderTransitionAction,
  reason?: string,
) {
  return request<AdminOrder>(`/api/admin/orders/${orderId}/transitions`, {
    method: 'POST',
    body: JSON.stringify({ action, reason }),
  })
}

export function getMyOrders() {
  return request<CustomerOrder[]>('/api/order/mine')
}

export function getGuestOrders(orderIds: string[]) {
  return request<CustomerOrder[]>('/api/order/guest', {
    method: 'POST',
    body: JSON.stringify({ orderIds }),
  })
}

export function getAdminPayments(params: AdminPaymentListParams = {}) {
  return request<PagedResponse<AdminPayment>>(`/api/payments${toQueryString(params)}`)
}

export function getAdminRefundSummary(params: AdminRefundSummaryParams = {}) {
  return request<AdminRefundSummary>(`/api/payments/refunds/summary${toQueryString(params)}`)
}

export function getAdminRefunds(params: AdminRefundListParams = {}) {
  return request<PagedResponse<AdminRefund>>(`/api/payments/refunds${toQueryString(params)}`)
}

export function getAdminRefundRequests(params: AdminRefundRequestListParams = {}) {
  return request<PagedResponse<AdminRefundRequest>>(`/api/payments/refund-requests${toQueryString(params)}`)
}

export function getAuditLogs(params: ReportLogListParams = {}) {
  return request<PagedResponse<AuditLog>>(`/api/admin/reports/audit${toQueryString(params)}`)
}

export function getOrderEventLogs(params: ReportLogListParams = {}) {
  return request<PagedResponse<OrderEventLog>>(`/api/admin/reports/orders${toQueryString(params)}`)
}

export function getPaymentEventLogs(params: ReportLogListParams = {}) {
  return request<PagedResponse<PaymentEventLog>>(`/api/admin/reports/payments${toQueryString(params)}`)
}

export function downloadReportLogsCsv(kind: 'audit' | 'orders' | 'payments', params: ReportLogListParams = {}) {
  return requestBlob(`/api/admin/reports/${kind}/export${toQueryString(params)}`)
}

export function approveAdminRefundRequest(requestId: string, payload: ReviewRefundRequestRequest = {}) {
  return request<AdminRefundRequest>(`/api/payments/refund-requests/${requestId}/approve`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function rejectAdminRefundRequest(requestId: string, payload: ReviewRefundRequestRequest = {}) {
  return request<AdminRefundRequest>(`/api/payments/refund-requests/${requestId}/reject`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function createOrderCheckoutSession(payload: CreateOrderCheckoutSessionRequest) {
  return request<CreateCheckoutSessionResponse>('/api/payments/checkout-session/order', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getPasskeys() {
  return request<UserPasskey[]>('/api/auth/passkeys')
}

export function updatePasskey(passkeyId: string, deviceName: string, verification?: MfaVerification) {
  return request<UpdatePasskeyResponse>(`/api/auth/passkeys/${passkeyId}`, {
    method: 'PUT',
    body: JSON.stringify({ deviceName, verification }),
  })
}

export function deletePasskey(passkeyId: string, verification?: MfaVerification) {
  return request<DeletePasskeyResponse>(`/api/auth/passkeys/${passkeyId}`, {
    method: 'DELETE',
    body: JSON.stringify({ verification }),
  })
}

export function getMfaSettings() {
  return request<MfaSettings>('/api/auth/mfa/settings')
}

export function setupTotpMfa() {
  return request<TotpSetupResponse>('/api/auth/mfa/totp/setup', {
    method: 'POST',
  })
}

export function setupEmailMfa() {
  return request<AuthMessageResponse>('/api/auth/mfa/email/setup', {
    method: 'POST',
  })
}

export function sendSensitiveMfaEmailCode() {
  return request<AuthMessageResponse>('/api/auth/mfa/sensitive/email-code', {
    method: 'POST',
  })
}

export function enableEmailMfa(code: string) {
  return request<EnableEmailMfaResponse>('/api/auth/mfa/email/enable', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

export function disableMfa(method: 'totp' | 'email' | 'all', verification?: MfaVerification) {
  return request<DisableMfaResponse>('/api/auth/mfa/disable', {
    method: 'POST',
    body: JSON.stringify({ method, verification }),
  })
}

export function updateMfaSettings(payload: UpdateMfaSettingsRequest) {
  return request<UpdateMfaSettingsResponse>('/api/auth/mfa/settings', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function enableTotpMfa(code: string) {
  return request<EnableTotpMfaResponse>('/api/auth/mfa/totp/enable', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

export function verifyMfaLogin(payload: VerifyMfaLoginRequest) {
  return request<LoginResponse>('/api/auth/mfa/login/verify', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function registerPasskey(deviceName?: string, verification?: MfaVerification) {
  if (!window.PublicKeyCredential || !navigator.credentials?.create) {
    throw new Error('Passkeys are not supported by this browser.')
  }

  const options = await request<PublicKeyCredentialCreationOptionsJson>('/api/auth/passkeys/register/options', {
    method: 'POST',
    body: JSON.stringify({ verification }),
  })
  const credential = await navigator.credentials.create({
    publicKey: toPublicKeyCredentialCreationOptions(options),
  })

  if (!credential || credential.type !== 'public-key') {
    throw new Error('Passkey registration was cancelled.')
  }

  const publicKeyCredential = credential as PublicKeyCredential
  const response = publicKeyCredential.response as AuthenticatorAttestationResponse

  return request<RegisterPasskeyResponse>('/api/auth/passkeys/register/complete', {
    method: 'POST',
    body: JSON.stringify({
      deviceName,
      attestationResponse: {
        id: publicKeyCredential.id,
        rawId: arrayBufferToBase64Url(publicKeyCredential.rawId),
        type: publicKeyCredential.type,
        response: {
          clientDataJson: arrayBufferToBase64Url(response.clientDataJSON),
          attestationObject: arrayBufferToBase64Url(response.attestationObject),
          transports: response.getTransports?.(),
        },
        extensions: publicKeyCredential.getClientExtensionResults(),
      },
    }),
  })
}

export async function passkeyLogin() {
  if (!window.PublicKeyCredential || !navigator.credentials?.get) {
    throw new Error('Passkeys are not supported by this browser.')
  }

  const options = await request<PublicKeyCredentialRequestOptionsJson>('/api/auth/passkeys/login/options', {
    method: 'POST',
  })
  const credential = await navigator.credentials.get({
    publicKey: toPublicKeyCredentialRequestOptions(options),
  })

  if (!credential || credential.type !== 'public-key') {
    throw new Error('Passkey sign-in was cancelled.')
  }

  const publicKeyCredential = credential as PublicKeyCredential
  const response = publicKeyCredential.response as AuthenticatorAssertionResponse

  return request<LoginResponse>('/api/auth/passkeys/login/complete', {
    method: 'POST',
    body: JSON.stringify({
      challenge: options.challenge,
      assertionResponse: {
        id: publicKeyCredential.id,
        rawId: arrayBufferToBase64Url(publicKeyCredential.rawId),
        type: publicKeyCredential.type,
        response: {
          clientDataJson: arrayBufferToBase64Url(response.clientDataJSON),
          authenticatorData: arrayBufferToBase64Url(response.authenticatorData),
          signature: arrayBufferToBase64Url(response.signature),
          userHandle: response.userHandle ? arrayBufferToBase64Url(response.userHandle) : null,
        },
        extensions: publicKeyCredential.getClientExtensionResults(),
      },
    }),
  })
}

function toPublicKeyCredentialCreationOptions(
  options: PublicKeyCredentialCreationOptionsJson,
): PublicKeyCredentialCreationOptions {
  return {
    ...options,
    challenge: base64UrlToArrayBuffer(options.challenge),
    user: {
      ...options.user,
      id: base64UrlToArrayBuffer(options.user.id),
    },
    excludeCredentials: options.excludeCredentials?.map((credential) => ({
      ...credential,
      id: base64UrlToArrayBuffer(credential.id),
    })),
  }
}

function toPublicKeyCredentialRequestOptions(
  options: PublicKeyCredentialRequestOptionsJson,
): PublicKeyCredentialRequestOptions {
  return {
    ...options,
    challenge: base64UrlToArrayBuffer(options.challenge),
    allowCredentials: options.allowCredentials?.map((credential) => ({
      ...credential,
      id: base64UrlToArrayBuffer(credential.id),
    })),
  }
}

function base64UrlToArrayBuffer(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  const binary = window.atob(padded)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes.buffer
}

function arrayBufferToBase64Url(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })

  return window.btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}
