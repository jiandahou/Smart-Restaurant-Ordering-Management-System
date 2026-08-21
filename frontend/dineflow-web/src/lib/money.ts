/**
 * True when an amount can actually be charged — no fraction of a cent left over.
 *
 * <p>
 * A price of 9.999 used to be accepted and stored as written, while the order line it produced was
 * rounded to 10.00 and Stripe was asked for 1000 minor units. The server now refuses it; this is
 * the same rule on the way in, so the field says so before a save is attempted.
 * </p>
 *
 * Every currency DineFlow can price in has a hundredth as its smallest unit, which is the same
 * assumption the pricing path makes when it multiplies by 100.
 */
export function isWholeCents(amount: number) {
  if (!Number.isFinite(amount)) {
    return false
  }

  // Comparing rounded cents rather than testing the decimal text, so 9.99 typed as 9.990 passes and
  // binary floating point does not fail an amount that is exactly representable in cents.
  return Math.abs(Math.round(amount * 100) - amount * 100) < 1e-9
}
