const dashboardRoot = 'https://dashboard.stripe.com'

/**
 * Deep link into the Stripe dashboard.
 *
 * Connect direct charges live on the *connected* account, so the account id has to be in the path
 * or the operator lands on an empty platform view. Built on the client because the account id and
 * the environment mode are both already on the page, and the order mapper that feeds this is
 * shared by three controllers with no access to Stripe config.
 */
export function buildStripeDashboardUrl(
  resourceId: string | null | undefined,
  stripeAccountId: string | null | undefined,
  isLiveMode: boolean,
  resource: 'payments' | 'disputes' = 'payments',
): string | null {
  if (!resourceId?.trim()) {
    return null
  }

  // Seeded demo identifiers resolve to nothing; a dead link is worse than no link.
  if (resourceId.includes('_demo_')) {
    return null
  }

  const accountSegment = stripeAccountId?.trim() ? `/${stripeAccountId.trim()}` : ''
  const modeSegment = isLiveMode ? '' : '/test'

  return `${dashboardRoot}${accountSegment}${modeSegment}/${resource}/${resourceId.trim()}`
}
