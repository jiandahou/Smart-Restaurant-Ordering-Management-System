import { useSyncExternalStore } from 'react'
import { WifiOff } from 'lucide-react'

function subscribe(onChange: () => void) {
  window.addEventListener('offline', onChange)
  window.addEventListener('online', onChange)

  return () => {
    window.removeEventListener('offline', onChange)
    window.removeEventListener('online', onChange)
  }
}

/**
 * Read rather than remembered, so there is no stored copy to go stale.
 *
 * <p>
 * `online`/`offline` are edge-triggered: a tab restored from the back/forward cache, or one whose
 * network died before this mounted, never fires one and would otherwise sit there claiming to be
 * connected. Keeping the browser's own flag as the source of truth covers that without a state
 * copy, and React re-reads it after subscribing, so a change in the gap between the first render
 * and the subscription cannot be missed either.
 * </p>
 */
const isOffline = () => navigator.onLine === false

/** Nothing is offline before there is a browser to ask. */
const isOfflineOnServer = () => false

/**
 * Says so, persistently, while the browser has no network.
 *
 * <p>
 * Tested on a real table QR page with the tab offline for five minutes: the menu still rendered,
 * every tap failed, and nothing anywhere on the page said why. A diner whose phone hits a dead spot
 * in the venue — or a venue whose Wi-Fi blinks — sees an app that looks fine and simply refuses to
 * work. Staff tablets have the same problem, so this sits above the router rather than inside the
 * customer pages.
 * </p>
 * <p>
 * It deliberately promises nothing about the cart. The cart lives on the server, so what is on
 * screen is the last state fetched, and claiming it is "saved" would be a guess. What can be
 * promised is that nothing is being sent, which is what makes retrying safe.
 * </p>
 */
export function OfflineNotice() {
  const offline = useSyncExternalStore(subscribe, isOffline, isOfflineOnServer)

  if (!offline) {
    return null
  }

  return (
    <section className="offline-notice" role="status" aria-live="polite">
      <span className="offline-notice-icon"><WifiOff size={16} aria-hidden="true" /></span>
      <div>
        <strong>You are offline</strong>
        <span>
          Nothing is being sent while the connection is down, so nothing has been half-ordered.
          Reconnect and try again.
        </span>
      </div>
    </section>
  )
}
