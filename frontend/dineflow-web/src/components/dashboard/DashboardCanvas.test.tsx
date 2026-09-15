import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardCanvas } from './DashboardCanvas'
import { dashboardStorageKey, type DashboardWidget } from './dashboardLayout'

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
  }),
}))

const widgets: DashboardWidget[] = [
  {
    id: 'alpha',
    title: 'Alpha',
    allowedSizes: [{ w: 1, h: 1 }, { w: 2, h: 1 }],
    render: () => <div data-slot="card">Alpha content</div>,
  },
  {
    id: 'beta',
    title: 'Beta',
    allowedSizes: [{ w: 2, h: 1 }, { w: 1, h: 1 }],
    render: () => <div data-slot="card">Beta content</div>,
  },
]

describe('DashboardCanvas customization', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
  })

  it('keeps layout controls out of the operational view', () => {
    render(<DashboardCanvas widgets={widgets} storageScope="owner-1" />)

    expect(screen.getByRole('button', { name: 'Customize' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Move Alpha' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Alpha' })).toBeInTheDocument()
  })

  it('discards draft changes when customization is cancelled', () => {
    render(<DashboardCanvas widgets={widgets} storageScope="owner-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Customize' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide Alpha' }))
    expect(screen.queryByRole('region', { name: 'Alpha' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('region', { name: 'Alpha' })).toBeInTheDocument()
  })

  it('supports undo before saving a draft', () => {
    render(<DashboardCanvas widgets={widgets} storageScope="owner-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Customize' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide Alpha' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(screen.getByRole('region', { name: 'Alpha' })).toBeInTheDocument()
  })

  it('moves a widget without changing its size and persists only after save', () => {
    render(<DashboardCanvas widgets={widgets} storageScope="owner-1" />)
    const key = dashboardStorageKey('owner-1')

    fireEvent.click(screen.getByRole('button', { name: 'Customize' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move Beta earlier' }))

    const draftOrder = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))
    expect(draftOrder).toEqual(['Beta', 'Alpha'])
    expect(JSON.parse(window.localStorage.getItem(key) ?? '[]').map((item: { id: string }) => item.id))
      .toEqual(['alpha', 'beta'])

    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }))

    const stored = JSON.parse(window.localStorage.getItem(key) ?? '[]') as Array<{
      id: string
      w: number
      h: number
    }>
    expect(stored.map((item) => item.id)).toEqual(['beta', 'alpha'])
    expect(stored.find((item) => item.id === 'beta')).toMatchObject({ w: 2, h: 1 })
  })

  it('saves hidden widgets under the current user scope', () => {
    render(<DashboardCanvas widgets={widgets} storageScope="owner-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Customize' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide Alpha' }))
    expect(screen.getByRole('button', { name: 'Show Alpha' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }))

    const stored = JSON.parse(
      window.localStorage.getItem(dashboardStorageKey('owner-1')) ?? '[]',
    ) as Array<{ id: string; hidden: boolean }>

    expect(stored.find((item) => item.id === 'alpha')?.hidden).toBe(true)
    expect(window.localStorage.getItem(dashboardStorageKey('owner-2'))).toBeNull()
  })
})

/**
 * The schedule widgets only enter the registry once the restaurant list resolves, so the first
 * render reconciles the stored layout against an incomplete set, drops them, and the mount effect
 * writes that back. Hidden and size preferences for those widgets never survived a refresh.
 */
describe('a widget that has not registered yet', () => {
  const scope = 'owner-1'
  const key = dashboardStorageKey(scope)
  const stored = [
    { id: 'alpha', w: 1, h: 1, hidden: false },
    { id: 'beta', w: 2, h: 1, hidden: true },
    { id: 'opening-hours', w: 2, h: 2, hidden: true },
  ]

  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem(key, JSON.stringify(stored))
  })

  afterEach(() => cleanup())

  it('survives a render that happens before it exists', () => {
    render(<DashboardCanvas widgets={widgets} storageScope={scope} />)

    const saved = JSON.parse(window.localStorage.getItem(key)!)
    expect(saved).toContainEqual({ id: 'opening-hours', w: 2, h: 2, hidden: true })
  })

  it('keeps its preference rather than reverting to a visible default', () => {
    // Reappearing unhidden is what made this look like the widget "came back" on every reload.
    const { unmount } = render(<DashboardCanvas widgets={widgets} storageScope={scope} />)
    unmount()

    render(<DashboardCanvas widgets={[...widgets, {
      id: 'opening-hours',
      title: 'Opening hours',
      allowedSizes: [{ w: 2, h: 2 }],
      render: () => <div data-slot="card">Hours</div>,
    }]} storageScope={scope} />)

    expect(screen.queryByText('Hours')).not.toBeInTheDocument()
  })

  it('still records what the visible widgets are doing', () => {
    render(<DashboardCanvas widgets={widgets} storageScope={scope} />)

    const saved = JSON.parse(window.localStorage.getItem(key)!)
    expect(saved).toContainEqual({ id: 'alpha', w: 1, h: 1, hidden: false })
    expect(saved).toContainEqual({ id: 'beta', w: 2, h: 1, hidden: true })
  })
})
