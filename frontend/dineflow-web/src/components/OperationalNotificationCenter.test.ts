import { describe, expect, it } from 'vitest'
import { sortOperationalNotices, type OperationalNotice } from './OperationalNotificationCenter'

describe('sortOperationalNotices', () => {
  it('prioritises blocking and degraded operational notices over success history', () => {
    const notices: OperationalNotice[] = [
      { id: 'success', severity: 'success', title: 'Accepted', message: 'Order 002 accepted.', createdAt: 3 },
      { id: 'warning', severity: 'warning', title: 'Printer offline', message: 'Printing paused.', createdAt: 2 },
      { id: 'error', severity: 'error', title: 'Stripe unavailable', message: 'Online payments disabled.', createdAt: 1 },
    ]

    expect(sortOperationalNotices(notices).map((notice) => notice.id)).toEqual(['error', 'warning', 'success'])
  })

  it('shows the newest notice first within the same severity', () => {
    const notices: OperationalNotice[] = [
      { id: 'older', severity: 'success', title: 'Older', message: 'Older event.', createdAt: 1 },
      { id: 'newer', severity: 'success', title: 'Newer', message: 'Newer event.', createdAt: 2 },
    ]

    expect(sortOperationalNotices(notices).map((notice) => notice.id)).toEqual(['newer', 'older'])
  })
})
