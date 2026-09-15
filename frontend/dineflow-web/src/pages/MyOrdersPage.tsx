import { buildOrderClosureNotice } from '@/lib/orderClosureNotice'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Ban, CircleX, Clock3, ClipboardList, CreditCard, Loader2, ReceiptText, RefreshCw, RotateCcw, ShoppingBag, Undo2, Utensils } from 'lucide-react'
import { toast } from 'sonner'
import {
  cancelCustomerOrder,
  getGuestOrders,
  getMyOrders,
  requestCustomerRefund,
  type CustomerOrder,
  type CustomerOrderItem,
} from '../api/auth'
import { resolvePublicAssetUrl } from '../api/publicMenu'
import { useAuth } from '../auth/AuthContext'
import { OrderItemOptionBadges } from '../components/orders/OrderItemOptionBadges'
import { OrderProgressStepper } from '../components/orders/OrderProgressStepper'
import { OrderRefundHistory } from '../components/orders/OrderRefundHistory'
import { OrderStatusBadge } from '../components/orders/OrderStatusBadge'
import { PaymentStatusBadge } from '../components/orders/PaymentStatusBadge'
import { canCustomerCancelForRefund, canCustomerCancelOrder } from '../components/orders/customerOrderCancellation'
import {
  computeSelectedAmountCents,
  isValidRefundSelection,
  canSelectExtras,
  canSelectWholeLine,
  parseRefundSelectionKey,
  refundSelectionKey,
  setItemAmountCents,
  toggleExtraSelection,
  toggleLineSelection,
  type RefundItemSelection,
} from '../components/orders/refundItemSelection'
import {
  buildRestaurantMenuPath,
  getSafeMenuReturnPath,
  normalizeCustomerMenuOrderType,
  type CustomerMenuOrderType,
} from '../lib/customerMenuNavigation'
import { findOpenCart, reorderIntoCart, type ReorderStrategy } from '../lib/reorder'
import { cartIdentityOf } from '../lib/cartSessionIdentity'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '../components/ui/alert-dialog'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { getStoredGuestOrders } from '../lib/guestOrders'
import { ReceiptDocumentView } from '../components/orders/ReceiptDocumentView'
import { getOrderStatusLabel } from '../components/orders/OrderStatusBadge'
import {
  buildReceiptLinePricing,
  buildReceiptPaymentSummary,
  formatReceiptDateTime,
  formatReceiptMoney,
  gstIncludedInTotal,
  resolveReceiptTitle,
  type ReceiptDocument,
} from '../lib/receipt'

const orderTypeLabels = ['Dine in', 'Takeaway', 'Scheduled']
// Matches the server's payable set. Cancelling the Stripe page leaves the order Cancelled, which
// is still owed and still payable — omitting it hid the button on exactly the orders that need it.
const payablePaymentStatuses = new Set(['Unpaid', 'Pending', 'Failed', 'Cancelled', 'Expired'])
const refundablePaymentStatuses = new Set(['Paid', 'PartiallyRefunded'])
const closedOrderStatuses = new Set([5, 6])

function getOrderScope(order: CustomerOrder) {
  return order.tableNumber ? `Table ${order.tableNumber}` : orderTypeLabels[order.orderType] ?? 'Order'
}

function getOrderMenuPath(order: CustomerOrder) {
  return order.restaurantId ? buildRestaurantMenuPath(order.restaurantId, order.orderType) : null
}

function formatMoney(amount: number, currencyCode?: string | null) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: (currencyCode || 'AUD').toUpperCase(),
  }).format(amount)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

/**
 * The customer's own copy of the transaction. Australian consumer law requires a proof of
 * transaction for supplies of $75 or more and on request below that, so this has to be
 * available for every order rather than only the ones paid through Stripe.
 *
 * <p>
 * Built from the same refund projection My Orders shows in the list. It used to keep its own idea of
 * "paid" — every settled status flattened to the word <i>Paid</i>, refunds unmentioned — so the row
 * said Refunded and the document it opened said Paid, for the same money.
 * </p>
 */
function buildCustomerReceipt(
  order: CustomerOrder,
  renderedAt: Date,
  wasPrinted: boolean,
): ReceiptDocument {
  const payment = buildReceiptPaymentSummary({
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    totalAmount: order.totalAmount,
    refundedAmountCents: order.refundBalance?.alreadyRefundedAmountCents ?? 0,
  })
  const gstRegistered = order.restaurantGstRegistered
  const currency = order.currency

  return {
    documentTitle: resolveReceiptTitle(gstRegistered, payment.isPaid),
    scopeLabel: getOrderScope(order),
    code: order.pickupCode || order.orderNumber,
    supplier: {
      restaurantName: order.restaurantName ?? 'Restaurant',
      legalBusinessName: order.restaurantLegalBusinessName,
      abn: order.restaurantAbn,
      address: order.restaurantAddress,
      phone: order.restaurantPhone,
    },
    issuedAt: new Date(order.createdAt),
    currency,
    gstAmount: gstIncludedInTotal(order.totalAmount, gstRegistered),
    items: order.orderItems.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      name: item.itemNameSnapshot?.trim() || 'Menu item',
      totalPrice: item.totalPrice,
      note: item.note,
      ...buildReceiptLinePricing({
        quantity: item.quantity,
        basePrice: item.basePriceSnapshot,
        unitPrice: item.unitPrice,
        options: item.selectedOptions,
        currency,
      }),
    })),
    totalAmount: order.totalAmount,
    amountDue: payment.amountDue,
    surchargeNotice: order.restaurantCustomerSurchargeNotice,
    refundContactEmail: order.restaurantRefundContactEmail,
    meta: [
      { label: 'Order', value: order.orderNumber },
      { label: 'Status', value: getOrderStatusLabel(order.status) },
      { label: 'Payment', value: payment.statusLabel },
      { label: 'Method', value: payment.methodLabel },
      // Only when there is one. A "Refunded: A$0.00" line on every receipt teaches people to skip
      // the row, which is the row that matters on the few where it is not zero.
      ...(payment.hasRefund
        ? [
            { label: 'Refunded', value: formatReceiptMoney(payment.refundedAmount, currency) },
            { label: 'Net paid', value: formatReceiptMoney(payment.netPaidAmount, currency) },
          ]
        : []),
      { label: 'Date', value: formatReceiptDateTime(order.createdAt) },
      // "Printed" was stamped when the dialog opened, so a receipt that was only ever looked at
      // claimed to have been printed. The word now follows what actually happened.
      {
        label: wasPrinted ? 'Printed' : 'Generated',
        value: formatReceiptDateTime(renderedAt),
      },
    ],
  }
}

/**
 * The menu price for one unit, so option badges read as additions. Falls back to the charged
 * unit price whenever the recorded adjustments do not reconcile to it — see
 * buildReceiptLinePricing for why they sometimes cannot.
 */
function getDisplayedUnitPrice(item: CustomerOrderItem) {
  const pricing = buildReceiptLinePricing({
    quantity: item.quantity,
    basePrice: item.basePriceSnapshot,
    unitPrice: item.unitPrice,
    options: item.selectedOptions,
    currency: 'AUD',
  })

  return pricing.baseAmount === null ? item.unitPrice : item.basePriceSnapshot
}

function getItemCount(order: CustomerOrder) {
  return order.orderItems.reduce((count, item) => count + item.quantity, 0)
}

function getRefundableQuantity(item: CustomerOrderItem) {
  return Math.max(0, item.quantity - item.refundedQuantity)
}

function getRefundRequestQuantity(item: CustomerOrderItem, amountCents: number) {
  const unitPriceCents = Math.max(1, Math.round(item.unitPrice * 100))
  return Math.min(
    getRefundableQuantity(item),
    Math.max(1, Math.ceil(amountCents / unitPriceCents)),
  )
}

function buildFullRefundSelection(order: CustomerOrder): RefundItemSelection {
  const selection = order.orderItems.reduce<RefundItemSelection>((current, item) => {
    // A line already refunded extra by extra cannot be refunded whole, so preselecting it opens
    // the dialog on a request the server is bound to refuse — and counts its balance into a total
    // the customer never chose.
    if (item.refundableAmountCents > 0 && canSelectWholeLine(item.refundGranularity)) {
      current[refundSelectionKey(item.id)] = item.refundableAmountCents
    }
    return current
  }, {})

  // Refunds that could not be tied to items still consume the money balance, so selecting every
  // remaining line balance can exceed what is claimable. Rather than opening in an error state, start
  // empty and let the customer choose within the cap the banner explains.
  if (computeSelectedAmountCents(selection) > order.refundBalance.refundableAmountCents) {
    return {}
  }

  return selection
}

function canContinuePayment(order: CustomerOrder) {
  return order.paymentMethod === 'Online'
    && payablePaymentStatuses.has(order.paymentStatus)
    && !closedOrderStatuses.has(order.status)
}

function canRequestRefund(order: CustomerOrder) {
  return order.paymentMethod === 'Online'
    && refundablePaymentStatuses.has(order.paymentStatus)
    // One request at a time, which the server enforces. Asked of the list rather than of its
    // newest entry, so the answer does not depend on which one happens to sort first.
    && !order.refundRequests.some((request) => request.status === 'Pending')
}

function getContinuePaymentLabel(order: CustomerOrder) {
  if (order.paymentStatus === 'Failed' || order.paymentStatus === 'Expired') {
    return 'Retry payment'
  }

  if (order.paymentStatus === 'Unpaid') {
    return 'Pay now'
  }

  return 'Continue payment'
}

const ORDER_POLL_INTERVAL_MS = 20_000

export function MyOrdersPage() {
  const { user, token, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [orders, setOrders] = useState<CustomerOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [guestOrderCount, setGuestOrderCount] = useState(0)
  const [reorderingOrderId, setReorderingOrderId] = useState<string | null>(null)
  const [searchParams] = useSearchParams()
  // Validated, because it arrives in a URL anybody can edit: an unchecked one turns this page into
  // an open redirect.
  const menuReturnPath = getSafeMenuReturnPath(searchParams.get('returnTo'))
  /** Set when the customer already has a cart with items and has to say what to do with it. */
  const [pendingReorder, setPendingReorder] = useState<
    { order: CustomerOrder; orderType: CustomerMenuOrderType; existingItemCount: number } | null
  >(null)
  /** Set when a past table order has to be told which way it is being repeated. */
  const [pendingOrderType, setPendingOrderType] = useState<CustomerOrder | null>(null)
  const [cancelOrder, setCancelOrder] = useState<CustomerOrder | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null)
  const [receiptOrder, setReceiptOrder] = useState<CustomerOrder | null>(null)
  const [receiptRenderedAt, setReceiptRenderedAt] = useState<Date | null>(null)
  // Whether Print was actually used. Opening the dialog is not printing, and the receipt used to
  // say it was.
  const [receiptPrinted, setReceiptPrinted] = useState(false)
  const [refundOrder, setRefundOrder] = useState<CustomerOrder | null>(null)
  const [refundReason, setRefundReason] = useState('')

  const [refundSelection, setRefundSelection] = useState<RefundItemSelection>({})
  const [requestingRefundOrderId, setRequestingRefundOrderId] = useState<string | null>(null)
  const isGuestView = !token

  /** Hands the page over to the shared receipt stylesheet for one window.print(). */
  const printReceipt = useCallback(() => {
    // Stamped here, not when the dialog opened: the document may now honestly say it was printed.
    setReceiptRenderedAt(new Date())
    setReceiptPrinted(true)
    document.body.classList.add('printing-receipt')

    const restore = () => document.body.classList.remove('printing-receipt')
    window.addEventListener('afterprint', restore, { once: true })

    try {
      window.print()
    } catch {
      window.removeEventListener('afterprint', restore)
      restore()
    }
  }, [])

  const sourceDescription = useMemo(() => {
    if (token) {
      return 'Showing orders linked to your signed-in account.'
    }

    return guestOrderCount > 0
      ? `Showing ${guestOrderCount} order${guestOrderCount === 1 ? '' : 's'} saved on this browser.`
      : 'Orders placed from this browser will appear here after checkout.'
  }, [guestOrderCount, token])

  const loadOrders = useCallback(async (showToast = false) => {
    if (authLoading) {
      return
    }

    setLoading(true)

    try {
      if (token) {
        setGuestOrderCount(0)
        setOrders(await getMyOrders())
      } else {
        const storedGuestOrders = getStoredGuestOrders()
        setGuestOrderCount(storedGuestOrders.length)
        setOrders(storedGuestOrders.length > 0 ? await getGuestOrders(storedGuestOrders) : [])
      }

      if (showToast) toast.success('Orders refreshed')
    } catch (error) {
      toast.error('Could not load your orders', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    } finally {
      setLoading(false)
    }
  }, [authLoading, token])

  useEffect(() => {
    // Fetch on mount: `loadOrders` flips its loading flag synchronously. One extra render on mount, not a stale value.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadOrders()
  }, [loadOrders])

  // Silent background refresh — keeps order/payment status current without the
  // full-screen loader or toast. Used by the polling effect below.
  const refreshSilently = useCallback(async () => {
    if (authLoading) {
      return
    }

    try {
      if (token) {
        setOrders(await getMyOrders())
      } else {
        const storedGuestOrders = getStoredGuestOrders()
        setGuestOrderCount(storedGuestOrders.length)
        if (storedGuestOrders.length > 0) {
          setOrders(await getGuestOrders(storedGuestOrders))
        }
      }
    } catch {
      // Transient polling errors are ignored; the manual Refresh surfaces failures.
    }
  }, [authLoading, token])

  // Poll while the tab is visible so customers see status changes without
  // manually refreshing. Guests have no auth token and cannot use SignalR, so
  // polling is the only live-update path that works for everyone. Paused when
  // the tab is hidden; resumes with an immediate refresh when it returns.
  useEffect(() => {
    if (authLoading) {
      return
    }

    let timer: number | undefined

    const start = () => {
      if (timer === undefined) {
        timer = window.setInterval(() => void refreshSilently(), ORDER_POLL_INTERVAL_MS)
      }
    }

    const stop = () => {
      if (timer !== undefined) {
        window.clearInterval(timer)
        timer = undefined
      }
    }

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stop()
      } else {
        void refreshSilently()
        start()
      }
    }

    if (!document.hidden) {
      start()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [authLoading, refreshSilently])

  const runReorder = async (
    order: CustomerOrder,
    strategy: ReorderStrategy,
    orderType: CustomerMenuOrderType,
  ) => {
    setReorderingOrderId(order.id)

    try {
      const result = await reorderIntoCart(order, { strategy, orderType, identity: cartIdentityOf(user) })
      const added = `${result.addedCount} item${result.addedCount === 1 ? '' : 's'}`
      const notes = [
        result.skippedCount > 0
          ? `${result.skippedCount} unavailable item${result.skippedCount === 1 ? '' : 's'} skipped.`
          : null,
        result.needsChoices.length > 0
          ? `${result.needsChoices.map((item) => item.name).join(', ')} now need${result.needsChoices.length === 1 ? 's' : ''} a choice — we have opened ${result.needsChoices.length === 1 ? 'it' : 'the first one'} for you.`
          : null,
      ].filter(Boolean).join(' ')

      // Opening the first one is the point: these dishes are on the menu, they just need an answer
      // the old order never had. Landing on the menu with nothing open would leave the customer to
      // work out for themselves what was missing.
      const menuPath = buildRestaurantMenuPath(result.restaurantId, result.orderType)
      const destination = result.needsChoices.length > 0
        ? `${menuPath}&item=${encodeURIComponent(result.needsChoices[0].menuItemId)}`
        : menuPath

      if (result.addedCount > 0) {
        toast.success(
          result.mergedIntoExistingCart
            ? `Added ${added} to your existing cart`
            : `Added ${added} to your cart`,
          notes ? { description: notes } : undefined,
        )
      } else {
        toast.info('Some choices are needed', notes ? { description: notes } : undefined)
      }

      navigate(destination)
    } catch (error) {
      toast.error('Could not reorder', {
        description: error instanceof Error ? error.message : 'The reorder could not be completed.',
      })
    } finally {
      setReorderingOrderId(null)
    }
  }

  const handleReorder = async (order: CustomerOrder) => {
    if (!order.restaurantId) {
      toast.error('Could not reorder', { description: 'This order is not linked to a restaurant menu.' })
      return
    }

    // A past order at a table cannot simply be repeated: rejoining that table's cart needs its QR
    // token, and an order records only the table's id. So rather than quietly turning it into a
    // different kind of order, ask which one they want now.
    if (order.tableId) {
      setPendingOrderType(order)
      return
    }

    await continueReorder(order, normalizeCustomerMenuOrderType(order.orderType))
  }

  const continueReorder = async (order: CustomerOrder, orderType: CustomerMenuOrderType) => {
    const restaurantId = order.restaurantId

    if (!restaurantId) {
      return
    }

    // Asked before anything is added, because both answers are reasonable and the wrong one is
    // only visible after the fact — either items nobody meant to order, or a cart quietly emptied.
    setReorderingOrderId(order.id)

    try {
      const existing = await findOpenCart(restaurantId, orderType)

      if (existing && existing.cart.items.length > 0) {
        setPendingReorder({ order, orderType, existingItemCount: existing.cart.itemCount })
        return
      }
    } catch {
      // Deciding failed; fall through and let the reorder itself report anything real.
    } finally {
      setReorderingOrderId(null)
    }

    await runReorder(order, 'merge', orderType)
  }

  /**
   * Sends the customer to checkout rather than starting a card payment here.
   *
   * <p>
   * This used to create a Stripe session directly, which a restaurant with Stripe switched off
   * refuses outright — leaving the customer holding an order they could not pay for and could only
   * cancel. Checkout is the one screen that shows whichever methods the restaurant actually offers.
   * </p>
   */
  const handleContinuePayment = (order: CustomerOrder) => {
    navigate(`/checkout?order=${encodeURIComponent(order.id)}`)
  }

  const submitOrderCancellation = async () => {
    if (!cancelOrder) {
      return
    }

    setCancellingOrderId(cancelOrder.id)

    try {
      const cancelledOrder = await cancelCustomerOrder(cancelOrder.id, {
        reason: cancelReason.trim() || undefined,
        guestAccessToken: getStoredGuestOrders()
          .find((entry) => entry.orderId === cancelOrder.id)?.guestAccessToken ?? undefined,
      })
      setOrders((current) => current.map((order) => (
        order.id === cancelledOrder.id ? cancelledOrder : order
      )))
      toast.success('Order cancelled', {
        description: `${cancelledOrder.orderNumber} will not be prepared.`,
      })
      setCancelOrder(null)
      setCancelReason('')
    } catch (error) {
      toast.error('Could not cancel order', {
        description: error instanceof Error ? error.message : 'The cancellation could not be completed.',
      })
    } finally {
      setCancellingOrderId(null)
    }
  }

  const submitRefundRequest = async () => {
    if (!refundOrder) {
      return
    }

    setRequestingRefundOrderId(refundOrder.id)

    try {
      const refundRequest = await requestCustomerRefund(refundOrder.id, {
        reason: refundReason.trim() || undefined,
        items: Object.entries(refundSelection).map(([key, amountCents]) => {
          const { orderItemId, orderItemOptionId } = parseRefundSelectionKey(key)
          const item = refundOrder.orderItems.find((candidate) => candidate.id === orderItemId)!

          return {
            orderItemId,
            orderItemOptionId: orderItemOptionId ?? undefined,
            amountCents,
            // An extra is one of a line rather than a count of plates, so the quantity a
            // whole-line refund derives from its amount does not describe it.
            quantity: orderItemOptionId ? 1 : getRefundRequestQuantity(item, amountCents),
          }
        }),
        // Guest orders have no session behind them, so the stored token is the credential.
        guestAccessToken: getStoredGuestOrders()
          .find((entry) => entry.orderId === refundOrder.id)?.guestAccessToken ?? undefined,
      })
      setOrders((current) => current.map((order) => (
        order.id === refundOrder.id
          ? { ...order, refundRequests: [refundRequest, ...order.refundRequests] }
          : order
      )))
      toast.success('Refund request sent', {
        description: 'The restaurant team can now review this request.',
      })
      setRefundOrder(null)
      setRefundReason('')
      setRefundSelection({})
    } catch (error) {
      toast.error('Could not request refund', {
        description: error instanceof Error ? error.message : 'The refund request could not be submitted.',
      })
    } finally {
      setRequestingRefundOrderId(null)
    }
  }

  // Earlier refunds shrink what is still claimable, so the picker has to be checked against the
  // remaining balance rather than the order total.
  const refundSelectedCents = refundOrder
    ? computeSelectedAmountCents(refundSelection)
    : 0
  const refundableCents = refundOrder?.refundBalance.refundableAmountCents ?? 0
  const alreadyRefundedCents = refundOrder?.refundBalance.alreadyRefundedAmountCents ?? 0
  const unattributedRefundedCents = refundOrder?.refundBalance.unattributedRefundedAmountCents ?? 0
  const exceedsRefundable = refundSelectedCents > refundableCents
  const canSubmitRefundRequest = isValidRefundSelection(refundSelection) && !exceedsRefundable

  return (
    <main className="content-grid">
      <Card>
        <CardHeader className="my-orders-header">
          <div className="admin-page-title">
            {/* Only when the customer arrived from a menu. Reaching this page from the account menu
                and finding a "back to menu" button that guesses at a restaurant would be worse than
                no button at all. */}
            {menuReturnPath ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0"
                aria-label="Back to menu"
                asChild
              >
                <Link to={menuReturnPath}><ArrowLeft size={18} /></Link>
              </Button>
            ) : (
              <ClipboardList size={22} />
            )}
            <div>
              <CardTitle asChild><h1>My Orders</h1></CardTitle>
              <CardDescription>{sourceDescription}</CardDescription>
            </div>
          </div>
          <CardAction className="my-orders-header-action">
            {isGuestView ? (
              <Button type="button" variant="outline" asChild>
                <Link to="/login">Log in to sync</Link>
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={() => void loadOrders(true)} disabled={loading || authLoading}>
              <RefreshCw size={18} />
              Refresh
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="directory-stack">
          {isGuestView ? (
            <div className="payment-test-note">
              <ClipboardList size={20} />
              <div>
                <strong>Guest order tracking is browser-based.</strong>
                <span>
                  If you switch devices, clear cookies, or use private browsing, these local order links will not follow you.
                </span>
              </div>
            </div>
          ) : null}

          {loading && orders.length === 0 ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : orders.length === 0 ? (
            <div className="dashboard-empty-state">
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <ClipboardList className="size-8 opacity-40" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    {isGuestView ? 'No saved orders' : 'No orders yet'}
                  </p>
                  <p className="text-sm">
                    {isGuestView
                      ? 'Your order history will appear here after placing an order.'
                      : 'When you place orders, they will appear here.'}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="my-orders-list">
              {orders.map((order) => {
                const isDineIn = order.orderType === 0
                const OrderIcon = isDineIn ? Utensils : ShoppingBag
                const itemCount = getItemCount(order)
                const showContinuePayment = canContinuePayment(order)
                const showRequestRefund = canRequestRefund(order)
                const showCancelOrder = canCustomerCancelOrder(order)
                // A paid order the restaurant never accepted: the customer can take their money
                // back rather than keep waiting on a kitchen that may not be watching.
                const showCancelForRefund = canCustomerCancelForRefund(order)
                const awaitingAcceptance = order.status === 0
                  && (order.paymentStatus === 'Paid' || order.paymentStatus === 'PartiallyRefunded')
                const canReorder = getOrderMenuPath(order) !== null && order.orderItems.length > 0
                // Navigating to checkout is instant, so there is no in-flight state to show.
                const isPaying = false
                const isRequestingRefund = requestingRefundOrderId === order.id
                const isReordering = reorderingOrderId === order.id
                const isCancelling = cancellingOrderId === order.id
                const closureNotice = buildOrderClosureNotice(order.closureReason)

                return (
                  <article key={order.id} className="my-order-card">
                    <div className="my-order-card-header">
                      <div className="my-order-title">
                        <span className="my-order-icon">
                          <OrderIcon size={18} />
                        </span>
                        <div>
                          <span className="my-order-kicker">{getOrderScope(order)}</span>
                          <strong>{order.orderNumber}</strong>
                          <span className="my-order-date">
                            <Clock3 size={13} />
                            {formatDate(order.createdAt)}
                          </span>
                        </div>
                      </div>
                      <div className="my-order-amount">
                        <span>Total</span>
                        <strong>{formatMoney(order.totalAmount, order.currency)}</strong>
                      </div>
                    </div>

                    <div className="my-order-status-row">
                      <div className="my-order-status">
                        <OrderStatusBadge status={order.status} paymentStatus={order.paymentStatus} className="my-order-status-badge" />
                        <PaymentStatusBadge status={order.paymentStatus} className="my-order-status-badge" />
                      </div>
                      <div className="my-order-payment-actions">
                        <Badge variant="outline" className="my-order-method-badge">
                          <CreditCard size={12} />
                          {order.paymentMethod === 'PayAtCounter' ? 'Pay at counter' : 'Online'}
                        </Badge>
                      </div>
                    </div>

                    <OrderProgressStepper status={order.status} className="my-order-progress" />

                    {/* The reason staff chose when they turned this order away. It was recorded in
                        the order's history and shown to nobody, so the customer saw only that it had
                        been rejected — with no way to tell whether reordering would work. */}
                    {closureNotice ? (
                      <div className="my-order-closure">
                        <Ban size={16} className="my-order-closure-icon" />
                        <div>
                          <strong>{closureNotice.heading}</strong>
                          <p>{closureNotice.reason ?? closureNotice.fallback}</p>
                        </div>
                      </div>
                    ) : null}

                    <OrderRefundHistory
                      requests={order.refundRequests}
                      refundedTotalCents={order.refundBalance?.alreadyRefundedAmountCents ?? 0}
                      currency={order.currency}
                    />

                    <div className="my-order-item-list">
                      {order.orderItems.map((item) => (
                        <div key={item.id} className="my-order-item">
                          <div className="order-item-line-copy">
                            <strong>{item.itemNameSnapshot || 'Menu item'}</strong>
                            {/* The dish's own price, so the badges below read as what each extra
                                added rather than as already-counted decoration. */}
                            <span className="my-order-item-meta">
                              {item.quantity} x {formatMoney(getDisplayedUnitPrice(item), order.currency)}
                            </span>
                            <OrderItemOptionBadges item={item} options={item.selectedOptions} currency={order.currency} />
                            {item.note ? <small className="my-order-item-note">Item note: {item.note}</small> : null}
                          </div>
                          <strong>{formatMoney(item.totalPrice, order.currency)}</strong>
                        </div>
                      ))}
                    </div>

                    {order.customerNote ? (
                      <div className="order-note">
                        <strong>Order note</strong>
                        <span>{order.customerNote}</span>
                      </div>
                    ) : null}

                    {awaitingAcceptance ? (
                      <p className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-500/25 dark:bg-amber-400/10 dark:text-amber-100">
                        {showCancelForRefund
                          ? 'Your payment went through, but the restaurant has not accepted this order yet. You can cancel it now and be refunded in full.'
                          : 'Your payment went through. The restaurant has not accepted the order yet — if it stays this way you will be able to cancel it for a full refund.'}
                      </p>
                    ) : null}

                    <div className="my-order-total">
                      <span>
                        <ReceiptText size={14} />
                        {itemCount} item{itemCount === 1 ? '' : 's'}
                      </span>
                      <strong>{formatMoney(order.totalAmount, order.currency)}</strong>
                    </div>

                    <div className="my-order-action-bar">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setReceiptRenderedAt(new Date())
                            setReceiptPrinted(false)
                            setReceiptOrder(order)
                          }}
                        >
                          <ReceiptText />
                          Receipt
                        </Button>
                        {showContinuePayment ? (
                          <Button
                            type="button"
                            className="my-order-continue-payment"
                            disabled={isPaying}
                            onClick={() => void handleContinuePayment(order)}
                          >
                            {isPaying ? <Loader2 className="animate-spin" /> : <CreditCard />}
                            {isPaying ? 'Opening checkout...' : getContinuePaymentLabel(order)}
                          </Button>
                        ) : null}
                        {showRequestRefund ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="my-order-refund-button"
                            disabled={isRequestingRefund}
                            onClick={() => {
                              setRefundReason('')
                              setRefundSelection(buildFullRefundSelection(order))
                              setRefundOrder(order)
                            }}
                          >
                            {isRequestingRefund ? <Loader2 className="animate-spin" /> : <Undo2 />}
                            Request refund
                          </Button>
                        ) : null}
                        {showCancelOrder || showCancelForRefund ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            disabled={isCancelling}
                            onClick={() => {
                              setCancelReason('')
                              setCancelOrder(order)
                            }}
                          >
                            {isCancelling ? <Loader2 className="animate-spin" /> : <CircleX />}
                            {isCancelling
                              ? 'Cancelling...'
                              : showCancelForRefund ? 'Cancel and refund' : 'Cancel order'}
                          </Button>
                        ) : null}
                        {canReorder ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="my-order-reorder-button"
                            disabled={isReordering}
                            onClick={() => void handleReorder(order)}
                          >
                            {isReordering ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                            Order again
                          </Button>
                        ) : null}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={receiptOrder !== null}
        onOpenChange={(open) => {
          if (!open) {
            setReceiptOrder(null)
            setReceiptRenderedAt(null)
            setReceiptPrinted(false)
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Receipt</DialogTitle>
            <DialogDescription>
              Your copy of this transaction. Print or save it for your records.
            </DialogDescription>
          </DialogHeader>

          {receiptOrder ? (
            <ReceiptDocumentView
              receipt={buildCustomerReceipt(
                receiptOrder,
                receiptRenderedAt ?? new Date(),
                receiptPrinted,
              )}
              visible
            />
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReceiptOrder(null)}>Close</Button>
            <Button type="button" onClick={printReceipt}>
              <ReceiptText />
              Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={cancelOrder !== null}
        onOpenChange={(open) => {
          if (!open && cancellingOrderId === null) {
            setCancelOrder(null)
            setCancelReason('')
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <CircleX />
            </AlertDialogMedia>
            <AlertDialogTitle>Cancel this order?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelOrder
                ? `${cancelOrder.orderNumber} is still pending and has not been paid. Cancelling releases its items and cannot be undone.`
                : 'This pending order will be cancelled.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={cancelReason}
            onChange={(event) => setCancelReason(event.target.value)}
            placeholder="Optional reason for the restaurant"
            aria-label="Cancellation reason"
            rows={3}
            maxLength={1000}
            disabled={cancellingOrderId !== null}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancellingOrderId !== null}>Keep order</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={cancellingOrderId !== null}
              onClick={(event) => {
                event.preventDefault()
                void submitOrderCancellation()
              }}
            >
              {cancellingOrderId !== null ? <Loader2 className="animate-spin" /> : <CircleX />}
              {cancellingOrderId !== null ? 'Cancelling...' : 'Yes, cancel order'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/*
        * Reordering into a cart that already has something in it has two reasonable answers, and
        * the wrong one is only visible afterwards — either items nobody meant to order, or a cart
        * quietly emptied. Previously neither was chosen: a whole new cart was created and the old
        * one was left active in the database, invisible and unreachable.
        */}
      {/* Repeating a table order. The table itself cannot be rejoined without its QR code, so the
          honest options are the two the menu already offers — and the wording says which one puts
          the food in front of them. */}
      <AlertDialog
        open={pendingOrderType !== null}
        onOpenChange={(open) => { if (!open) setPendingOrderType(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>How would you like to order this time?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingOrderType?.tableNumber
                ? `You ordered this at table ${pendingOrderType.tableNumber}. To have it brought to a table again, scan the table's QR code — otherwise choose one of these.`
                : "You ordered this at a table. To have it brought to a table again, scan the table's QR code — otherwise choose one of these."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction
              variant="outline"
              onClick={(event) => {
                event.preventDefault()
                const pending = pendingOrderType
                setPendingOrderType(null)
                if (pending) void continueReorder(pending, 'Takeaway')
              }}
            >
              Collect it myself
            </AlertDialogAction>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                const pending = pendingOrderType
                setPendingOrderType(null)
                if (pending) void continueReorder(pending, 'DineIn')
              }}
            >
              Eat in
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingReorder !== null}
        onOpenChange={(open) => { if (!open) setPendingReorder(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>You already have a cart here</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingReorder
                ? `Your cart for this restaurant already has ${pendingReorder.existingItemCount} item${pendingReorder.existingItemCount === 1 ? '' : 's'} in it. Add this order on top, or start again with just this order?`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep browsing</AlertDialogCancel>
            <AlertDialogAction
              variant="outline"
              onClick={(event) => {
                event.preventDefault()
                const pending = pendingReorder
                setPendingReorder(null)
                if (pending) void runReorder(pending.order, 'replace', pending.orderType)
              }}
            >
              Replace my cart
            </AlertDialogAction>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                const pending = pendingReorder
                setPendingReorder(null)
                if (pending) void runReorder(pending.order, 'merge', pending.orderType)
              }}
            >
              Add to my cart
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={refundOrder !== null}
        onOpenChange={(open) => {
          if (!open && requestingRefundOrderId === null) {
            setRefundOrder(null)
            setRefundReason('')
            setRefundSelection({})
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request a refund</DialogTitle>
            <DialogDescription>
              {refundOrder
                ? `${refundOrder.orderNumber}: choose which items to refund and tell the restaurant why.`
                : 'Choose which items to refund and tell the restaurant why.'}
            </DialogDescription>
          </DialogHeader>
          {refundOrder ? (
            <div className="refund-picker">
              {alreadyRefundedCents > 0 ? (
                <p className="refund-picker-balance">
                  <strong>{formatMoney(alreadyRefundedCents / 100, refundOrder.currency)}</strong>
                  {' has already been refunded on this order'}
                  {unattributedRefundedCents > 0
                    ? `, of which ${formatMoney(unattributedRefundedCents / 100, refundOrder.currency)} is not tied to specific items`
                    : null}
                  {'. At most '}
                  <strong>{formatMoney(refundableCents / 100, refundOrder.currency)}</strong>
                  {' can still be refunded.'}
                </p>
              ) : null}
              <ul className="refund-picker-list">
                {refundOrder.orderItems.map((item) => {
                  const refundableAmountCents = item.refundableAmountCents
                  const wholeLineOpen = canSelectWholeLine(item.refundGranularity)
                  // Two different facts that used to share one flag: nothing left to give back, and
                  // this line's extras were refunded so only they can be from here. Conflated, a
                  // line with most of its value intact announced itself as already refunded.
                  const isFullyRefunded = refundableAmountCents === 0
                  const canPickWholeLine = wholeLineOpen && !isFullyRefunded
                  const lineKey = refundSelectionKey(item.id)
                  const isSelected = lineKey in refundSelection
                  const selectedAmountCents = refundSelection[lineKey] ?? refundableAmountCents
                  // Only extras with a share of their own, and only while this line has not
                  // already been refunded whole.
                  const refundableExtras = canSelectExtras(item.refundGranularity)
                    ? item.selectedOptions.filter((option) => option.refundIneligibilityReason === null)
                    : []
                  const imageUrl = resolvePublicAssetUrl(item.imageUrl)
                  const name = item.itemNameSnapshot || 'Menu item'
                  return (
                    <li key={item.id} data-refunded={isFullyRefunded ? 'true' : 'false'}>
                      <label
                        className="refund-picker-item"
                        data-selected={isSelected ? 'true' : 'false'}
                      >
                        <input
                          type="checkbox"
                          className="refund-picker-check"
                          checked={isSelected}
                          disabled={!canPickWholeLine}
                          onChange={() => setRefundSelection((current) => toggleLineSelection(
                            current,
                            item.id,
                            refundableAmountCents,
                            refundableExtras.map((option) => option.id),
                          ))}
                        />
                        <span className="refund-picker-thumb" aria-hidden="true">
                          {imageUrl ? (
                            <img src={imageUrl} alt="" decoding="async" />
                          ) : (
                            <Utensils size={18} />
                          )}
                        </span>
                        <span className="refund-picker-copy">
                          <strong>{name}</strong>
                          {item.selectedOptions.length > 0 ? (
                            <OrderItemOptionBadges item={item} options={item.selectedOptions} currency={refundOrder.currency} />
                          ) : null}
                          <small>
                            {formatMoney(item.unitPrice, refundOrder.currency)} each
                            <span aria-hidden="true"> · </span>
                            {item.quantity} in order
                            {item.refundedAmountCents > 0 ? (
                              <>
                                <span aria-hidden="true"> · </span>
                                <span className="refund-picker-refunded-note">
                                  {isFullyRefunded
                                    ? 'already refunded'
                                    : `${formatMoney(item.refundedAmountCents / 100, refundOrder.currency)} already refunded`}
                                </span>
                              </>
                            ) : null}
                          </small>
                        </span>
                        {!canPickWholeLine ? (
                          <span className="refund-picker-refunded-badge">
                            {isFullyRefunded ? 'Refunded' : 'Extras refunded'}
                          </span>
                        ) : (
                          <span className="refund-picker-amount">
                            {formatMoney((isSelected ? selectedAmountCents : refundableAmountCents) / 100, refundOrder.currency)}
                          </span>
                        )}
                      </label>
                      {isSelected ? (
                        <div className="refund-picker-item-amount-editor">
                          <label htmlFor={`refund-item-amount-${item.id}`}>Refund amount</label>
                          <div className="refund-picker-item-amount-control">
                            <span>{refundOrder.currency.toUpperCase()}</span>
                            <Input
                              id={`refund-item-amount-${lineKey}`}
                              type="number"
                              min={0.01}
                              max={refundableAmountCents / 100}
                              step={0.01}
                              inputMode="decimal"
                              aria-label={`Refund amount for ${name}`}
                              value={selectedAmountCents > 0 ? selectedAmountCents / 100 : ''}
                              onChange={(event) => setRefundSelection((current) => (
                                setItemAmountCents(
                                  current,
                                  lineKey,
                                  Math.round(Number(event.target.value) * 100) || 0,
                                  refundableAmountCents,
                                )
                              ))}
                            />
                            <span className="refund-picker-item-amount-max">
                              of {formatMoney(refundableAmountCents / 100, refundOrder.currency)} available
                            </span>
                          </div>
                        </div>
                      ) : null}
                      {refundableExtras.length > 0 ? (
                        <ul className="refund-picker-extras">
                          <li className="refund-picker-extras-hint">
                            Refund the whole item, or just one of its extras.
                          </li>
                          {refundableExtras.map((option) => {
                            const extraKey = refundSelectionKey(item.id, option.id)
                            const extraSelected = extraKey in refundSelection
                            const extraAvailableCents = option.refundableAmountCents
                            const extraAmountCents = refundSelection[extraKey] ?? extraAvailableCents
                            const extraSpent = extraAvailableCents === 0

                            return (
                              <li key={option.id}>
                                <label
                                  className="refund-picker-extra"
                                  data-selected={extraSelected ? 'true' : 'false'}
                                >
                                  <input
                                    type="checkbox"
                                    className="refund-picker-check"
                                    checked={extraSelected}
                                    disabled={extraSpent}
                                    onChange={() => setRefundSelection((current) => (
                                      toggleExtraSelection(current, item.id, option.id, extraAvailableCents)
                                    ))}
                                  />
                                  <span className="refund-picker-extra-copy">
                                    <strong>{option.optionNameSnapshot}</strong>
                                    <small>{option.groupNameSnapshot}</small>
                                  </span>
                                  <span className="refund-picker-extra-amount">
                                    {extraSpent
                                      ? 'Refunded'
                                      : formatMoney(
                                        (extraSelected ? extraAmountCents : extraAvailableCents) / 100,
                                        refundOrder.currency,
                                      )}
                                  </span>
                                </label>
                                {extraSelected ? (
                                  <div className="refund-picker-item-amount-editor">
                                    <label htmlFor={`refund-item-amount-${extraKey}`}>Refund amount</label>
                                    <div className="refund-picker-item-amount-control">
                                      <span>{refundOrder.currency.toUpperCase()}</span>
                                      <Input
                                        id={`refund-item-amount-${extraKey}`}
                                        type="number"
                                        min={0.01}
                                        max={extraAvailableCents / 100}
                                        step={0.01}
                                        inputMode="decimal"
                                        aria-label={`Refund amount for ${option.optionNameSnapshot}`}
                                        value={extraAmountCents > 0 ? extraAmountCents / 100 : ''}
                                        onChange={(event) => setRefundSelection((current) => (
                                          setItemAmountCents(
                                            current,
                                            extraKey,
                                            Math.round(Number(event.target.value) * 100) || 0,
                                            extraAvailableCents,
                                          )
                                        ))}
                                      />
                                      <span className="refund-picker-item-amount-max">
                                        of {formatMoney(extraAvailableCents / 100, refundOrder.currency)} available
                                      </span>
                                    </div>
                                  </div>
                                ) : null}
                              </li>
                            )
                          })}
                        </ul>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
              <p className="refund-picker-total" data-over-limit={exceedsRefundable ? 'true' : 'false'}>
                <span>Refund total</span>
                <strong>{formatMoney(refundSelectedCents / 100, refundOrder.currency)}</strong>
              </p>
              {exceedsRefundable ? (
                <p className="refund-picker-error" role="alert">
                  That is more than the {formatMoney(refundableCents / 100, refundOrder.currency)} still
                  available to refund. Deselect an item or lower an amount.
                </p>
              ) : null}
            </div>
          ) : null}
          <Textarea
            value={refundReason}
            onChange={(event) => setRefundReason(event.target.value)}
            placeholder="Reason, issue, or anything the team should know"
            rows={4}
            maxLength={1000}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setRefundOrder(null)
                setRefundReason('')
                setRefundSelection({})
              }}
              disabled={requestingRefundOrderId !== null}
            >
              Keep order
            </Button>
            <Button
              type="button"
              onClick={() => void submitRefundRequest()}
              disabled={requestingRefundOrderId !== null || !canSubmitRefundRequest}
            >
              {requestingRefundOrderId !== null ? <Loader2 className="animate-spin" /> : <Undo2 />}
              Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
