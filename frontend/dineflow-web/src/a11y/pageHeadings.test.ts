import { describe, expect, it } from 'vitest'

/**
 * FS-019. Every route needs a semantic H1: it is the first thing a screen reader user jumps to,
 * and a styled `div` gives them nothing. Several pages rendered their title through `CardTitle`,
 * which is a div, so the route had no heading at all.
 *
 * Checked against the source because rendering every page would need the router, the store, the
 * auth context and a mocked API — this catches the regression that actually happens, which is a
 * new page shipping without a heading. Loaded through Vite's raw glob so the suite stays inside
 * the browser-ish environment the rest of the tests use.
 */
const pageSources = import.meta.glob('../pages/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/** Files whose extra H1s belong to markup that is never visible at the same time. */
const multipleHeadingsAllowed: Record<string, string> = {
  'CustomerMenuPage.tsx': 'Loading, error and loaded states render one heading each.',
  'StaffOrdersPage.tsx': 'The second heading belongs to the print-only ticket (display: none on screen).',
}

const pages = Object.entries(pageSources)
  .map(([path, source]) => ({ file: path.split('/').pop() ?? path, source }))
  .filter(({ file }) => !file.endsWith('.test.tsx'))

describe('page headings', () => {
  it('finds the page components', () => {
    expect(pages.length).toBeGreaterThan(10)
  })

  it.each(pages)('$file renders an H1', ({ source }) => {
    // `<CardTitle asChild><h1>` counts: asChild makes the child element the rendered tag.
    expect(source).toMatch(/<h1[\s>]/)
  })

  it.each(pages)('$file does not render competing H1s', ({ file, source }) => {
    const headingCount = source.match(/<h1[\s>]/g)?.length ?? 0

    if (headingCount > 1) {
      // Allowed only with a recorded reason, so a second heading cannot creep in unnoticed.
      expect(multipleHeadingsAllowed[file], `${file} has ${headingCount} H1s`).toBeDefined()
      return
    }

    expect(headingCount).toBe(1)
  })
})
