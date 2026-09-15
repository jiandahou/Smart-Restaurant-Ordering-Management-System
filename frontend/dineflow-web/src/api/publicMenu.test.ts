import { describe, expect, it } from 'vitest'

import { resolvePublicAssetUrl } from './publicMenu'

describe('resolvePublicAssetUrl', () => {
  it('keeps local MinIO URLs unchanged for a browser running on localhost', () => {
    expect(resolvePublicAssetUrl(
      'http://localhost:9000/dineflow-avatars-local/seed-menu/item.svg',
      'http://localhost:5173',
    )).toBe('http://localhost:9000/dineflow-avatars-local/seed-menu/item.svg')
  })

  it('routes local MinIO images through the frontend when viewed from another LAN device', () => {
    expect(resolvePublicAssetUrl(
      'http://localhost:9000/dineflow-avatars-local/seed-menu/item.svg?version=1',
      'http://10.15.177.58:5173',
    )).toBe('/dineflow-avatars-local/seed-menu/item.svg?version=1')
  })

  it('also rewrites IPv4 loopback assets for a LAN browser', () => {
    expect(resolvePublicAssetUrl(
      'http://127.0.0.1:5000/uploads/avatars/customer.png',
      'http://192.168.1.10:5173',
    )).toBe('/uploads/avatars/customer.png')
  })

  it('keeps public CDN URLs and relative paths unchanged', () => {
    expect(resolvePublicAssetUrl(
      'https://cdn.example.com/menu/item.webp',
      'http://10.15.177.58:5173',
    )).toBe('https://cdn.example.com/menu/item.webp')
    expect(resolvePublicAssetUrl('/uploads/menu/item.webp', 'http://10.15.177.58:5173'))
      .toBe('/uploads/menu/item.webp')
  })

  it('normalises empty values', () => {
    expect(resolvePublicAssetUrl(null, 'http://10.15.177.58:5173')).toBeNull()
    expect(resolvePublicAssetUrl('   ', 'http://10.15.177.58:5173')).toBeNull()
  })
})
