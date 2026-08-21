/**
 * How a limited dish's remaining count reads on the menu.
 *
 * <p>
 * Every limited dish shows its count, not only the nearly-gone ones — a customer choosing between
 * dishes deserves to know which ones are finite. But "60 left" and "1 left" are not the same news,
 * so the urgency is carried by how it looks rather than by hiding the comfortable numbers.
 * </p>
 *
 * <p>
 * The count is also reduced by whatever the customer is already holding. The server reports the
 * kitchen's stock, which is not drawn down until checkout, so a customer who put the last portion
 * in their cart would still be told "1 left" — while the add button refused them. What they
 * actually want to know is how many more they can take, and where the missing ones went.
 * </p>
 */

/** At or below this many portions the count is urgent. Matches the server's own threshold. */
export const lowStockAtOrBelow = 5

export type StockDisplay = {
  /** What to put on the badge where there is room for it. */
  label: string
  /**
   * The same fact for a thumbnail-sized badge, which is only about 70px wide. "Only 3 left" wraps
   * to two cramped lines there, and the count is the part carrying the meaning.
   */
  shortLabel: string
  /** How loudly to say it. */
  tone: 'low' | 'plenty' | 'held'
  /** How many of these the cart holds, so the badge can show where the missing portions went. */
  inCart: number
  /** Spoken form, for people who are not looking at the colour. */
  srLabel: string
}

/**
 * The badge for a dish, or null when there is nothing to say.
 *
 * <p>
 * A sold-out dish already says so in its own right; a count beside that would contradict it.
 * </p>
 *
 * @param alreadyInCart portions of this dish the cart holds, across every line.
 */
export function describeStock(
  remainingStock: number | null | undefined,
  isSoldOut: boolean,
  alreadyInCart = 0,
): StockDisplay | null {
  if (isSoldOut || remainingStock == null || remainingStock <= 0) {
    return null
  }

  const held = Math.max(0, alreadyInCart)
  const available = Math.max(0, remainingStock - held)
  const portions = `${available} left`

  if (held > 0) {
    // Taken as far as it goes: the rest of this dish is in their own cart, which is a different
    // thing from the kitchen running out and should not read like an alarm.
    return {
      label: `${portions} · ${held} in cart`,
      shortLabel: portions,
      tone: available === 0 ? 'held' : available <= lowStockAtOrBelow ? 'low' : 'plenty',
      inCart: held,
      srLabel: `${available} left, ${held} already in your cart`,
    }
  }

  return available <= lowStockAtOrBelow
    ? {
        label: available === 1 ? 'Last one' : `Only ${portions}`,
        shortLabel: portions,
        tone: 'low',
        inCart: 0,
        srLabel: available === 1 ? 'Last portion available' : `Only ${available} portions left`,
      }
    : {
        label: portions,
        shortLabel: portions,
        tone: 'plenty',
        inCart: 0,
        srLabel: `${available} portions left`,
      }
}

/**
 * The most anyone can still add, given what the cart already holds.
 *
 * <p>
 * Used to stop the quantity stepper before the server has to refuse it. Null means unlimited.
 * </p>
 */
export function remainingAddable(
  remainingStock: number | null | undefined,
  alreadyInCart: number,
): number | null {
  if (remainingStock == null) {
    return null
  }

  return Math.max(0, remainingStock - Math.max(0, alreadyInCart))
}

/**
 * How many of a limited dish this one line may hold.
 *
 * <p>
 * Adding and editing count the cart differently, and conflating them is what made the plus button
 * dead. Adding asks for more on top of what the cart holds. Editing replaces the line, so the line's
 * own portions are not competing with it — counted as though they were, the ceiling came out lower
 * than the quantity already on screen and the only direction was down.
 * </p>
 *
 * <p>
 * The server excludes the edited line for exactly this reason. This exists so the screen and the
 * server cannot disagree about it.
 * </p>
 */
export function remainingForLine(
  remainingStock: number | null | undefined,
  alreadyInCart: number,
  editingLineQuantity: number | null,
): number | null {
  const competingWithThisLine = alreadyInCart - Math.max(0, editingLineQuantity ?? 0)

  return remainingAddable(remainingStock, competingWithThisLine)
}

/**
 * How many lots of one tracked modifier may go on each dish of a line.
 *
 * <p>
 * Two ceilings apply and they answer different questions. <code>maxQuantity</code> is a recipe rule
 * — at most two lots of truffle on one garlic bread, however much truffle the kitchen holds. Stock
 * is what is left. Only the lower one binds, and a screen showing "Max 3" beside a modifier with
 * two left is telling the customer something the server will refuse.
 * </p>
 *
 * <p>
 * Divided by the dish quantity because the order multiplies: two garlic breads each taking two lots
 * consume four. Mirrors <code>CartOptionStockLimit</code> on the server, so the stepper stops where
 * the refusal would have been.
 * </p>
 *
 * @param unitsElsewhereInCart lots of this modifier the cart's other lines already commit.
 */
export function optionPerItemLimit(
  maxQuantity: number,
  remainingStock: number | null | undefined,
  unitsElsewhereInCart: number,
  dishQuantity: number,
): number {
  if (remainingStock == null) {
    // Not counted: there is nothing to run out of, so the recipe rule is the only ceiling.
    return maxQuantity
  }

  const available = Math.max(0, remainingStock - Math.max(0, unitsElsewhereInCart))
  const perItem = Math.floor(available / Math.max(1, dishQuantity))

  return Math.min(maxQuantity, perItem)
}

/**
 * Lots of each tracked modifier the cart already commits, excluding one line.
 *
 * <p>
 * A line of two dishes each taking three lots commits six. The excluded line is the one being
 * edited, which is replaced rather than added to — the same exclusion the server makes.
 * </p>
 */
export function optionUnitsInCart(
  lines: readonly { id: string; quantity: number; selectedOptions: readonly { menuItemOptionId: string | null; quantity: number }[] }[],
  excludeLineId: string | null,
): Map<string, number> {
  const units = new Map<string, number>()

  for (const line of lines) {
    if (line.id === excludeLineId) continue

    for (const option of line.selectedOptions) {
      // A snapshot of a modifier that has since been deleted has no stock to count against.
      if (option.menuItemOptionId == null) continue

      units.set(
        option.menuItemOptionId,
        (units.get(option.menuItemOptionId) ?? 0) + line.quantity * option.quantity,
      )
    }
  }

  return units
}
