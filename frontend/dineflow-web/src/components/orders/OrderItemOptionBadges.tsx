import { Badge } from '../ui/badge'

export type OrderItemOptionSnapshot = {
  id: string
  menuItemOptionId: string | null
  groupNameSnapshot: string
  optionNameSnapshot: string
  priceAdjustmentSnapshot: number
  quantity?: number | null
}

type OrderItemOptionBadgesProps = {
  options?: OrderItemOptionSnapshot[] | null
  currency?: string | null
}

function formatOptionAdjustment(amount: number, currencyCode?: string | null) {
  if (amount === 0) {
    return 'Included'
  }

  const formatted = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: (currencyCode || 'AUD').toUpperCase(),
  }).format(Math.abs(amount))

  return amount > 0 ? `+${formatted}` : `-${formatted}`
}

function groupOptions(options: OrderItemOptionSnapshot[]) {
  const groups = new Map<string, OrderItemOptionSnapshot[]>()

  for (const option of options) {
    const groupName = option.groupNameSnapshot?.trim() || 'Options'
    groups.set(groupName, [...(groups.get(groupName) ?? []), option])
  }

  return Array.from(groups, ([groupName, groupOptions]) => ({
    groupName,
    options: groupOptions,
  }))
}

export function OrderItemOptionBadges({ options, currency }: OrderItemOptionBadgesProps) {
  if (!options?.length) {
    return null
  }

  return (
    <div className="order-item-options">
      {groupOptions(options).map((group) => (
        <div key={group.groupName} className="order-item-option-group">
          <span className="order-item-option-group-name">{group.groupName}</span>
          {group.options.map((option, index) => {
            const quantity = option.quantity ?? 1
            const adjustment = option.priceAdjustmentSnapshot * quantity
            const optionName = option.optionNameSnapshot?.trim() || 'Option'

            return (
              <Badge
                key={`${option.id || option.menuItemOptionId || optionName}-${index}`}
                variant="outline"
                className="order-item-option-pill"
              >
                <span>{optionName}</span>
                {quantity > 1 ? <span className="order-item-option-quantity">x{quantity}</span> : null}
                <span className="order-item-option-price">
                  {formatOptionAdjustment(adjustment, currency)}
                </span>
              </Badge>
            )
          })}
        </div>
      ))}
    </div>
  )
}
