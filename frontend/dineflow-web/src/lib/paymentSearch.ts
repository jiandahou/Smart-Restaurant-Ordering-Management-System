export const paymentSearchMaxLength = 200

/** Applies the API search contract to typed, pasted, and hand-edited URL values. */
export function normalizePaymentSearch(value: string) {
  return value.slice(0, paymentSearchMaxLength)
}
