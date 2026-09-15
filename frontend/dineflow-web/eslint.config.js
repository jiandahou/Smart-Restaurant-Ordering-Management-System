import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // `react-hooks/preserve-manual-memoization` reports that React Compiler would skip a
      // component because its inferred dependencies differ from the hand-written ones. The
      // compiler is not enabled in this project (no babel-plugin-react-compiler in the Vite
      // config), so the finding has no effect on what ships — it is a readiness check for a
      // migration we have not started. Turn it back on as the first step of enabling the compiler,
      // and expect to rework the memoization in AppLayout and AdminPaymentsPage at that point.
      'react-hooks/preserve-manual-memoization': 'off',
    },
  },
  {
    // `react-refresh/only-export-components` is a Fast Refresh ergonomics rule, not a correctness
    // one: it fires when a module exports both components and other values, which costs a full
    // reload instead of a component-only update during development.
    //
    // These modules mix deliberately — vendored shadcn wrappers export their variant definitions,
    // and the domain modules keep a schema or label map next to the component that consumes it.
    // Splitting them would be a large import churn across the app for no runtime benefit, so the
    // rule is switched off here and left enabled everywhere else to catch accidental mixing.
    files: [
      'src/components/ui/**/*.tsx',
      'src/auth/AuthContext.tsx',
      'src/components/OperationalNotificationCenter.tsx',
      'src/components/orders/OrderStatusBadge.tsx',
      'src/components/orders/PaymentStatusBadge.tsx',
      'src/components/restaurant/openingHours.tsx',
    ],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
