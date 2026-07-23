import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

// Indices align with orderStatusOptions in OrderStatusBadge:
// 0 Pending, 1 Accepted, 2 Preparing, 3 Ready, 4 Completed, 5 Cancelled, 6 Rejected.
const progressSteps = ['Pending', 'Accepted', 'Preparing', 'Ready', 'Completed'] as const

/**
 * Compact horizontal progress indicator for a customer's order, driven purely by
 * the numeric order status. Cancelled/Rejected orders render a terminal state
 * instead of the progress track. Colours use theme tokens so it works in light
 * and dark mode.
 */
export function OrderProgressStepper({
  status,
  className,
}: {
  status: number
  className?: string
}) {
  if (status === 5 || status === 6) {
    const label = status === 5 ? 'Order cancelled' : 'Order rejected'
    return (
      <div
        role="status"
        className={cn(
          'rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive',
          className,
        )}
      >
        {label}
      </div>
    )
  }

  const activeIndex = Math.min(Math.max(status, 0), progressSteps.length - 1)

  return (
    <ol className={cn('flex items-start gap-1', className)} aria-label="Order progress">
      {progressSteps.map((step, index) => {
        const isComplete = index < activeIndex
        const isCurrent = index === activeIndex

        return (
          <li
            key={step}
            className="flex flex-1 flex-col items-center gap-1 text-center"
            aria-current={isCurrent ? 'step' : undefined}
          >
            <div className="flex w-full items-center">
              <span
                className={cn(
                  'h-0.5 flex-1',
                  index === 0 ? 'opacity-0' : isComplete || isCurrent ? 'bg-primary' : 'bg-border',
                )}
              />
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold',
                  isComplete
                    ? 'border-primary bg-primary text-primary-foreground'
                    : isCurrent
                      ? 'border-primary text-primary'
                      : 'border-border text-muted-foreground',
                )}
              >
                {isComplete ? <Check size={12} /> : index + 1}
              </span>
              <span
                className={cn(
                  'h-0.5 flex-1',
                  index === progressSteps.length - 1 ? 'opacity-0' : isComplete ? 'bg-primary' : 'bg-border',
                )}
              />
            </div>
            <span
              className={cn(
                'text-[11px] leading-tight',
                isCurrent ? 'font-semibold text-foreground' : 'text-muted-foreground',
              )}
            >
              {step}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
