import { describe, expect, it } from 'vitest'
import { getRequestErrorMessage } from './requestErrorMessage'

describe('getRequestErrorMessage', () => {
  /** The API's own sentence always wins: it was written for this reader. */
  it('uses what the server said when the server said something', () => {
    expect(getRequestErrorMessage(409, { message: 'Some items sold out while the cart was being submitted.' }))
      .toBe('Some items sold out while the cart was being submitted.')
  })

  it('trims it, and treats a blank one as nothing said', () => {
    expect(getRequestErrorMessage(400, { message: '  Pick a table first.  ' })).toBe('Pick a table first.')
    expect(getRequestErrorMessage(400, { message: '   ' })).toBe('Something went wrong. Try again.')
  })

  /**
   * The case this exists for. Unhandled failures come back as RFC 9457 problem details, which carry
   * `title` and never `message` — so every 500 fell through to the status line and showed a diner
   * "Request failed with HTTP 500".
   */
  it('does not read a status code out to a customer', () => {
    const problemDetails = { type: 'about:blank', title: 'An unexpected error occurred.', status: 500 }

    const shown = getRequestErrorMessage(500, problemDetails)

    expect(shown).not.toMatch(/500|HTTP/)
    expect(shown).toMatch(/our end/i)
    // Worth saying out loud at a checkout: a failed request is not a taken payment.
    expect(shown).toMatch(/nothing has been charged/i)
  })

  /** A route whose id does not parse is answered with no body at all. */
  it('has something to say when there is no body', () => {
    expect(getRequestErrorMessage(404, null)).toMatch(/no longer valid/i)
    expect(getRequestErrorMessage(404, undefined)).not.toMatch(/HTTP/)
  })

  it('tells someone being rate limited to wait rather than to retry harder', () => {
    expect(getRequestErrorMessage(429, null)).toMatch(/wait a moment/i)
  })

  it('names a timeout as a connection problem', () => {
    expect(getRequestErrorMessage(408, null)).toMatch(/connection/i)
  })

  it('falls back to something plain for anything else', () => {
    expect(getRequestErrorMessage(418, null)).toBe('Something went wrong. Try again.')
    expect(getRequestErrorMessage(400, {})).toBe('Something went wrong. Try again.')
  })

  it('is not confused by a body that is not an object', () => {
    expect(getRequestErrorMessage(500, 'nginx gateway error')).toMatch(/our end/i)
    expect(getRequestErrorMessage(502, [])).toMatch(/our end/i)
  })
})
