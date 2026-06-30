import { Navigate, Route, Routes } from 'react-router-dom'
import 'flag-icons/css/flag-icons.min.css'
import './App.css'
import { AppLayout } from './layout/AppLayout'
import { AdminDashboardPage } from './pages/AdminDashboardPage'
import { AdminMenuPage } from './pages/AdminMenuPage'
import { AdminOrdersPage } from './pages/AdminOrdersPage'
import { AdminPaymentsPage } from './pages/AdminPaymentsPage'
import { AdminReportsPage } from './pages/AdminReportsPage'
import { AdminRestaurantsPage } from './pages/AdminRestaurantsPage'
import { AdminUsersPage } from './pages/AdminUsersPage'
import { ChangeEmailPage } from './pages/ChangeEmailPage'
import { CheckEmailPage } from './pages/CheckEmailPage'
import { ConfirmEmailPage } from './pages/ConfirmEmailPage'
import { CheckoutPage } from './pages/CheckoutPage'
import { CustomerMenuPage } from './pages/CustomerMenuPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { LoginPage } from './pages/LoginPage'
import { MagicLinkLoginPage } from './pages/MagicLinkLoginPage'
import { MyOrdersPage } from './pages/MyOrdersPage'
import { OAuthCallbackPage } from './pages/OAuthCallbackPage'
import { PaymentResultPage } from './pages/PaymentResultPage'
import { ProfilePage } from './pages/ProfilePage'
import { RegisterCustomerPage } from './pages/RegisterCustomerPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { StaffOrdersPage } from './pages/StaffOrdersPage'
import { ProtectedRoute } from './routes/ProtectedRoute'
import { Toaster } from './components/ui/sonner'

function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterCustomerPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/change-email" element={<ChangeEmailPage />} />
        <Route path="/check-email" element={<CheckEmailPage />} />
        <Route path="/confirm-email" element={<ConfirmEmailPage />} />
        <Route path="/magic-login" element={<MagicLinkLoginPage />} />
        <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
        <Route path="/payment/success" element={<PaymentResultPage result="success" />} />
        <Route path="/payment/cancelled" element={<PaymentResultPage result="cancelled" />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/r/:restaurantId/menu" element={<CustomerMenuPage />} />
        <Route path="/table/:qrToken" element={<CustomerMenuPage />} />
        <Route element={<AppLayout />}>
          <Route path="/my-orders" element={<MyOrdersPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/me" element={<ProfilePage />} />
            <Route element={<ProtectedRoute roles={['PlatformOwner', 'RestaurantOwner', 'Admin', 'Staff']} />}>
              <Route element={<ProtectedRoute roles={['PlatformOwner', 'RestaurantOwner', 'Admin', 'Staff']} />}>
                <Route path="/staff/orders" element={<StaffOrdersPage />} />
              </Route>
              <Route path="/admin" element={<AdminDashboardPage />} />
              <Route path="/admin/orders" element={<AdminOrdersPage />} />
              <Route element={<ProtectedRoute roles={['PlatformOwner', 'RestaurantOwner', 'Admin']} />}>
                <Route path="/admin/users" element={<AdminUsersPage />} />
                <Route path="/admin/restaurants" element={<AdminRestaurantsPage />} />
                <Route path="/admin/menu" element={<AdminMenuPage />} />
                <Route path="/admin/payments" element={<AdminPaymentsPage />} />
                <Route path="/admin/reports" element={<AdminReportsPage />} />
              </Route>
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/me" replace />} />
      </Routes>
      <Toaster position="top-center" richColors />
    </>
  )
}

export default App
