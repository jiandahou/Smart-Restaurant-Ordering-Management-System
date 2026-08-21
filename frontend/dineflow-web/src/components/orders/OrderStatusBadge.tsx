import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export const orderStatusOptions = [
  'Pending',
  'Accepted',
  'Preparing',
  'Ready',
  'Completed',
  'Cancelled',
  'Rejected',
] as const

const orderStatusClasses: Record<string, string> = {
  Pending: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
  Accepted: 'border-blue-300 bg-blue-100 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200',
  Preparing: 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
  Ready: 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  Completed: 'border-green-400 bg-green-700 text-white dark:border-green-700 dark:bg-green-800 dark:text-green-50',
  Cancelled: 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200',
  Rejected: 'border-destructive/30 bg-destructive/10 text-destructive',
}

function normalizeOrderStatus(status: string | number) {
  return typeof status === 'number' ? orderStatusOptions[status] ?? 'Unknown' : status
}

export function getOrderStatusLabel(status: string | number) {
  return normalizeOrderStatus(status)
}

export function OrderStatusBadge({
  status,
  paymentStatus,
  className,
}: {
  status: string | number
  /**
   * Optional, and worth passing wherever it is known: `Pending` means "waiting for the customer to
   * pay" before settlement and "waiting for the restaurant to accept" after it, and the two need
   * opposite responses from whoever is reading the screen.
   */
  paymentStatus?: string
  className?: string
}) {
  const normalizedStatus = normalizeOrderStatus(status)
  const awaitingAcceptance = normalizedStatus === 'Pending'
    && (paymentStatus === 'Paid' || paymentStatus === 'PartiallyRefunded')
  const label = normalizedStatus !== 'Pending' || paymentStatus === undefined
    ? normalizedStatus
    : awaitingAcceptance
      ? 'Awaiting acceptance'
      : 'Awaiting payment'

  return (
    <Badge
      variant="outline"
      className={cn(
        awaitingAcceptance
          ? 'border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100'
          : orderStatusClasses[normalizedStatus],
        className,
      )}
      aria-label={`Order status: ${label}`}
    >
      {label}
    </Badge>
  )
}
