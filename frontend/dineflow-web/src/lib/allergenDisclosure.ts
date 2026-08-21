/**
 * Everything declared about a plate as it is actually being ordered — the dish and the modifiers
 * chosen for it, together.
 *
 * <p>
 * A dish's declaration describes the dish as listed. Options had nowhere to record what they
 * themselves contain, so adding satay sauce to a curry declared peanut-free left the panel a
 * customer reads before ordering saying exactly what it said before. The one check an allergic
 * customer performs could not see the thing they had just added.
 * </p>
 *
 * <p>
 * Lines stay separate and attributed rather than merged into one sentence. Someone who reads
 * "contains peanut — Satay sauce" can deselect the sauce; someone who reads "contains peanut" can
 * only put the dish down.
 * </p>
 */

/** The dish itself, as opposed to one of its modifiers. */
export const dishSource = 'This dish'

export type AllergenLine = {
  /** `dishSource`, or the name of the modifier that carries this line. */
  source: string
  /** The restaurant's wording, verbatim. */
  text: string
}

export type PlateDisclosure = {
  allergens: AllergenLine[]
  mayContain: AllergenLine[]
  crossContact: AllergenLine[]
  /** True when a modifier contributed at least one line, so the panel can say the plate changed. */
  hasModifierDisclosure: boolean
}

type Declared = {
  allergens?: string | null
  mayContainAllergens?: string | null
  crossContactStatement?: string | null
}

type Modifier = Declared & { name: string }

function append(lines: AllergenLine[], source: string, text: string | null | undefined) {
  const trimmed = text?.trim()

  if (trimmed) {
    lines.push({ source, text: trimmed })
  }
}

export function buildPlateDisclosure(dish: Declared, modifiers: Modifier[]): PlateDisclosure {
  const allergens: AllergenLine[] = []
  const mayContain: AllergenLine[] = []
  const crossContact: AllergenLine[] = []

  append(allergens, dishSource, dish.allergens)
  append(mayContain, dishSource, dish.mayContainAllergens)
  append(crossContact, dishSource, dish.crossContactStatement)

  const dishLineCount = allergens.length + mayContain.length + crossContact.length

  for (const modifier of modifiers) {
    const source = modifier.name.trim() || 'A selected option'

    append(allergens, source, modifier.allergens)
    append(mayContain, source, modifier.mayContainAllergens)
    append(crossContact, source, modifier.crossContactStatement)
  }

  return {
    allergens,
    mayContain,
    crossContact,
    hasModifierDisclosure: allergens.length + mayContain.length + crossContact.length > dishLineCount,
  }
}

/**
 * One readable line per declaration. The dish's own lines are left unattributed — repeating "this
 * dish" on every row is noise — while a modifier's are named, because that is the part the customer
 * can still change.
 */
export function formatAllergenLines(lines: AllergenLine[]): string {
  return lines
    .map((line) => (line.source === dishSource ? line.text : `${line.text} (${line.source})`))
    .join('; ')
}

/**
 * The one line worth showing when the panel is folded away.
 *
 * <p>
 * The panel is collapsed by default because most of it is standing wording — how the kitchen is
 * laid out, what an order note cannot promise — that pushed the price and the options off a phone
 * screen. What must not be collapsed is the answer itself, so the summary carries it: an allergic
 * customer can decide from the closed panel and only opens it for the detail.
 * </p>
 *
 * <p>
 * Nothing declared is reported as such rather than as silence, which reads identically to a dish
 * confirmed to be free of everything.
 * </p>
 */
export function summariseDisclosure(disclosure: PlateDisclosure): {
  headline: string
  /** True when the restaurant has actually declared something, for styling and for tests. */
  declared: boolean
} {
  if (disclosure.allergens.length > 0) {
    return { headline: `Contains ${formatAllergenLines(disclosure.allergens)}`, declared: true }
  }

  if (disclosure.mayContain.length > 0) {
    return { headline: `May contain ${formatAllergenLines(disclosure.mayContain)}`, declared: true }
  }

  return { headline: 'Allergens not declared by the restaurant', declared: false }
}
