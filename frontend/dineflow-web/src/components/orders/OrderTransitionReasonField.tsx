import { useState } from 'react'
import type { OrderTransitionAction } from '@/api/auth'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

const customReasonValue = '__custom__'

const reasonsByAction: Partial<Record<OrderTransitionAction, readonly string[]>> = {
  Reject: [
    'Item is unavailable',
    'Restaurant is unable to fulfil the order',
    'Kitchen is closed',
    'Duplicate order',
    'Payment could not be verified',
    'Customer requested rejection',
  ],
  Cancel: [
    'Customer requested cancellation',
    'Duplicate order',
    'Item is unavailable',
    'Restaurant is unable to fulfil the order',
    'Food safety or allergy concern',
    'Order was created by mistake',
  ],
  Reopen: [
    'Order was closed by mistake',
    'Customer asked to continue the order',
    'Payment issue has been resolved',
    'Kitchen requested the order to be reopened',
    'Additional preparation is required',
  ],
}

export function OrderTransitionReasonField({
  action,
  value,
  onChange,
}: {
  action: OrderTransitionAction
  value: string
  onChange: (value: string) => void
}) {
  const reasons = reasonsByAction[action] ?? []
  const initialSelection = reasons.includes(value) ? value : value ? customReasonValue : ''
  const [selection, setSelection] = useState(initialSelection)

  const handleSelection = (nextSelection: string) => {
    setSelection(nextSelection)
    onChange(nextSelection === customReasonValue ? '' : nextSelection)
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="order-transition-reason">
          Reason
        </label>
        <Select value={selection} onValueChange={handleSelection}>
          <SelectTrigger id="order-transition-reason" aria-label="Select status change reason">
            <SelectValue placeholder="Select a reason" />
          </SelectTrigger>
          <SelectContent position="popper">
            {reasons.map((reason) => (
              <SelectItem key={reason} value={reason}>{reason}</SelectItem>
            ))}
            <SelectItem value={customReasonValue}>Custom reason</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {selection === customReasonValue ? (
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={1000}
          rows={4}
          placeholder="Enter a custom reason"
          aria-label="Custom status change reason"
        />
      ) : null}
    </div>
  )
}
