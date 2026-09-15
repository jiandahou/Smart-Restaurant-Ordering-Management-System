/**
 * Handing a customer over to Stripe's hosted Checkout page without stranding them.
 *
 * <p>
 * Checkout sessions expire, and Stripe's expired page is a dead end: it says "You're all done here —
 * you've either completed your payment or this checkout session has timed out" and offers no link
 * back to the restaurant and no way to try again. Nothing we send in the session changes that page;
 * `after_expiration.recovery` only attaches a recovery URL to the API object for us to deliver
 * ourselves, and it does so by minting a second payable session that our own retry path knows
 * nothing about — two live sessions for one order.
 * </p>
 *
 * <p>
 * So the fix is not to decorate Stripe's dead end but to avoid replacing the only page that has a
 * way out. We send Checkout to its own tab and leave DineFlow standing in this one, still showing
 * the order and a retry button. A customer who meets the expired page closes it and is already back.
 * </p>
 */

/** Where the customer actually ended up, because a blocked popup has to be honoured. */
export type HandoffDestination = 'new-tab' | 'same-tab'

export type HostedCheckoutHandoff = {
  /**
   * Sends the waiting tab to the hosted page.
   *
   * <p>
   * Returns `same-tab` when no tab could be opened — a blocked popup must not become a checkout
   * that silently never appears, so this navigates the current page instead. The caller needs the
   * answer to decide whether it still has a page to draw a retry panel on.
   * </p>
   */
  complete: (url: string) => HandoffDestination
  /** The session could not be created. Closes the waiting tab so no blank one is left behind. */
  abort: () => void
}

/**
 * Opens the tab that will receive the hosted page.
 *
 * <p>
 * Must be called synchronously inside the click handler. Browsers only allow `window.open` while a
 * user gesture is still being handled, and creating a Checkout session is an awaited round trip —
 * opening afterwards is blocked. So the tab is claimed first and pointed at the URL once we have it.
 * </p>
 */
export function beginHostedCheckoutHandoff(target: Window = window): HostedCheckoutHandoff {
  // Deliberately not 'noopener': that makes window.open return null, and the handle is the whole
  // point. The opener reference is severed below instead, before anything is loaded into the tab.
  let opened: Window | null = null

  try {
    opened = target.open('', '_blank')
  } catch {
    opened = null
  }

  if (opened) {
    try {
      opened.opener = null
    } catch {
      // Some browsers refuse the assignment. The tab still only ever loads Stripe's own URL.
    }
  }

  return {
    complete(url: string): HandoffDestination {
      if (!opened || opened.closed) {
        target.location.assign(url)
        return 'same-tab'
      }

      try {
        opened.location.assign(url)
        opened.focus()
        return 'new-tab'
      } catch {
        // The tab is there but unreachable. Better a same-tab checkout than no checkout at all.
        target.location.assign(url)
        return 'same-tab'
      }
    },
    abort() {
      try {
        opened?.close()
      } catch {
        // Nothing to do: an un-closable blank tab is harmless next to a lost error message.
      }
    },
  }
}
