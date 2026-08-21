import { useState } from 'react'
import { AlertTriangle, Bell, CheckCircle2, CircleAlert, Info, Printer, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export type OperationalNoticeSeverity = 'error' | 'warning' | 'success' | 'info'

export type OperationalNotice = {
  id: string
  severity: OperationalNoticeSeverity
  title: string
  message: string
  actionLabel?: string
  onAction?: () => void
  createdAt?: number
}

const severityRank: Record<OperationalNoticeSeverity, number> = {
  error: 0,
  warning: 1,
  success: 2,
  info: 3,
}

export function sortOperationalNotices(notices: OperationalNotice[]): OperationalNotice[] {
  return [...notices].sort((first, second) => {
    const severityDifference = severityRank[first.severity] - severityRank[second.severity]
    if (severityDifference !== 0) return severityDifference
    return (second.createdAt ?? 0) - (first.createdAt ?? 0)
  })
}

function NoticeIcon({ notice }: { notice: OperationalNotice }) {
  if (notice.severity === 'error') return <CircleAlert size={18} />
  if (notice.severity === 'warning') return notice.id.startsWith('printer-')
    ? <Printer size={18} />
    : <AlertTriangle size={18} />
  if (notice.severity === 'success') return <CheckCircle2 size={18} />
  return <Info size={18} />
}

export function OperationalNotificationButton({
  notices,
  compact = false,
}: {
  notices: OperationalNotice[]
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const sortedNotices = sortOperationalNotices(notices)
  const highestSeverity = sortedNotices[0]?.severity
  const unresolvedCount = notices.filter((notice) => notice.severity === 'error' || notice.severity === 'warning').length

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={cn('operational-notification-trigger', compact && 'mobile-topbar-icon')}
          aria-label={notices.length > 0 ? `Operational notifications: ${notices.length}` : 'Operational notifications: all clear'}
        >
          <Bell size={18} />
          {highestSeverity ? <span className="operational-notification-dot" data-severity={highestSeverity} /> : null}
          {unresolvedCount > 0 ? (
            <span className="operational-notification-count">{unresolvedCount > 9 ? '9+' : unresolvedCount}</span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="operational-notification-popover">
        <div className="operational-notification-heading">
          <div>
            <strong>Operations</strong>
            <span>Payments, printing and order activity</span>
          </div>
          <span>{notices.length}</span>
        </div>

        {sortedNotices.length > 0 ? (
          <div className="operational-notification-list">
            {sortedNotices.map((notice) => (
              <article key={notice.id} className="operational-notification-item" data-severity={notice.severity}>
                <span className="operational-notification-item-icon"><NoticeIcon notice={notice} /></span>
                <div>
                  <strong>{notice.title}</strong>
                  <span>{notice.message}</span>
                  {notice.actionLabel && notice.onAction ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setOpen(false)
                        notice.onAction?.()
                      }}
                    >
                      {notice.actionLabel}
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="operational-notification-empty">
            <CheckCircle2 size={24} />
            <strong>All clear</strong>
            <span>No payment or printing issues need attention.</span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export function OperationalNotificationBanner({
  notice,
  onDismiss,
}: {
  notice: OperationalNotice
  onDismiss: () => void
}) {
  return (
    <section className="operational-notification-banner" data-severity={notice.severity} role="status">
      <span className="operational-notification-banner-icon"><NoticeIcon notice={notice} /></span>
      <div>
        <strong>{notice.title}</strong>
        <span>{notice.message}</span>
      </div>
      {notice.actionLabel && notice.onAction ? (
        <Button type="button" variant="outline" size="sm" onClick={notice.onAction}>
          {notice.actionLabel}
        </Button>
      ) : null}
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Dismiss notification banner" onClick={onDismiss}>
        <X size={16} />
      </Button>
    </section>
  )
}
