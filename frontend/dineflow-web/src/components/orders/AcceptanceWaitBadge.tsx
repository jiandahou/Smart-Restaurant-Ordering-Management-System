import { useEffect, useState } from 'react'
import { Clock3, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { AdminOrder } from '@/api/auth'
import {
  acceptanceUrgency,
  acceptanceWaitMs,
  formatWaitDuration,
  isAwaitingAcceptance,
} from '@/lib/orderAcceptance'

/**
 * FS-017. How long a paid order has been waiting for the restaurant to accept it. A customer has
 * already paid by this point, so the number is the thing that makes an unattended order visible
 * on a busy screen — a static "Pending" badge does not.
 *
 * Ticks on its own so the figure keeps climbing between order refreshes.
 */
export function AcceptanceWaitBadge({
  order,
  className,
}: {
  order: AdminOrder
  className?: string
}) {
  const awaiting = isAwaitingAcceptance(order)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!awaiting) {
      return
    }

    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [awaiting])

  if (!awaiting) {
    return null
  }

  const urgency = acceptanceUrgency(order, now)
  const waited = formatWaitDuration(acceptanceWaitMs(order, now))
  const overdue = urgency === 'overdue'

  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1 tabular-nums',
        overdue
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : urgency === 'approaching'
            ? 'border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100'
            : 'text-muted-foreground',
        className,
      )}
      // Screen readers get the meaning, not just the number.
      aria-label={`Paid ${waited} ago and not yet accepted${overdue ? ' — overdue' : ''}`}
    >
      {overdue ? <TriangleAlert className="size-3.5" aria-hidden /> : <Clock3 className="size-3.5" aria-hidden />}
      {waited}
    </Badge>
  )
}
