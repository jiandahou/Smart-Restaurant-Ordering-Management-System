import axe, { type AxeResults, type RunOptions } from 'axe-core'

/**
 * Runs axe over rendered markup and returns the violations, formatted so a failure names the rule
 * and the element rather than dumping the whole axe result.
 *
 * Colour-contrast is disabled: jsdom does not do layout or resolve stylesheets, so axe cannot
 * measure it and would report false negatives either way. Contrast belongs to a real browser.
 */
export async function findAccessibilityViolations(
  container: Element,
  options: RunOptions = {},
): Promise<string[]> {
  const results: AxeResults = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } },
    ...options,
  })

  return results.violations.map((violation) => {
    const targets = violation.nodes
      .map((node) => node.target.join(' '))
      .join(', ')
    return `${violation.id}: ${violation.help} (${targets})`
  })
}
