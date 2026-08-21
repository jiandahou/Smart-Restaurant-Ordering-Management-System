/** A money amount in its own currency, never converted. */
export function formatMoney(amount: number, currencyCode?: string | null) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: (currencyCode || 'AUD').toUpperCase(),
  }).format(amount)
}
