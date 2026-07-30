import type { ReactNode } from 'react'

/**
 * Dashboard widget layout model.
 *
 * The canvas is a two-column grid with unbounded rows. A widget occupies a whole number of
 * columns and rows, so the only valid spans are 1x1, 2x1, 1x2 and 2x2. Layout is stored per
 * signed-in user in this browser so two accounts sharing a device do not overwrite each other.
 */

export type WidgetSpan = 1 | 2

export type WidgetSize = {
  w: WidgetSpan
  h: WidgetSpan
}

export type DashboardWidget = {
  id: string
  title: string
  /** Sizes this widget may take. The first entry is its default. */
  allowedSizes: WidgetSize[]
  render: () => ReactNode
}

export type WidgetPlacement = {
  id: string
  w: WidgetSpan
  h: WidgetSpan
  hidden: boolean
}

export type DashboardLayout = WidgetPlacement[]

const legacyStorageKey = 'dineflow.dashboard.layout.v2'
const storageKeyPrefix = 'dineflow.dashboard.layout.v3'

export function dashboardStorageKey(scope: string) {
  return `${storageKeyPrefix}.${encodeURIComponent(scope || 'anonymous')}`
}

export function sizeKey(size: WidgetSize) {
  return `${size.w}x${size.h}`
}

export function isSameSize(first: WidgetSize, second: WidgetSize) {
  return first.w === second.w && first.h === second.h
}

/** The next size in the widget's allowed list, wrapping around. */
export function cycleSize(widget: DashboardWidget, current: WidgetSize): WidgetSize {
  const index = widget.allowedSizes.findIndex((size) => isSameSize(size, current))
  return widget.allowedSizes[(index + 1) % widget.allowedSizes.length] ?? widget.allowedSizes[0]
}

function defaultPlacement(widget: DashboardWidget): WidgetPlacement {
  const size = widget.allowedSizes[0] ?? { w: 1, h: 1 }
  return { id: widget.id, w: size.w, h: size.h, hidden: false }
}

export function createDefaultLayout(widgets: DashboardWidget[]): DashboardLayout {
  return widgets.map(defaultPlacement)
}

/**
 * Merges a stored layout with the widgets that actually exist right now. Widgets can appear and
 * disappear with the signed-in role, so a stored entry is never trusted on its own: unknown ids
 * are dropped, new widgets are appended, and sizes are clamped to what the widget allows.
 */
export function reconcileLayout(
  widgets: DashboardWidget[],
  stored: DashboardLayout | null,
): DashboardLayout {
  if (!stored || stored.length === 0) {
    return createDefaultLayout(widgets)
  }

  const byId = new Map(widgets.map((widget) => [widget.id, widget]))
  const seen = new Set<string>()
  const reconciled: DashboardLayout = []

  for (const placement of stored) {
    const widget = byId.get(placement.id)
    if (!widget || seen.has(placement.id)) {
      continue
    }

    seen.add(placement.id)
    const requested: WidgetSize = { w: placement.w, h: placement.h }
    const size = widget.allowedSizes.some((allowed) => isSameSize(allowed, requested))
      ? requested
      : widget.allowedSizes[0] ?? { w: 1, h: 1 }

    reconciled.push({
      id: widget.id,
      w: size.w,
      h: size.h,
      hidden: Boolean(placement.hidden),
    })
  }

  for (const widget of widgets) {
    if (!seen.has(widget.id)) {
      reconciled.push(defaultPlacement(widget))
    }
  }

  return reconciled
}

export function loadStoredLayout(scope: string): DashboardLayout | null {
  try {
    // Read the old unscoped preference once as a migration path for existing installations.
    const raw = window.localStorage.getItem(dashboardStorageKey(scope))
      ?? window.localStorage.getItem(legacyStorageKey)
    if (!raw) {
      return null
    }

    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return null
    }

    return parsed.filter(isWidgetPlacement)
  } catch {
    // A corrupt or unavailable store just means "no preference yet".
    return null
  }
}

export function saveLayout(scope: string, layout: DashboardLayout) {
  try {
    window.localStorage.setItem(dashboardStorageKey(scope), JSON.stringify(layout))
  } catch {
    // Private-mode or quota failures must not break the dashboard.
  }
}

export function clearStoredLayout(scope: string) {
  try {
    window.localStorage.removeItem(dashboardStorageKey(scope))
  } catch {
    // Ignored for the same reason as saveLayout.
  }
}

function isWidgetPlacement(value: unknown): value is WidgetPlacement {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Record<string, unknown>
  return typeof candidate.id === 'string' &&
    (candidate.w === 1 || candidate.w === 2) &&
    (candidate.h === 1 || candidate.h === 2)
}

/** Applies an explicitly selected, allowed size without coupling resize to reordering. */
export function setWidgetSize(
  layout: DashboardLayout,
  widget: DashboardWidget,
  requested: WidgetSize,
): DashboardLayout {
  if (!widget.allowedSizes.some((size) => isSameSize(size, requested))) {
    return layout
  }

  return layout.map((placement) =>
    placement.id === widget.id
      ? { ...placement, w: requested.w, h: requested.h }
      : placement,
  )
}

/** Moves `draggedId` so it sits immediately before `targetId`, preserving everything else. */
export function reorderLayout(layout: DashboardLayout, draggedId: string, targetId: string): DashboardLayout {
  if (draggedId === targetId) {
    return layout
  }

  const from = layout.findIndex((placement) => placement.id === draggedId)
  const to = layout.findIndex((placement) => placement.id === targetId)

  if (from === -1 || to === -1) {
    return layout
  }

  const next = [...layout]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/** Moves a visible widget one logical position without disturbing hidden widgets. */
export function moveVisibleWidget(
  layout: DashboardLayout,
  id: string,
  direction: -1 | 1,
): DashboardLayout {
  const visible = layout.filter((placement) => !placement.hidden)
  const index = visible.findIndex((placement) => placement.id === id)
  const target = visible[index + direction]

  if (index === -1 || !target) {
    return layout
  }

  return reorderLayout(layout, id, target.id)
}
