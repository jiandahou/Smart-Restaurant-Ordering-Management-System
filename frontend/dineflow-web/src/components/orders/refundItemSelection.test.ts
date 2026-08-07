import { describe, expect, it } from 'vitest'
import {
  computeSelectedAmountCents,
  isValidRefundSelection,
  setItemAmountCents,
  toggleItemSelection,
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
