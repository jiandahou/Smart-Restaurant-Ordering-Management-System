import {
  forwardRef,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'

type HorizontalTableScrollProps = {
  children: ReactNode
  topScrollLabel: string
}

export const HorizontalTableScroll = forwardRef<HTMLDivElement, HorizontalTableScrollProps>(
  function HorizontalTableScroll({ children, topScrollLabel }, ref) {
    const topScrollRef = useRef<HTMLDivElement | null>(null)
    const viewportRef = useRef<HTMLDivElement | null>(null)
    const syncingScroll = useRef(false)
    const [contentWidth, setContentWidth] = useState(0)
    const [hasHorizontalOverflow, setHasHorizontalOverflow] = useState(false)

    useImperativeHandle(ref, () => viewportRef.current as HTMLDivElement, [])

    useEffect(() => {
      const viewport = viewportRef.current

      if (!viewport) {
        return undefined
      }

      const updateMetrics = () => {
        const nextContentWidth = viewport.scrollWidth
        setContentWidth(nextContentWidth)
        setHasHorizontalOverflow(nextContentWidth > viewport.clientWidth + 1)

        if (topScrollRef.current) {
          topScrollRef.current.scrollLeft = viewport.scrollLeft
        }
      }

      const resizeObserver = new ResizeObserver(updateMetrics)
      resizeObserver.observe(viewport)

      for (const child of Array.from(viewport.children)) {
        resizeObserver.observe(child)
      }

      const animationFrame = window.requestAnimationFrame(updateMetrics)
      window.addEventListener('resize', updateMetrics)

      return () => {
        window.cancelAnimationFrame(animationFrame)
        window.removeEventListener('resize', updateMetrics)
        resizeObserver.disconnect()
      }
    }, [children])

    const syncScroll = (
      source: HTMLDivElement | null,
      target: HTMLDivElement | null,
    ) => {
      if (!source || !target || syncingScroll.current) {
        return
      }

      syncingScroll.current = true
      target.scrollLeft = source.scrollLeft

      window.requestAnimationFrame(() => {
        syncingScroll.current = false
      })
    }

    return (
      <div className={`table-scroll-area${hasHorizontalOverflow ? ' has-horizontal-overflow' : ''}`}>
        <div
          ref={topScrollRef}
          className="table-scroll-top"
          aria-label={topScrollLabel}
          tabIndex={hasHorizontalOverflow ? 0 : -1}
          onScroll={() => syncScroll(topScrollRef.current, viewportRef.current)}
        >
          <div className="table-scroll-spacer" style={{ width: contentWidth }} />
        </div>
        <div
          ref={viewportRef}
          className="table-wrap"
          onScroll={() => syncScroll(viewportRef.current, topScrollRef.current)}
        >
          {children}
        </div>
      </div>
    )
  },
)
