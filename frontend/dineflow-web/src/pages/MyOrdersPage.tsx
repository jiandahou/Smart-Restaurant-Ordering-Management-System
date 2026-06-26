import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock3, ClipboardList, CreditCard, Loader2, ReceiptText, RefreshCw, ShoppingBag, Utensils } from 'lucide-react'
import { toast } from 'sonner'
import { createOrderCheckoutSession, getGuestOrders, getMyOrders, type CustomerOrder } from '../api/auth'
import { useAuth } from '../auth/AuthContext'
import { OrderItemOptionBadges } from '../components/orders/OrderItemOptionBadges'
import { OrderStatusBadge } from '../components/orders/OrderStatusBadge'
import { PaymentStatusBadge } from '../components/orders/PaymentStatusBadge'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { getGuestOrderIds, rememberGuestOrder } from '../lib/guestOrders'

const orderTypeLabels = ['Dine in', 'Takeaway', 'Scheduled']
const payablePaymentStatuses = new Set(['Unpaid', 'Pending', 'Failed', 'Expired'])
const closedOrderStatuses = new Set([5, 6])

function getOrderScope(order: CustomerOrder) {
  return order.tableNumber ? `Table ${order.tableNumber}` : orderTypeLabels[order.orderType] ?? 'Order'
}

function getOrderMenuPath(order: CustomerOrder) {
  return order.restaurantId ? `/r/${encodeURIComponent(order.restaurantId)}/menu` : null
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

function canContinuePayment(order: CustomerOrder) {
  return order.paymentMethod === 'Online'
    && payablePaymentStatuses.has(order.paymentStatus)
    && !closedOrderStatuses.has(order.status)
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

export function MyOrdersPage() {
  const { token, loading: authLoading } = useAuth()
  const [orders, setOrders] = useState<CustomerOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [guestOrderCount, setGuestOrderCount] = useState(0)
  const [payingOrderId, setPayingOrderId] = useState<string | null>(null)
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
        const guestOrderIds = getGuestOrderIds()
        setGuestOrderCount(guestOrderIds.length)
        setOrders(guestOrderIds.length > 0 ? await getGuestOrders(guestOrderIds) : [])
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

  return (
    <main className="content-grid">
      <Card>
        <CardHeader className="section-header">
          <div className="admin-page-title">
            <ClipboardList size={22} />
            <div>
              <CardTitle>My Orders</CardTitle>
              <CardDescription>{sourceDescription}</CardDescription>
            </div>
          </div>
          <div className="row-actions">
            {isGuestView ? (
              <Button type="button" variant="outline" asChild>
                <Link to="/login">Log in to sync</Link>
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={() => void loadOrders(true)} disabled={loading || authLoading}>
              <RefreshCw size={18} />
              Refresh
            </Button>
          </div>
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
            <p>Loading your orders...</p>
          ) : orders.length === 0 ? (
            <div className="dashboard-empty-state">
              {isGuestView
                ? 'No orders are saved on this browser yet.'
                : 'You have not placed any orders yet.'}
            </div>
          ) : (
            <div className="my-orders-list">
              {orders.map((order) => {
                const isDineIn = order.orderType === 0
                const OrderIcon = isDineIn ? Utensils : ShoppingBag
                const itemCount = getItemCount(order)
                const showContinuePayment = canContinuePayment(order)
                const isPaying = payingOrderId === order.id

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
                        {showContinuePayment ? (
                          <Button
                            type="button"
                            size="sm"
                            className="my-order-continue-payment"
                            disabled={isPaying}
                            onClick={() => void handleContinuePayment(order)}
                          >
                            {isPaying ? <Loader2 className="animate-spin" /> : <CreditCard />}
                            {isPaying ? 'Opening checkout...' : getContinuePaymentLabel(order)}
                          </Button>
                        ) : null}
                      </div>
                    </div>

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
                  </article>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
