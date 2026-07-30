import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getRestaurants } from './auth'

function pagedResponse(items: Array<{ id: string; name: string }>, page: number, totalPages: number) {
  return new Response(JSON.stringify({
    items,
    page,
    pageSize: 100,
    totalItems: totalPages * 100,
    totalPages,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('paged option loaders', () => {
  it('stays within the backend page-size contract and aggregates every page', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(pagedResponse([{ id: 'restaurant-1', name: 'One' }], 1, 2))
      .mockResolvedValueOnce(pagedResponse([{ id: 'restaurant-2', name: 'Two' }], 2, 2))
    vi.stubGlobal('fetch', fetchMock)

    const restaurants = await getRestaurants()

    expect(restaurants.map((restaurant) => restaurant.id)).toEqual([
      'restaurant-1',
      'restaurant-2',
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toContain('page=1')
    expect(fetchMock.mock.calls[0][0]).toContain('pageSize=100')
    expect(fetchMock.mock.calls[1][0]).toContain('page=2')
    expect(fetchMock.mock.calls[1][0]).not.toContain('pageSize=200')
  })
})
