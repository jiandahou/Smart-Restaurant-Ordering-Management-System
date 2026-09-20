import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'

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
  // Not read during render: a tab restored from the back/forward cache, or one whose network died
  // before this mounted, is already offline and there would be no event to catch up on.
  const [offline, setOffline] = useState(() =>
    typeof navigator !== 'undefined' && navigator.onLine === false,
  )

  useEffect(() => {
    const goOffline = () => setOffline(true)
    const goOnline = () => setOffline(false)

    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    // The events are edge-triggered, so a change between the initial read and this subscription
    // would otherwise be missed.
    setOffline(navigator.onLine === false)

    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

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
