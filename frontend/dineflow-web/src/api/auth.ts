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
  timezone: string
  currency: string
  isActive: boolean
  createdAt: string
  updatedAt: string | null
}

export type RestaurantRequest = {
  name: string
  address: string
  phone: string
  timezone: string
  currency: string
  isActive: boolean
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

export type DeleteMenuCategoryResponse = {
  message: string
  categoryId: string
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
  displayOrder: number
  createdAt: string
  updatedAt: string | null
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

export type CreateTestCheckoutSessionRequest = {
  name: string
  amountCents: number
  quantity: number
  currency?: string
}

export type CreateCheckoutSessionResponse = {
  message: string
  sessionId: string
  checkoutUrl: string
  testOrderId: string
}

export type TestPaymentOrder = {
  id: string
  userId: string | null
  userEmail: string | null
  name: string
  amountCents: number
  quantity: number
  totalCents: number
  currency: string
  status: 'Pending' | 'Paid' | 'Failed' | 'Expired' | string
  stripeCheckoutSessionId: string | null
  stripePaymentIntentId: string | null
  createdAt: string
  updatedAt: string | null
  paidAt: string | null
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

export function getStoredToken() {
  return localStorage.getItem(tokenKey)
}

export function storeToken(token: string) {
  localStorage.setItem(tokenKey, token)
}

export function clearStoredToken() {
  localStorage.removeItem(tokenKey)
}

async function request<T>(path: string, options: RequestInit = {}) {
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

  const response = await fetch(path, {
    ...options,
    headers,
  })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null)
    const errorDetails = Array.isArray(errorBody?.errors)
      ? errorBody.errors
        .map((error: { description?: string; code?: string }) => error.description || error.code)
        .filter(Boolean)
        .join(' ')
      : ''
    const message = [errorBody?.message, errorDetails || undefined]
      .filter(Boolean)
      .join(' ')
      || `Request failed with HTTP ${response.status}`
    throw new Error(message)
  }

  return (await response.json()) as T
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

export function getRestaurantUsers() {
  return request<UserListItem[]>('/api/restaurant/users')
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

export function getRestaurants() {
  return request<Restaurant[]>('/api/restaurant')
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

export function createTestCheckoutSession(payload: CreateTestCheckoutSessionRequest) {
  return request<CreateCheckoutSessionResponse>('/api/payments/checkout-session/test', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getTestPaymentOrders() {
  return request<TestPaymentOrder[]>('/api/payments/test-orders')
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
