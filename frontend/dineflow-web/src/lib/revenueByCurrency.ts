import type { AdminOrderRevenue } from '../api/auth'
import { formatMoney } from './formatMoney'

/**
 * Paid revenue as a line of text, one figure per currency.
 *
 * <p>A platform trading in more than one currency has no single revenue number, so none is
 * invented here: the currencies are listed side by side and the reader can see there are several.
 * The alternative — one sum labelled with an arbitrary currency — was not merely imprecise, it
 * reported roughly six times the actual Australian revenue as Australian dollars.</p>
 */
export function describeRevenue(revenue: AdminOrderRevenue[] | undefined): string {
  if (!revenue || revenue.length === 0) {
    return 'No paid orders'
  }

  return revenue.map((entry) => formatMoney(entry.amount, entry.currency)).join(' · ')
}
