import { describe, expect, it } from 'vitest'
import {
  buildReceiptLinePricing,
  buildReceiptOptionGroups,
  gstIncludedInTotal,
  resolveReceiptTitle,
} from './receipt'

describe('resolveReceiptTitle', () => {
  it('calls a GST-registered supplier document a tax invoice, paid or not', () => {
    expect(resolveReceiptTitle(true, true)).toBe('TAX INVOICE')
    expect(resolveReceiptTitle(true, false)).toBe('TAX INVOICE')
  })

  it('distinguishes a settled receipt from an outstanding bill when there is no GST', () => {
    expect(resolveReceiptTitle(false, true)).toBe('RECEIPT')
    expect(resolveReceiptTitle(false, false)).toBe('BILL')
  })
})

describe('gstIncludedInTotal', () => {
  it('takes one eleventh of a GST-inclusive total, rounded to cents', () => {
    expect(gstIncludedInTotal(44, true)).toBe(4)
    expect(gstIncludedInTotal(48.5, true)).toBe(4.41)
  })

  it('reports no GST at all for a supplier that is not registered', () => {
    expect(gstIncludedInTotal(44, false)).toBeNull()
  })
})

describe('buildReceiptOptionGroups', () => {
  it('groups options by their snapshot group and prices only the ones that cost extra', () => {
    const groups = buildReceiptOptionGroups(
      [
        { groupNameSnapshot: 'Side', optionNameSnapshot: 'Rice', priceAdjustmentSnapshot: 0 },
        { groupNameSnapshot: 'Side', optionNameSnapshot: 'Naan', priceAdjustmentSnapshot: 3, quantity: 2 },
        { groupNameSnapshot: 'Spice', optionNameSnapshot: 'Mild', priceAdjustmentSnapshot: -1 },
      ],
      'AUD',
    )

    expect(groups).toEqual([
      { groupName: 'Side', options: ['Rice', 'Naan x2 +$3.00'] },
      { groupName: 'Spice', options: ['Mild -$1.00'] },
    ])
  })

  it('falls back to a generic group name rather than printing an empty heading', () => {
    const groups = buildReceiptOptionGroups(
      [{ groupNameSnapshot: '', optionNameSnapshot: 'Extra hot', priceAdjustmentSnapshot: 0 }],
      'AUD',
    )

    expect(groups[0].groupName).toBe('Options')
  })
})

describe('buildReceiptLinePricing', () => {
  const currency = 'AUD'

  it('separates the dish price from what each extra added across the whole line', () => {
    const pricing = buildReceiptLinePricing({
      quantity: 2,
      basePrice: 19,
      unitPrice: 22,
      options: [
        { groupNameSnapshot: 'Side', optionNameSnapshot: 'Rice', priceAdjustmentSnapshot: 0 },
        { groupNameSnapshot: 'Side', optionNameSnapshot: 'Naan', priceAdjustmentSnapshot: 3 },
      ],
      currency,
    })

    expect(pricing.baseAmount).toBe(38)
    expect(pricing.modifiers).toEqual([{ label: 'Naan', amount: 6 }])
    // Free options stay grouped rather than becoming $0.00 money lines.
    expect(pricing.optionGroups).toEqual([{ groupName: 'Side', options: ['Rice'] }])
  })

  it('multiplies an option taken more than once by both quantities', () => {
    const pricing = buildReceiptLinePricing({
      quantity: 3,
      basePrice: 10,
      unitPrice: 14,
      options: [{ groupNameSnapshot: 'Extras', optionNameSnapshot: 'Bacon', priceAdjustmentSnapshot: 2, quantity: 2 }],
      currency,
    })

    expect(pricing.modifiers).toEqual([{ label: 'Bacon x2', amount: 12 }])
    expect(pricing.baseAmount! + pricing.modifiers[0].amount).toBe(42)
  })

  it('handles a discounting option without inverting its sign', () => {
    const pricing = buildReceiptLinePricing({
      quantity: 1,
      basePrice: 20,
      unitPrice: 18,
      options: [{ groupNameSnapshot: 'Size', optionNameSnapshot: 'Small', priceAdjustmentSnapshot: -2 }],
      currency,
    })

    expect(pricing.modifiers).toEqual([{ label: 'Small', amount: -2 }])
  })

  it('refuses to break down a line whose options do not reconcile to the charged price', () => {
    // A "replace"-style option overrides the unit price instead of adding to it, and the order
    // snapshot does not record which kind it was — so no breakdown can be trusted.
    const pricing = buildReceiptLinePricing({
      quantity: 1,
      basePrice: 19,
      unitPrice: 30,
      options: [{ groupNameSnapshot: 'Size', optionNameSnapshot: 'Large', priceAdjustmentSnapshot: 30 }],
      currency,
    })

    expect(pricing.baseAmount).toBeNull()
    expect(pricing.modifiers).toEqual([])
    expect(pricing.optionGroups).toEqual([{ groupName: 'Size', options: ['Large +$30.00'] }])
  })

  it('falls back when no base price was recorded at all', () => {
    const pricing = buildReceiptLinePricing({
      quantity: 1,
      basePrice: null,
      unitPrice: 19,
      options: [],
      currency,
    })

    expect(pricing.baseAmount).toBeNull()
  })

  it('reconciles cent-level prices without floating point drift', () => {
    const pricing = buildReceiptLinePricing({
      quantity: 3,
      basePrice: 0.1,
      unitPrice: 0.3,
      options: [{ groupNameSnapshot: 'Add', optionNameSnapshot: 'Sauce', priceAdjustmentSnapshot: 0.2 }],
      currency,
    })

    expect(pricing.baseAmount).toBeCloseTo(0.3, 10)
    expect(pricing.modifiers[0].amount).toBeCloseTo(0.6, 10)
  })
})
