import { describe, expect, it, vi } from 'vitest'
import {
  publishOperationalStatusInvalidated,
  subscribeOperationalStatusInvalidated,
} from './operationalNotifications'

describe('operational status invalidation', () => {
  it('notifies active status consumers immediately with the restaurant id', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeOperationalStatusInvalidated(listener)

    publishOperationalStatusInvalidated('restaurant-1')
    expect(listener).toHaveBeenCalledWith('restaurant-1')

    unsubscribe()
    publishOperationalStatusInvalidated('restaurant-2')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
