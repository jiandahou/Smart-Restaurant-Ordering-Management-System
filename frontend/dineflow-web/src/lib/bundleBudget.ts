/**
 * What the first load is allowed to cost, stated rather than assumed.
 *
 * <p>
 * The build warned about a 1.9 MB chunk and shipped it anyway, so the number drifted upward for
 * months with nothing to push back. A warning nobody can fail on is a comment. These are the
 * budgets the entry bundle is held to; exceeding one fails the build, and raising one is a decision
 * somebody makes on purpose in a diff.
 * </p>
 *
 * <p>
 * Measured on the gzipped entry chunks, because that is what crosses the wire. Lazy route chunks
 * are deliberately not counted: splitting work out of the entry is the point, and a total-size
 * budget would punish exactly the change that helps.
 * </p>
 */

/** Gzipped bytes the entry JavaScript may occupy. */
export const entryScriptBudgetBytes = 140 * 1024

/** Gzipped bytes the entry stylesheet may occupy. */
export const entryStyleBudgetBytes = 80 * 1024

export type BundleMeasurement = {
  /** File name as emitted, e.g. "index-DCTVO_vl.js". */
  file: string
  gzipBytes: number
}

export type BudgetBreach = {
  file: string
  gzipBytes: number
  budgetBytes: number
  overBytes: number
}

/**
 * Which entry files are over budget.
 *
 * <p>
 * Entry files are the ones named <code>index-*</code>; everything else is a route chunk that is
 * only fetched when someone navigates to it.
 * </p>
 */
export function findBudgetBreaches(
  measurements: readonly BundleMeasurement[],
  budgets: { script: number; style: number } = {
    script: entryScriptBudgetBytes,
    style: entryStyleBudgetBytes,
  },
): BudgetBreach[] {
  return measurements
    .filter((measurement) => isEntryFile(measurement.file))
    .flatMap((measurement) => {
      const budgetBytes = measurement.file.endsWith('.css') ? budgets.style : budgets.script

      return measurement.gzipBytes > budgetBytes
        ? [{
            file: measurement.file,
            gzipBytes: measurement.gzipBytes,
            budgetBytes,
            overBytes: measurement.gzipBytes - budgetBytes,
          }]
        : []
    })
}

/** Whether this emitted file is downloaded before anything can render. */
export function isEntryFile(file: string): boolean {
  return /^index-[^/]+\.(js|css)$/.test(file)
}

export function describeBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} kB`
}
