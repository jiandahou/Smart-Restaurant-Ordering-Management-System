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
export const isDemoLoginAutofilled =
  import.meta.env.DEV && import.meta.env.VITE_DEMO_LOGIN !== 'off'

export const demoLoginDefaults: { email: string; password: string } = isDemoLoginAutofilled
  ? {
      email: import.meta.env.VITE_DEMO_LOGIN_EMAIL || 'owner@dineflow.com',
      password: import.meta.env.VITE_DEMO_LOGIN_PASSWORD || 'ChangeMe123!',
    }
  : { email: '', password: '' }
