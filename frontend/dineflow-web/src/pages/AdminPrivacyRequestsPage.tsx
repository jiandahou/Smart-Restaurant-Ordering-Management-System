import { AlertTriangle, Loader2, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import {
  getAllPrivacyRequests,
  updatePrivacyRequestStatus,
  type AdminPrivacyRequestRecord,
  type PrivacyRequestStatus,
} from '@/api/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

/**
 * Where privacy requests are actually answered.
 *
 * <p>
 * Customers could file these and nobody was ever shown one: the request went into a table with no
 * screen behind it and no way to move it along. That is not a missing feature so much as a missed
 * deadline — an access or correction request carries thirty days, counting from the day the person
 * asked, and the clock was running against a queue nobody could see.
 * </p>
 *
 * <p>
 * Ordered oldest-open-first and led by the days remaining, because the only question this screen has
 * to answer at a glance is which request runs out of time next.
 * </p>
 */

const statusLabels: Record<string, string> = {
  Received: 'Received',
  InProgress: 'In progress',
  Completed: 'Completed',
  Declined: 'Declined',
}

const typeLabels: Record<string, string> = {
  Access: 'Access',
  Correction: 'Correction',
  Deletion: 'Deletion',
  Complaint: 'Complaint',
}

/** What can be done next, mirroring PrivacyRequestWorkflow on the server. */
function nextSteps(status: string): PrivacyRequestStatus[] {
  if (status === 'Received') return ['InProgress', 'Completed', 'Declined']
  if (status === 'InProgress') return ['Completed', 'Declined']
  return []
}

function describeClock(request: AdminPrivacyRequestRecord) {
  if (request.daysRemaining === null) return 'Answered'
  if (request.daysRemaining < 0) return `${Math.abs(request.daysRemaining)} days overdue`
  if (request.daysRemaining === 0) return 'Due today'
  return `${request.daysRemaining} days left`
}

export function AdminPrivacyRequestsPage() {
  const [requests, setRequests] = useState<AdminPrivacyRequestRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [openOnly, setOpenOnly] = useState(true)
  const [pending, setPending] = useState<
    { request: AdminPrivacyRequestRecord; status: PrivacyRequestStatus } | null
  >(null)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async (only: boolean) => {
    setLoading(true)
    try {
      setRequests(await getAllPrivacyRequests(only))
    } catch (error) {
      toast.error('Could not load privacy requests', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(() => load(openOnly))
  }, [load, openOnly])

  const confirm = async () => {
    if (!pending) return

    setSubmitting(true)
    try {
      await updatePrivacyRequestStatus(pending.request.id, pending.status, note.trim() || undefined)
      toast.success(`Request marked ${statusLabels[pending.status] ?? pending.status}`)
      setPending(null)
      setNote('')
      await load(openOnly)
    } catch (error) {
      toast.error('Could not update the request', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const overdue = requests.filter((request) => request.isOverdue).length

  return (
    <main className="mx-auto w-full max-w-4xl space-y-4 p-4 sm:p-6">
      <h1 className="flex items-center gap-2 font-heading text-xl font-medium">
        <ShieldCheck size={20} />
        Privacy requests
      </h1>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Queue</CardTitle>
            <CardDescription>
              Access, correction, deletion and complaint requests from customers. Answer within 30
              days of the date the request was made.
            </CardDescription>
          </div>
          <Button type="button" variant="outline" onClick={() => setOpenOnly((current) => !current)}>
            {openOnly ? 'Show answered too' : 'Show open only'}
          </Button>
        </CardHeader>

        {overdue > 0 ? (
          <CardContent className="pt-0">
            <p className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertTriangle className="size-4 shrink-0" />
              {overdue} request{overdue === 1 ? ' is' : 's are'} past the 30-day deadline.
            </p>
          </CardContent>
        ) : null}

        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading requests…</p>
          ) : requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {openOnly ? 'No open privacy requests.' : 'No privacy requests have been made.'}
            </p>
          ) : requests.map((request) => (
            <article key={request.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{typeLabels[request.requestType] ?? request.requestType}</Badge>
                  <Badge variant="secondary">{statusLabels[request.status] ?? request.status}</Badge>
                  <span
                    className={cn('text-xs font-medium', request.isOverdue && 'text-destructive')}
                    data-testid={`privacy-clock-${request.id}`}
                  >
                    {describeClock(request)}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {request.requesterName || request.requesterEmail || 'Account removed'}
                </span>
              </div>

              <p className="mt-2 whitespace-pre-wrap text-sm">{request.details}</p>

              <p className="mt-2 text-xs text-muted-foreground">
                Received {new Date(request.createdAt).toLocaleDateString('en-AU')}
                {request.requesterEmail ? ` · ${request.requesterEmail}` : ''}
              </p>

              {nextSteps(request.status).length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {nextSteps(request.status).map((status) => (
                    <Button
                      key={status}
                      type="button"
                      size="sm"
                      variant={status === 'Declined' ? 'destructive' : 'outline'}
                      onClick={() => {
                        setPending({ request, status })
                        setNote('')
                      }}
                    >
                      Mark {statusLabels[status].toLowerCase()}
                    </Button>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </CardContent>
      </Card>

      <Dialog open={pending !== null} onOpenChange={(open) => { if (!open && !submitting) setPending(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Mark {pending ? statusLabels[pending.status].toLowerCase() : ''}
            </DialogTitle>
            <DialogDescription>
              {pending?.status === 'Declined'
                // The one move the person is owed an explanation for, and the first thing an
                // investigation asks to see.
                ? 'Say why this request was declined. The reason is kept on the audit record.'
                : 'Add a note about what was done. It is kept on the audit record.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="privacy-status-note">
              {pending?.status === 'Declined' ? 'Reason' : 'Note'}
            </Label>
            <Textarea
              id="privacy-status-note"
              value={note}
              rows={4}
              maxLength={2000}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={submitting || (pending?.status === 'Declined' && note.trim().length === 0)}
              onClick={() => void confirm()}
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
