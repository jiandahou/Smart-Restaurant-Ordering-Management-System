import { useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Check, ChevronsUpDown, Mail, Send } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { sendTestEmail, type UserListItem } from '../../api/auth'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../ui/command'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../ui/form'
import { Input } from '../ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'

const emailTestSchema = z.object({
  to: z.email('Enter a valid recipient email.'),
  subject: z.string().min(1, 'Subject is required.'),
  message: z.string().min(1, 'Message is required.'),
})

type EmailTestFormValues = z.infer<typeof emailTestSchema>

type EmailTestCardProps = {
  users: UserListItem[]
  canSendEmail: boolean
}

export function EmailTestCard({ users, canSendEmail }: EmailTestCardProps) {
  const [recipientOpen, setRecipientOpen] = useState(false)
  const recipientOptions = useMemo(() => {
    return users
      .filter((user): user is UserListItem & { email: string } => Boolean(user.email))
      .toSorted((first, second) => first.email.localeCompare(second.email))
  }, [users])

  const form = useForm<EmailTestFormValues>({
    resolver: zodResolver(emailTestSchema),
    defaultValues: {
      to: '',
      subject: 'DineFlow email test',
      message: 'Your DineFlow email configuration is working.',
    },
  })

  const selectedEmail = form.watch('to')

  const handleSubmit = async (values: EmailTestFormValues) => {
    if (!canSendEmail) {
      toast.error('Could not send email', {
        description: 'Only platform owners can send test emails.',
      })
      return
    }

    try {
      const response = await sendTestEmail({
        to: values.to.trim(),
        subject: values.subject.trim(),
        message: values.message.trim(),
      })

      toast.success('Test email sent', {
        description: response.message,
      })
    } catch (sendError) {
      toast.error('Could not send test email', {
        description: sendError instanceof Error ? sendError.message : 'Failed to send email',
      })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email</CardTitle>
        <CardDescription>Send a Resend SMTP test message from the backend.</CardDescription>
      </CardHeader>
      <CardContent>
        {!canSendEmail && (
          <p className="form-error">Only platform owners can send test emails.</p>
        )}
        <Form {...form}>
          <form className="form-grid email-test-form" onSubmit={form.handleSubmit(handleSubmit)}>
            <FormField
              control={form.control}
              name="to"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Recipient</FormLabel>
                  <div className="recipient-row">
                    <FormControl>
                      <Input type="email" autoComplete="email" placeholder="name@example.com" {...field} />
                    </FormControl>
                    <Popover open={recipientOpen} onOpenChange={setRecipientOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          className="recipient-picker-trigger"
                          disabled={recipientOptions.length === 0}
                        >
                          <Mail size={16} />
                          User
                          <ChevronsUpDown size={14} />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="recipient-picker-content">
                        <Command>
                          <CommandInput placeholder="Search users..." />
                          <CommandList>
                            <CommandEmpty>No matching users.</CommandEmpty>
                            <CommandGroup>
                              {recipientOptions.map((user) => (
                                <CommandItem
                                  key={user.id}
                                  value={`${user.email} ${user.fullName ?? ''} ${user.roles.join(' ')}`}
                                  data-checked={selectedEmail === user.email}
                                  onSelect={() => {
                                    form.setValue('to', user.email, {
                                      shouldDirty: true,
                                      shouldValidate: true,
                                    })
                                    setRecipientOpen(false)
                                  }}
                                >
                                  <div className="recipient-option">
                                    <strong>{user.fullName || 'Not set'}</strong>
                                    <span>{user.email}</span>
                                  </div>
                                  {selectedEmail === user.email && <Check size={16} />}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="subject"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Subject</FormLabel>
                  <FormControl>
                    <Input placeholder="DineFlow email test" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="message"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Message</FormLabel>
                  <FormControl>
                    <Input placeholder="Your DineFlow email configuration is working." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={form.formState.isSubmitting || !canSendEmail}>
              <Send size={18} />
              {form.formState.isSubmitting ? 'Sending email' : 'Send test email'}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
