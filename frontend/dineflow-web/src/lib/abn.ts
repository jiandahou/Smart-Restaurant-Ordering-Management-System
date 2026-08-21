/**
 * Australian Business Number validation, mirroring AustralianBusinessNumber on the server so the
 * form rejects a fabricated number where it is typed rather than after a round trip.
 *
 * An ABN carries a check on itself, so `12345678901` — eleven digits, but not a real ABN — can be
 * caught here. A passing checksum still only means well-formed: whether the ABN is registered,
 * active, and belongs to this business is a manual check against the Australian Business Register.
 */
export const abnDigitCount = 11

/** ATO weighting; the first digit is reduced by one before the weighted sum. */
const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19]

export function normalizeAbn(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '')
}

export function isValidAbn(value: string | null | undefined): boolean {
  const digits = normalizeAbn(value)

  if (digits.length !== abnDigitCount) {
    return false
  }

  const total = weights.reduce((sum, weight, index) => {
    const digit = Number(digits[index]) - (index === 0 ? 1 : 0)
    return sum + digit * weight
  }, 0)

  return total % 89 === 0
}

/** Grouped as the ABR prints it: "51 824 753 556". */
export function formatAbn(value: string | null | undefined): string {
  const digits = normalizeAbn(value)

  return digits.length === abnDigitCount
    ? `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`
    : digits
}
