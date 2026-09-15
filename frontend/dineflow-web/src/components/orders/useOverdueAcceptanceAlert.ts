import { useEffect, useRef } from 'react'
import type { AdminOrder } from '@/api/auth'
import { acceptanceUrgency } from '@/lib/orderAcceptance'
import { useRestaurantPrinting } from '@/printing/RestaurantPrintingContext'

/**
 * FS-017. The new-order chime sounds once, when the order arrives. If nobody was near the screen
 * at that moment the order can sit paid and unaccepted in silence — which is the failure this
 * ticket describes.
 *
 * The repeat uses the overdue alert, not the arrival chime: replaying the arrival sound would tell
 * the kitchen another order had come in, which is the opposite of what is happening.
 *
 * Deliberately one repeat per interval no matter how many orders are overdue: the alert exists to
 * pull someone back to the screen, not to fill the kitchen with noise.
 */
export const overdueAlertIntervalMs = 60_000

export function useOverdueAcceptanceAlert(orders: readonly AdminOrder[]): void {
  const { playOverdueAlertSound } = useRestaurantPrinting()
  const ordersRef = useRef(orders)

  // Kept in a ref so the interval below is created once rather than restarted on every refresh
  // of the order list, which would reset the alert cadence each time the page polls.
  useEffect(() => {
    ordersRef.current = orders
  }, [orders])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const hasOverdue = ordersRef.current.some(
        (order) => acceptanceUrgency(order) === 'overdue',
      )

      if (hasOverdue) {
        playOverdueAlertSound()
      }
    }, overdueAlertIntervalMs)

    return () => window.clearInterval(timer)
  }, [playOverdueAlertSound])
}
