import { useEffect, useMemo, useState } from 'react'
import { ClipboardList, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { getRealOrders, getTestPaymentOrders, type Order, type TestPaymentOrder } from '../api/auth'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'

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
  0: 'secondary',  // Pending
  1: 'default',    // Accepted
  2: 'default',    // Preparing
  3: 'default',    // Ready
  4: 'outline',    // Completed
  5: 'destructive', // Cancelled
  6: 'destructive', // Rejected
}

const TEST_STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  Paid: 'default',
  Pending: 'secondary',
  Failed: 'destructive',
  Expired: 'outline',
}

function formatCents(cents: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100)
}

function formatAmount(amount: number) {
  return new Intl.NumberFormat(undefined, {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function AdminOrdersPage() {
  const [orders, setOrders] = useState<TestPaymentOrder[]>([])
  const [realOrders, setRealOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [realLoading, setRealLoading] = useState(true)

  const totals = useMemo(() => ({
    count: orders.length,
    paid: orders.filter((o) => o.status === 'Paid').length,
    pending: orders.filter((o) => o.status === 'Pending').length,
    failed: orders.filter((o) => o.status === 'Failed').length,
  }), [orders])

  const realTotals = useMemo(() => ({
    count: realOrders.length,
    pending: realOrders.filter((o) => o.status === 0).length,
    active: realOrders.filter((o) => o.status >= 1 && o.status <= 3).length,
    completed: realOrders.filter((o) => o.status === 4).length,
  }), [realOrders])

  const loadOrders = async (showToast = false) => {
    setLoading(true)
    try {
      setOrders(await getTestPaymentOrders())
      if (showToast) toast.success('Test orders refreshed')
    } catch (error) {
      toast.error('Could not load test orders', {
        description: error instanceof Error ? error.message : 'Order loading failed',
      })
    } finally {
      setLoading(false)
    }
  }

  const loadRealOrders = async (showToast = false) => {
    setRealLoading(true)
    try {
      setRealOrders(await getRealOrders())
      if (showToast) toast.success('Orders refreshed')
    } catch (error) {
      toast.error('Could not load orders', {
        description: error instanceof Error ? error.message : 'Order loading failed',
      })
    } finally {
      setRealLoading(false)
    }
  }

  useEffect(() => {
    void loadOrders()
    void loadRealOrders()
  }, [])

  return (
    <main className="content-grid">
      {realOrders.map((order) => (
        <div key={order.id}>
          <div>{order.id}</div>
          <div>{order.status}</div>
          <div>{formatDate(order.createdAt)}</div>
          <div>{formatDate(order.scheduledTime)}</div>
          <div>{formatCents(order.orderItems.reduce((sum, item) => sum + item.priceCents * item.quantity, 0), 'AUD')}</div>
        </div>
      ))}
    </main>
  )
}