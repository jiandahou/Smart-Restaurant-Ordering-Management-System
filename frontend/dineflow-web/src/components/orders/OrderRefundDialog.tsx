import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { AdminOrder, PaymentEnvironment, RefundOrderRequest } from '../../api/auth'
import { canConfirmDirectRefund } from './directRefundConfirmation'
import { parseRefundAmountCents } from './refundAmount'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'

function formatPaymentAmount(amountCents: number, currencyCode?: string | null) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: (currencyCode || 'AUD').toUpperCase(),
  }).format(amountCents / 100)
}

type ItemDraft = {
  selected: boolean
  quantity: number
  amount: string
}

export type RefundMode = 'full' | 'partial'

export function OrderRefundDialog({
  order,
  environmentMode,
  reason,
  mode,
  amount,
  submitting,
  onReasonChange,
  onModeChange,
  onAmountChange,
  onOpenChange,
  onConfirm,
}: {
  order: AdminOrder | null
  environmentMode: PaymentEnvironment['mode'] | null
  reason: string
  mode: RefundMode
  /** An explicitly unattributed service credit or other general adjustment. */
  amount: string
  submitting: boolean
  onReasonChange: (value: string) => void
  onModeChange: (mode: RefundMode) => void
  onAmountChange: (value: string) => void
  onOpenChange: (open: boolean) => void
  onConfirm: (payload: RefundOrderRequest) => void
}) {
  const [drafts, setDrafts] = useState<Record<string, ItemDraft>>({})
  const [confirmation, setConfirmation] = useState('')
  const refundableAmountCents = order?.latestPayment?.refundableAmountCents ?? 0
  const currency = order?.latestPayment?.currency ?? order?.currency

  useEffect(() => {
    // Resets the per-item drafts when a different order is opened. One extra render on mount, not a stale value.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrafts(Object.fromEntries((order?.items ?? []).map((item) => [
      item.id,
      {
        selected: false,
        quantity: Math.max(1, item.refundableQuantity),
        amount: (item.refundableAmountCents / 100).toFixed(2),
      },
    ])))
    setConfirmation('')
  }, [order])

  const isLive = environmentMode === 'Live'
  const environmentAllowsConfirmation = canConfirmDirectRefund(
    order?.orderNumber,
    environmentMode,
    confirmation,
  )

  const partialItems = useMemo(() => (order?.items ?? []).flatMap((item) => {
    const draft = drafts[item.id]
    if (!draft?.selected) {
      return []
    }

    const amountCents = parseRefundAmountCents(draft.amount)
    const unitPriceCents = Math.round(item.unitPrice * 100)
    if (
      amountCents === null
      || amountCents <= 0
      || amountCents > item.refundableAmountCents
      || draft.quantity <= 0
      || draft.quantity > item.refundableQuantity
      || amountCents > unitPriceCents * draft.quantity
    ) {
      return []
    }

    return [{ orderItemId: item.id, quantity: draft.quantity, amountCents }]
  }), [drafts, order])

  const selectedCount = Object.values(drafts).filter((draft) => draft.selected).length
  const generalAdjustmentAmountCents = parseRefundAmountCents(amount) ?? 0
  const partialItemTotalCents = partialItems.reduce((total, item) => total + item.amountCents, 0)
  const partialTotalCents = partialItemTotalCents + generalAdjustmentAmountCents
  const partialIsValid = selectedCount === partialItems.length
    && partialTotalCents > 0
    && partialTotalCents <= refundableAmountCents

  const buildFullPayload = (): RefundOrderRequest => {
    let remaining = refundableAmountCents
    const items = (order?.items ?? []).flatMap((item) => {
      const itemAmount = Math.min(item.refundableAmountCents, remaining)
      if (itemAmount <= 0) {
        return []
      }

      const unitPriceCents = Math.max(1, Math.round(item.unitPrice * 100))
      const quantity = Math.max(
        1,
        Math.min(item.refundableQuantity || item.quantity, Math.ceil(itemAmount / unitPriceCents)),
      )
      remaining -= itemAmount
      return [{ orderItemId: item.id, quantity, amountCents: itemAmount }]
    })

    return {
      reason: reason.trim() || undefined,
      amountCents: refundableAmountCents,
      generalAdjustmentAmountCents: remaining > 0 ? remaining : undefined,
      items,
    }
  }

  const submit = () => {
    if (mode === 'full') {
      onConfirm(buildFullPayload())
      return
    }

    onConfirm({
      reason: reason.trim() || undefined,
      amountCents: partialTotalCents,
      generalAdjustmentAmountCents: generalAdjustmentAmountCents > 0
        ? generalAdjustmentAmountCents
        : undefined,
      items: partialItems,
    })
  }

  return (
    <Dialog open={order !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>Refund order</DialogTitle>
            <Badge
              variant={isLive ? 'destructive' : 'outline'}
              className={environmentMode === 'Test' ? 'payment-environment-test' : undefined}
            >
              Stripe {environmentMode ?? 'Checking'}
            </Badge>
          </div>
          <DialogDescription>
            {order
              ? `Allocate up to ${formatPaymentAmount(refundableAmountCents, currency)} to the exact items being refunded for ${order.orderNumber}.`
              : 'Refund this order to the original Stripe payment.'}
          </DialogDescription>
        </DialogHeader>

        {isLive ? (
          <div className="flex gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm" role="alert">
            <AlertTriangle className="mt-0.5 shrink-0 text-destructive" size={18} />
            <div className="space-y-1">
              <strong className="block">This sends real money back immediately</strong>
              <span>A successful live Stripe refund is irreversible. Verify the order and amount before continuing.</span>
            </div>
          </div>
        ) : null}

        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant={mode === 'full' ? 'default' : 'outline'} aria-pressed={mode === 'full'} disabled={submitting} onClick={() => onModeChange('full')}>
              Refund remaining balance
            </Button>
            <Button type="button" size="sm" variant={mode === 'partial' ? 'default' : 'outline'} aria-pressed={mode === 'partial'} disabled={submitting} onClick={() => onModeChange('partial')}>
              Choose items
            </Button>
          </div>

          {mode === 'full' ? (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              All remaining item balances will be recorded against their items. Any genuine difference is clearly recorded as a general adjustment.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                {(order?.items ?? []).map((item) => {
                  const draft = drafts[item.id]
                  const disabled = item.refundableAmountCents <= 0
                  return (
                    <div key={item.id} className="rounded-lg border p-3">
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1 size-4 accent-primary"
                          checked={draft?.selected ?? false}
                          disabled={submitting || disabled}
                          onChange={(event) => setDrafts((current) => ({
                            ...current,
                            [item.id]: { ...current[item.id], selected: event.target.checked },
                          }))}
                          aria-label={`Refund ${item.itemNameSnapshot}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap justify-between gap-2">
                            <span className="font-semibold">{item.itemNameSnapshot}</span>
                            <span className="text-muted-foreground">
                              {disabled
                                ? 'Fully allocated'
                                : `${formatPaymentAmount(item.refundableAmountCents, currency)} available`}
                            </span>
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <label className="space-y-1 text-xs font-medium">
                              Quantity
                              <Input
                                type="number"
                                min="1"
                                max={Math.max(1, item.refundableQuantity)}
                                step="1"
                                value={draft?.quantity ?? 1}
                                disabled={submitting || disabled || !draft?.selected}
                                onChange={(event) => setDrafts((current) => ({
                                  ...current,
                                  [item.id]: { ...current[item.id], quantity: Number(event.target.value) },
                                }))}
                              />
                            </label>
                            <label className="space-y-1 text-xs font-medium">
                              Item refund
                              <Input
                                type="number"
                                min="0.01"
                                max={(item.refundableAmountCents / 100).toFixed(2)}
                                step="0.01"
                                inputMode="decimal"
                                value={draft?.amount ?? ''}
                                disabled={submitting || disabled || !draft?.selected}
                                onChange={(event) => setDrafts((current) => ({
                                  ...current,
                                  [item.id]: { ...current[item.id], amount: event.target.value },
                                }))}
                              />
                            </label>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="space-y-1 rounded-lg border border-dashed p-3">
                <label className="text-sm font-semibold" htmlFor="refund-adjustment">General adjustment (optional)</label>
                <Input id="refund-adjustment" type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(event) => onAmountChange(event.target.value)} disabled={submitting} placeholder="0.00" />
                <p className="text-xs text-muted-foreground">Use only for a service credit, delivery fee, tip, or another amount that does not belong to one item.</p>
              </div>

              <div className="flex justify-between rounded-lg bg-muted/40 p-3 font-semibold">
                <span>Refund total</span>
                <span>{formatPaymentAmount(partialTotalCents, currency)}</span>
              </div>
              {partialTotalCents > refundableAmountCents ? (
                <p className="text-sm text-destructive">The allocation exceeds the refundable balance.</p>
              ) : null}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold" htmlFor="refund-reason">Refund reason</label>
          <Textarea id="refund-reason" rows={3} value={reason} onChange={(event) => onReasonChange(event.target.value)} placeholder="Optional note for the refund record" disabled={submitting} maxLength={1000} />
          <p className="text-xs text-muted-foreground">Stripe receives the total; DineFlow keeps this item allocation for reconciliation and audit.</p>
        </div>

        {isLive && order ? (
          <div className="space-y-2">
            <label className="text-sm font-semibold" htmlFor="direct-refund-confirmation">
              Type {order.orderNumber} to confirm this live refund
            </label>
            <Input
              id="direct-refund-confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              disabled={submitting}
            />
          </div>
        ) : null}

        {environmentMode === 'Unconfigured' ? (
          <p className="text-sm text-destructive">Stripe is not configured. Direct refunds are disabled.</p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>Keep payment</Button>
          <Button type="button" variant="destructive" disabled={submitting || !order || !environmentAllowsConfirmation || refundableAmountCents <= 0 || (mode === 'partial' && !partialIsValid)} onClick={submit}>
            {submitting ? 'Refunding' : 'Confirm refund'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
