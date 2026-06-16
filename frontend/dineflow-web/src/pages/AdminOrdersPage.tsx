import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { getRealOrders, getTestPaymentOrders, type Order, type TestPaymentOrder } from '../api/auth'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'

const ORDER_STATUS_LABELS: Record<number, string> = {
  0: 'Pending',
  1: 'Accepted',
  2: 'Preparing',
  3: 'Ready',
  4: 'Completed',
  5: 'Cancelled',
  6: 'Rejected',
}

const ORDER_STATUS_VARIANTS: Record<number, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  0: 'secondary',
  1: 'default',
  2: 'default',
  3: 'default',
  4: 'outline',
  5: 'destructive',
  6: 'destructive',
}

const TEST_STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  Paid: 'default',
  Pending: 'secondary',
  Failed: 'destructive',
  Expired: 'outline',
}

function formatMoney(amount: number) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'AUD',
  }).format(amount)
}

function formatCents(cents: number) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'AUD',
  }).format(cents / 100)
}

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function RealOrdersCard({ orders, onRefresh }: { orders: Order[]; onRefresh: () => void }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Orders ({orders.length})</CardTitle>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw size={14} className="mr-1" /> Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No orders yet.</p>
        ) : (
          <div className="divide-y">
            {orders.map((order) => (
              <div key={order.id} className="py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium text-sm">{order.orderNumber}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(order.createdAt)}</p>
                  {order.customerNote && (
                    <p className="text-xs text-muted-foreground mt-0.5">Note: {order.customerNote}</p>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm font-medium">{formatMoney(order.totalAmount)}</span>
                  <Badge variant={ORDER_STATUS_VARIANTS[order.status] ?? 'secondary'}>
                    {ORDER_STATUS_LABELS[order.status] ?? `Status ${order.status}`}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function TestOrdersCard({ orders, onRefresh }: { orders: TestPaymentOrder[]; onRefresh: () => void }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Test Payments ({orders.length})</CardTitle>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw size={14} className="mr-1" /> Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No test payments yet.</p>
        ) : (
          <div className="divide-y">
            {orders.map((order) => (
              <div key={order.id} className="py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium text-sm">{order.userEmail ?? '—'}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(order.createdAt)}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm font-medium">{formatCents(order.amountCents)}</span>
                  <Badge variant={TEST_STATUS_VARIANTS[order.status] ?? 'secondary'}>
                    {order.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function AdminOrdersPage() {
  const [orders, setOrders] = useState<TestPaymentOrder[]>([])
  const [realOrders, setRealOrders] = useState<Order[]>([])

  const loadOrders = async (showToast = false) => {
    try {
      setOrders(await getTestPaymentOrders())
      if (showToast) toast.success('Test orders refreshed')
    } catch (error) {
      toast.error('Could not load test orders', {
        description: error instanceof Error ? error.message : 'Order loading failed',
      })
    }
  }

  const loadRealOrders = async (showToast = false) => {
    try {
      setRealOrders(await getRealOrders())
      if (showToast) toast.success('Orders refreshed')
    } catch (error) {
      toast.error('Could not load orders', {
        description: error instanceof Error ? error.message : 'Order loading failed',
      })
    }
  }

  useEffect(() => {
    void loadOrders()
    void loadRealOrders()
  }, [])

  return (
    <main className="content-grid">
      <RealOrdersCard orders={realOrders} onRefresh={() => void loadRealOrders(true)} />
      <TestOrdersCard orders={orders} onRefresh={() => void loadOrders(true)} />
    </main>
  )
}
