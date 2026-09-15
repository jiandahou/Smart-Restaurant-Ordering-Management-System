import { describe, expect, it, vi } from 'vitest'

import { beginHostedCheckoutHandoff } from './hostedCheckoutHandoff'

const checkoutUrl = 'https://checkout.stripe.com/c/pay/cs_test_123'

function fakeWindow(openedTab: unknown) {
  return {
    open: vi.fn(() => openedTab),
    location: { assign: vi.fn() },
  } as unknown as Window & { open: ReturnType<typeof vi.fn>; location: { assign: ReturnType<typeof vi.fn> } }
}

function fakeTab() {
  return { location: { assign: vi.fn() }, focus: vi.fn(), close: vi.fn(), closed: false, opener: {} }
}

describe('handing a customer over to hosted Checkout', () => {
  /**
   * The tab has to be claimed while the click is still being handled. Creating the session is an
   * awaited round trip, and a window.open on the far side of it is blocked as an unsolicited popup.
   */
  it('opens the tab immediately, before any URL is known', () => {
    const tab = fakeTab()
    const target = fakeWindow(tab)

    beginHostedCheckoutHandoff(target)

    expect(target.open).toHaveBeenCalledWith('', '_blank')
    expect(tab.location.assign).not.toHaveBeenCalled()
  })

  it('sends the claimed tab to Checkout and leaves this page standing', () => {
    const tab = fakeTab()
    const target = fakeWindow(tab)

    const destination = beginHostedCheckoutHandoff(target).complete(checkoutUrl)

    expect(destination).toBe('new-tab')
    expect(tab.location.assign).toHaveBeenCalledWith(checkoutUrl)
    // The page the customer comes back to when Stripe's expired page strands them.
    expect(target.location.assign).not.toHaveBeenCalled()
  })

  it('severs the opener so the hosted page cannot reach back into DineFlow', () => {
    const tab = fakeTab()

    beginHostedCheckoutHandoff(fakeWindow(tab))

    expect(tab.opener).toBeNull()
  })

  /**
   * A blocked popup must never become a checkout that silently never appears — better to lose the
   * retry panel than the payment.
   */
  it('falls back to this tab when the popup was blocked', () => {
    const target = fakeWindow(null)

    const destination = beginHostedCheckoutHandoff(target).complete(checkoutUrl)

    expect(destination).toBe('same-tab')
    expect(target.location.assign).toHaveBeenCalledWith(checkoutUrl)
  })

  it('falls back to this tab when the customer closed the claimed tab', () => {
    const tab = { ...fakeTab(), closed: true }
    const target = fakeWindow(tab)

    const destination = beginHostedCheckoutHandoff(target).complete(checkoutUrl)

    expect(destination).toBe('same-tab')
    expect(target.location.assign).toHaveBeenCalledWith(checkoutUrl)
    expect(tab.location.assign).not.toHaveBeenCalled()
  })

  it('falls back to this tab when the claimed tab cannot be navigated', () => {
    const tab = fakeTab()
    tab.location.assign = vi.fn(() => {
      throw new Error('cross-origin')
    })
    const target = fakeWindow(tab)

    expect(beginHostedCheckoutHandoff(target).complete(checkoutUrl)).toBe('same-tab')
    expect(target.location.assign).toHaveBeenCalledWith(checkoutUrl)
  })

  it('survives a browser that refuses to open anything at all', () => {
    const target = {
      open: vi.fn(() => {
        throw new Error('popups disabled')
      }),
      location: { assign: vi.fn() },
    } as unknown as Window

    expect(() => beginHostedCheckoutHandoff(target)).not.toThrow()
    expect(beginHostedCheckoutHandoff(target).complete(checkoutUrl)).toBe('same-tab')
  })

  /** A failed session must not leave a blank tab sitting there looking like a broken payment. */
  it('closes the claimed tab when no session could be created', () => {
    const tab = fakeTab()

    beginHostedCheckoutHandoff(fakeWindow(tab)).abort()

    expect(tab.close).toHaveBeenCalled()
    expect(tab.location.assign).not.toHaveBeenCalled()
  })
})
