import { Badge } from '../ui/badge'
import { buildPlateDisclosure, formatAllergenLines } from '../../lib/allergenDisclosure'

export type OrderItemOptionSnapshot = {
  id: string
  menuItemOptionId: string | null
  groupNameSnapshot: string
  optionNameSnapshot: string
  priceAdjustmentSnapshot: number
  quantity?: number | null
  /** The modifier's allergen declaration, frozen when the order was placed. */
  allergensSnapshot?: string | null
  mayContainAllergensSnapshot?: string | null
  crossContactStatementSnapshot?: string | null
}

/** The dish's own declaration, frozen when the order was placed. */
export type OrderItemDisclosureSnapshot = {
  allergensSnapshot?: string | null
  mayContainAllergensSnapshot?: string | null
  crossContactStatementSnapshot?: string | null
}

type OrderItemOptionBadgesProps = {
  options?: OrderItemOptionSnapshot[] | null
  currency?: string | null
  /**
   * The order line itself. Supplied where the view should show the whole plate's declaration
   * rather than only what the modifiers added — a dish that declares peanut on its own is not less
   * important than a sauce that does.
   */
  item?: OrderItemDisclosureSnapshot | null
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

export function OrderItemOptionBadges({ options, currency, item }: OrderItemOptionBadgesProps) {
  // The dish can declare something even when nothing was added to it, so the disclosure is built
  // before the early return rather than after it.
  const disclosure = buildPlateDisclosure({
    allergens: item?.allergensSnapshot,
    mayContainAllergens: item?.mayContainAllergensSnapshot,
    crossContactStatement: item?.crossContactStatementSnapshot,
  }, (options ?? []).map((option) => ({
    name: option.optionNameSnapshot?.trim() || 'Option',
    allergens: option.allergensSnapshot,
    mayContainAllergens: option.mayContainAllergensSnapshot,
    crossContactStatement: option.crossContactStatementSnapshot,
  })))

  const declaration = [
    formatAllergenLines(disclosure.allergens) && `Contains ${formatAllergenLines(disclosure.allergens)}`,
    formatAllergenLines(disclosure.mayContain) && `may contain ${formatAllergenLines(disclosure.mayContain)}`,
    formatAllergenLines(disclosure.crossContact),
  ].filter(Boolean).join(' - ')

  if (!options?.length) {
    // No modifiers, but the dish's own declaration is still worth showing on the order.
    return declaration ? <p className="order-item-option-allergens">{declaration}</p> : null
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
      {declaration ? <p className="order-item-option-allergens">{declaration}</p> : null}
    </div>
  )
}
