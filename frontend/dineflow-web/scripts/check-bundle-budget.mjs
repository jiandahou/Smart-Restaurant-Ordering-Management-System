#!/usr/bin/env node
/**
 * Fails the build when the first load costs more than the budget allows.
 *
 * <p>
 * Vite already warns about large chunks. A warning is not a control: the 1.9 MB entry bundle this
 * replaces had been warning on every build for months. Run after `vite build`.
 * </p>
 */
import { gzipSync } from 'node:zlib'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Kept in TypeScript so the rules have unit tests; read here as source because this script runs
// before any build step that could compile it.
const rules = readFileSync(new URL('../src/lib/bundleBudget.ts', import.meta.url), 'utf8')
const budgetOf = (name) => Number(rules.match(new RegExp(`${name} = (\\d+) \\* 1024`))[1]) * 1024

const scriptBudget = budgetOf('entryScriptBudgetBytes')
const styleBudget = budgetOf('entryStyleBudgetBytes')
const assets = join(process.cwd(), 'dist', 'assets')
const entries = readdirSync(assets).filter((file) => /^index-[^/]+\.(js|css)$/.test(file))

if (entries.length === 0) {
  console.error('No entry bundle found in dist/assets. Run `npm run build` first.')
  process.exit(1)
}

let failed = false

for (const file of entries.sort()) {
  const gzipBytes = gzipSync(readFileSync(join(assets, file))).length
  const budget = file.endsWith('.css') ? styleBudget : scriptBudget
  const over = gzipBytes > budget
  failed ||= over

  console.log(
    `${over ? 'OVER ' : 'ok   '} ${file}  ${(gzipBytes / 1024).toFixed(1)} kB gzip  (budget ${(budget / 1024).toFixed(0)} kB)`,
  )
}

if (failed) {
  console.error(
    '\nThe first load is over budget. Split the new weight into a route chunk, or raise the budget '
    + 'in src/lib/bundleBudget.ts on purpose and say why in the commit.',
  )
  process.exit(1)
}
