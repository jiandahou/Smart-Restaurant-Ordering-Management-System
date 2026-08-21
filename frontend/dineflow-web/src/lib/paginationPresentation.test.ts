import { describe, expect, it } from 'vitest'
import { getPaginationPresentation } from './paginationPresentation'

describe('PAY-PAGE-11 and PAY-LIST-15 pagination presentation', () => {
  it('presents an empty table without a zero-to-zero range or page zero', () => {
    expect(getPaginationPresentation(1, 20, 0, 0)).toEqual({
      start: null,
      end: null,
      currentPage: 1,
      totalPages: 1,
    })
  })

  it('clamps a stale page to the available result pages', () => {
    expect(getPaginationPresentation(9, 20, 35, 2)).toEqual({
      start: 21,
      end: 35,
      currentPage: 2,
      totalPages: 2,
    })
  })

  it('keeps a normal result range unchanged', () => {
    expect(getPaginationPresentation(2, 20, 55, 3)).toEqual({
      start: 21,
      end: 40,
      currentPage: 2,
      totalPages: 3,
    })
  })
})
