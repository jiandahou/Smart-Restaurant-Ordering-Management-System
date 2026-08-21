import { describe, expect, it } from 'vitest'

import {
  describeBytes,
  entryScriptBudgetBytes,
  entryStyleBudgetBytes,
  findBudgetBreaches,
  isEntryFile,
} from './bundleBudget'

// Vite hands the files over as text; reading them through node would drag node's types into an app
// config that deliberately does not carry them.
import app from '@/App.tsx?raw'
import appLayout from '@/layout/AppLayout.tsx?raw'
import packageJson from '../../package.json?raw'

/**
 * The build warned about a 1.9 MB entry chunk on every run and shipped it anyway. A warning nobody
 * can fail on is a comment — so a customer scanning a QR code at a table downloaded the admin
 * console, the reports screens and the thermal-printer driver before the menu could paint.
 */
describe('the first-load budget', () => {
  it('counts the entry bundles and nothing else', () => {
    // Route chunks are the point of splitting; a total-size budget would punish the fix.
    expect(isEntryFile('index-DCTVO_vl.js')).toBe(true)
    expect(isEntryFile('index-CR9kIQZG.css')).toBe(true)
    expect(isEntryFile('AdminRestaurantsPage-DyLeFCkz.js')).toBe(false)
    expect(isEntryFile('inter-latin-wght-normal-Dx4kXJAl.woff2')).toBe(false)
  })

  it('fails an entry script over budget', () => {
    const breach = findBudgetBreaches([
      { file: 'index-abc.js', gzipBytes: entryScriptBudgetBytes + 1 },
    ])

    expect(breach).toHaveLength(1)
    expect(breach[0].overBytes).toBe(1)
  })

  it('passes at exactly the budget', () => {
    expect(findBudgetBreaches([{ file: 'index-abc.js', gzipBytes: entryScriptBudgetBytes }])).toEqual([])
  })

  it('holds stylesheets to their own budget, not the script one', () => {
    // They are different costs with different causes; one number for both hides whichever grew.
    const breaches = findBudgetBreaches([
      { file: 'index-abc.css', gzipBytes: entryStyleBudgetBytes + 1 },
      { file: 'index-abc.js', gzipBytes: entryStyleBudgetBytes + 1 },
    ])

    expect(breaches.map((breach) => breach.file)).toEqual(['index-abc.css'])
  })

  it('ignores a route chunk however large', () => {
    expect(findBudgetBreaches([{ file: 'AdminRestaurantsPage-x.js', gzipBytes: 5_000_000 }])).toEqual([])
  })

  it('reports every breach rather than the first', () => {
    const breaches = findBudgetBreaches([
      { file: 'index-abc.js', gzipBytes: entryScriptBudgetBytes + 10 },
      { file: 'index-abc.css', gzipBytes: entryStyleBudgetBytes + 10 },
    ])

    expect(breaches).toHaveLength(2)
  })

  it('states sizes in a unit a person can act on', () => {
    expect(describeBytes(140 * 1024)).toBe('140.0 kB')
  })
})

/**
 * The budget only holds if the splitting that got us under it stays in place.
 */
describe('what the entry bundle no longer carries', () => {
  it('loads every page as its own chunk', () => {
    expect(app).toContain('lazy(() => import(')
    expect(app).not.toMatch(/^import \{ [A-Za-z]+Page \} from '\.\/pages\//m)
  })

  it('leaves the signed-in shell and the printer driver off the first load', () => {
    // A customer opening a table menu never reaches this route and was downloading its QZ
    // transport and thermal-printer driver anyway.
    expect(app).toContain("import('./layout/AppLayout')")
    expect(app).toContain("import('./printing/RestaurantPrintingContext')")
  })

  it('does not drag the staff orders page in through the settings dialog', () => {
    // A static import here pulled a 3,000-line page into the entry chunk for every visitor.
    expect(appLayout).not.toContain("import { PrinterSettingsDialog } from '../pages/StaffOrdersPage'")
    expect(appLayout).toContain("import('../pages/StaffOrdersPage')")
  })

  it('loads the country flag stylesheet with the one screen that shows flags', () => {
    expect(app).not.toContain('flag-icons/css/flag-icons.min.css')
  })

  it('is a command a build can fail on, not a warning to read', () => {
    // Vitest cannot reach outside the project root, so the workflow step that runs this is not
    // asserted here — the script existing is what makes that step possible at all.
    expect(packageJson).toContain('"bundle-budget"')
  })
})
