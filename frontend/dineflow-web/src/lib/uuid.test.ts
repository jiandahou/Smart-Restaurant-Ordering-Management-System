import { describe, expect, it, vi } from 'vitest'

import { createUuid } from './uuid'

const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('createUuid', () => {
  it('uses native randomUUID when the browser provides it', () => {
    const randomUUID = vi.fn(() => '11111111-2222-4333-8444-555555555555')

    expect(createUuid({ randomUUID })).toBe('11111111-2222-4333-8444-555555555555')
    expect(randomUUID).toHaveBeenCalledOnce()
  })

  it('creates an RFC-compatible UUID using getRandomValues when randomUUID is unavailable', () => {
    const getRandomValues = vi.fn((values: Uint8Array) => {
      values.set(Array.from({ length: 16 }, (_, index) => index))
      return values
    })

    const uuid = createUuid({ getRandomValues })

    expect(getRandomValues).toHaveBeenCalledOnce()
    expect(uuid).toMatch(uuidV4Pattern)
    expect(uuid).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f')
  })

  it('still returns a UUID-shaped identifier when Web Crypto is absent', () => {
    expect(createUuid(undefined)).toMatch(uuidV4Pattern)
  })
})
