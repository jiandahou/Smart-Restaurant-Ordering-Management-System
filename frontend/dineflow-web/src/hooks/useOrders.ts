import { useState, useCallback } from 'react'

export interface OrderItem {
  id?: string
  orderId?: string
  menuItemId?: string
  quantity: number
  unitPrice: number
  note?: string
  createdAt?: string
  updatedAt?: string
}

export interface Order {
  id?: string
  restaurantId: string
  tableId?: string | null
  customerId?: string | null
  orderNumber: string
  orderType: 0 | 1 | 2 // 0: DineIn, 1: Takeaway, 2: Scheduled
  status: 0 | 1 | 2 | 3 | 4 | 5 | 6 // 0: Pending, 1: Accepted, 2: Preparing, 3: Ready, 4: Completed, 5: Cancelled, 6: Rejected
  totalAmount: number
  customerNote?: string
  scheduledTime?: string | null
  createdAt?: string
  updatedAt?: string
  orderItems?: OrderItem[]
}

export type OrderType = 'DineIn' | 'Takeaway' | 'Scheduled'
export type OrderStatus = 'Pending' | 'Accepted' | 'Preparing' | 'Ready' | 'Completed' | 'Cancelled' | 'Rejected'

const orderTypeLabels: Record<number, OrderType> = {
  0: 'DineIn',
  1: 'Takeaway',
  2: 'Scheduled',
}

const orderStatusLabels: Record<number, OrderStatus> = {
  0: 'Pending',
  1: 'Accepted',
  2: 'Preparing',
  3: 'Ready',
  4: 'Completed',
  5: 'Cancelled',
  6: 'Rejected',
}

interface UseOrdersResult {
  orders: Order[]
  loading: boolean
  error: string | null
  fetchOrders: () => Promise<void>
  createOrder: (order: Order) => Promise<Order | null>
  updateOrder: (id: string, order: Order) => Promise<void>
  deleteOrder: (id: string) => Promise<void>
  getOrderTypeLabel: (type: number) => OrderType
  getStatusLabel: (status: number) => OrderStatus
}

export function useOrders(): UseOrdersResult {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/order')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      setOrders(Array.isArray(data) ? data : [])
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch orders'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [])

  const createOrder = useCallback(async (order: Order): Promise<Order | null> => {
    setError(null)
    try {
      const response = await fetch('/api/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const newOrder = await response.json()
      setOrders((prev) => [...prev, newOrder])
      return newOrder
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create order'
      setError(message)
      return null
    }
  }, [])

  const updateOrder = useCallback(async (id: string, order: Order) => {
    setError(null)
    try {
      const response = await fetch(`/api/order/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setOrders((prev) => prev.map((o) => (o.id === id ? order : o)))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update order'
      setError(message)
    }
  }, [])

  const deleteOrder = useCallback(async (id: string) => {
    setError(null)
    try {
      const response = await fetch(`/api/order/${id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setOrders((prev) => prev.filter((o) => o.id !== id))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete order'
      setError(message)
    }
  }, [])

  return {
    orders,
    loading,
    error,
    fetchOrders,
    createOrder,
    updateOrder,
    deleteOrder,
    getOrderTypeLabel: (type: number) => orderTypeLabels[type] || 'Unknown',
    getStatusLabel: (status: number) => orderStatusLabels[status] || 'Unknown',
  }
}
