import { describe, expect, it } from 'vitest'
import { formatAbn, isValidAbn, normalizeAbn } from './abn'

describe('ABN validation', () => {
  it.each(['51824753556', '53004085616', '51 824 753 556', '51-824-753-556'])(
    'accepts %s',
    (value) => expect(isValidAbn(value)).toBe(true),
  )

  it('rejects the eleven-digit placeholder that reached a live record', () => {
    // Correct length, wrong checksum — exactly what the old regex let through.
    expect(normalizeAbn('12345678901')).toHaveLength(11)
    expect(isValidAbn('12345678901')).toBe(false)
  })

  it('rejects a transposed pair, which is the realistic typing mistake', () => {
    expect(isValidAbn('51824753556')).toBe(true)
    expect(isValidAbn('51824753565')).toBe(false)
  })

  it.each([null, undefined, '', '   ', '5182475355', '518247535561', '5182475355A'])(
    'rejects %s',
    (value) => expect(isValidAbn(value)).toBe(false),
  )

  it('matches the server rule so the form and the API cannot disagree', () => {
    // Mirrors AustralianBusinessNumberTests on the backend.
    expect(normalizeAbn(' 51 824 753 556 ')).toBe('51824753556')
    expect(formatAbn('51824753556')).toBe('51 824 753 556')
  })
})
