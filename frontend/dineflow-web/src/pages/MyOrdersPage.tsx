import { useEffect, useState } from 'react'
import { ClipboardList, RefreshCw, ShoppingBag, Utensils } from 'lucide-react'
import { toast } from 'sonner'
import { getMyOrders, type CustomerOrder } from '../api/auth'
import { OrderStatusBadge } from '../components/orders/OrderStatusBadge'
import { PaymentStatusBadge } from '../components/orders/PaymentStatusBadge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'

const orderTypeLabels = ['Dine in', 'Takeaway', 'Scheduled']

function getOrderScope(order: CustomerOrder) {
  return order.tableNumber ? `Table ${order.tableNumber}` : orderTypeLabels[order.orderType] ?? 'Order'
}

function formatMoney(amount: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'AUD' }).format(amount)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function MyOrdersPage() {
  const [orders, setOrders] = useState<CustomerOrder[]>([])
  const [loading, setLoading] = useState(true)

  const loadOrders = async (showToast = false) => {
    setLoading(true)

    try {
      setOrders(await getMyOrders())
      if (showToast) toast.success('Orders refreshed')
    } catch (error) {
      toast.error('Could not load your orders', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => loadOrders())
  }, [])

  return (
    <main className="content-grid">
      <Card>
        <CardHeader className="section-header">
          <div className="admin-page-title">
            <ClipboardList size={22} />
            <div>
              <CardTitle>My Orders</CardTitle>
              <CardDescription>Your recent dine-in, takeaway, and scheduled orders.</CardDescription>
            </div>
          </div>
          <Button type="button" variant="secondary" onClick={() => void loadOrders(true)} disabled={loading}>
            <RefreshCw size={18} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="directory-stack">
          {loading && orders.length === 0 ? (
            <p>Loading your orders...</p>
          ) : orders.length === 0 ? (
            <div className="dashboard-empty-state">You have not placed any orders yet.</div>
          ) : (
            <div className="dashboard-order-list">
              {orders.map((order) => (
                <div key={order.id} className="dashboard-order-row">
                  <div>
                    <strong className="table-name">
                      {order.orderType === 0 ? <Utensils size={16} /> : <ShoppingBag size={16} />}
                      {order.orderNumber}
                    </strong>
                    <span>{formatDate(order.createdAt)} - {getOrderScope(order)}</span>
                    <small>{order.orderItems.map((item) => `${item.quantity}x ${item.itemNameSnapshot}`).join(', ')}</small>
                  </div>
                  <div className="dashboard-order-state">
                    <OrderStatusBadge status={order.status} />
                    <div className="flex items-center gap-1.5">
                      <PaymentStatusBadge status={order.paymentStatus} />
                      <span className="text-xs text-muted-foreground">
                        {order.paymentMethod === 'PayAtCounter' ? 'Counter' : 'Online'}
                      </span>
                    </div>
                    <strong>{formatMoney(order.totalAmount)}</strong>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
