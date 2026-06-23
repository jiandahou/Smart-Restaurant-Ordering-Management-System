import type { AdminOrder } from '../api/auth'

const activeOrderStatuses = new Set(['Pending', 'Accepted', 'Preparing', 'Ready'])

export function isOrderPayable(order: AdminOrder) {
  if (order.paymentStatus === 'Paid' || order.paymentMethod !== 'Online') {
    return false
  }

  return !['Cancelled', 'Rejected'].includes(order.status)
}

export function getOrderStats(orders: AdminOrder[]) {
  return {
    total: orders.length,
    activeKitchen: orders.filter((order) => activeOrderStatuses.has(order.status)).length,
    paid: orders.filter((order) => order.paymentStatus === 'Paid').length,
    pendingPayment: orders.filter((order) => order.paymentStatus === 'Pending').length,
    failedPayment: orders.filter((order) => order.paymentStatus === 'Failed').length,
    payable: orders.filter(isOrderPayable).length,
    revenue: orders
      .filter((order) => order.paymentStatus === 'Paid')
      .reduce((total, order) => total + order.totalAmount, 0),
  }
}
