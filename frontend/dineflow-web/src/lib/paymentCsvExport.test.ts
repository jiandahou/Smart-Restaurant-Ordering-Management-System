import { describe, expect, it, vi } from 'vitest'
import { fetchAllExportRows, serializeCsv } from './paymentCsvExport'

describe('PAY-EXP-03 CSV formula injection protection', () => {
  it.each(['=1+1', '+SUM(A1:A2)', '-2+3', '@SUM(A1:A2)', '\t=1+1', '\r=1+1'])(
    'neutralises dangerous string %j',
    (value) => {
      expect(serializeCsv(['Value'], [[value]])).toContain(`"'${value.replaceAll('"', '""')}"`)
    },
  )

  it('still escapes quotes and leaves ordinary strings unchanged', () => {
    expect(serializeCsv(['Value'], [['Central "Market", Adelaide']]))
      .toBe('"Value"\r\n"Central ""Market"", Adelaide"')
  })

  it('does not turn a genuine negative number into text', () => {
    expect(serializeCsv(['Amount'], [[-12.5]])).toBe('"Amount"\r\n"-12.5"')
  })
})

describe('PAY-EXP-05 complete CSV export', () => {
  it('loads every result page instead of silently stopping after page 50', async () => {
    const load = vi.fn(async (page: number) => ({ items: [`row-${page}`], totalPages: 52 }))

    const rows = await fetchAllExportRows(load)

    expect(rows).toHaveLength(52)
    expect(rows.at(-1)).toBe('row-52')
    expect(load).toHaveBeenCalledTimes(52)
    expect(load).toHaveBeenLastCalledWith(52)
  })
})
