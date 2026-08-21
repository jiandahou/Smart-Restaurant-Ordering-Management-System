import { useState } from 'react'
import { CircleCheck, CircleHelp, Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PrinterReadiness } from '@/lib/thermalPrinter'

/**
 * FS-021. "Connected" was the only signal staff had, and it describes the websocket between this
 * page and the QZ desktop app — both on the same machine. It stays green while the laptop is
 * carried away from the shop or the printer is unplugged.
 *
 * This shows the two things that actually answer "will a ticket come out": whether the printer
 * itself answered its last probe, and when a ticket last really reached one.
 */
export function PrinterReadinessPanel({
  readiness,
  lastSuccessfulPrintAt,
  onRecheck,
}: {
  readiness: PrinterReadiness | null
  lastSuccessfulPrintAt: number | null
  onRecheck: () => Promise<unknown>
}) {
  const [checking, setChecking] = useState(false)

  const recheck = async () => {
    setChecking(true)
    try {
      await onRecheck()
    } finally {
      setChecking(false)
    }
  }

  const state = readiness?.state ?? 'unknown'
  const tone = state === 'ready'
    ? 'border-emerald-400/60 bg-emerald-50 text-emerald-900 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-100'
    : state === 'unreachable'
      ? 'border-destructive/40 bg-destructive/10 text-destructive'
      : 'border-amber-400/60 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100'

  const Icon = state === 'ready' ? CircleCheck : state === 'unreachable' ? TriangleAlert : CircleHelp
  const headline = state === 'ready'
    ? 'Printer responded'
    : state === 'unreachable'
      ? 'Printer did not respond'
      : state === 'not-configured'
        ? 'Printer not configured'
        : 'Cannot be checked without printing'

  return (
    <div className={`flex flex-col gap-2 rounded-md border p-2 text-[0.72rem] ${tone}`}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="font-semibold">{headline}</p>
          <p className="opacity-90">{readiness?.detail ?? 'Not checked yet'}</p>
          <p className="mt-1 opacity-80">
            {/* The one piece of positive evidence: a connection proves nothing, a printed ticket
                proves the whole chain worked. */}
            Last ticket actually printed:{' '}
            {lastSuccessfulPrintAt === null
              ? 'not since this page was opened'
              : new Date(lastSuccessfulPrintAt).toLocaleTimeString()}
          </p>
        </div>
      </div>
      <Button type="button" variant="outline" size="sm" disabled={checking} onClick={() => void recheck()}>
        {checking ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw size={14} />}
        {checking ? 'Checking the printer' : 'Check the printer now'}
      </Button>
    </div>
  )
}
