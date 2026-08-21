type BrowserCrypto = {
  randomUUID?: () => string
  getRandomValues?: (values: Uint8Array) => Uint8Array
}

/**
 * Generates a UUID v4 on browsers that do not expose crypto.randomUUID().
 *
 * Safari restricts randomUUID to secure contexts, so it is absent when a phone opens the local
 * development server through an HTTP LAN address. getRandomValues remains the preferred fallback;
 * Math.random is only the last-resort compatibility path for very old browsers and test shells.
 */
export function createUuid(
  browserCrypto: BrowserCrypto | undefined = typeof crypto === 'undefined'
    ? undefined
    : crypto as BrowserCrypto,
): string {
  if (typeof browserCrypto?.randomUUID === 'function') {
    return browserCrypto.randomUUID()
  }

  const bytes = new Uint8Array(16)

  if (typeof browserCrypto?.getRandomValues === 'function') {
    browserCrypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }

  // RFC 9562 UUID version 4 and variant bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0'))
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-')
}
