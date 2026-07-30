/**
 * Mirrors PlatformFeeCalculator on the server so the UI preview matches what is actually charged.
 *
 * The fee is stored in basis points (1 bp = 0.01%), which is easy to misread: a "0.1" in the
 * percent field is a tenth of a percent, not ten cents. The preview built on this exists to make
 * that obvious before someone saves a rate that is a hundred times off.
 */
export function calculateOrderFeeCents(amountCents: number, feeBasisPoints: number): number {
  if (amountCents <= 1 || feeBasisPoints <= 0) {
    return 0
  }

  // Math.round matches MidpointRounding.AwayFromZero for the positive values used here.
  const calculated = Math.round((amountCents * feeBasisPoints) / 10_000)

  // Stripe requires the application fee to be lower than the charge itself.
  return Math.min(calculated, amountCents - 1)
}

export function percentToBasisPoints(percent: number): number {
  return Math.round(percent * 100)
}

/** Worked examples at two magnitudes, which is what makes a rate's real size obvious. */
export function buildFeePreview(percent: number, currency: string): string | null {
  if (!Number.isFinite(percent) || percent <= 0) {
    return null
  }

  const basisPoints = percentToBasisPoints(percent)
  if (basisPoints <= 0) {
    return 'Rounds to zero — orders would be charged no platform fee.'
  }

  const format = (cents: number) =>
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: (currency || 'AUD').toUpperCase(),
    }).format(cents / 100)

  const samples = [2_000, 10_000]
  const parts = samples.map(
    (amount) => `${format(amount)} order → ${format(calculateOrderFeeCents(amount, basisPoints))}`,
  )

  return parts.join('  ·  ')
}
