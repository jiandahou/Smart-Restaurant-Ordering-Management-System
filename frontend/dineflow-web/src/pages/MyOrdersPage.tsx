import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronDown, CircleX, Clock3, ClipboardList, CreditCard, Loader2, ReceiptText, RefreshCw, RotateCcw, ShoppingBag, Undo2, Utensils } from 'lucide-react'
import { toast } from 'sonner'
import {
  createOrderCheckoutSession,
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
import { OrderStatusBadge } from '../components/orders/OrderStatusBadge'
import { PaymentStatusBadge } from '../components/orders/PaymentStatusBadge'
import { canCustomerCancelOrder } from '../components/orders/customerOrderCancellation'
import {
  computeSelectedAmountCents,
  isValidRefundSelection,
  setItemAmountCents,
  toggleItemSelection,
  type RefundItemSelection,
} from '../components/orders/refundItemSelection'
import { buildRestaurantMenuPath } from '../lib/customerMenuNavigation'
import { reorderIntoCart } from '../lib/reorder'
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
import { getStoredGuestOrders, rememberGuestOrder } from '../lib/guestOrders'

const orderTypeLabels = ['Dine in', 'Takeaway', 'Scheduled']
const payablePaymentStatuses = new Set(['Unpaid', 'Pending', 'Failed', 'Expired'])
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
    if (item.refundableAmountCents > 0) {
      current[item.id] = item.refundableAmountCents
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
    && order.latestRefundRequest?.status !== 'Pending'
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
  const { token, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [orders, setOrders] = useState<CustomerOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [guestOrderCount, setGuestOrderCount] = useState(0)
  const [payingOrderId, setPayingOrderId] = useState<string | null>(null)
  const [reorderingOrderId, setReorderingOrderId] = useState<string | null>(null)
  const [cancelOrder, setCancelOrder] = useState<CustomerOrder | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null)
  const [refundOrder, setRefundOrder] = useState<CustomerOrder | null>(null)
  const [refundReason, setRefundReason] = useState('')
  const [refundSelection, setRefundSelection] = useState<RefundItemSelection>({})
  const [requestingRefundOrderId, setRequestingRefundOrderId] = useState<string | null>(null)
  const isGuestView = !token

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

  const handleReorder = async (order: CustomerOrder) => {
    setReorderingOrderId(order.id)

    try {
      const result = await reorderIntoCart(order)
      toast.success(
        `Added ${result.addedCount} item${result.addedCount === 1 ? '' : 's'} to a new cart`,
        result.skippedCount > 0
          ? {
              description: `${result.skippedCount} unavailable item${result.skippedCount === 1 ? '' : 's'} skipped.`,
            }
          : undefined,
      )
      navigate(buildRestaurantMenuPath(result.restaurantId, result.orderType))
    } catch (error) {
      toast.error('Could not reorder', {
        description: error instanceof Error ? error.message : 'The reorder could not be completed.',
      })
    } finally {
      setReorderingOrderId(null)
    }
  }

  const handleContinuePayment = async (order: CustomerOrder) => {
    setPayingOrderId(order.id)

    try {
      const returnTo = getOrderMenuPath(order)
      const result = await createOrderCheckoutSession({
        orderId: order.id,
        ...(returnTo ? { returnTo } : {}),
      })
      rememberGuestOrder(result.orderId)
      window.location.assign(result.checkoutUrl)
    } catch (error) {
      toast.error('Could not continue payment', {
        description: error instanceof Error ? error.message : 'The payment session could not be created.',
      })
    } finally {
      setPayingOrderId(null)
    }
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
        items: Object.entries(refundSelection).map(([orderItemId, amountCents]) => {
          const item = refundOrder.orderItems.find((candidate) => candidate.id === orderItemId)!
          return {
            orderItemId,
            amountCents,
            quantity: getRefundRequestQuantity(item, amountCents),
          }
        }),
        // Guest orders have no session behind them, so the stored token is the credential.
        guestAccessToken: getStoredGuestOrders()
          .find((entry) => entry.orderId === refundOrder.id)?.guestAccessToken ?? undefined,
      })
      setOrders((current) => current.map((order) => (
        order.id === refundOrder.id
          ? { ...order, latestRefundRequest: refundRequest }
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
            <ClipboardList size={22} />
            <div>
              <CardTitle>My Orders</CardTitle>
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
                const canReorder = getOrderMenuPath(order) !== null && order.orderItems.length > 0
                const isPaying = payingOrderId === order.id
                const isRequestingRefund = requestingRefundOrderId === order.id
                const isReordering = reorderingOrderId === order.id
                const isCancelling = cancellingOrderId === order.id
                const refundRequest = order.latestRefundRequest
                // Staff can approve for less than was asked, so the settled amount is the one
                // that actually left the account — never imply the requested figure was refunded.
                const settledRefundCents = refundRequest?.refundStatus === 'Succeeded'
                  ? refundRequest.refundedAmountCents
                  : null
                const isPartialRefund = settledRefundCents !== null
                  && refundRequest !== null
                  && settledRefundCents < refundRequest.requestedAmountCents

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
                        <OrderStatusBadge status={order.status} className="my-order-status-badge" />
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

                    {order.latestRefundRequest ? (
                      <div className={`my-order-refund-state my-order-refund-state-${order.latestRefundRequest.status.toLowerCase()}`}>
                        <details className="refund-state-details">
                          <summary>
                            <div className="refund-state-heading">
                              <strong>Refund request {order.latestRefundRequest.status.toLowerCase()}</strong>
                              <span>
                                {settledRefundCents !== null ? (
                                  <>
                                    <b className="refund-state-settled">
                                      {formatMoney(settledRefundCents / 100, order.latestRefundRequest.currency)}
                                    </b>
                                    {isPartialRefund
                                      ? ` refunded of ${formatMoney(order.latestRefundRequest.requestedAmountCents / 100, order.latestRefundRequest.currency)} requested`
                                      : ' refunded'}
                                  </>
                                ) : (
                                  <>
                                    {formatMoney(order.latestRefundRequest.requestedAmountCents / 100, order.latestRefundRequest.currency)}
                                    {' requested on '}
                                    {formatDate(order.latestRefundRequest.createdAt)}
                                  </>
                                )}
                              </span>
                            </div>
                            <ChevronDown className="refund-state-chevron" size={18} aria-hidden="true" />
                          </summary>
                          <div className="refund-state-body">
                            {isPartialRefund ? (
                              <p className="refund-state-partial">
                                The restaurant approved a partial refund:{' '}
                                <strong>{formatMoney(settledRefundCents! / 100, order.latestRefundRequest.currency)}</strong>
                                {' of the '}
                                {formatMoney(order.latestRefundRequest.requestedAmountCents / 100, order.latestRefundRequest.currency)}
                                {' you asked for.'}
                              </p>
                            ) : null}

                            {order.latestRefundRequest.items.length > 0 ? (
                              <div className="refund-state-section">
                                <h4>Items you asked to refund</h4>
                                <ul className="refund-state-items">
                                  {order.latestRefundRequest.items.map((item, index) => (
                                    <li key={`${item.menuItemNameSnapshot}-${index}`}>
                                      <span>
                                        {item.menuItemNameSnapshot}
                                        {item.quantity > 1 ? ` × ${item.quantity}` : null}
                                      </span>
                                      <strong>
                                        {formatMoney(item.amountCents / 100, order.latestRefundRequest!.currency)}
                                      </strong>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : (
                              <div className="refund-state-section">
                                <h4>Items you asked to refund</h4>
                                <p className="refund-state-empty">
                                  This request was submitted for the whole order.
                                </p>
                              </div>
                            )}

                            <div className="refund-state-section">
                              <h4>Your message</h4>
                              {order.latestRefundRequest.reason ? (
                                <p className="refund-state-note">{order.latestRefundRequest.reason}</p>
                              ) : (
                                <p className="refund-state-empty">You did not leave a message.</p>
                              )}
                            </div>
                          </div>
                        </details>
                        {order.latestRefundRequest.adminNote ? (
                          <div className="refund-state-reply">
                            <h4>Restaurant reply</h4>
                            <p>{order.latestRefundRequest.adminNote}</p>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="my-order-item-list">
                      {order.orderItems.map((item) => (
                        <div key={item.id} className="my-order-item">
                          <div className="order-item-line-copy">
                            <strong>{item.itemNameSnapshot || 'Menu item'}</strong>
                            <span className="my-order-item-meta">
                              {item.quantity} x {formatMoney(item.unitPrice, order.currency)}
                            </span>
                            <OrderItemOptionBadges options={item.selectedOptions} currency={order.currency} />
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

                    <div className="my-order-total">
                      <span>
                        <ReceiptText size={14} />
                        {itemCount} item{itemCount === 1 ? '' : 's'}
                      </span>
                      <strong>{formatMoney(order.totalAmount, order.currency)}</strong>
                    </div>

                    {showContinuePayment || showRequestRefund || showCancelOrder || canReorder ? (
                      <div className="my-order-action-bar">
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
                        {showCancelOrder ? (
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
                            {isCancelling ? 'Cancelling...' : 'Cancel order'}
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
                    ) : null}
                  </article>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

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
                  const isFullyRefunded = refundableAmountCents === 0
                  const isSelected = item.id in refundSelection
                  const selectedAmountCents = refundSelection[item.id] ?? refundableAmountCents
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
                          disabled={isFullyRefunded}
                          onChange={() => setRefundSelection((current) => toggleItemSelection(current, item.id, refundableAmountCents))}
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
                            <OrderItemOptionBadges options={item.selectedOptions} currency={refundOrder.currency} />
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
                        {isFullyRefunded ? (
                          <span className="refund-picker-refunded-badge">Refunded</span>
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
                              id={`refund-item-amount-${item.id}`}
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
                                  item.id,
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
