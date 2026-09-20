import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfflineNotice } from './OfflineNotice'

/**
 * Losing the network said nothing at all.
 *
 * <p>
 * Tested on a real table QR page with the tab offline for five minutes: the menu still rendered,
 * every tap failed, and no wording anywhere on the page mentioned the connection. This covers the
 * cases that produced that: the tab that was already offline before the component mounted, and the
 * ordinary drop and recovery.
 * </p>
 */
describe('OfflineNotice', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    setOnLine(true)
  })

  function setOnLine(value: boolean) {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
  }

  function fire(event: 'online' | 'offline') {
    act(() => {
      window.dispatchEvent(new Event(event))
    })
  }

  it('says nothing while the network is up', () => {
    setOnLine(true)
    render(<OfflineNotice />)

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('tells the customer when the connection drops', () => {
    setOnLine(true)
    render(<OfflineNotice />)

    setOnLine(false)
    fire('offline')

    expect(screen.getByRole('status')).toHaveTextContent(/you are offline/i)
  })

  /**
   * The events are edge-triggered. A tab restored from the back/forward cache, or one whose network
   * died before this mounted, never sees the transition and would stay silent forever.
   */
  it('shows straight away when it mounts into a tab that is already offline', () => {
    setOnLine(false)
    render(<OfflineNotice />)

    expect(screen.getByRole('status')).toHaveTextContent(/you are offline/i)
  })

  it('takes the notice away once the connection is back', () => {
    setOnLine(false)
    render(<OfflineNotice />)
    expect(screen.getByRole('status')).toBeInTheDocument()

    setOnLine(true)
    fire('online')

    expect(screen.queryByRole('status')).toBeNull()
  })

  /**
   * It must not claim the cart is kept. The cart lives on the server, so what is on screen is the
   * last state fetched; what can honestly be promised is that nothing is being sent.
   */
  it('promises only that nothing was sent', () => {
    setOnLine(false)
    render(<OfflineNotice />)

    const notice = screen.getByRole('status')
    expect(notice).toHaveTextContent(/nothing is being sent/i)
    expect(notice.textContent).not.toMatch(/saved|your order is safe/i)
  })

  it('stops listening when it goes away', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    setOnLine(true)
    const { unmount } = render(<OfflineNotice />)

    unmount()

    const events = remove.mock.calls.map(([name]) => name)
    expect(events).toContain('offline')
    expect(events).toContain('online')
  })
})
