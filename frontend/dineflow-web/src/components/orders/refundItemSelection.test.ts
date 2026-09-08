import { describe, expect, it } from 'vitest'
import {
  canSelectExtras,
  canSelectWholeLine,
  computeSelectedAmountCents,
  isValidRefundSelection,
  parseRefundSelectionKey,
  refundSelectionKey,
  setItemAmountCents,
  toggleExtraSelection,
  toggleItemSelection,
  toggleLineSelection,
} from './refundItemSelection'

describe('refund item selection', () => {
  it('toggles an item into and out of the selection at the default amount', () => {
    const selected = toggleItemSelection({}, 'item-1', 1750)
    expect(selected).toEqual({ 'item-1': 1750 })

    const deselected = toggleItemSelection(selected, 'item-1', 1750)
    expect(deselected).toEqual({})
  })

  it('clamps amounts to the line balance, allows a cleared input, and ignores unselected items', () => {
    const selection = { 'item-1': 1500 }
    expect(setItemAmountCents(selection, 'item-1', 1800, 1750)).toEqual({ 'item-1': 1750 })
    expect(setItemAmountCents(selection, 'item-1', -1, 1750)).toEqual({ 'item-1': 0 })
    expect(setItemAmountCents(selection, 'item-2', 500, 1750)).toEqual(selection)
  })

  it('sums the amount only for selected items', () => {
    expect(computeSelectedAmountCents({ 'item-1': 1500 })).toBe(1500)
    expect(computeSelectedAmountCents({ 'item-1': 1500, 'item-2': 250 })).toBe(1750)
    expect(computeSelectedAmountCents({})).toBe(0)
  })

  it('requires at least one selected item with a positive amount', () => {
    expect(isValidRefundSelection({})).toBe(false)
    expect(isValidRefundSelection({ 'item-1': 0 })).toBe(false)
    expect(isValidRefundSelection({ 'item-1': 1500 })).toBe(true)
  })
})

/**
 * "The wings" and "the sauce on the wings" are different requests for different money. Keyed by the
 * line alone they would be the same entry, and picking one would silently replace the other.
 */
describe('picking a line or one of its extras', () => {
  it('keeps a line and one of its extras apart', () => {
    const line = refundSelectionKey('item-1')
    const extra = refundSelectionKey('item-1', 'option-9')

    expect(line).not.toBe(extra)

    const selection = toggleItemSelection(toggleItemSelection({}, line, 1_711), extra, 74)

    expect(selection).toEqual({ [line]: 1_711, [extra]: 74 })
    expect(computeSelectedAmountCents(selection)).toBe(1_785)
  })

  it('reads back the line and extra a key was built from', () => {
    expect(parseRefundSelectionKey(refundSelectionKey('item-1')))
      .toEqual({ orderItemId: 'item-1', orderItemOptionId: null })
    expect(parseRefundSelectionKey(refundSelectionKey('item-1', 'option-9')))
      .toEqual({ orderItemId: 'item-1', orderItemOptionId: 'option-9' })
  })

  it('edits one without disturbing the other', () => {
    const line = refundSelectionKey('item-1')
    const extra = refundSelectionKey('item-1', 'option-9')
    const selection = { [line]: 1_711, [extra]: 74 }

    expect(setItemAmountCents(selection, extra, 50, 74)).toEqual({ [line]: 1_711, [extra]: 50 })
  })

  /**
   * A line is refunded as a whole or by its parts and never both, so the first refund on it settles
   * which choice remains. Offering the closed one only to have the server refuse it wastes the
   * customer's time on something that was never available.
   */
  it('closes whichever way the line was already refunded', () => {
    expect(canSelectWholeLine('Untouched')).toBe(true)
    expect(canSelectExtras('Untouched')).toBe(true)

    expect(canSelectWholeLine('ByItsParts')).toBe(false)
    expect(canSelectExtras('ByItsParts')).toBe(true)

    expect(canSelectWholeLine('AsAWhole')).toBe(true)
    expect(canSelectExtras('AsAWhole')).toBe(false)
  })

  /** An order response from before this field existed leaves both open, as it always was. */
  it('leaves both open when the line says nothing', () => {
    expect(canSelectWholeLine(undefined)).toBe(true)
    expect(canSelectExtras(undefined)).toBe(true)
  })
})

/**
 * A line is refunded as a whole or by its parts and never both. The screen used to express that by
 * hiding the extras whenever the line was ticked — and since the dialog opens with every line
 * ticked, the extras were invisible in the state the customer actually arrives in. Presenting the
 * two as alternatives says the rule instead of concealing half of it.
 */
describe('choosing between a whole line and its extras', () => {
  const extras = ['naan', 'gravy']

  it('releases the extras when the whole line is picked', () => {
    const selection = {
      [refundSelectionKey('item-1', 'naan')]: 556,
      [refundSelectionKey('item-2')]: 900,
    }

    expect(toggleLineSelection(selection, 'item-1', 3_252, extras)).toEqual({
      [refundSelectionKey('item-1')]: 3_252,
      [refundSelectionKey('item-2')]: 900,
    })
  })

  it('releases the whole line when one of its extras is picked', () => {
    const selection = {
      [refundSelectionKey('item-1')]: 3_252,
      [refundSelectionKey('item-2')]: 900,
    }

    expect(toggleExtraSelection(selection, 'item-1', 'naan', 556)).toEqual({
      [refundSelectionKey('item-1', 'naan')]: 556,
      [refundSelectionKey('item-2')]: 900,
    })
  })

  /** The exclusion is per line: another dish being refunded whole is nobody else's business. */
  it('leaves other lines alone', () => {
    const selection = { [refundSelectionKey('item-2')]: 900 }

    expect(toggleLineSelection(selection, 'item-1', 3_252, extras))
      .toHaveProperty(refundSelectionKey('item-2'), 900)
    expect(toggleExtraSelection(selection, 'item-1', 'naan', 556))
      .toHaveProperty(refundSelectionKey('item-2'), 900)
  })

  it('still unpicks what is already picked', () => {
    const line = { [refundSelectionKey('item-1')]: 3_252 }
    expect(toggleLineSelection(line, 'item-1', 3_252, extras)).toEqual({})

    const extra = { [refundSelectionKey('item-1', 'naan')]: 556 }
    expect(toggleExtraSelection(extra, 'item-1', 'naan', 556)).toEqual({})
  })

  it('lets two extras on one line be picked together', () => {
    const first = toggleExtraSelection({}, 'item-1', 'naan', 556)
    const both = toggleExtraSelection(first, 'item-1', 'gravy', 296)

    expect(both).toEqual({
      [refundSelectionKey('item-1', 'naan')]: 556,
      [refundSelectionKey('item-1', 'gravy')]: 296,
    })
  })
})

/**
 * The dialog opens with every refundable line ticked. A line whose extras have already been
 * refunded cannot be refunded whole, so ticking it opens the dialog on a request the server is
 * bound to refuse — and counts that line's balance into a total the customer never chose. On a
 * A$32.52 order with A$6.56 of extras returned, the dialog offered A$25.96 and would have been
 * turned down.
 */
describe('what the dialog opens with', () => {
  it('leaves out a line that can only be refunded extra by extra', () => {
    expect(canSelectWholeLine('ByItsParts')).toBe(false)
  })

  it('still includes lines that have not been refunded either way', () => {
    expect(canSelectWholeLine('Untouched')).toBe(true)
    expect(canSelectWholeLine('AsAWhole')).toBe(true)
  })
})
