import { describe, expect, it } from 'vitest'
import {
  applyOptionAdjustment,
  describeOptionAdjustment,
  hasKnownAdjustmentType,
  optionAdjustment,
} from './menuOptionPricing'

const money = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })

const option = (adjustmentType: number, priceAdjustment: number) => ({ adjustmentType, priceAdjustment })

describe('the three adjustment types', () => {
  it('adds a surcharge once per selected quantity', () => {
    expect(applyOptionAdjustment(12.34, option(optionAdjustment.add, 1), 2)).toBe(14.34)
  })

  it('subtracts a removal, which carries a negative amount', () => {
    expect(applyOptionAdjustment(12.34, option(optionAdjustment.remove, -2), 1)).toBe(10.34)
  })

  it('replaces the plate price outright', () => {
    expect(applyOptionAdjustment(12.34, option(optionAdjustment.replace, 20), 1)).toBe(20)
  })
})

/**
 * A stored adjustment type of 99 was shown as a A$1.00 surcharge on a A$12.34 item — the browser
 * had no case for it and fell through to "add" — while the server ignored it and charged A$12.34.
 * The displayed and the charged price came from the same row.
 */
describe('an adjustment type with no pricing rule', () => {
  const unknown = option(99, 1)

  it('is not mistaken for a surcharge', () => {
    expect(applyOptionAdjustment(12.34, unknown, 1)).toBeNull()
    expect(applyOptionAdjustment(12.34, unknown, 1)).not.toBe(13.34)
  })

  it('is not described with a price the bill would not agree with', () => {
    expect(describeOptionAdjustment(unknown, money)).toBeNull()
  })

  it('is recognised as unknown', () => {
    expect(hasKnownAdjustmentType(unknown)).toBe(false)
    expect(hasKnownAdjustmentType(option(optionAdjustment.add, 1))).toBe(true)
  })

  it.each([-1, 3, 99, 1.5, Number.NaN])('rejects %s as a type', (type) => {
    expect(hasKnownAdjustmentType(option(type, 1))).toBe(false)
    expect(applyOptionAdjustment(12.34, option(type, 1), 1)).toBeNull()
  })
})

describe('how an option reads on a menu', () => {
  it('marks a surcharge with a plus sign', () => {
    expect(describeOptionAdjustment(option(optionAdjustment.add, 1.5), money)).toBe('+$1.50')
  })

  it('shows a removal as the deduction it is', () => {
    expect(describeOptionAdjustment(option(optionAdjustment.remove, -2), money)).toBe('-$2.00')
  })

  it('names a replacement as a set price rather than a change', () => {
    expect(describeOptionAdjustment(option(optionAdjustment.replace, 20), money)).toBe('Set $20.00')
  })

  it('says free options are included', () => {
    expect(describeOptionAdjustment(option(optionAdjustment.add, 0), money)).toBe('Included')
  })
})
