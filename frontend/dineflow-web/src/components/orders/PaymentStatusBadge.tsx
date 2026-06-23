import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export const paymentStatusOptions = [
  'Unpaid',
  'Pending',
  'Paid',
  'Failed',
  'Refunded',
  'Cancelled',
  'Expired',
  'PartiallyRefunded',
  'NotRequired',
] as const

const paymentStatusLabels: Record<string, string> = {
  Unpaid: 'Unpaid',
  Pending: 'Pending',
  Paid: 'Paid',
  Failed: 'Failed',
  Refunded: 'Refunded',
  Cancelled: 'Cancelled',
  Expired: 'Expired',
  PartiallyRefunded: 'Partially refunded',
  NotRequired: 'Not required',
}

const paymentStatusClasses: Record<string, string> = {
  Unpaid: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
  Pending: 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
  Paid: 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  Failed: 'border-destructive/30 bg-destructive/10 text-destructive',
  Refunded: 'border-blue-300 bg-blue-100 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200',
  PartiallyRefunded: 'border-blue-300 bg-blue-100 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200',
  Cancelled: 'border-slate-300 bg-background text-muted-foreground dark:border-slate-700',
  Expired: 'border-slate-300 bg-background text-muted-foreground dark:border-slate-700',
  NotRequired: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
}

export function getPaymentStatusLabel(status: string) {
  return paymentStatusLabels[status] ?? status
}

export function PaymentStatusBadge({
  status,
  className,
}: {
  status: string
  className?: string
}) {
  return (
    <Badge
      variant="outline"
      className={cn(paymentStatusClasses[status], className)}
      aria-label={`Payment status: ${getPaymentStatusLabel(status)}`}
    >
      {getPaymentStatusLabel(status)}
    </Badge>
  )
}
