import { CircleCheck, CircleX, UserRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'

type PaymentResultPageProps = {
  result: 'success' | 'cancelled'
}

export function PaymentResultPage({ result }: PaymentResultPageProps) {
  const isSuccess = result === 'success'
  const Icon = isSuccess ? CircleCheck : CircleX

  return (
    <main className="login-screen">
      <Card className="login-card payment-result-card">
        <CardHeader>
          <p className="eyebrow">DineFlow</p>
          <CardTitle>{isSuccess ? 'Payment submitted' : 'Payment cancelled'}</CardTitle>
          <CardDescription>
            {isSuccess
              ? 'Thanks. We are confirming your payment and will update your order shortly.'
              : 'No payment was taken. You can return to your account and try again when ready.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="form-grid">
          <div className={`confirm-status ${isSuccess ? 'success' : 'error'}`}>
            <Icon size={22} />
            <span>{isSuccess ? 'Payment is being confirmed' : 'Payment was cancelled'}</span>
          </div>
          <p className="auth-note">
            {isSuccess
              ? 'You can safely return to your account while payment confirmation finishes.'
              : 'Your order has not been paid yet.'}
          </p>
          <Button asChild>
            <Link to="/me">
              <UserRound size={18} />
              Back to user center
            </Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
