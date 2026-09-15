import type { CustomerOrder } from '@/api/auth'
import type { SubmittedOrder } from '@/api/carts'
import { buildRestaurantMenuPath } from '@/lib/customerMenuNavigation'

/**
 * Reopening the checkout screen from an order alone, with no cart behind it.
 *
 * <p>
 * Checkout used to be reachable only as the last step of a cart: it read everything it needed from
 * the navigation state handed over at that moment. So a customer returning to an unpaid order — from
 * My Orders, or from the prompt on the menu — could never get back to the screen where the payment
 * choices live. My Orders offered only "retry payment", which a restaurant with Stripe switched off
 * refuses outright, leaving an order that could not be paid and could only be abandoned.
 * </p>
 *
 * <p>
 * The order already carries the supplier details and, since this change, what the restaurant is
 * able to accept. What it does not carry is the cart — hence no cart id or participant token here,
 * and why the page must settle through the order-level routes when it is opened this way.
 * </p>
 */

/** The subset of checkout's navigation state that an order can supply on its own. */
export type CheckoutViewFromOrder = {
  order: SubmittedOrder
  currency: string
  restaurantName: string
  restaurantLegalBusinessName: string
  restaurantAbn: string | null
  gstRegistered: boolean
  pricesIncludeGst: boolean
  refundContactEmail: string
  customerSurchargeNotice: string | null
  tableNumber: string | null
  paymentPolicy: 'PrepayRequired' | 'PayAtCounterAllowed'
  onlinePaymentsEnabled: boolean
  returnPath: string
}

/**
 * Builds what the checkout screen needs from a customer's own view of their order.
 *
 * <p>
 * The order's line items are shaped for a receipt rather than a cart, so they are mapped across
 * here — the checkout summary only ever reads name, quantity and price.
 * </p>
 */
export function buildCheckoutViewFromOrder(order: CustomerOrder): CheckoutViewFromOrder {
  return {
    order: {
      id: order.id,
      restaurantId: order.restaurantId,
      tableId: order.tableId ?? null,
      tableNumber: order.tableNumber ?? null,
      customerId: order.customerId ?? null,
      orderNumber: order.orderNumber,
      currency: order.currency,
      orderType: order.orderType,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      totalAmount: order.totalAmount,
      customerNote: order.customerNote ?? null,
      scheduledTime: order.scheduledTime ?? null,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt ?? null,
      orderItems: order.orderItems.map((line) => ({
        id: line.id,
        orderId: order.id,
        menuItemId: line.menuItemId,
        itemNameSnapshot: line.itemNameSnapshot,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        totalPrice: line.unitPrice * line.quantity,
        note: line.note ?? null,
        selectedOptions: line.selectedOptions.map((option) => ({
          id: option.id,
          menuItemOptionId: option.menuItemOptionId,
          groupNameSnapshot: option.groupNameSnapshot,
          optionNameSnapshot: option.optionNameSnapshot,
          priceAdjustmentSnapshot: option.priceAdjustmentSnapshot,
          quantity: option.quantity ?? 1,
        })),
        createdAt: order.createdAt,
        updatedAt: null,
      })),
    } as unknown as SubmittedOrder,
    currency: order.currency,
    restaurantName: order.restaurantName ?? 'This restaurant',
    restaurantLegalBusinessName: order.restaurantLegalBusinessName ?? order.restaurantName ?? '',
    restaurantAbn: order.restaurantAbn ?? null,
    gstRegistered: order.restaurantGstRegistered,
    pricesIncludeGst: order.restaurantPricesIncludeGst,
    refundContactEmail: order.restaurantRefundContactEmail ?? '',
    customerSurchargeNotice: order.restaurantCustomerSurchargeNotice ?? null,
    tableNumber: order.tableNumber ?? null,
    paymentPolicy: order.restaurantPaymentPolicy === 'PayAtCounterAllowed'
      ? 'PayAtCounterAllowed'
      : 'PrepayRequired',
    onlinePaymentsEnabled: order.restaurantOnlinePaymentsEnabled,
    returnPath: order.restaurantId
      ? buildRestaurantMenuPath(order.restaurantId, order.orderType)
      : '/my-orders',
  }
}

/**
 * Whether this order still has a payment decision to make.
 *
 * <p>
 * Reopening checkout for an order that is paid, cancelled, or already being charged would offer to
 * take money for something that is settled or in flight.
 * </p>
 */
/**
 * The payment states that still owe money, as the server defines them
 * (`OrderPaymentEligibility.IsPayableOnlineStatus`).
 *
 * <p>
 * Restating a narrower list here is what made My Orders offer a payment the checkout screen then
 * refused: cancelling the Stripe page leaves the order Pending or Cancelled, both of which the
 * server is happy to be paid for, and the customer was told their order had already been handled.
 * `Pending` is included for the same reason the server includes it — it means a checkout session was
 * opened, not that money is moving. A payment genuinely in flight is refused by the server, which
 * can see the payment rows; this list cannot, and must not guess.
 * </p>
 */
const payableOnlineStatuses = ['Pending', 'Unpaid', 'Failed', 'Cancelled', 'Expired']

export function isCheckoutReopenable(order: CustomerOrder): boolean {
  return order.status === 0 && payableOnlineStatuses.includes(order.paymentStatus)
}
