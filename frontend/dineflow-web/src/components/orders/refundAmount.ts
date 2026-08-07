export function parseRefundAmountCents(input: string): number | null {
  const dollars = Number(input)
  if (!Number.isFinite(dollars) || input.trim() === '') {
    return null
  }

  return Math.round(dollars * 100)
}

export function isValidDirectRefundAmount(amountCents: number | null, refundableAmountCents: number): boolean {
  return amountCents !== null && amountCents > 0 && amountCents <= refundableAmountCents
}
