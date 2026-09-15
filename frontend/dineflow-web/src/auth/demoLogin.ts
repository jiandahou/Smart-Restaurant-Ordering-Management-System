/**
 * Demo credentials that prefill the sign-in form, for local development only.
 *
 * `import.meta.env.DEV` is substituted with a literal `false` when Vite builds for production, so
 * the whole branch — and the credential strings inside it — is dropped from the shipped bundle
 * rather than merely hidden. A deployed build renders empty fields and contains no password.
 *
 * Both exports are written so the minifier can fold them to constants: the flag is a plain
 * comparison rather than a property lookup, which is what lets the dead branch (and anything a
 * future edit puts inside it) disappear instead of surviving behind a runtime `if`.
 *
 * Override the values with VITE_DEMO_LOGIN_EMAIL / VITE_DEMO_LOGIN_PASSWORD, or turn the autofill
 * off entirely with VITE_DEMO_LOGIN=off (useful for testing the real sign-in flow locally).
 */
// Prefill happens in two cases, both decided at build time so the credential strings below are
// dropped from any bundle that will not use them (production ships empty fields and no password):
//   - the Vite dev server, unless explicitly turned off, and
//   - a build that opts in with VITE_DEMO_LOGIN=on (e.g. the internal stage/demo deployment).
// A real production build sets neither, so `isDemoLoginAutofilled` folds to a constant `false`.
export const isDemoLoginAutofilled =
  import.meta.env.VITE_DEMO_LOGIN === 'on' ||
  (import.meta.env.DEV && import.meta.env.VITE_DEMO_LOGIN !== 'off')

export const demoLoginDefaults: { email: string; password: string } = isDemoLoginAutofilled
  ? {
      email: import.meta.env.VITE_DEMO_LOGIN_EMAIL || 'owner@dineflow.com',
      password: import.meta.env.VITE_DEMO_LOGIN_PASSWORD || 'ChangeMe123!',
    }
  : { email: '', password: '' }
