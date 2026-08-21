export type CsvCell = string | number | null | undefined

const spreadsheetFormulaPrefix = /^[=+\-@\t\r]/

/**
 * Quoting a CSV cell does not stop Excel or other spreadsheet programs from evaluating it.
 * Prefix untrusted formula-like strings with an apostrophe so they remain visible as text.
 */
export function neutralizeSpreadsheetFormula(value: CsvCell) {
  if (typeof value !== 'string') {
    return value == null ? '' : String(value)
  }

  return spreadsheetFormulaPrefix.test(value) ? `'${value}` : value
}

export function serializeCsv(headers: string[], rows: CsvCell[][]) {
  const escapeCell = (value: CsvCell) => {
    const safeText = neutralizeSpreadsheetFormula(value)
    return `"${safeText.replaceAll('"', '""')}"`
  }

  return [headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\r\n')
}

export async function fetchAllExportRows<T>(
  load: (page: number) => Promise<{ items: T[]; totalPages: number }>,
) {
  const first = await load(1)
  const rows = [...first.items]

  // Export is intentionally complete. If this becomes too expensive, replace it with a server-side
  // export job that reports progress; silently imposing a client-side page cap loses financial data.
  for (let page = 2; page <= first.totalPages; page += 1) {
    rows.push(...(await load(page)).items)
  }

  return rows
}
