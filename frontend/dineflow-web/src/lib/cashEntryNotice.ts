/**
 * What is wrong with the cash figure a cashier has typed, or null when nothing is.
 *
 * <p>
 * The Confirm button greys itself out when the number will not do, and used to say nothing about
 * why. The field carried <code>aria-invalid</code> and no message, so a sighted cashier saw a dead
 * button and a red ring, and a cashier using a screen reader was told the field was invalid and
 * nothing else — with a customer waiting and a note in their hand.
 * </p>
 *
 * <p>
 * The wording matches what the server would have said if the button had been pressable
 * (<code>StaffFrontCounterController</code>: "Cash received must be at least 8.00."). It was
 * written, and correct, and unreachable, because the only way to see it was to make a request the
 * screen refused to send.
 * </p>
 *
 * <p>
 * An empty field is not an error. Nothing has been typed yet, and telling somebody they are wrong
 * before they have started is how a form nags.
 * </p>
 */
export function getCashEntryNotice(
  cashReceived: string,
  amountDue: number,
  formatAmount: (amount: number) => string,
): string | null {
  if (amountDue <= 0) {
    return null
  }

  const entered = cashReceived.trim()
  if (entered.length === 0) {
    return null
  }

  const parsed = Number.parseFloat(entered)
  if (!Number.isFinite(parsed)) {
    return 'Enter the cash amount as a number.'
  }

  if (parsed < amountDue) {
    return `Cash received must be at least ${formatAmount(amountDue)}.`
  }

  return null
}
