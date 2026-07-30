import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { motion } from 'motion/react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  Eye,
  EyeOff,
  GripVertical,
  LayoutGrid,
  Pencil,
  RotateCcw,
  Scaling,
  Undo2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/tooltip'
import {
  createDefaultLayout,
  loadStoredLayout,
  moveVisibleWidget,
  reconcileLayout,
  reorderLayout,
  saveLayout,
  setWidgetSize,
  sizeKey,
  type DashboardLayout,
  type DashboardWidget,
  type WidgetPlacement,
  type WidgetSize,
} from './dashboardLayout'

const maxUndoDepth = 20

function layoutsEqual(first: DashboardLayout, second: DashboardLayout) {
  return first.length === second.length &&
    first.every((placement, index) => {
      const other = second[index]
      return other &&
        placement.id === other.id &&
        placement.w === other.w &&
        placement.h === other.h &&
        placement.hidden === other.hidden
    })
}

function sizeLabel(size: WidgetSize) {
  if (size.w === 2 && size.h === 2) return 'Large'
  if (size.w === 2) return 'Wide'
  if (size.h === 2) return 'Tall'
  return 'Small'
}

type SortableWidgetProps = {
  placement: WidgetPlacement
  widget: DashboardWidget
  editing: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (direction: -1 | 1) => void
  onResize: (size: WidgetSize) => void
  onHide: () => void
}

function SortableWidget({
  placement,
  widget,
  editing,
  canMoveUp,
  canMoveDown,
  onMove,
  onResize,
  onHide,
}: SortableWidgetProps) {
  const {
    attributes,
    isDragging,
    isOver,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: placement.id, disabled: !editing })

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <section
      ref={setNodeRef}
      style={style}
      className={[
        'dashboard-widget',
        editing ? 'is-customizing' : '',
        isDragging ? 'is-dragging' : '',
        isOver && !isDragging ? 'is-drop-target' : '',
      ].filter(Boolean).join(' ')}
      data-w={placement.w}
      data-h={placement.h}
      aria-label={widget.title}
    >
      {editing ? (
        <div className="dashboard-widget-tools" aria-label={`${widget.title} layout controls`}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                ref={setActivatorNodeRef}
                type="button"
                variant="outline"
                size="icon-sm"
                className="dashboard-widget-grip"
                aria-label={`Move ${widget.title}`}
                {...attributes}
                {...listeners}
              >
                <GripVertical />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Drag, or press Space then use arrow keys</TooltipContent>
          </Tooltip>

          <div className="dashboard-widget-position-buttons">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={!canMoveUp}
                  aria-label={`Move ${widget.title} earlier`}
                  onClick={() => onMove(-1)}
                >
                  <ArrowUp />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Move earlier</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={!canMoveDown}
                  aria-label={`Move ${widget.title} later`}
                  onClick={() => onMove(1)}
                >
                  <ArrowDown />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Move later</TooltipContent>
            </Tooltip>
          </div>

          {widget.allowedSizes.length > 1 ? (
            <Select
              value={sizeKey(placement)}
              onValueChange={(value) => {
                const selected = widget.allowedSizes.find((size) => sizeKey(size) === value)
                if (selected) onResize(selected)
              }}
            >
              <SelectTrigger
                size="sm"
                className="dashboard-widget-size-trigger"
                aria-label={`Size of ${widget.title}`}
              >
                <Scaling />
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="end">
                {widget.allowedSizes.map((size) => (
                  <SelectItem key={sizeKey(size)} value={sizeKey(size)}>
                    {sizeLabel(size)} · {sizeKey(size)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Hide ${widget.title}`}
                onClick={onHide}
              >
                <EyeOff />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Hide widget</TooltipContent>
          </Tooltip>
        </div>
      ) : null}

      {widget.render()}
    </section>
  )
}

export function DashboardCanvas({
  widgets,
  storageScope,
}: {
  widgets: DashboardWidget[]
  storageScope: string
}) {
  const [layout, setLayout] = useState<DashboardLayout>(
    () => reconcileLayout(widgets, loadStoredLayout(storageScope)),
  )
  const [draftLayout, setDraftLayout] = useState<DashboardLayout | null>(null)
  const [undoStack, setUndoStack] = useState<DashboardLayout[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  const widgetsById = useMemo(
    () => new Map(widgets.map((widget) => [widget.id, widget])),
    [widgets],
  )
  const editing = draftLayout !== null
  const reconciledLayout = useMemo(
    () => reconcileLayout(widgets, layout),
    // Widget availability changes with loaded data and the signed-in role.
    [layout, widgets],
  )
  const workingLayout = draftLayout
    ? reconcileLayout(widgets, draftLayout)
    : reconciledLayout
  const visible = workingLayout.filter((placement) => !placement.hidden && widgetsById.has(placement.id))
  const hidden = workingLayout.filter((placement) => placement.hidden && widgetsById.has(placement.id))
  const activeWidget = activeId ? widgetsById.get(activeId) : undefined

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  useEffect(() => {
    saveLayout(storageScope, layout)
  }, [layout, storageScope])

  const updateDraft = useCallback((
    updater: (current: DashboardLayout) => DashboardLayout,
  ) => {
    if (!draftLayout) return

    const next = updater(draftLayout)
    if (next === draftLayout || layoutsEqual(next, draftLayout)) return

    setUndoStack((current) => [...current, draftLayout].slice(-maxUndoDepth))
    setDraftLayout(next)
  }, [draftLayout])

  const beginEditing = () => {
    setDraftLayout(reconciledLayout.map((placement) => ({ ...placement })))
    setUndoStack([])
  }

  const cancelEditing = () => {
    setDraftLayout(null)
    setUndoStack([])
    setActiveId(null)
    toast('Dashboard changes discarded.')
  }

  const finishEditing = () => {
    if (!draftLayout) return

    const previous = reconciledLayout
    const next = draftLayout
    setDraftLayout(null)
    setUndoStack([])
    setActiveId(null)

    if (layoutsEqual(previous, next)) {
      toast('Dashboard layout is unchanged.')
      return
    }

    setLayout(next)
    toast.success('Dashboard layout saved.', {
      action: {
        label: 'Undo',
        onClick: () => setLayout(previous),
      },
    })
  }

  const undoDraft = () => {
    const previous = undoStack.at(-1)
    if (!previous) return

    setDraftLayout(previous)
    setUndoStack((current) => current.slice(0, -1))
  }

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id))
  }

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null)
    if (!over || active.id === over.id) return

    updateDraft((current) => reorderLayout(current, String(active.id), String(over.id)))
  }

  const resetDraft = () => {
    updateDraft(() => createDefaultLayout(widgets))
  }

  const setHidden = (id: string, hiddenValue: boolean) => {
    updateDraft((current) =>
      current.map((placement) =>
        placement.id === id ? { ...placement, hidden: hiddenValue } : placement,
      ),
    )
  }

  const hasDraftChanges = Boolean(draftLayout && !layoutsEqual(reconciledLayout, draftLayout))

  return (
    <TooltipProvider>
      <div className={`dashboard-workspace${editing ? ' is-customizing' : ''}`}>
        {!editing ? (
          <div className="dashboard-layout-launcher">
            <div>
              <strong>Dashboard layout</strong>
              <span>Arrange, resize, or hide widgets without affecting restaurant data.</span>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={beginEditing}>
              <Pencil />
              Customize
            </Button>
          </div>
        ) : (
          <motion.div
            className="dashboard-customize-panel"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.16 }}
          >
            <div className="dashboard-customize-heading">
              <div className="dashboard-customize-title">
                <LayoutGrid size={17} />
                <div>
                  <strong>Customize dashboard</strong>
                  <span>Drag cards, use the arrow buttons, or choose an exact size.</span>
                </div>
              </div>

              <div className="dashboard-customize-actions">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={undoStack.length === 0}
                  onClick={undoDraft}
                >
                  <Undo2 />
                  Undo
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={resetDraft}>
                  <RotateCcw />
                  Default
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={cancelEditing}>
                  <X />
                  Cancel
                </Button>
                <Button type="button" size="sm" onClick={finishEditing}>
                  <Check />
                  {hasDraftChanges ? 'Save layout' : 'Done'}
                </Button>
              </div>
            </div>

            <div className="dashboard-hidden-widgets" aria-label="Hidden dashboard widgets">
              <span>{hidden.length > 0 ? 'Hidden widgets' : 'All widgets are visible'}</span>
              {hidden.map((placement) => {
                const widget = widgetsById.get(placement.id)
                if (!widget) return null

                return (
                  <Button
                    key={placement.id}
                    type="button"
                    variant="outline"
                    size="xs"
                    aria-label={`Show ${widget.title}`}
                    onClick={() => setHidden(placement.id, false)}
                  >
                    <Eye />
                    {widget.title}
                  </Button>
                )
              })}
            </div>
          </motion.div>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragCancel={() => setActiveId(null)}
          onDragEnd={handleDragEnd}
          accessibility={{
            screenReaderInstructions: {
              draggable: 'Press Space to pick up a widget. Use the arrow keys to move it, Space to drop it, or Escape to cancel.',
            },
            announcements: {
              onDragStart: ({ active }) => `Picked up ${widgetsById.get(String(active.id))?.title ?? 'widget'}.`,
              onDragOver: ({ over }) => over
                ? `Over ${widgetsById.get(String(over.id))?.title ?? 'widget'}.`
                : 'Not over a dashboard widget.',
              onDragEnd: ({ active, over }) => over
                ? `${widgetsById.get(String(active.id))?.title ?? 'Widget'} moved before ${widgetsById.get(String(over.id))?.title ?? 'widget'}.`
                : 'Widget was not moved.',
              onDragCancel: ({ active }) => `${widgetsById.get(String(active.id))?.title ?? 'Widget'} move cancelled.`,
            },
          }}
        >
          <SortableContext
            items={visible.map((placement) => placement.id)}
            strategy={rectSortingStrategy}
          >
            <div className="dashboard-canvas">
              {visible.map((placement, index) => {
                const widget = widgetsById.get(placement.id)
                if (!widget) return null

                return (
                  <SortableWidget
                    key={placement.id}
                    placement={placement}
                    widget={widget}
                    editing={editing}
                    canMoveUp={index > 0}
                    canMoveDown={index < visible.length - 1}
                    onMove={(direction) => {
                      updateDraft((current) => moveVisibleWidget(current, placement.id, direction))
                    }}
                    onResize={(size) => {
                      updateDraft((current) => setWidgetSize(current, widget, size))
                    }}
                    onHide={() => setHidden(placement.id, true)}
                  />
                )
              })}

              {visible.length === 0 ? (
                <div className="dashboard-canvas-empty">
                  Every widget is hidden. Restore one from the customization panel.
                </div>
              ) : null}
            </div>
          </SortableContext>

          <DragOverlay dropAnimation={{ duration: 180, easing: 'ease-out' }}>
            {activeWidget ? (
              <div className="dashboard-drag-overlay">
                <GripVertical size={18} />
                <div>
                  <strong>{activeWidget.title}</strong>
                  <span>Move to a new position</span>
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </TooltipProvider>
  )
}
