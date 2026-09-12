import { describe, expect, it } from 'vitest'
import { orderNoteMaxLength, validateOrderNote } from './cartNoteValidation'

describe('order note validation', () => {
  it.each([3_999, 4_000])('accepts a note with %i characters', (length) => {
    expect(validateOrderNote('x'.repeat(length))).toBeNull()
  })

  it('rejects a note with 4001 characters', () => {
    expect(validateOrderNote('x'.repeat(4_001)))
      .toBe(`Order note cannot exceed ${orderNoteMaxLength} characters.`)
  })
})
