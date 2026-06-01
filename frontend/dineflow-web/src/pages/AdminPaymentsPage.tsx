import { zodResolver } from '@hookform/resolvers/zod'
import { CreditCard, ExternalLink, ReceiptText } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { createTestCheckoutSession } from '../api/auth'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../components/ui/form'
import { Input } from '../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'

const paymentTestSchema = z.object({
  name: z.string().min(1, 'Item name is required.'),
  amount: z.number().min(0.5, 'Amount must be at least 0.50.'),
  quantity: z.number().int('Quantity must be a whole number.').min(1, 'Quantity must be at least 1.'),
  currency: z.enum(['aud', 'usd', 'cad', 'gbp', 'eur']),
})

type PaymentTestFormValues = z.infer<typeof paymentTestSchema>

export function AdminPaymentsPage() {
  const form = useForm<PaymentTestFormValues>({
    resolver: zodResolver(paymentTestSchema),
    defaultValues: {
      name: 'DineFlow test order',
      amount: 25,
      quantity: 1,
      currency: 'aud',
    },
  })

  const handleSubmit = async (values: PaymentTestFormValues) => {
    try {
      const response = await createTestCheckoutSession({
        name: values.name,
        amountCents: Math.round(values.amount * 100),
        quantity: values.quantity,
        currency: values.currency,
      })

      toast.success('Checkout session created', {
        description: `Test order ${response.testOrderId}`,
      })

      window.location.assign(response.checkoutUrl)
    } catch (error) {
      toast.error('Could not create checkout session', {
        description: error instanceof Error ? error.message : 'Stripe checkout failed',
      })
    }
  }

  return (
    <main className="content-grid">
      <Card>
        <CardHeader>
          <div className="admin-page-title">
            <CreditCard size={22} />
            <div>
              <CardTitle>Payments</CardTitle>
              <CardDescription>Create a Stripe Checkout test session and verify the redirect flow.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="payment-test-layout">
          <Form {...form}>
            <form className="form-grid payment-test-form" onSubmit={form.handleSubmit(handleSubmit)}>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Test item</FormLabel>
                    <FormControl>
                      <Input autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="payment-test-row">
                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Amount</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0.5"
                          step="0.01"
                          {...field}
                          onChange={(event) => field.onChange(event.target.valueAsNumber)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="quantity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Quantity</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="1"
                          step="1"
                          {...field}
                          onChange={(event) => field.onChange(event.target.valueAsNumber)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="currency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Currency</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent position="popper">
                          <SelectItem value="aud">AUD</SelectItem>
                          <SelectItem value="usd">USD</SelectItem>
                          <SelectItem value="cad">CAD</SelectItem>
                          <SelectItem value="gbp">GBP</SelectItem>
                          <SelectItem value="eur">EUR</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                <ExternalLink size={18} />
                {form.formState.isSubmitting ? 'Creating session' : 'Create checkout session'}
              </Button>
            </form>
          </Form>
          <div className="payment-test-note">
            <ReceiptText size={20} />
            <div>
              <strong>Development-only payment test</strong>
              <span>
                This does not use real order data yet. The production checkout endpoint should accept an order ID and calculate totals on the backend.
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
