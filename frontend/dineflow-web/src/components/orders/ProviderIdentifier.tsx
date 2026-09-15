import { Copy } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { compactIdentifier } from '@/lib/providerIdentifier'

/**
 * A Stripe identifier, shortened to fit and copied in full.
 *
 * <p>
 * Lived inside the payments page, so every other screen printed the raw 66-character id and let it
 * dominate the row. Shared now for the ordinary reason: the same fact rendered two ways in one
 * product teaches people that one of the two is unreliable, and they cannot tell which.
 * </p>
 */
export function ProviderIdentifier({
  value,
  fallback,
  label,
}: {
  value?: string | null
  fallback: string
  label: string
}) {
  if (!value) {
    return <span className="table-subtext">{fallback}</span>
  }

  return (
    <span className="payment-identifier">
      {/* The full value stays on the element, so hovering and assistive technology both get it. */}
      <code title={value}>{compactIdentifier(value)}</code>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Copy ${label}`}
        onClick={(event) => {
          event.stopPropagation()
          // Whole, never the shortened form: an abbreviated id on the clipboard is a trap.
          void navigator.clipboard.writeText(value)
            .then(() => toast.success(`${label} copied`))
            .catch(() => toast.error(`Could not copy ${label}`))
        }}
      >
        <Copy size={13} />
      </Button>
    </span>
  )
}
