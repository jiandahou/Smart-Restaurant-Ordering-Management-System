/** Roles whose home is the console rather than the customer profile. */
export const adminRoles = ['PlatformOwner', 'RestaurantOwner', 'Admin']

/** The dashboard, not the first page of the console — signing in should open the overview. */
export const adminHome = '/admin'
export const customerHome = '/me'

/**
 * Where signing in should land.
 *
 * <p>Shared by every way in — password, magic link, passkey, social — and, importantly, by the
 * guard that redirects an already-signed-in visitor away from the login page. That guard used to
 * send everyone to the profile: signing in stored the session, the page re-rendered with a token
 * before the explicit navigation ran, and the guard won the race. An owner ended up on the customer
 * profile no matter which way they signed in.</p>
 */
export function resolvePostLoginDestination(roles: string[] | undefined): string {
  return roles?.some((role) => adminRoles.includes(role)) ? adminHome : customerHome
}
