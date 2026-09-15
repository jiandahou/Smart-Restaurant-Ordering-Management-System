import { describe, expect, it } from 'vitest'
import { normalizePaymentSearch, paymentSearchMaxLength } from './paymentSearch'

describe('PAY-LIST-04 payment search length', () => {
  it('accepts exactly 200 characters', () => {
    const search = 'a'.repeat(200)
    expect(normalizePaymentSearch(search)).toBe(search)
  })

  it('prevents a 201st character from reaching the URL or API', () => {
    const search = normalizePaymentSearch('a'.repeat(201))
    expect(search).toHaveLength(paymentSearchMaxLength)
    expect(search).toBe('a'.repeat(200))
  })
})
