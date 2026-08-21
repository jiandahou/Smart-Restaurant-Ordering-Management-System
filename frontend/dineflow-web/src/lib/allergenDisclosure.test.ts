import { describe, expect, it } from 'vitest'
import { buildPlateDisclosure, formatAllergenLines, summariseDisclosure } from './allergenDisclosure'

const peanutFreeCurry = {
  allergens: 'Soy',
  mayContainAllergens: null,
  crossContactStatement: null,
}

const satay = {
  name: 'Satay sauce',
  allergens: 'Peanut',
  mayContainAllergens: 'Tree nuts',
  crossContactStatement: null,
}

const plainRice = {
  name: 'Steamed rice',
  allergens: null,
  mayContainAllergens: null,
  crossContactStatement: null,
}

/**
 * The reported case: a modifier changes what is on the plate, and the panel a customer reads before
 * ordering has to change with it.
 */
describe('a modifier that brings its own allergen', () => {
  it('appears in the plate disclosure once selected', () => {
    const before = buildPlateDisclosure(peanutFreeCurry, [])
    const after = buildPlateDisclosure(peanutFreeCurry, [satay])

    expect(formatAllergenLines(before.allergens)).toBe('Soy')
    expect(formatAllergenLines(after.allergens)).toBe('Soy; Peanut (Satay sauce)')
  })

  it('is attributed, so it can be deselected rather than only avoided', () => {
    const { allergens } = buildPlateDisclosure(peanutFreeCurry, [satay])

    expect(allergens[1]).toEqual({ source: 'Satay sauce', text: 'Peanut' })
  })

  it('is flagged so the panel can say the plate changed', () => {
    expect(buildPlateDisclosure(peanutFreeCurry, [satay]).hasModifierDisclosure).toBe(true)
    expect(buildPlateDisclosure(peanutFreeCurry, [plainRice]).hasModifierDisclosure).toBe(false)
    expect(buildPlateDisclosure(peanutFreeCurry, []).hasModifierDisclosure).toBe(false)
  })

  it('carries may-contain and cross-contact too, not only the contains list', () => {
    const plate = buildPlateDisclosure(peanutFreeCurry, [
      { ...satay, crossContactStatement: 'Made in a nut kitchen' },
    ])

    expect(formatAllergenLines(plate.mayContain)).toBe('Tree nuts (Satay sauce)')
    expect(formatAllergenLines(plate.crossContact)).toBe('Made in a nut kitchen (Satay sauce)')
  })
})

describe('a dish nobody has declared anything about', () => {
  const undeclared = { allergens: null, mayContainAllergens: null, crossContactStatement: null }

  it('stays empty rather than inventing reassurance', () => {
    const plate = buildPlateDisclosure(undeclared, [plainRice])

    expect(plate.allergens).toEqual([])
    expect(formatAllergenLines(plate.allergens)).toBe('')
    expect(plate.hasModifierDisclosure).toBe(false)
  })

  it('still reports a modifier that does declare something', () => {
    const plate = buildPlateDisclosure(undeclared, [satay])

    expect(formatAllergenLines(plate.allergens)).toBe('Peanut (Satay sauce)')
    expect(plate.hasModifierDisclosure).toBe(true)
  })
})

describe('how the lines read', () => {
  it("leaves the dish's own lines unattributed", () => {
    expect(formatAllergenLines(buildPlateDisclosure(peanutFreeCurry, []).allergens)).toBe('Soy')
  })

  it('names an option even when it is the only source', () => {
    const plate = buildPlateDisclosure(
      { allergens: null, mayContainAllergens: null, crossContactStatement: null },
      [satay],
    )

    expect(formatAllergenLines(plate.allergens)).toBe('Peanut (Satay sauce)')
  })

  it('does not treat whitespace as a declaration', () => {
    const plate = buildPlateDisclosure(
      { allergens: '   ', mayContainAllergens: null, crossContactStatement: null },
      [{ name: 'Extra sauce', allergens: '  ', mayContainAllergens: null, crossContactStatement: null }],
    )

    expect(plate.allergens).toEqual([])
    expect(plate.hasModifierDisclosure).toBe(false)
  })

  it('falls back to a name when an option has none', () => {
    const plate = buildPlateDisclosure(peanutFreeCurry, [
      { name: '  ', allergens: 'Egg', mayContainAllergens: null, crossContactStatement: null },
    ])

    expect(formatAllergenLines(plate.allergens)).toBe('Soy; Egg (A selected option)')
  })

  it('keeps every modifier when several are chosen', () => {
    const plate = buildPlateDisclosure(peanutFreeCurry, [
      satay,
      { name: 'Fried egg', allergens: 'Egg', mayContainAllergens: null, crossContactStatement: null },
    ])

    expect(formatAllergenLines(plate.allergens)).toBe('Soy; Peanut (Satay sauce); Egg (Fried egg)')
  })
})

/**
 * The order and receipt views build the same disclosure from snapshots rather than live options, so
 * the dish half is empty and everything comes from the modifiers.
 */
describe('an order line, built from snapshots', () => {
  it('reports what the chosen modifiers declared at the time', () => {
    const plate = buildPlateDisclosure({}, [
      { name: 'Satay sauce', allergens: 'Peanut', mayContainAllergens: null, crossContactStatement: null },
    ])

    expect(plate.hasModifierDisclosure).toBe(true)
    expect(formatAllergenLines(plate.allergens)).toBe('Peanut (Satay sauce)')
  })

  it('stays silent for a line whose modifiers declared nothing', () => {
    const plate = buildPlateDisclosure({}, [
      { name: 'Steamed rice', allergens: null, mayContainAllergens: null, crossContactStatement: null },
    ])

    expect(plate.hasModifierDisclosure).toBe(false)
    expect(formatAllergenLines(plate.allergens)).toBe('')
  })
})

/**
 * The panel folds away by default: most of it is standing wording that pushed the price and the
 * options off a phone screen. The answer itself must survive the fold, so it moves into the summary
 * line — the part that stays on screen when the panel is shut.
 */
describe('what the folded panel still says', () => {
  it('leads with what the dish contains', () => {
    const plate = buildPlateDisclosure(
      { allergens: 'Milk, tree nuts', mayContainAllergens: 'Sesame' }, [])

    expect(summariseDisclosure(plate)).toEqual({
      headline: 'Contains Milk, tree nuts',
      declared: true,
    })
  })

  /** "May contain" is the whole answer when nothing is confirmed, so it must not be dropped. */
  it('falls back to what it may contain', () => {
    const plate = buildPlateDisclosure({ mayContainAllergens: 'Peanut' }, [])

    expect(summariseDisclosure(plate)).toEqual({
      headline: 'May contain Peanut',
      declared: true,
    })
  })

  /** Silence reads exactly like a dish confirmed to be free of everything, so it is spelt out. */
  it('says so when the restaurant has declared nothing', () => {
    expect(summariseDisclosure(buildPlateDisclosure({}, []))).toEqual({
      headline: 'Allergens not declared by the restaurant',
      declared: false,
    })
  })

  /** A cross-contact statement alone is not an allergen answer, and must not read as one. */
  it('does not treat a cross-contact statement as a declaration', () => {
    const plate = buildPlateDisclosure({ crossContactStatement: 'Fried in a shared fryer' }, [])

    expect(summariseDisclosure(plate).declared).toBe(false)
  })

  /** What a modifier adds stays attributed, so the customer knows they can take it back off. */
  it('names the modifier that added an allergen', () => {
    const plate = buildPlateDisclosure({ allergens: 'Soy' }, [
      { name: 'Satay sauce', allergens: 'Peanut', mayContainAllergens: null, crossContactStatement: null },
    ])

    expect(summariseDisclosure(plate).headline).toBe('Contains Soy; Peanut (Satay sauce)')
  })
})
