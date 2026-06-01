import { useEffect, useMemo, useState } from 'react'
import { ClipboardList, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { getTestPaymentOrders, type TestPaymentOrder } from '../api/auth'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'

const statusVariantByValue: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  Paid: 'default',
  Pending: 'secondary',
  Failed: 'destructive',
  Expired: 'outline',
}

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100)
}

function formatDate(value: string | null) {
  if (!value) {
    return 'Not yet'
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function getStatusVariant(status: string) {
  return statusVariantByValue[status] ?? 'secondary'
}

export function AdminOrdersPage() {
  const [orders, setOrders] = useState<TestPaymentOrder[]>([])
  const [loading, setLoading] = useState(true)

  const totals = useMemo(() => {
    return {
      count: orders.length,
      paid: orders.filter((order) => order.status === 'Paid').length,
      pending: orders.filter((order) => order.status === 'Pending').length,
      failed: orders.filter((order) => order.status === 'Failed').length,
    }
  }, [orders])

  const loadOrders = async (showToast = false) => {
    setLoading(true)

    try {
      setOrders(await getTestPaymentOrders())
      if (showToast) {
        toast.success('Test orders refreshed')
      }
    } catch (error) {
      toast.error('Could not load test orders', {
        description: error instanceof Error ? error.message : 'Order loading failed',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadOrders()
  }, [])

  return (
    <main className="content-grid">
      <Card>
        <CardHeader>
          <div className="section-header">
            <div className="admin-page-title">
              <ClipboardList size={22} />
              <div>
                <CardTitle>Order Management</CardTitle>
                <CardDescription>Temporary test orders created through Stripe Checkout.</CardDescription>
              </div>
            </div>
            <Button type="button" variant="secondary" onClick={() => loadOrders(true)} disabled={loading}>
              <RefreshCw size={18} />
              {loading ? 'Refreshing' : 'Refresh'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="directory-stack">
          <div className="placeholder-grid order-summary-grid">
            <div className="placeholder-item">
              <span>Total test orders</span>
              <strong>{totals.count}</strong>
            </div>
            <div className="placeholder-item">
              <span>Paid</span>
              <strong>{totals.paid}</strong>
            </div>
            <div className="placeholder-item">
              <span>Pending</span>
              <strong>{totals.pending}</strong>
            </div>
            <div className="placeholder-item">
              <span>Failed</span>
              <strong>{totals.failed}</strong>
            </div>
          </div>

          <div className="table-wrap">
            <table className="data-table payment-orders-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Status</th>
                  <th>Amount</th>
                  <th>Customer</th>
                  <th>Stripe session</th>
                  <th>Created</th>
                  <th>Paid</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <span className="table-name">
                        <ClipboardList size={16} />
                        {order.name}
                      </span>
                      <span className="table-subtext">{order.id}</span>
                    </td>
                    <td>
                      <Badge variant={getStatusVariant(order.status)}>{order.status}</Badge>
                    </td>
                    <td>
                      <strong>{formatMoney(order.totalCents, order.currency)}</strong>
                      <span className="table-subtext">
                        {order.quantity} x {formatMoney(order.amountCents, order.currency)}
                      </span>
                    </td>
                    <td>{order.userEmail || order.userId || 'Unknown'}</td>
                    <td>
                      <span className="table-subtext">
                        {order.stripeCheckoutSessionId || 'Not created'}
                      </span>
                    </td>
                    <td>{formatDate(order.createdAt)}</td>
                    <td>{formatDate(order.paidAt)}</td>
                  </tr>
                ))}
                {orders.length === 0 && (
                  <tr>
                    <td colSpan={7} className="empty-cell">
                      {loading ? 'Loading test orders...' : 'No test payment orders yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
