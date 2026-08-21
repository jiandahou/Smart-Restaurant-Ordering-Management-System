import { describe, expect, it } from 'vitest'
import type { PublicMenuOption, PublicMenuOptionGroup } from '@/api/publicMenu'
import { getSelectedCountInGroup, setOptionQuantity } from '@/lib/menuOptionSelection'

const extraRoll: PublicMenuOption = {
  id: 'extra-roll',
  groupId: 'add-ons',
  name: 'Extra roll',
  priceAdjustment: 90,
  adjustmentType: 0,
  allergens: null,
  mayContainAllergens: null,
  crossContactStatement: null,
  maxQuantity: 3,
  remainingStock: null,
  displayOrder: 1,
  isAvailable: true,
}

const sesameSprinkle: PublicMenuOption = {
  ...extraRoll,
  id: 'sesame-sprinkle',
  name: 'Sesame sprinkle',
  priceAdjustment: 15,
  maxQuantity: 1,
  displayOrder: 2,
}

const addOns: PublicMenuOptionGroup = {
  id: 'add-ons',
  menuItemId: 'veg-spring-rolls',
  name: 'Add-ons',
  isRequired: false,
  minSelections: 0,
  maxSelections: 2,
  displayOrder: 2,
  isActive: true,
  options: [extraRoll, sesameSprinkle],
}

describe('customer menu option limits', () => {
  it('allows the maximum quantity of one choice together with another choice', () => {
    let selectedIds = setOptionQuantity([], addOns, extraRoll, 3)
    selectedIds = setOptionQuantity(selectedIds, addOns, sesameSprinkle, 1)

    expect(selectedIds).toEqual([
      'extra-roll',
      'extra-roll',
      'extra-roll',
      'sesame-sprinkle',
    ])
    expect(getSelectedCountInGroup(selectedIds, addOns)).toBe(2)

    selectedIds = setOptionQuantity(selectedIds, addOns, extraRoll, 3)
    expect(selectedIds.filter((id) => id === extraRoll.id)).toHaveLength(3)
  })

  it('still prevents selecting more distinct choices than the group maximum', () => {
    const thirdOption = { ...sesameSprinkle, id: 'third-option', name: 'Third option' }
    const group = { ...addOns, options: [...addOns.options, thirdOption] }
    let selectedIds = setOptionQuantity([], group, extraRoll, 1)
    selectedIds = setOptionQuantity(selectedIds, group, sesameSprinkle, 1)

    expect(setOptionQuantity(selectedIds, group, thirdOption, 1)).toEqual(selectedIds)
  })

  it('keeps per-option quantity independent for single-choice groups', () => {
    const singleChoiceGroup = { ...addOns, maxSelections: 1 }

    expect(setOptionQuantity([], singleChoiceGroup, extraRoll, 3)).toEqual([
      'extra-roll',
      'extra-roll',
      'extra-roll',
    ])
  })
})
