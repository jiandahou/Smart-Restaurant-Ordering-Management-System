import type { OrderClosure } from '@/lib/orderClosureNotice'
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
  acceptedCustomerTermsVersion: string
  acknowledgedPrivacyPolicyVersion: string
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
  /** Second factor, when the account requires one for sensitive actions. */
  verification?: MfaVerification
}

export type ConfirmEmailChangeRequest = {
  userId: string
  newEmail: string
  token: string
}

export type AuthMessageResponse = {
  message: string
}

export type PrivacyRequestType = 'Access' | 'Correction' | 'Deletion' | 'Complaint'
export type PrivacyRequestRecord = {
  id: string
  requestType: PrivacyRequestType
  details: string
  status: string
  createdAt: string
  updatedAt: string | null
  completedAt: string | null
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
  lastLoginAt: string | null
  emailConfirmed: boolean
  lockoutEnd: string | null
  /** Currently unable to sign in, whether deliberately disabled or temporarily locked out. */
  isLockedOut: boolean
  /** Deliberately disabled by an admin, as opposed to locked out by failed sign-ins. */
  isDisabled: boolean
  accessFailedCount: number
  twoFactorEnabled: boolean
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
  /** Narrows to staff or customers; customers swamp the directory once a venue is live. */
  audience?: 'staff' | 'customers' | 'all'
  /** Server-side account state filter so pagination totals remain accurate. */
  status?: 'all' | 'active' | 'disabled' | 'locked' | 'unverified' | 'mfa'
}

export type CreateRestaurantUserRole = 'RestaurantOwner' | 'Admin' | 'Staff'
export type ManagedUserRole = CreateRestaurantUserRole | 'Customer'

export type CreateRestaurantUserRequest = {
  email: string
  password: string
  sendPasswordSetupEmail: boolean
  fullName?: string
  restaurantId?: string
  role: CreateRestaurantUserRole
}

export type CreateRestaurantUserResponse = {
  message: string
  userId: string
  email: string | null
  restaurantId: string | null
  passwordSetupEmailSent: boolean
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
  legalBusinessName: string
  abn: string | null
  gstRegistered: boolean
  pricesIncludeGst: boolean
  businessContactEmail: string
  refundContactEmail: string
  customerSurchargeNotice: string | null
  imageUrl: string | null
  countryCode: string
  timezone: string
  currency: string
  paymentPolicy: RestaurantPaymentPolicy
  isActive: boolean
  acceptingOrders: boolean
  /** UTC instant a timed pause lapses. Null when not paused or paused indefinitely. */
  acceptingOrdersPausedUntil: string | null
  autoAcceptOrders: boolean
  openingHoursJson: string
  specialOpeningDaysJson: string
  availability: RestaurantAvailability | null
  stripeConnectStatus?: StripeConnectStatus
  onlinePaymentsEnabled?: boolean
  /** Refund requests waiting on a decision here. */
  pendingRefundRequestCount?: number
  /** When the longest-waiting of those was filed, or null when none are waiting. */
  oldestPendingRefundRequestAt?: string | null
  orderPlatformFeePercent?: number
  oneTimePlatformFeeCents?: number
  oneTimePlatformFeeStatus?: PlatformFeeStatus
  createdAt: string
  updatedAt: string | null
}

export type StripeConnectStatus = 'NotConnected' | 'OnboardingIncomplete' | 'Restricted' | 'Ready'
export type PlatformFeeStatus = 'NotRequired' | 'Pending' | 'Paid' | 'Failed'

export type RestaurantPaymentSettings = {
  restaurantId: string
  restaurantName: string
  currency: string
  stripeAccountId: string | null
  stripeConnectStatus: StripeConnectStatus
  stripeDetailsSubmitted: boolean
  stripeChargesEnabled: boolean
  stripePayoutsEnabled: boolean
  stripeRequirementsDue: string[]
  stripeRestrictions: StripeConnectRestriction[]
  stripeCurrentDeadline: string | null
  stripeConnectedAt: string | null
  stripeAccountUpdatedAt: string | null
  orderPlatformFeePercent: number
  oneTimePlatformFeeCents: number
  oneTimePlatformFeeStatus: PlatformFeeStatus
  oneTimePlatformFeePaidAt: string | null
  onlinePaymentsEnabled: boolean
}

export type StripeConnectRestriction = {
  code: string
  title: string
  message: string
  severity: 'Info' | 'Warning' | 'Error'
  requirement: string | null
  actionRequired: boolean
}

export type StripeConnectDiagnosticCheck = {
  code: string
  label: string
  status: 'Passed' | 'Warning' | 'Failed'
  message: string
}

export type StripeConnectDiagnostic = {
  mode: 'Test'
  checkedAt: string
  settings: RestaurantPaymentSettings
  checks: StripeConnectDiagnosticCheck[]
}

export type StripeBusinessProfileImportField =
  | 'name'
  | 'legalBusinessName'
  | 'abn'
  | 'address'
  | 'phone'
  | 'businessContactEmail'
  | 'refundContactEmail'
  | 'countryCode'
  | 'currency'

/**
 * 'Imported' — Stripe returned a readable ABN.
 * 'ProvidedButHidden' — Stripe confirms a business tax ID exists but does not expose it.
 * 'Missing' — the connected account has no business tax ID.
 */
export type StripeBusinessTaxIdStatus = 'Imported' | 'ProvidedButHidden' | 'Missing'

export type StripeBusinessProfileSuggestion = {
  field: StripeBusinessProfileImportField
  label: string
  value: string
  source: string
}

export type StripeBusinessProfileImport = {
  retrievedAt: string
  taxIdProvided: boolean
  taxIdStatus: StripeBusinessTaxIdStatus
  suggestions: StripeBusinessProfileSuggestion[]
}

export type StripeActionLinkResponse = {
  message: string
  url: string | null
  stripeAccountId: string | null
  expiresAt: string | null
}

export type PlatformFeeCheckoutResponse = {
  message: string
  required: boolean
  paid: boolean
  checkoutUrl: string | null
  sessionId: string | null
}

/** Staff-visible subset of a restaurant: trading state only, no editable profile fields. */
export type RestaurantTradingStatus = {
  id: string
  name: string
  timezone: string
  isActive: boolean
  acceptingOrders: boolean
  acceptingOrdersPausedUntil: string | null
  openingHoursJson: string
  specialOpeningDaysJson: string
  availability: RestaurantAvailability | null
}

/** Server-evaluated open/closed state, so the client never re-derives it in the wrong timezone. */
export type RestaurantAvailability = {
  isOrderingAvailable: boolean
  isWithinOpeningHours: boolean
  acceptingOrders: boolean
  reason: 'Open' | 'Closed' | 'Paused' | 'Inactive'
  message: string
  /** Restaurant-local time the state next flips (ISO, no offset). Null when it never does. */
  nextTransitionLocal: string | null
  /** Restaurant-local time of the next opening; while trading, the one after the current run. */
  nextOpeningLocal: string | null
  /** The restaurant's current local time (ISO, no offset). */
  localNow: string
  pausedUntilUtc: string | null
}

export type RestaurantPaymentPolicy = 'PrepayRequired' | 'PayAtCounterAllowed'

export type RestaurantOperations = {
  id: string
  name: string
  autoAcceptOrders: boolean
  stripeConnectStatus: StripeConnectStatus
  onlinePaymentsEnabled: boolean
  /** Refund requests still waiting on a decision at this restaurant. */
  pendingRefundRequestCount: number
  /** When the longest-waiting of those was filed, or null when none are waiting. */
  oldestPendingRefundRequestAt: string | null
}

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
  legalBusinessName: string
  abn?: string | null
  gstRegistered: boolean
  pricesIncludeGst: boolean
  businessContactEmail: string
  refundContactEmail: string
  customerSurchargeNotice?: string | null
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
  allergens?: string | null
  mayContainAllergens?: string | null
  crossContactStatement?: string | null
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
  allergens?: string | null
  mayContainAllergens?: string | null
  crossContactStatement?: string | null
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
  /** Pinned to the dashboard watch list for quick availability changes. */
  isWatched: boolean
  /** Remaining portions, or null when the item is untracked / unlimited. */
  stockQuantity: number | null
  isVegetarian: boolean
  isVegan: boolean
  isGlutenFree: boolean
  isHalal: boolean
  allergens: string | null
  mayContainAllergens?: string | null
  crossContactStatement?: string | null
  allergenInfoLastVerifiedAt?: string | null
  spiceLevel: number
  servingSize: string | null
  calories: number | null
  isPopular: boolean
  isRecommended: boolean
  displayOrder: number
  createdAt: string
  updatedAt: string | null
  optionGroups: MenuOptionGroup[]
}

/** Trimmed menu item for the dashboard watch widget. */
export type WatchedMenuItem = {
  id: string
  restaurantId: string
  name: string
  categoryName: string
  price: number
  isAvailable: boolean
  isSoldOut: boolean
  stockQuantity: number | null
}

export type CreateMenuItemRequest = {
  /** The person saving confirmed that contradicting dietary labels are correct. */
  acknowledgeDietaryConflicts?: boolean
  restaurantId: string
  categoryId: string
  name: string
  description?: string | null
  price: number
  imageUrl?: string | null
  isAvailable: boolean
  isSoldOut: boolean
  isVegetarian: boolean
  isVegan: boolean
  isGlutenFree: boolean
  isHalal: boolean
  allergens?: string | null
  mayContainAllergens?: string | null
  crossContactStatement?: string | null
  spiceLevel: number
  servingSize?: string | null
  calories?: number | null
  isPopular: boolean
  isRecommended: boolean
  displayOrder: number
}

export type UpdateMenuItemRequest = Omit<CreateMenuItemRequest, 'restaurantId'> & {
  /**
   * The item's `updatedAt` as it stood when the form was opened. An update sends every field, so
   * without this a second person saving from an older copy quietly restores the first person's
   * fields to what they were. Required by the server.
   */
  expectedUpdatedAt: string
  /** Save despite the conflict, having been shown what the other person changed. */
  overwriteConflict?: boolean
}

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

export type UpdateMenuItemsStateRequest = {
  restaurantId: string
  itemIds: string[]
  isAvailable: boolean
  isSoldOut: boolean
}

export type UpdateMenuItemsStateResponse = {
  message: string
  itemIds: string[]
  isAvailable: boolean
  isSoldOut: boolean
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
  /** Menu price for one unit before option adjustments. */
  basePriceSnapshot: number
  /** The dish's allergen declaration as it read when the order was placed. */
  allergensSnapshot?: string | null
  mayContainAllergensSnapshot?: string | null
  crossContactStatementSnapshot?: string | null
  unitPrice: number
  totalPrice: number
  refundedAmountCents: number
  refundableAmountCents: number
  refundedQuantity: number
  refundableQuantity: number
  note: string | null
  selectedOptions: AdminOrderItemOption[]
}

export type AdminOrderItemOption = {
  id: string
  menuItemOptionId: string | null
  groupNameSnapshot: string
  optionNameSnapshot: string
  priceAdjustmentSnapshot: number
  allergensSnapshot?: string | null
  mayContainAllergensSnapshot?: string | null
  crossContactStatementSnapshot?: string | null
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
  providerChargeId: string | null
  stripeAccountId: string | null
  platformFeeAmountCents: number
  /** Null until the payment is synced — Stripe's fee only exists once the charge settles. */
  stripeFeeAmountCents: number | null
  netAmountCents: number | null
  providerReceiptUrl: string | null
  receiptEmail: string | null
  disputeId: string | null
  disputeStatus: string | null
  disputeAmountCents: number | null
  /** Miss this and Stripe closes the dispute against the restaurant automatically. */
  disputeEvidenceDueBy: string | null
  disputeReason: string | null
  disputedAt: string | null
  lastProviderEventCreatedAt: string | null
  lastSyncedAt: string | null
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
  unattributedAmountCents: number
  items: AdminPaymentRefundItem[]
  createdAt: string
  updatedAt: string | null
  refundedAt: string | null
  failedAt: string | null
}

export type AdminPaymentRefundItem = {
  orderItemId: string
  /** The extra this refund was for, when it was for one. */
  optionNameSnapshot: string | null
  menuItemNameSnapshot: string
  quantity: number
  amountCents: number
}

/** A refund the customer is waiting on an answer to, surfaced on the order itself. */
export type AdminOrderPendingRefundRequest = {
  id: string
  requestedAmountCents: number
  currency: string
  /** The customer's own words, shown verbatim: it is why they are asking. */
  reason: string | null
  createdAt: string
  /** True when granting it in full calls the order off, so the screen can warn before the click. */
  fullRefundWouldCancelOrder: boolean
}

export type AdminOrder = {
  id: string
  pendingRefundRequest: AdminOrderPendingRefundRequest | null
  restaurantId: string | null
  restaurantName: string | null
  restaurantLegalBusinessName?: string | null
  restaurantAbn?: string | null
  restaurantGstRegistered?: boolean
  restaurantPricesIncludeGst?: boolean
  restaurantAddress?: string | null
  restaurantPhone?: string | null
  restaurantRefundContactEmail?: string | null
  restaurantCustomerSurchargeNotice?: string | null
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
  pageSize?: number
}

export type FrontCounterRecentPaymentsResponse = {
  generatedAt: string
  /** How far back the list reaches, so the screen can say so rather than imply "everything". */
  windowHours: number
  totalOrders: number
  orders: AdminOrder[]
}

export type FrontCounterTakeawayResponse = {
  generatedAt: string
  /** The restaurant's current business day (YYYY-MM-DD). Pickup numbers reset on this boundary. */
  businessDate: string
  totalOrders: number
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
  restaurantLegalBusinessName: string
  restaurantAbn: string | null
  restaurantGstRegistered: boolean
  restaurantPricesIncludeGst: boolean
  restaurantAddress: string
  restaurantPhone: string
  restaurantRefundContactEmail: string
  restaurantCustomerSurchargeNotice: string | null
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
  /** Menu price for one unit before option adjustments. */
  basePriceSnapshot: number
  /** The dish's allergen declaration as it read when the order was placed. */
  allergensSnapshot?: string | null
  mayContainAllergensSnapshot?: string | null
  crossContactStatementSnapshot?: string | null
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

export type FrontCounterTender = 'Cash' | 'Card'

export type FrontCounterRecordPaymentRequest = {
  tender: FrontCounterTender
  amountReceived?: number
}

export type FrontCounterRecordPaymentResponse = {
  order: AdminOrder
  amountReceived: number
  changeDue: number
}

export type FrontCounterSettleTableSessionResponse = {
  tableSession: FrontCounterTableSessionDetail
  amountReceived: number
  changeDue: number
}

export type CustomerOrderItem = {
  id: string
  orderId: string
  menuItemId: string | null
  itemNameSnapshot: string
  imageUrl: string | null
  quantity: number
  refundedQuantity: number
  refundedAmountCents: number
  refundableAmountCents: number
  /**
   * Whether this line has been refunded as a whole, extra by extra, or not yet at all.
   * A line is refunded one way or the other and never both.
   */
  refundGranularity: 'Untouched' | 'AsAWhole' | 'ByItsParts'
  /** Menu price for one unit before option adjustments. */
  basePriceSnapshot: number
  /** The dish's allergen declaration as it read when the order was placed. */
  allergensSnapshot?: string | null
  mayContainAllergensSnapshot?: string | null
  crossContactStatementSnapshot?: string | null
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
  /** What this extra added to the line, with both quantities already applied. */
  contributionCents: number
  refundedAmountCents: number
  refundableAmountCents: number
  /** Null when the extra can be refunded on its own; otherwise why it cannot, in words to show. */
  refundIneligibilityReason: string | null
  allergensSnapshot?: string | null
  mayContainAllergensSnapshot?: string | null
  crossContactStatementSnapshot?: string | null
  quantity: number
}

export type { OrderClosure } from '@/lib/orderClosureNotice'

export type CustomerOrder = {
  id: string
  restaurantId: string | null
  restaurantName: string | null
  restaurantLegalBusinessName: string | null
  restaurantAbn: string | null
  restaurantGstRegistered: boolean
  restaurantPricesIncludeGst: boolean
  /** What the restaurant allows, and whether it can take a card right now. */
  restaurantPaymentPolicy: RestaurantPaymentPolicy
  restaurantOnlinePaymentsEnabled: boolean
  restaurantAddress: string | null
  restaurantPhone: string | null
  restaurantRefundContactEmail: string | null
  restaurantCustomerSurchargeNotice: string | null
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
  /** When the payment settled — the clock the acceptance wait is measured against. */
  paidAt: string | null
  /** True once the customer may cancel this paid, unaccepted order and be refunded. */
  canCancelForRefund: boolean
  /** UTC instant that right becomes available, so the page can count down to it. */
  cancellableForRefundAt: string | null
  /**
   * UTC instant an unpaid order releases the stock and pickup number it reserved, or null when it
   * holds nothing. Sent by the server so the deadline shown is the one actually enforced.
   */
  unpaidExpiresAt: string | null
  /** Why the order was turned away, when it was. See `buildOrderClosureNotice`. */
  closureReason: OrderClosure | null
  /** Every refund request filed against this order, newest first. */
  refundRequests: CustomerRefundRequest[]
  refundBalance: OrderRefundBalance
  orderItems: CustomerOrderItem[]
}

export type OrderRefundBalance = {
  alreadyRefundedAmountCents: number
  refundableAmountCents: number
  unattributedRefundedAmountCents: number
}

export type CustomerRefundRequestStatus = 'Pending' | 'Processing' | 'Approved' | 'Rejected' | 'Cancelled'

export type CustomerRefundRequest = {
  id: string
  orderId: string
  status: CustomerRefundRequestStatus
  requestedAmountCents: number
  refundedAmountCents: number | null
  refundStatus: 'Pending' | 'Succeeded' | 'Failed' | null
  currency: string
  reason: string | null
  adminNote: string | null
  createdAt: string
  updatedAt: string | null
  reviewedAt: string | null
  items: CustomerRefundRequestItem[]
}

export type CustomerRefundRequestItem = {
  /** The extra this line of the request is for, when it is for one. */
  optionNameSnapshot: string | null
  menuItemNameSnapshot: string
  quantity: number
  amountCents: number
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

export type ActivityLogListParams = {
  page?: number
  pageSize?: number
  search?: string
  restaurantId?: string
  category?: string
  actorType?: string
  outcome?: string
  createdFrom?: string
  createdTo?: string
}

export type ActivityLog = {
  id: string
  restaurantId: string | null
  restaurantName: string | null
  restaurantTimeZone: string | null
  occurredAt: string
  category: string
  severity: 'Success' | 'Warning' | 'Error' | 'Info'
  eventType: string
  actionLabel: string
  actorType: 'User' | 'Customer' | 'Automation' | 'Provider' | 'System' | string
  actorName: string
  actorRoles: string | null
  source: string
  description: string
  subjectType: string | null
  subjectId: string | null
  subjectLabel: string | null
  orderId: string | null
  orderNumber: string | null
  paymentId: string | null
  status: string | null
  amountCents: number | null
  currency: string | null
  correlationId: string | null
  technicalJson: string | null
}

export type ActivityMoneyTotal = {
  currency: string
  count: number
  amountCents: number
}

export type ActivitySummary = {
  timeZone: string
  activityCountToday: number
  completedOrdersToday: number
  failedPaymentsToday: number
  paymentsReceivedToday: ActivityMoneyTotal[]
  refundsSucceededToday: ActivityMoneyTotal[]
  /** Paid orders the restaurant has not accepted yet — a live figure, not a daily total. */
  ordersAwaitingAcceptance: number
  ordersOverdueForAcceptance: number
  longestAcceptanceWaitMinutes: number | null
}

export type ReportPolicy = {
  maxExportRows: number
  auditRetentionDays: number
  orderEventRetentionDays: number
  paymentEventRetentionDays: number
  logsAreImmutable: boolean
  sensitiveTechnicalDetailsRequirePlatformOwner: boolean
  retentionEnforcementConfigured: boolean
  legalHoldWorkflowConfigured: boolean
  restoreDrillCurrent: boolean
  /** How long ago the last restore drill was declared, or null when none has been. */
  restoreDrillAgeDays: number | null
  retentionStatus: string
}

export type AuditLog = {
  id: string
  restaurantId: string | null
  actorUserId: string | null
  actorEmail: string | null
  actorRoles: string | null
  actorType: string | null
  source: string | null
  correlationId: string | null
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
  actorType: string | null
  source: string | null
  correlationId: string | null
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
  actorType: string | null
  source: string | null
  correlationId: string | null
  createdAt: string
}

/**
 * The queues the staff order screen divides its work into. Named on the server, which decides
 * membership, so the two cannot disagree about what "active" means.
 */
export type StaffOrderQueue =
  | 'active'
  | 'new'
  | 'kitchen'
  | 'ready'
  | 'late'
  | 'payment'
  | 'carried'
  | 'closed'

/**
 * A page of orders together with how much work every queue holds.
 *
 * <p>
 * The counts come from everything the filters match rather than from the rows on this page. Counted
 * here from a page, they moved when the sort did — 402 orders, "Active" reading 14 newest-first and
 * 26 oldest-first — which on a kitchen screen can read as no work waiting.
 * </p>
 */
export type StaffOrderPage = PagedResponse<AdminOrder> & {
  queueCounts: Record<StaffOrderQueue, number>
}

export type AdminOrderListParams = {
  /** Restrict the rows to one queue. The counts still describe every queue. */
  queue?: StaffOrderQueue
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
  createdFromUtc?: string
  createdToUtc?: string
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
  createdFromUtc?: string
  createdToUtc?: string
}

export type AdminRefundListParams = AdminRefundSummaryParams & {
  page?: number
  pageSize?: number
  sortBy?: string
  sortDirection?: 'asc' | 'desc'
}

export type AdminRefundRequestStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled' | 'Processing'

export type AdminRefundRequestListParams = {
  page?: number
  pageSize?: number
  search?: string
  status?: AdminRefundRequestStatus
  restaurantId?: string
  createdFromUtc?: string
  createdToUtc?: string
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
  originalPaymentAmountCents: number
  alreadyRefundedAmountCents: number
  refundableAmountCents: number
  previousRefundCount: number
  providerPaymentIntentId: string | null
  currency: string
  reason: string | null
  adminNote: string | null
  requestedByUserId: string | null
  reviewedByUserId: string | null
  createdAt: string
  updatedAt: string | null
  reviewedAt: string | null
  items: AdminRefundRequestItem[]
}

export type AdminRefundRequestItem = {
  /** Which order line this is, so an approval can name an amount for it. */
  orderItemId: string
  /** The extra this line of the request is for, when it is for one. */
  orderItemOptionId: string | null
  optionNameSnapshot: string | null
  menuItemNameSnapshot: string
  quantity: number
  amountCents: number
}

/** One paid total, in the currency it was taken in. */
export type AdminOrderRevenue = {
  currency: string
  amount: number
  orders: number
}

export type AdminOrderSummary = {
  total: number
  activeKitchen: number
  paid: number
  pendingPayment: number
  failedPayment: number
  payable: number
  /**
   * One entry per currency. There is no combined figure because there is no exchange rate: adding
   * AUD, INR and NPR together produced a number that was then labelled with whichever currency the
   * first active restaurant happened to use.
   */
  revenue: AdminOrderRevenue[]
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
  /** Proof that a guest owns this order. Staff and signed-in customers are identified without it. */
  guestAccessToken?: string
}

export type CreateCheckoutSessionResponse = {
  message: string
  sessionId: string
  checkoutUrl: string
  orderId: string
  paymentId: string
}

export type ConfirmCheckoutSessionResponse = {
  paymentStatus: string
  confirmed: boolean
  /** The money arrived for an order the restaurant had already turned away, and is being sent back. */
  orderTurnedAway?: boolean
  message: string
}

export type RefundOrderRequest = {
  reason?: string
  amountCents?: number
  generalAdjustmentAmountCents?: number
  items?: CreateRefundRequestItemInput[]
}

export type CreateCustomerRefundRequest = {
  reason?: string
  customerName?: string
  customerEmail?: string
  items: CreateRefundRequestItemInput[]
  /** Required for orders placed without signing in. */
  guestAccessToken?: string
}

export type CreateRefundRequestItemInput = {
  orderItemId: string
  /** One extra on that line, when the refund is for the extra rather than the dish. */
  orderItemOptionId?: string
  quantity: number
  amountCents: number
}

export type CancelCustomerOrderRequest = {
  reason?: string
  /** Required for orders placed without signing in. */
  guestAccessToken?: string
}

export type ReviewRefundRequestRequest = {
  note?: string
  /** One total for the whole request. Not sent together with `items`; the server refuses both. */
  amountCents?: number
  /** What staff approved for each line. Lines left out are not refunded. */
  items?: { orderItemId: string; orderItemOptionId?: string | null; amountCents: number }[]
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

export type PublicKeyCredentialRequestOptionsJson = Omit<
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
let refreshInFlight: Promise<RefreshOutcome> | null = null

/**
 * Exchange the stored refresh token for a new access token + refresh token
 * (rotation). Used both by the request()/requestBlob() 401 handler below and
 * by call sites outside this module (e.g. the QZ Tray print-signing request)
 * that need a guaranteed-fresh token before an operation that cannot itself
 * retry. Clears both tokens on failure so the app falls back to a real login.
 */
/**
 * What a refresh attempt settled, which is not the same question as whether it worked.
 *
 * <p>
 * 'dead' is the only outcome that means the session is over — the server looked at the refresh
 * token and rejected it. 'unavailable' means we never got that verdict: a sibling tab rotated the
 * token and had not stored its replacement in time, or the network failed. Collapsing the two into
 * `false` is what signed people out of a live session: the caller could not tell "you are logged
 * out" from "ask again in a moment", so it treated both as the former.
 * </p>
 */
export type RefreshOutcome = 'refreshed' | 'dead' | 'unavailable'

/** How hard to try when a sibling tab beat us to rotating the token we share. */
const rotationRaceRetries = 2

/**
 * How long to wait for the sibling to store its replacement.
 *
 * <p>
 * It used to be 250ms and a single look afterwards, which made the retry budget above a fiction:
 * a sibling still mid-request had written nothing, so the first attempt gave up and the second
 * never happened. The wait is now on the storage event — the sibling's write wakes us the moment
 * it lands — with this only as the ceiling.
 * </p>
 */
const rotationRaceWaitMs = 2_000

export function refreshAccessToken(): Promise<RefreshOutcome> {
  if (!refreshInFlight) {
    refreshInFlight = performTokenRefresh().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

/**
 * Waits for another tab to store the token that replaced ours.
 *
 * <p>
 * The storage event fires in every tab except the one that wrote, so the loser of a rotation race
 * is exactly who hears it. Storage is checked first in case the sibling finished before we started
 * listening.
 * </p>
 */
function waitForRotatedRefreshToken(previous: string, timeoutMs: number): Promise<string | null> {
  const alreadyThere = getStoredRefreshToken()
  if (alreadyThere && alreadyThere !== previous) {
    return Promise.resolve(alreadyThere)
  }

  return new Promise((resolve) => {
    let timer = 0

    const settle = (value: string | null) => {
      window.removeEventListener('storage', onStorage)
      window.clearTimeout(timer)
      resolve(value)
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== refreshTokenKey) {
        return
      }

      const next = getStoredRefreshToken()
      if (next && next !== previous) {
        settle(next)
      }
    }

    window.addEventListener('storage', onStorage)
    timer = window.setTimeout(() => settle(null), timeoutMs)
  })
}

async function performTokenRefresh(attempt = 0): Promise<RefreshOutcome> {
  const refreshToken = getStoredRefreshToken()
  if (!refreshToken) {
    // Nothing to refresh with. Not a verdict on the session, and nothing to clear.
    return 'unavailable'
  }

  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })

    // Another tab of this browser rotated the token we share, moments ago. The server says so in
    // as many words — 409, retry:true — because nothing is wrong with the session. Never clear
    // here, and never replay the token we just presented: the server treats a replay outside its
    // grace window as a stolen token and signs every device out.
    if (response.status === 409) {
      const replacement = attempt < rotationRaceRetries
        ? await waitForRotatedRefreshToken(refreshToken, rotationRaceWaitMs)
        : null

      return replacement ? performTokenRefresh(attempt + 1) : 'unavailable'
    }

    if (!response.ok) {
      // The server looked at the token and rejected it: revoked, reused, or expired. This is the
      // one outcome that means the session is genuinely over.
      clearStoredToken()
      clearStoredRefreshToken()
      return 'dead'
    }

    const payload = await response.json() as LoginResponse
    storeToken(payload.token)
    storeRefreshToken(payload.refreshToken)
    return 'refreshed'
  } catch {
    // Network failure: leave existing tokens in place and let the caller's
    // original request fail normally — a transient blip shouldn't log anyone out.
    return 'unavailable'
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

/**
 * A failed API response, keeping the pieces a caller may need to branch on. The server's
 * machine-readable `code` used to be dropped on the floor, leaving callers to match on the
 * human-readable message — which then cannot be reworded without breaking behaviour.
 */
export class ApiError extends Error {
  readonly status: number
  readonly code?: string
  /**
   * The parsed response body. Some rejections carry more than a sentence — the dietary-conflict
   * check lists exactly which words clash, and the dialog cannot ask for confirmation without them.
   */
  readonly details?: unknown

  /**
   * Set when this 401 was met by a refresh that never reached a verdict — a sibling tab held the
   * rotation, or the network failed.
   *
   * <p>
   * Without it a 401 is indistinguishable from a dead session, and the app tore the session down on
   * a refresh that had merely been unlucky. The server had already said the opposite in as many
   * words (409, retry:true), and the answer was thrown away here.
   * </p>
   */
  readonly sessionVerdictUnknown: boolean

  // Written out rather than as constructor parameter properties: this project builds with
  // `erasableSyntaxOnly`, which rules those out.
  constructor(
    message: string,
    status: number,
    code?: string,
    details?: unknown,
    sessionVerdictUnknown = false,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.sessionVerdictUnknown = sessionVerdictUnknown
  }
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
  let sessionVerdictUnknown = false

  if (response.status === 401 && !isAuthRetryExempt(path)) {
    const outcome = await refreshAccessToken()

    if (outcome === 'refreshed') {
      response = await performFetch()
    } else {
      // Carried on the error rather than decided here: only the caller knows whether a 401 should
      // end the session, and it must not end one on a refresh that never got an answer.
      sessionVerdictUnknown = outcome === 'unavailable'
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
    // Development ProblemDetails may contain a full exception stack in `detail`. It is useful in
    // server logs and developer tools, but must never become user-facing copy (for example in a
    // toast). Keep non-5xx validation details while suppressing unexpected-server-error details.
    const safeDetail = response.status < 500 ? errorBody?.detail : undefined
    const message = [errorBody?.message, safeDetail, errorDetails || undefined]
      .filter(Boolean)
      .join(' ')
      || (response.status >= 500
        ? 'The service encountered an unexpected error. Please try again.'
        : `Request failed with HTTP ${response.status}`)
    throw new ApiError(
      message,
      response.status,
      typeof errorBody?.code === 'string' ? errorBody.code : undefined,
      errorBody,
      sessionVerdictUnknown,
    )
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

  let sessionVerdictUnknown = false

  if (response.status === 401 && !isAuthRetryExempt(path)) {
    const outcome = await refreshAccessToken()

    if (outcome === 'refreshed') {
      response = await performFetch()
    } else {
      // Carried on the error rather than decided here: only the caller knows whether a 401 should
      // end the session, and it must not end one on a refresh that never got an answer.
      sessionVerdictUnknown = outcome === 'unavailable'
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

    throw new ApiError(message, response.status, undefined, undefined, sessionVerdictUnknown)
  }

  return {
    blob: await response.blob(),
    truncated: response.headers.get('X-Export-Truncated') === 'true',
    rowLimit: Number(response.headers.get('X-Export-Row-Limit') ?? 0),
  }
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

export function createPrivacyRequest(requestType: PrivacyRequestType, details: string) {
  return request<PrivacyRequestRecord>('/api/privacy/requests', {
    method: 'POST', body: JSON.stringify({ requestType, details }),
  })
}

export function getMyPrivacyRequests() {
  return request<PrivacyRequestRecord[]>('/api/privacy/requests/mine')
}

/**
 * A privacy request as the person who has to answer it needs to see it.
 *
 * <p>
 * Carries who filed it and how long is left. The clock is the point: an access or correction request
 * carries a thirty-day deadline that starts the day it is filed, and nothing was showing these to
 * anyone at all.
 * </p>
 */
export type AdminPrivacyRequestRecord = PrivacyRequestRecord & {
  requesterEmail: string | null
  requesterName: string | null
  /** Negative once the deadline has passed, null once the request has been answered. */
  daysRemaining: number | null
  isOverdue: boolean
}

export type PrivacyRequestStatus = 'Received' | 'InProgress' | 'Completed' | 'Declined'

export function getAllPrivacyRequests(openOnly = false) {
  return request<AdminPrivacyRequestRecord[]>(
    `/api/privacy/requests${openOnly ? '?openOnly=true' : ''}`,
  )
}

export function updatePrivacyRequestStatus(
  id: string,
  status: PrivacyRequestStatus,
  note?: string,
) {
  return request<AdminPrivacyRequestRecord>(`/api/privacy/requests/${id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status, note }),
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
  return request<PasswordLoginResponse>('/api/auth/magic-link-login', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function exchangeOAuthCode(payload: ExchangeOAuthCodeRequest) {
  // Social sign-in runs the same MFA gate as a password, so it can come back as a challenge.
  return request<PasswordLoginResponse>('/api/auth/oauth/exchange', {
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

/**
 * Every page, not just the first. These lists back name lookups and pickers, and silently stopping
 * at 100 made the users table print raw restaurant GUIDs once a deployment grew past that.
 */
async function fetchAllPages<T>(
  load: (page: number, pageSize: number) => Promise<PagedResponse<T>>,
): Promise<T[]> {
  // PagedRequest caps this at 100. Keeping the shared loader on that contract prevents every
  // restaurant/user picker from failing with HTTP 400.
  const pageSize = 100
  const maximumPages = 50 // Guard against an unbounded loop if the server misreports totals.
  const first = await load(1, pageSize)
  const items = [...first.items]

  for (let page = 2; page <= Math.min(first.totalPages, maximumPages); page++) {
    const next = await load(page, pageSize)
    items.push(...next.items)
  }

  return items
}

export function getRestaurantUsers() {
  return fetchAllPages<UserListItem>((page, pageSize) =>
    getRestaurantUserPage({ page, pageSize, sortBy: 'email', sortDirection: 'asc' }))
}

export function updateUserStatus(userId: string, isDisabled: boolean) {
  return request<{ message: string; userId: string; isDisabled: boolean }>(
    `/api/users/${userId}/status`,
    { method: 'PATCH', body: JSON.stringify({ isDisabled }) },
  )
}

export function unlockUser(userId: string) {
  return request<{ message: string; userId: string }>(`/api/users/${userId}/unlock`, {
    method: 'POST',
  })
}

export function sendUserPasswordReset(userId: string) {
  return request<{ message: string; userId: string }>(`/api/users/${userId}/send-password-reset`, {
    method: 'POST',
  })
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

export function getRestaurants() {
  return fetchAllPages<Restaurant>((page, pageSize) =>
    getRestaurantPage({ page, pageSize, sortBy: 'name', sortDirection: 'asc' }))
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

export type PauseOrderingOptions = {
  /** Auto-resume after this many minutes. */
  pauseMinutes?: number
  /** Auto-resume at the next scheduled opening. Takes precedence over pauseMinutes. */
  pauseUntilNextOpening?: boolean
}

export function updateRestaurantOrderingStatus(
  restaurantId: string,
  acceptingOrders: boolean,
  options: PauseOrderingOptions = {},
) {
  return request<UpdateRestaurantResponse>(`/api/restaurant/${restaurantId}/ordering-status`, {
    method: 'PATCH',
    body: JSON.stringify({
      acceptingOrders,
      pauseMinutes: options.pauseMinutes ?? null,
      pauseUntilNextOpening: Boolean(options.pauseUntilNextOpening),
    }),
  })
}

/**
 * Scoped writes: these touch only their own column, so the hours editor and the special calendar
 * can no longer overwrite each other with a stale copy of the whole restaurant.
 */
export function updateRestaurantOpeningHours(
  restaurantId: string,
  openingHoursJson: string,
  expectedUpdatedAt?: string | null,
) {
  return request<UpdateRestaurantResponse>(`/api/restaurant/${restaurantId}/opening-hours`, {
    method: 'PUT',
    body: JSON.stringify({ openingHoursJson, expectedUpdatedAt }),
  })
}

export function updateRestaurantSpecialDays(
  restaurantId: string,
  specialOpeningDaysJson: string,
  // Each save replaces the whole calendar, so losing a race loses everything the other person
  // wrote. Sending the version this editor loaded turns that into a 409 it can report.
  expectedUpdatedAt?: string | null,
) {
  return request<UpdateRestaurantResponse>(`/api/restaurant/${restaurantId}/special-days`, {
    method: 'PUT',
    body: JSON.stringify({ specialOpeningDaysJson, expectedUpdatedAt }),
  })
}

export function updateRestaurantAutoAccept(restaurantId: string, autoAcceptOrders: boolean) {
  return request<RestaurantOperations>(`/api/staff/restaurants/${restaurantId}/auto-accept`, {
    method: 'PATCH',
    body: JSON.stringify({ autoAcceptOrders }),
  })
}

/**
 * Read-only trading status on the staff policy. Use this when the caller may only have the Staff
 * role — the admin restaurant API (getRestaurants, updateRestaurant*) is not available to them.
 */
export function getCurrentRestaurantTradingStatus() {
  return request<RestaurantTradingStatus>('/api/staff/restaurants/current/trading-status')
}

export function getRestaurantTradingStatus(restaurantId: string) {
  return request<RestaurantTradingStatus>(`/api/staff/restaurants/${restaurantId}/trading-status`)
}

export function getRestaurantOperations(restaurantId: string) {
  return request<RestaurantOperations>(`/api/staff/restaurants/${restaurantId}/operations`)
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

export function getRestaurantPaymentSettings(restaurantId: string) {
  return request<RestaurantPaymentSettings>(`/api/restaurant/${restaurantId}/payment-settings`)
}

export function updateRestaurantPlatformFees(
  restaurantId: string,
  payload: Pick<RestaurantPaymentSettings, 'orderPlatformFeePercent' | 'oneTimePlatformFeeCents'>,
) {
  return request<RestaurantPaymentSettings>(`/api/restaurant/${restaurantId}/payment-settings`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function createRestaurantStripeConnectLink(restaurantId: string) {
  return request<StripeActionLinkResponse>(`/api/restaurant/${restaurantId}/stripe/connect-link`, {
    method: 'POST',
  })
}

export function refreshRestaurantStripeStatus(restaurantId: string) {
  return request<RestaurantPaymentSettings>(`/api/restaurant/${restaurantId}/stripe/refresh`, {
    method: 'POST',
  })
}

export function previewStripeBusinessProfileImport(restaurantId: string) {
  return request<StripeBusinessProfileImport>(`/api/restaurant/${restaurantId}/stripe/business-profile-import`)
}

export function runRestaurantStripeDiagnostics(restaurantId: string) {
  return request<StripeConnectDiagnostic>(`/api/restaurant/${restaurantId}/stripe/diagnostics`, {
    method: 'POST',
  })
}

export function createRestaurantPlatformFeeCheckout(restaurantId: string) {
  return request<PlatformFeeCheckoutResponse>(`/api/restaurant/${restaurantId}/platform-fee/checkout`, {
    method: 'POST',
  })
}

export type PaymentEnvironment = {
  provider: 'Stripe'
  mode: 'Live' | 'Test' | 'Unconfigured'
  destructiveActionsRequireConfirmation: boolean
}

export function updateMenuItemsState(payload: UpdateMenuItemsStateRequest) {
  return request<UpdateMenuItemsStateResponse>('/api/admin/menu/items/bulk-state', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function getWatchedMenuItems(restaurantId?: string) {
  const query = restaurantId ? `?restaurantId=${encodeURIComponent(restaurantId)}` : ''
  return request<WatchedMenuItem[]>(`/api/admin/menu/items/watched${query}`)
}

export function updateMenuItemWatch(itemId: string, isWatched: boolean) {
  return request<{ message: string; itemId: string; isWatched: boolean }>(
    `/api/admin/menu/items/${itemId}/watch`,
    { method: 'PATCH', body: JSON.stringify({ isWatched }) },
  )
}

/** Pass null to stop tracking stock, which makes the item unlimited again. */
type MenuItemStockResponse = { message: string; itemId: string; stockQuantity: number | null; isSoldOut: boolean }

export function updateMenuItemStock(itemId: string, stockQuantity: number | null) {
  return request<MenuItemStockResponse>(
    `/api/admin/menu/items/${itemId}/stock`,
    { method: 'PATCH', body: JSON.stringify({ stockQuantity }) },
  )
}

/**
 * Changes the count by a delta the database applies to the current row.
 *
 * <p>Sending an absolute value computed from a number read earlier loses one of two concurrent
 * adjustments — both callers read the same count, both write the same result, and both are told it
 * worked.</p>
 */
export function adjustMenuItemStock(itemId: string, adjustBy: number) {
  return request<MenuItemStockResponse>(
    `/api/admin/menu/items/${itemId}/stock`,
    { method: 'PATCH', body: JSON.stringify({ adjustBy }) },
  )
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

export function reorderMenuOptionGroups(itemId: string, groupIds: string[]) {
  return request<{ message: string }>(`/api/menu/items/${itemId}/option-groups/reorder`, {
    method: 'POST',
    body: JSON.stringify({ groupIds }),
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

export function reorderMenuOptions(itemId: string, groupId: string, optionIds: string[]) {
  return request<{ message: string }>(
    `/api/menu/items/${itemId}/option-groups/${groupId}/options/reorder`,
    {
      method: 'POST',
      body: JSON.stringify({ optionIds }),
    },
  )
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

export function getAdminOrders(
  params: AdminOrderListParams = {},
  options: Pick<RequestInit, 'signal'> = {},
) {
  return request<StaffOrderPage>(`/api/admin/orders${toQueryString(params)}`, options)
}

export function getStaffOrders(params: AdminOrderListParams = {}) {
  return request<StaffOrderPage>(`/api/staff/orders${toQueryString(params)}`)
}

export function getFrontCounterTakeaway(params: FrontCounterListParams = {}) {
  return request<FrontCounterTakeawayResponse>(`/api/staff/front-counter/takeaway${toQueryString(params)}`)
}

/**
 * Counter payments recent enough to still be put right, finished pickups included.
 *
 * <p>
 * Completing an order takes it out of the counter's working lists, and the void and refund controls
 * live on those lists — so a payment stopped being reachable at the moment the customer was most
 * likely to come back about it. The endpoints never cared about the order's state; nothing led to
 * them.
 * </p>
 */
export function getFrontCounterRecentPayments(params: FrontCounterListParams = {}) {
  return request<FrontCounterRecentPaymentsResponse>(
    `/api/staff/front-counter/recent-payments${toQueryString(params)}`,
  )
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

export function getAdminOrderSummary(
  params: AdminOrderListParams = {},
  options: Pick<RequestInit, 'signal'> = {},
) {
  return request<AdminOrderSummary>(`/api/admin/orders/summary${toQueryString(params)}`, options)
}

export function getAdminOrderStatusHistory(orderId: string) {
  return request<AdminOrderStatusHistory[]>(`/api/admin/orders/${orderId}/status-history`)
}

export function recordCounterPayment(orderId: string) {
  return request<AdminOrder>(`/api/admin/orders/${orderId}/counter-payment`, {
    method: 'POST',
  })
}

export function recordFrontCounterPayment(
  orderId: string,
  payload: FrontCounterRecordPaymentRequest,
  params: { restaurantId?: string } = {},
) {
  return request<FrontCounterRecordPaymentResponse>(
    `/api/staff/front-counter/orders/${orderId}/record-payment${toQueryString(params)}`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  )
}

/** Cancels a counter payment taken in error; the order goes back to unpaid so it can be re-collected. */
export function voidCounterPayment(
  paymentId: string,
  payload: { reason: string },
  params: { restaurantId?: string } = {},
) {
  return request<FrontCounterSettleOrderResponse>(
    `/api/staff/front-counter/payments/${paymentId}/void${toQueryString(params)}`,
    { method: 'POST', body: JSON.stringify(payload) },
  )
}

/** Records money already handed back at the counter. Omit amountCents to refund the remainder. */
export function refundCounterPayment(
  paymentId: string,
  payload: { reason: string; amountCents?: number },
  params: { restaurantId?: string } = {},
) {
  return request<FrontCounterSettleOrderResponse>(
    `/api/staff/front-counter/payments/${paymentId}/offline-refund${toQueryString(params)}`,
    { method: 'POST', body: JSON.stringify(payload) },
  )
}

export function completeFrontCounterOrder(orderId: string, params: { restaurantId?: string } = {}) {
  return request<FrontCounterSettleOrderResponse>(
    `/api/staff/front-counter/orders/${orderId}/complete${toQueryString(params)}`,
    {
      method: 'POST',
    },
  )
}

export function settleCompleteFrontCounterTableSession(
  sessionId: string,
  payload: FrontCounterRecordPaymentRequest,
  params: { restaurantId?: string } = {},
) {
  return request<FrontCounterSettleTableSessionResponse>(
    `/api/staff/front-counter/table-sessions/${sessionId}/settle-complete${toQueryString(params)}`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  )
}

/** Pulls authoritative state from Stripe — recovery for payments stranded by a dropped webhook. */
export function syncAdminPayment(paymentId: string) {
  return request<AdminPayment>(`/api/payments/${paymentId}/sync`, { method: 'POST' })
}

/** Staff-initiated: Stripe only emails the receipt once, and only in live mode. */
export function resendAdminPaymentReceipt(paymentId: string) {
  return request<{ message: string }>(`/api/payments/${paymentId}/receipt/resend`, { method: 'POST' })
}

export function refundAdminOrder(orderId: string, payload: RefundOrderRequest = {}) {
  return request<AdminOrder>(`/api/admin/orders/${orderId}/refund`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function requestCustomerRefund(orderId: string, payload: CreateCustomerRefundRequest = { items: [] }) {
  return request<CustomerRefundRequest>(`/api/order/${orderId}/refund-requests`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function cancelCustomerOrder(orderId: string, payload: CancelCustomerOrderRequest = {}) {
  return request<CustomerOrder>(`/api/order/${orderId}/cancel`, {
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

/** Each order must be paired with the token issued at checkout; the id alone is not a credential. */
export function getGuestOrders(orders: { orderId: string; guestAccessToken: string | null }[]) {
  return request<CustomerOrder[]>('/api/order/guest', {
    method: 'POST',
    body: JSON.stringify({ orders }),
  })
}

export function getAdminPayments(params: AdminPaymentListParams = {}) {
  return request<PagedResponse<AdminPayment>>(`/api/payments${toQueryString(params)}`)
}

export function getPaymentEnvironment() {
  return request<PaymentEnvironment>('/api/payments/environment')
}

export function getAdminRefundSummary(
  params: AdminRefundSummaryParams = {},
  options: Pick<RequestInit, 'signal'> = {},
) {
  return request<AdminRefundSummary>(`/api/payments/refunds/summary${toQueryString(params)}`, options)
}

export function getAdminRefunds(
  params: AdminRefundListParams = {},
  options: Pick<RequestInit, 'signal'> = {},
) {
  return request<PagedResponse<AdminRefund>>(`/api/payments/refunds${toQueryString(params)}`, options)
}

export function getAdminRefundRequests(
  params: AdminRefundRequestListParams = {},
  options: Pick<RequestInit, 'signal'> = {},
) {
  return request<PagedResponse<AdminRefundRequest>>(`/api/payments/refund-requests${toQueryString(params)}`, options)
}

export function getActivityLogs(
  params: ActivityLogListParams = {},
  options: Pick<RequestInit, 'signal'> = {},
) {
  return request<PagedResponse<ActivityLog>>(`/api/admin/reports/activity${toQueryString(params)}`, options)
}

export function getActivitySummary(
  restaurantId?: string,
  options: Pick<RequestInit, 'signal'> = {},
) {
  return request<ActivitySummary>(
    `/api/admin/reports/activity/summary${toQueryString({ restaurantId })}`,
    options,
  )
}

export function getReportPolicy(options: Pick<RequestInit, 'signal'> = {}) {
  return request<ReportPolicy>('/api/admin/reports/policy', options)
}

export function getAuditLogs(
  params: ReportLogListParams = {},
  options: Pick<RequestInit, 'signal'> = {},
) {
  return request<PagedResponse<AuditLog>>(`/api/admin/reports/audit${toQueryString(params)}`, options)
}

export function getOrderEventLogs(
  params: ReportLogListParams = {},
  options: Pick<RequestInit, 'signal'> = {},
) {
  return request<PagedResponse<OrderEventLog>>(`/api/admin/reports/orders${toQueryString(params)}`, options)
}

export function getPaymentEventLogs(
  params: ReportLogListParams = {},
  options: Pick<RequestInit, 'signal'> = {},
) {
  return request<PagedResponse<PaymentEventLog>>(`/api/admin/reports/payments${toQueryString(params)}`, options)
}

export function downloadReportLogsCsv(
  kind: 'activity' | 'audit' | 'orders' | 'payments',
  params: ReportLogListParams | ActivityLogListParams = {},
) {
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

/**
 * Changes how an unpaid order will be settled, addressed by order rather than by cart.
 *
 * <p>
 * The cart route needs a participant token that is usually gone by the time somebody returns to an
 * order, which is why My Orders had no way to offer the counter when online payment was refused.
 * </p>
 */
export function changeOrderPaymentMethod(
  orderId: string,
  paymentMethod: 'Online' | 'PayAtCounter',
  guestAccessToken?: string | null,
) {
  return request<CustomerOrder>(`/api/order/${encodeURIComponent(orderId)}/payment-method`, {
    method: 'PUT',
    body: JSON.stringify({ paymentMethod, guestAccessToken: guestAccessToken ?? undefined }),
  })
}

export function createOrderCheckoutSession(payload: CreateOrderCheckoutSessionRequest) {
  return request<CreateCheckoutSessionResponse>('/api/payments/checkout-session/order', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** Customer return-path recovery when the webhook has not updated the local order yet. */
export function confirmStripeCheckoutSession(sessionId: string) {
  return request<ConfirmCheckoutSessionResponse>('/api/payments/stripe/checkout-session/confirm', {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
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
  // Creating a passkey needs the same focused document as using one. Someone adding their first
  // passkey has no reason to suspect a silent refusal is about the window rather than the feature,
  // and this is the only way in — a failure here is one they may never come back from.
  const { result, diagnostics } = whenDocumentFocused(() =>
    navigator.credentials.create({ publicKey: toPublicKeyCredentialCreationOptions(options) }))

  let credential: Credential | null
  try {
    credential = await result
  } catch (error) {
    const { name, message } = describeError(error, 'Passkey registration failed.')
    console.warn('[passkey] registration failed', { name, message, focus: await diagnostics })
    throw new Error(describePasskeyFailure(name, message), { cause: error })
  }

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

/**
 * The name and message of a failure, whichever shape it arrives in.
 *
 * <p>Redux Toolkit's `createAsyncThunk` replaces a rejection with a plain `SerializedError`, so an
 * `instanceof Error` check fails and the real reason — for passkeys, the part that says *why* the
 * platform refused — was being swallowed and replaced with generic copy.</p>
 */
/**
 * The failure code, whether this came back as an ApiError or as the plain object a Redux thunk
 * hands over from `.unwrap()`. `instanceof` is false for the second, which is how a sign-in on an
 * unconfirmed account lost its `email_not_confirmed` code and showed generic failure copy instead
 * of the page offering to resend the confirmation.
 */
export function errorCodeOf(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const { code } = error as { code?: unknown }
    return typeof code === 'string' && code ? code : undefined
  }

  return undefined
}

export function describeError(error: unknown, fallback: string): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message }
  }

  if (error && typeof error === 'object') {
    const serialized = error as { name?: unknown; message?: unknown }
    if (typeof serialized.message === 'string' && serialized.message) {
      return {
        name: typeof serialized.name === 'string' && serialized.name ? serialized.name : 'Error',
        message: serialized.message,
      }
    }
  }

  return { name: 'Error', message: fallback }
}

export function isPasskeySupported(): boolean {
  return Boolean(window.PublicKeyCredential && navigator.credentials?.get)
}

export function requestPasskeyLoginOptions() {
  return request<PublicKeyCredentialRequestOptionsJson>('/api/auth/passkeys/login/options', {
    method: 'POST',
  })
}

/**
 * What the document's focus looked like around the ceremony. Safari's refusal is invisible
 * otherwise: the same `NotAllowedError` is thrown whether focus never arrived or arrived and was
 * refused anyway, and only one of those is worth waiting for.
 */
export type PasskeyCeremonyDiagnostics = {
  focusedAtClick: boolean
  /** 'focus-event' means the click's own focus landed; 'timeout' means it never did. */
  resolvedBy: 'already-focused' | 'focus-event' | 'timeout'
  focusedAtCall: boolean
  waitedMs: number
  /** A framed document never holds focus itself, which would explain a refusal on its own. */
  framed: boolean
}

/** A challenge together with the assertion already being collected for it. */
export type PasskeyAssertionAttempt = {
  options: PublicKeyCredentialRequestOptionsJson
  credential: Promise<Credential | null>
  /** Settles when the ceremony is actually invoked, never rejects. */
  diagnostics: Promise<PasskeyCeremonyDiagnostics>
}

/**
 * How long to wait for the click's own focus to land before giving up and calling anyway. Kept
 * inside Safari's transient activation window (about five seconds) so a late focus still gets a
 * working ceremony rather than a second refusal.
 */
const documentFocusTimeoutMs = 3_000

/** Cross-origin framing throws on the comparison, which is itself the answer. */
function isFramed(): boolean {
  try {
    return window.top !== window.self
  } catch {
    return true
  }
}

/**
 * Resolves once the document is focused. Safari refuses a passkey ceremony with
 * `NotAllowedError: The document is not focused.` — which is what happens when the gesture that
 * reached the button left focus in the browser's own furniture (a sidebar, the address bar, the
 * inspector) rather than in the page. Focus often lands a moment later from that same gesture, so
 * waiting for it costs nothing and stays inside the transient activation window.
 */
function waitForDocumentFocus(): Promise<'focus-event' | 'timeout'> {
  return new Promise((resolve) => {
    const finish = (reason: 'focus-event' | 'timeout') => {
      window.removeEventListener('focus', onFocus)
      window.clearTimeout(timer)
      resolve(reason)
    }

    const onFocus = () => finish('focus-event')

    // Calling anyway after the timeout is better than hanging: the browser's own error is a more
    // useful outcome than a button that never does anything.
    const timer = window.setTimeout(() => finish('timeout'), documentFocusTimeoutMs)
    window.addEventListener('focus', onFocus)

    // Ask for focus rather than only waiting for it. Browsers honour this during a user gesture,
    // and it is the difference between the page taking focus from a devtools window and not.
    window.focus()

    // The gesture may have already focused the page before this ran, in which case no event is
    // coming and the timeout would be a pointless second of delay.
    if (document.hasFocus()) {
      finish('focus-event')
    }
  })
}

/**
 * Invokes a passkey ceremony at the first moment the browser will allow one.
 *
 * <p>Stays synchronous when the document already holds focus, so the gesture's transient user
 * activation is still live — that is the common path and it must not cost a microtask. Only an
 * unfocused document, which Safari refuses outright, waits.</p>
 */
function whenDocumentFocused<T>(invoke: () => Promise<T>): {
  result: Promise<T>
  diagnostics: Promise<PasskeyCeremonyDiagnostics>
} {
  const focusedAtClick = document.hasFocus()
  const startedAt = Date.now()

  if (focusedAtClick) {
    return {
      result: invoke(),
      diagnostics: Promise.resolve({
        focusedAtClick,
        resolvedBy: 'already-focused' as const,
        focusedAtCall: true,
        waitedMs: 0,
        framed: isFramed(),
      }),
    }
  }

  let report: (diagnostics: PasskeyCeremonyDiagnostics) => void = () => {}
  const diagnostics = new Promise<PasskeyCeremonyDiagnostics>((resolve) => {
    report = resolve
  })

  const result = waitForDocumentFocus().then((resolvedBy) => {
    report({
      focusedAtClick,
      resolvedBy,
      focusedAtCall: document.hasFocus(),
      waitedMs: Date.now() - startedAt,
      framed: isFramed(),
    })
    return invoke()
  })

  return { result, diagnostics }
}

/**
 * Opens the platform's passkey prompt for signing in.
 *
 * <p>The challenge is prefetched rather than awaited here, so nothing stands between the click and
 * the prompt.</p>
 */
export function startPasskeyAssertion(
  options: PublicKeyCredentialRequestOptionsJson,
): PasskeyAssertionAttempt {
  const publicKey = toPublicKeyCredentialRequestOptions(options)
  const { result, diagnostics } = whenDocumentFocused(() => navigator.credentials.get({ publicKey }))

  return { options, credential: result, diagnostics }
}

/**
 * Turns a browser refusal into something the person can act on. `NotAllowedError` covers both a
 * cancelled prompt and a document the browser would not let open one; only the second has a remedy,
 * and quoting the raw message leaves the reader guessing which they hit.
 */
export function describePasskeyFailure(name: string, message: string): string {
  if (name === 'NotAllowedError' && /not focused/i.test(message)) {
    return 'Your browser would not open the passkey prompt because this window was not in front. Click anywhere on the page, then try again.'
  }

  return message
}

export async function finishPasskeyLogin(attempt: PasskeyAssertionAttempt) {
  const credential = await attempt.credential

  if (!credential || credential.type !== 'public-key') {
    throw new Error('Passkey sign-in was cancelled.')
  }

  const publicKeyCredential = credential as PublicKeyCredential
  const response = publicKeyCredential.response as AuthenticatorAssertionResponse

  return request<LoginResponse>('/api/auth/passkeys/login/complete', {
    method: 'POST',
    body: JSON.stringify({
      challenge: attempt.options.challenge,
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

/**
 * Whole flow in one call. Pass an attempt started in the click handler; without one this falls
 * back to fetching the challenge first, which is the path that can lose the user activation.
 */
export async function passkeyLogin(attempt?: PasskeyAssertionAttempt) {
  if (!isPasskeySupported()) {
    throw new Error('Passkeys are not supported by this browser.')
  }

  return finishPasskeyLogin(attempt ?? startPasskeyAssertion(await requestPasskeyLoginOptions()))
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
  const { allowCredentials, ...rest } = options as PublicKeyCredentialRequestOptionsJson &
    Record<string, unknown>

  // The server sends `allowCredentials: []` and `hints: []` for the usernameless flow. An empty
  // list is not the same thing as an absent one to every platform authenticator, and an empty
  // hints array carries no meaning at all, so neither is forwarded.
  delete rest.hints

  const converted: PublicKeyCredentialRequestOptions = {
    ...(rest as Omit<PublicKeyCredentialRequestOptionsJson, 'allowCredentials'>),
    challenge: base64UrlToArrayBuffer(options.challenge),
  }

  if (allowCredentials?.length) {
    converted.allowCredentials = allowCredentials.map((credential) => ({
      ...credential,
      id: base64UrlToArrayBuffer(credential.id),
    }))
  }

  return converted
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
