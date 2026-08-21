/**
 * Tells a password manager which account a form is about.
 *
 * <p>Without it, an email field followed by a password field is indistinguishable from a sign-in
 * form. A manager holding several logins for this site would fill one of them — putting another
 * account's address into "New email" and that account's password into "Current password", over the
 * top of whatever had been typed, and then offering to save the result back.</p>
 *
 * <p>Naming the account with <c>autocomplete="username"</c> is the documented way to say "this form
 * changes something on this account" rather than "sign in here". It also lets the manager fill the
 * right password and update the right entry afterwards.</p>
 *
 * <p>Off-screen rather than <c>display: none</c>, because managers skip fields they consider
 * unrendered — and hidden from assistive technology, since it carries nothing a reader needs.</p>
 */
export function CurrentAccountField({ email }: { email: string | null | undefined }) {
  if (!email) {
    return null
  }

  return (
    <input
      type="text"
      name="username"
      autoComplete="username"
      value={email}
      readOnly
      tabIndex={-1}
      aria-hidden="true"
      className="sr-only"
    />
  )
}
