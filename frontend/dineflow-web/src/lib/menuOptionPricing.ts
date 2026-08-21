/**
 * What an option does to the price of a plate, written once for both sides of the app.
 *
 * <p>
 * The rules used to be spelled out at three separate call sites, each as a chain of `if`s ending in
 * a fallthrough that meant "add". That fallthrough is what made an unrecognised adjustment type
 * dangerous: a stored type of 99 reached the customer's browser, missed every `if`, and was shown
 * and totalled as a A$1.00 surcharge — while the server's own switch had a default that ignored it
 * and charged nothing. The row was the same; only the reader differed.
 * </p>
 *
 * <p>
 * The server now refuses to store a type it has no rule for, and its calculator throws rather than
 * guess. These functions do the matching thing: they name the three types explicitly and treat
 * anything else as unpriceable rather than quietly picking a meaning for it.
 * </p>
 */

export const optionAdjustment = {
  /** Adds the adjustment to the plate, once per selected quantity. */
  add: 0,
  /** Subtracts it — the same arithmetic, but the amount is zero or negative. */
  remove: 1,
  /** Replaces the plate price outright, ignoring what came before. */
  replace: 2,
} as const

export type OptionAdjustmentType = (typeof optionAdjustment)[keyof typeof optionAdjustment]

type PricedOption = {
  priceAdjustment: number
  adjustmentType: number
}

/** True when this option's type names a rule both sides of the app agree on. */
export function hasKnownAdjustmentType(option: PricedOption): boolean {
  return option.adjustmentType === optionAdjustment.add
    || option.adjustmentType === optionAdjustment.remove
    || option.adjustmentType === optionAdjustment.replace
}

/**
 * The running price after applying one selected option, or null when its type names no rule —
 * in which case no price can honestly be shown, because none can be charged.
 */
export function applyOptionAdjustment(
  unitPrice: number,
  option: PricedOption,
  quantity: number,
): number | null {
  switch (option.adjustmentType) {
    case optionAdjustment.replace:
      return option.priceAdjustment
    case optionAdjustment.add:
    case optionAdjustment.remove:
      return unitPrice + option.priceAdjustment * quantity
    default:
      return null
  }
}

/**
 * How the option's effect on the price reads on a menu, or null when it has no rule to describe.
 */
export function describeOptionAdjustment(
  option: PricedOption,
  formatMoney: Intl.NumberFormat,
): string | null {
  if (!hasKnownAdjustmentType(option)) {
    return null
  }

  if (option.adjustmentType === optionAdjustment.replace) {
    return `Set ${formatMoney.format(option.priceAdjustment)}`
  }

  if (option.priceAdjustment === 0) {
    return 'Included'
  }

  // A Remove option carries a zero or negative amount, so its formatted value already reads as a
  // deduction; only a genuine surcharge needs the plus sign.
  if (option.adjustmentType === optionAdjustment.remove || option.priceAdjustment < 0) {
    return formatMoney.format(option.priceAdjustment)
  }

  return `+${formatMoney.format(option.priceAdjustment)}`
}
