import { Suspense, lazy } from 'react'
import { Route, Routes } from 'react-router-dom'
import './App.css'
import { ProtectedRoute } from './routes/ProtectedRoute'
import { Toaster } from './components/ui/sonner'
import { LegalFooter } from './components/LegalFooter'

/**
 * Every page is a chunk of its own.
 *
 * <p>
 * The whole application used to arrive in one 1.9 MB script. A customer scanning a QR code at a
 * table downloaded the admin console, the reports screens and the thermal-printer driver before the
 * menu could paint — on the phone, on the restaurant's wifi, at the moment they are deciding
 * whether ordering here is worth the trouble. The three audiences share almost no screens, so
 * splitting on the route boundary is splitting on the audience boundary.
 * </p>
 *
 * <p>
 * The shell — layout, route guards, footer, toasts — stays eager. It is small, it is needed on
 * every route, and deferring it would only add a second waterfall in front of the page.
 * </p>
 */

// The signed-in shell, and with it the QZ transport and the thermal-printer driver. Static, these
// arrived for everyone: a customer opening a table menu never reaches this route and was
// downloading its printer stack anyway.
const AppLayout = lazy(() => import('./layout/AppLayout').then((module) => ({ default: module.AppLayout })))
const RestaurantPrintingProvider = lazy(() =>
  import('./printing/RestaurantPrintingContext').then((module) => ({ default: module.RestaurantPrintingProvider })))

const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage').then((module) => ({ default: module.AdminDashboardPage })))
const AdminMenuPage = lazy(() => import('./pages/AdminMenuPage').then((module) => ({ default: module.AdminMenuPage })))
const AdminOrdersPage = lazy(() => import('./pages/AdminOrdersPage').then((module) => ({ default: module.AdminOrdersPage })))
const AdminPaymentsPage = lazy(() => import('./pages/AdminPaymentsPage').then((module) => ({ default: module.AdminPaymentsPage })))
const AdminReportsPage = lazy(() => import('./pages/AdminReportsPage').then((module) => ({ default: module.AdminReportsPage })))
const AdminBillingPage = lazy(() => import('./pages/AdminBillingPage').then((module) => ({ default: module.AdminBillingPage })))
const AdminRestaurantsPage = lazy(() => import('./pages/AdminRestaurantsPage').then((module) => ({ default: module.AdminRestaurantsPage })))
const AdminPrivacyRequestsPage = lazy(() => import('./pages/AdminPrivacyRequestsPage').then((module) => ({ default: module.AdminPrivacyRequestsPage })))
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage').then((module) => ({ default: module.AdminUsersPage })))
const ChangeEmailPage = lazy(() => import('./pages/ChangeEmailPage').then((module) => ({ default: module.ChangeEmailPage })))
const CheckEmailPage = lazy(() => import('./pages/CheckEmailPage').then((module) => ({ default: module.CheckEmailPage })))
const ConfirmEmailPage = lazy(() => import('./pages/ConfirmEmailPage').then((module) => ({ default: module.ConfirmEmailPage })))
const CheckoutPage = lazy(() => import('./pages/CheckoutPage').then((module) => ({ default: module.CheckoutPage })))
const CustomerMenuPage = lazy(() => import('./pages/CustomerMenuPage').then((module) => ({ default: module.CustomerMenuPage })))
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage').then((module) => ({ default: module.ForgotPasswordPage })))
const FrontCounterPage = lazy(() => import('./pages/FrontCounterPage').then((module) => ({ default: module.FrontCounterPage })))
const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })))
const MagicLinkLoginPage = lazy(() => import('./pages/MagicLinkLoginPage').then((module) => ({ default: module.MagicLinkLoginPage })))
const MyOrdersPage = lazy(() => import('./pages/MyOrdersPage').then((module) => ({ default: module.MyOrdersPage })))
const OAuthCallbackPage = lazy(() => import('./pages/OAuthCallbackPage').then((module) => ({ default: module.OAuthCallbackPage })))
const PaymentResultPage = lazy(() => import('./pages/PaymentResultPage').then((module) => ({ default: module.PaymentResultPage })))
const PrivacyRequestsPage = lazy(() => import('./pages/PrivacyRequestsPage').then((module) => ({ default: module.PrivacyRequestsPage })))
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((module) => ({ default: module.ProfilePage })))
const RegisterCustomerPage = lazy(() => import('./pages/RegisterCustomerPage').then((module) => ({ default: module.RegisterCustomerPage })))
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage').then((module) => ({ default: module.ResetPasswordPage })))
const StaffOrdersPage = lazy(() => import('./pages/StaffOrdersPage').then((module) => ({ default: module.StaffOrdersPage })))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then((module) => ({ default: module.NotFoundPage })))
const AllergenInformationPage = lazy(() => import('./pages/LegalPages').then((module) => ({ default: module.AllergenInformationPage })))
const ContactPage = lazy(() => import('./pages/LegalPages').then((module) => ({ default: module.ContactPage })))
const CustomerTermsPage = lazy(() => import('./pages/LegalPages').then((module) => ({ default: module.CustomerTermsPage })))
const PrivacyPolicyPage = lazy(() => import('./pages/LegalPages').then((module) => ({ default: module.PrivacyPolicyPage })))
const RefundPolicyPage = lazy(() => import('./pages/LegalPages').then((module) => ({ default: module.RefundPolicyPage })))
const RestaurantTermsPage = lazy(() => import('./pages/LegalPages').then((module) => ({ default: module.RestaurantTermsPage })))

function App() {
  return (
    <>
      {/* One boundary around the whole table: a per-route boundary would remount the fallback on
          every navigation, and the chunks are small enough that nobody sees this twice. */}
      <Suspense fallback={<div className="route-loading" role="status" aria-live="polite">Loading…</div>}>
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
          <Route path="/privacy" element={<PrivacyPolicyPage />} />
          <Route path="/terms/customer" element={<CustomerTermsPage />} />
          <Route path="/terms/restaurant" element={<RestaurantTermsPage />} />
          <Route path="/refunds-and-cancellations" element={<RefundPolicyPage />} />
          <Route path="/allergen-information" element={<AllergenInformationPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/r/:restaurantId/menu" element={<CustomerMenuPage />} />
          <Route path="/table/:qrToken" element={<CustomerMenuPage />} />
          <Route element={(
            <RestaurantPrintingProvider>
              <AppLayout />
            </RestaurantPrintingProvider>
          )}>
            <Route path="/my-orders" element={<MyOrdersPage />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/me" element={<ProfilePage />} />
              {/* The privacy policy tells people they can ask for access, correction or deletion.
                  Until this route existed there was nowhere to do it. */}
              <Route path="/me/privacy-requests" element={<PrivacyRequestsPage />} />
              <Route element={<ProtectedRoute roles={['PlatformOwner', 'RestaurantOwner', 'Admin', 'Staff']} />}>
                <Route element={<ProtectedRoute roles={['PlatformOwner', 'RestaurantOwner', 'Admin', 'Staff']} />}>
                  <Route path="/staff/orders" element={<StaffOrdersPage />} />
                  <Route path="/staff/front-counter" element={<FrontCounterPage />} />
                </Route>
                <Route path="/admin" element={<AdminDashboardPage />} />
                <Route path="/admin/orders" element={<AdminOrdersPage />} />
                {/* Platform owner only: a privacy request concerns a person's information across the
                    whole platform, not one venue's copy of it. */}
                <Route element={<ProtectedRoute roles={['PlatformOwner']} />}>
                  <Route path="/admin/privacy-requests" element={<AdminPrivacyRequestsPage />} />
                </Route>
                <Route element={<ProtectedRoute roles={['PlatformOwner', 'RestaurantOwner', 'Admin']} />}>
                  <Route path="/admin/users" element={<AdminUsersPage />} />
                  <Route path="/admin/restaurants" element={<AdminRestaurantsPage />} />
                  <Route path="/admin/menu" element={<AdminMenuPage />} />
                  <Route path="/admin/payments" element={<AdminPaymentsPage />} />
                  <Route path="/admin/billing" element={<AdminBillingPage />} />
                  <Route path="/admin/reports" element={<AdminReportsPage />} />
                </Route>
              </Route>
            </Route>
          </Route>
          {/* A wrong address is a different problem from a permission one; sending both to the
              profile page made them impossible to tell apart. */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
      <LegalFooter />
      <Toaster position="top-center" richColors />
    </>
  )
}

export default App
