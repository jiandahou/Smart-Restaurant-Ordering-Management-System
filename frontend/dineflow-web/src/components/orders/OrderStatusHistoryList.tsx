import type { AdminOrderStatusHistory } from '../../api/auth'
import { OrderStatusBadge } from './OrderStatusBadge'

function formatDate(value: string | null) {
  if (!value) {
    return 'Not yet'
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function OrderStatusHistoryList({
  history,
  loading,
}: {
  history: AdminOrderStatusHistory[] | undefined
  loading: boolean
}) {
  if (loading) {
    return <div className="order-refund-empty">Loading status history...</div>
  }

  if (!history || history.length === 0) {
    return <div className="order-refund-empty">No status changes have been recorded yet.</div>
  }

  return (
    <div className="order-status-history-list">
      {history.map((entry) => (
        <div key={entry.id} className="order-status-history-card">
          <div className="order-status-history-main">
            <OrderStatusBadge status={entry.previousStatus} />
            <span>to</span>
            <OrderStatusBadge status={entry.newStatus} />
          </div>
          <div className="order-refund-meta">
            <span>{entry.action || 'Status change'}</span>
            <span>{formatDate(entry.createdAt)}</span>
          </div>
          {entry.reason && (
            <div className="order-refund-reason">
              <strong>Reason</strong>
              <span>{entry.reason}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
