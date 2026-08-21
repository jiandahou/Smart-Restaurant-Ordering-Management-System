/**
 * How a Stripe identifier reads in a table.
 *
 * <p>
 * A Checkout Session id is around 66 characters of base-58 noise. Printed whole it is the widest
 * thing in the row, so the columns a person actually reads — amount, status, time — get squeezed
 * around a string nobody reads and everybody copies. The ends are the parts that identify it: the
 * <code>cs_test_</code> prefix says what kind of object it is and which mode it was made in, and the
 * tail is what someone matches against Stripe's dashboard.
 * </p>
 *
 * <p>
 * Never abbreviated when copied. What lands on the clipboard is the whole id, or the affordance is
 * a trap.
 * </p>
 */

/** Beyond this many characters an identifier is shortened. Below it, shortening only hides. */
export const identifierCompactAbove = 22

export function compactIdentifier(value: string, above = identifierCompactAbove): string {
  if (value.length <= above) {
    return value
  }

  // Enough of the head to keep the object type and mode ("cs_test_", "pi_live_"), enough of the
  // tail to match against a dashboard search.
  return `${value.slice(0, 10)}…${value.slice(-7)}`
}
