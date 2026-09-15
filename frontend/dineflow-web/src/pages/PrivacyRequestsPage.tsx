import { AlertCircle, Loader2, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import {
  createPrivacyRequest,
  getMyPrivacyRequests,
  type PrivacyRequestRecord,
  type PrivacyRequestType,
} from '@/api/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

/**
 * Where a customer asks about their own information, and sees what happened to the asking.
 *
 * <p>
 * The endpoints for this existed and nothing reached them: no page, no link, no route. The privacy
 * policy told people they could ask for access, correction or deletion, and then offered nowhere to
 * do it. A right that can only be exercised by emailing someone is a right most people never
 * exercise.
 * </p>
 *
 * <p>
 * The status list matters as much as the form. Someone who has asked to have their data deleted is
 * owed the knowledge that the request arrived and is being dealt with, rather than having to ask
 * again into the same silence.
 * </p>
 */

const requestTypes: { value: PrivacyRequestType; label: string; help: string }[] = [
  { value: 'Access', label: 'Access my information', help: 'A copy of the personal information held about you.' },
  { value: 'Correction', label: 'Correct my information', help: 'Something held about you is wrong or out of date.' },
  { value: 'Deletion', label: 'Delete my information', help: 'Removal of information no longer needed for a legal or operational reason.' },
  { value: 'Complaint', label: 'Make a privacy complaint', help: 'How your information has been collected, used or disclosed.' },
]

const statusLabels: Record<string, string> = {
  Received: 'Received',
  InProgress: 'In progress',
  Completed: 'Completed',
  Declined: 'Declined',
}

const minimumDetails = 10
const maximumDetails = 4000

export function PrivacyRequestsPage() {
  const [requests, setRequests] = useState<PrivacyRequestRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [requestType, setRequestType] = useState<PrivacyRequestType>('Access')
  const [details, setDetails] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    try {
      setRequests(await getMyPrivacyRequests())
    } catch (error) {
      toast.error('Could not load your privacy requests', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(load)
  }, [load])

  const trimmed = details.trim()
  const detailsTooShort = trimmed.length > 0 && trimmed.length < minimumDetails
  const canSubmit = trimmed.length >= minimumDetails && trimmed.length <= maximumDetails && !submitting

  const submit = async () => {
    if (!canSubmit) return

    setSubmitting(true)
    try {
      await createPrivacyRequest(requestType, trimmed)
      setDetails('')
      toast.success('Privacy request sent', {
        description: 'You can follow its progress below.',
      })
      await load()
    } catch (error) {
      toast.error('Could not send your request', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const selected = requestTypes.find((type) => type.value === requestType)

  return (
    <main className="mx-auto w-full max-w-3xl space-y-5 p-4 sm:p-6">
      <h1 className="flex items-center gap-2 font-heading text-xl font-medium">
        <ShieldCheck size={20} />
        Your privacy requests
      </h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Make a request</CardTitle>
          <CardDescription>
            Ask for a copy of the information held about you, have it corrected or deleted, or raise a
            complaint. See the{' '}
            <Link to="/privacy" className="underline">privacy policy</Link> for what is held and why.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="privacy-request-type">What would you like to ask for?</Label>
            <Select value={requestType} onValueChange={(value) => setRequestType(value as PrivacyRequestType)}>
              <SelectTrigger id="privacy-request-type" aria-label="Privacy request type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {requestTypes.map((type) => (
                  <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected ? <p className="text-xs text-muted-foreground">{selected.help}</p> : null}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="privacy-request-details">Tell us what you need</Label>
              <span className="text-xs text-muted-foreground">{trimmed.length}/{maximumDetails}</span>
            </div>
            <Textarea
              id="privacy-request-details"
              value={details}
              maxLength={maximumDetails}
              rows={5}
              placeholder="For example: please send me a copy of the orders and account details held about me."
              onChange={(event) => setDetails(event.target.value)}
              aria-describedby="privacy-request-details-help"
              aria-invalid={detailsTooShort}
            />
            <p id="privacy-request-details-help" className="text-xs text-muted-foreground">
              {detailsTooShort
                ? `Please write at least ${minimumDetails} characters so we know what to look for.`
                : 'We may need to confirm who you are before releasing or deleting account information.'}
            </p>
          </div>

          <Button type="button" disabled={!canSubmit} onClick={() => void submit()}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            Send request
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Requests you have made</CardTitle>
          <CardDescription>
            {/* Said plainly, because the alternative is asking again into the same silence. */}
            We aim to answer within 30 days. You will see the status change here as it is worked on.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading your requests…</p>
          ) : requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">You have not made any privacy requests yet.</p>
          ) : (
            <ul className="space-y-3">
              {requests.map((item) => (
                <li key={item.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-sm">
                      {requestTypes.find((type) => type.value === item.requestType)?.label ?? item.requestType}
                    </strong>
                    <span className="text-xs font-medium">{statusLabels[item.status] ?? item.status}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{item.details}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Sent {new Date(item.createdAt).toLocaleDateString('en-AU')}
                    {item.completedAt
                      ? ` · answered ${new Date(item.completedAt).toLocaleDateString('en-AU')}`
                      : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        Some information must be kept for a legal or accounting reason even after a deletion request —
        the privacy policy says which, and we will tell you if that applies to yours.
      </p>
    </main>
  )
}
