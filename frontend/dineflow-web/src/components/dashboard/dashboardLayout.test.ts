import { describe, expect, it } from 'vitest'
import {
  createDefaultLayout,
  cycleSize,
  dashboardStorageKey,
  moveVisibleWidget,
  reconcileLayout,
  reorderLayout,
  setWidgetSize,
  type DashboardWidget,
} from './dashboardLayout'

function widget(id: string, allowedSizes: DashboardWidget['allowedSizes']): DashboardWidget {
  return { id, title: id, allowedSizes, render: () => null }
}

const alpha = widget('alpha', [{ w: 1, h: 1 }, { w: 2, h: 1 }])
const beta = widget('beta', [{ w: 2, h: 2 }])
const gamma = widget('gamma', [{ w: 1, h: 2 }, { w: 2, h: 2 }])

describe('createDefaultLayout', () => {
  it('uses the first allowed size and shows every widget', () => {
    expect(createDefaultLayout([alpha, beta])).toEqual([
      { id: 'alpha', w: 1, h: 1, hidden: false },
      { id: 'beta', w: 2, h: 2, hidden: false },
    ])
  })
})

describe('reconcileLayout', () => {
  it('falls back to defaults when nothing is stored', () => {
    expect(reconcileLayout([alpha], null)).toEqual([{ id: 'alpha', w: 1, h: 1, hidden: false }])
  })

  it('keeps the stored order and hidden flags', () => {
    const stored = [
      { id: 'beta', w: 2 as const, h: 2 as const, hidden: true },
      { id: 'alpha', w: 2 as const, h: 1 as const, hidden: false },
    ]

    expect(reconcileLayout([alpha, beta], stored)).toEqual([
      { id: 'beta', w: 2, h: 2, hidden: true },
      { id: 'alpha', w: 2, h: 1, hidden: false },
    ])
  })

  it('drops widgets that no longer exist for this role', () => {
    const stored = [
      { id: 'ghost', w: 1 as const, h: 1 as const, hidden: false },
      { id: 'alpha', w: 1 as const, h: 1 as const, hidden: false },
    ]

    expect(reconcileLayout([alpha], stored).map((entry) => entry.id)).toEqual(['alpha'])
  })

  it('appends widgets that appeared since the layout was stored', () => {
    const stored = [{ id: 'alpha', w: 1 as const, h: 1 as const, hidden: false }]

    expect(reconcileLayout([alpha, gamma], stored)).toEqual([
      { id: 'alpha', w: 1, h: 1, hidden: false },
      { id: 'gamma', w: 1, h: 2, hidden: false },
    ])
  })

  it('clamps a stored size the widget no longer allows', () => {
    const stored = [{ id: 'beta', w: 1 as const, h: 1 as const, hidden: false }]

    expect(reconcileLayout([beta], stored)).toEqual([{ id: 'beta', w: 2, h: 2, hidden: false }])
  })

  it('ignores duplicate ids', () => {
    const stored = [
      { id: 'alpha', w: 1 as const, h: 1 as const, hidden: false },
      { id: 'alpha', w: 2 as const, h: 1 as const, hidden: true },
    ]

    expect(reconcileLayout([alpha], stored)).toEqual([{ id: 'alpha', w: 1, h: 1, hidden: false }])
  })
})

describe('cycleSize', () => {
  it('advances through the allowed sizes and wraps', () => {
    expect(cycleSize(alpha, { w: 1, h: 1 })).toEqual({ w: 2, h: 1 })
    expect(cycleSize(alpha, { w: 2, h: 1 })).toEqual({ w: 1, h: 1 })
  })

  it('stays put when only one size is allowed', () => {
    expect(cycleSize(beta, { w: 2, h: 2 })).toEqual({ w: 2, h: 2 })
  })

  it('recovers from a size that is not in the list', () => {
    expect(cycleSize(gamma, { w: 1, h: 1 })).toEqual({ w: 1, h: 2 })
  })
})

describe('setWidgetSize', () => {
  const widget: DashboardWidget = {
    id: 'b',
    title: 'B',
    allowedSizes: [{ w: 2, h: 1 }, { w: 1, h: 1 }],
    render: () => null,
  }
  const layout = [
    { id: 'a', w: 1, h: 1, hidden: false },
    { id: 'b', w: 2, h: 1, hidden: false },
  ] as const

  it('resizes only the selected widget', () => {
    const next = setWidgetSize([...layout], widget, { w: 1, h: 1 })

    expect(next.find((placement) => placement.id === 'b')).toMatchObject({ w: 1, h: 1 })
    expect(next.find((placement) => placement.id === 'a')).toMatchObject({ w: 1, h: 1 })
  })

  it('leaves the layout untouched for a size the widget does not allow', () => {
    const source = [...layout]

    expect(setWidgetSize(source, widget, { w: 2, h: 2 })).toBe(source)
  })
})

describe('dashboardStorageKey', () => {
  it('scopes preferences to a user and safely encodes the id', () => {
    expect(dashboardStorageKey('user/a@example.com'))
      .toBe('dineflow.dashboard.layout.v3.user%2Fa%40example.com')
  })
})

describe('reorderLayout', () => {
  const layout = createDefaultLayout([alpha, beta, gamma])

  it('moves a later widget in front of an earlier one', () => {
    expect(reorderLayout(layout, 'gamma', 'alpha').map((entry) => entry.id))
      .toEqual(['gamma', 'alpha', 'beta'])
  })

  it('moves an earlier widget back', () => {
    expect(reorderLayout(layout, 'alpha', 'gamma').map((entry) => entry.id))
      .toEqual(['beta', 'gamma', 'alpha'])
  })

  it('is a no-op for unknown or identical ids', () => {
    expect(reorderLayout(layout, 'alpha', 'alpha')).toBe(layout)
    expect(reorderLayout(layout, 'ghost', 'alpha')).toBe(layout)
  })
})

describe('moveVisibleWidget', () => {
  const layout = [
    { id: 'alpha', w: 1 as const, h: 1 as const, hidden: false },
    { id: 'hidden', w: 1 as const, h: 1 as const, hidden: true },
    { id: 'beta', w: 2 as const, h: 2 as const, hidden: false },
    { id: 'gamma', w: 1 as const, h: 2 as const, hidden: false },
  ]

  it('moves through visible neighbours while preserving hidden entries', () => {
    expect(moveVisibleWidget(layout, 'gamma', -1).map((entry) => entry.id))
      .toEqual(['alpha', 'hidden', 'gamma', 'beta'])
  })

  it('does nothing at the beginning or end', () => {
    expect(moveVisibleWidget(layout, 'alpha', -1)).toBe(layout)
    expect(moveVisibleWidget(layout, 'gamma', 1)).toBe(layout)
  })
})
