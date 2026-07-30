import { describe, expect, it } from 'vitest'
import type { AdminOrder } from '../api/auth'
import {
  adminOrderTransitionNeedsConfirmation,
  getAdminOrderArrayValue,
  getAdminOrderPage,
  getAdminOrderPageSize,
  splitAdminOrderActions,
} from './adminOrderManagement'

function order(overrides: Partial<AdminOrder> = {}): AdminOrder {
  return {
    id: 'order-1',
    restaurantId: 'restaurant-1',
    restaurantName: 'Central Market Table',
    tableId: null,
    tableNumber: null,
    customerId: null,
    customerName: 'Jane Smith',
    customerEmail: 'jane@example.com',
    orderNumber: 'ORD-1001',
    pickupDate: null,
    pickupNumber: null,
    pickupCode: null,
    tableSessionId: null,
    orderType: 'Takeaway',
    status: 'Pending',
    paymentStatus: 'Paid',
    paymentMethod: 'Stripe',
    canProcess: true,
    availableActions: ['Accept', 'MarkReady', 'Complete', 'Reject', 'Cancel'],
    totalAmount: 42,
    currency: 'AUD',
    customerNote: null,
    scheduledTime: null,
    createdAt: '2026-07-28T00:00:00Z',
    updatedAt: '2026-07-28T00:00:00Z',
    paymentAttempts: 1,
    latestPayment: null,
    items: [],
    ...overrides,
  } as AdminOrder
}

describe('admin order management helpers', () => {
  it('keeps only the expected workflow step prominent', () => {
    expect(splitAdminOrderActions(order())).toEqual({
      primary: 'Accept',
      secondary: ['MarkReady', 'Complete', 'Reject', 'Cancel'],
    })
  })

  it('requires confirmation for completing and skipping pending workflow steps', () => {
    const pending = order()
    const ready = order({ status: 'Ready', availableActions: ['Complete', 'Cancel'] })

    expect(adminOrderTransitionNeedsConfirmation(pending, 'MarkReady')).toBe(true)
    expect(adminOrderTransitionNeedsConfirmation(pending, 'Complete')).toBe(true)
    expect(adminOrderTransitionNeedsConfirmation(ready, 'Complete')).toBe(true)
    expect(adminOrderTransitionNeedsConfirmation(pending, 'Accept')).toBe(false)
  })

  it('sanitises URL-backed paging and enum values', () => {
    expect(getAdminOrderPage('3')).toBe(3)
    expect(getAdminOrderPage('-2')).toBe(1)
    expect(getAdminOrderPageSize('50')).toBe(50)
    expect(getAdminOrderPageSize('500')).toBe(20)
    expect(getAdminOrderArrayValue('Paid', ['all', 'Paid'] as const, 'all')).toBe('Paid')
    expect(getAdminOrderArrayValue('Unknown', ['all', 'Paid'] as const, 'all')).toBe('all')
  })
})
