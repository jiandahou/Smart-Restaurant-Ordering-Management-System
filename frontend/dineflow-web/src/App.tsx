<<<<<<< HEAD
import { useState } from 'react'
import heroImg from './assets/hero.png'
import { OrdersPage } from './pages/OrdersPage'
import './App.css'

type BackendStatus = 'idle' | 'checking' | 'ok' | 'fail'
type CurrentPage = 'home' | 'orders'

type HealthResponse = {
  status?: string
  service?: string
  checkedAt?: string
}

function App() {
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('idle')
  const [backendMsg, setBackendMsg] = useState('Connection has not been checked yet')
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState<CurrentPage>('home')

  const checkBackend = async () => {
    setBackendStatus('checking')
    setBackendMsg('Connecting to the backend service...')
    setLastCheckedAt(null)

    try {
      const response = await fetch('/health', {
        headers: {
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data = (await response.json()) as HealthResponse
      const checkedAt = data.checkedAt
        ? new Date(data.checkedAt).toLocaleString()
        : new Date().toLocaleString()

      setBackendStatus('ok')
      setBackendMsg(`${data.service || 'DineFlow.Api'} is connected. Status: ${data.status || 'ok'}`)
      setLastCheckedAt(checkedAt)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setBackendStatus('fail')
      setBackendMsg(`Connection failed: ${message}`)
      setLastCheckedAt(new Date().toLocaleString())
    }
  }

  return (
    <div className="app">
      <nav className="app-nav">
        <div className="nav-container">
          <h1 className="nav-brand">DineFlow</h1>
          <ul className="nav-links">
            <li>
              <button
                className={`nav-link ${currentPage === 'home' ? 'active' : ''}`}
                onClick={() => setCurrentPage('home')}
              >
                Home
              </button>
            </li>
            <li>
              <button
                className={`nav-link ${currentPage === 'orders' ? 'active' : ''}`}
                onClick={() => setCurrentPage('orders')}
              >
                Orders
              </button>
            </li>
          </ul>
        </div>
      </nav>

      {currentPage === 'home' && (
        <section id="center">
          <div className="hero">
            <img src={heroImg} className="base" width="170" height="179" alt="" />
          </div>

          <div className="intro">
            <h1>DineFlow</h1>
            <p>Restaurant ordering system frontend console</p>
          </div>

          <div className={`connection-panel ${backendStatus}`}>
            <div className="status-row">
              <span className="status-dot" aria-hidden="true"></span>
              <span className="status-label">
                {backendStatus === 'ok'
                  ? 'Backend online'
                  : backendStatus === 'fail'
                    ? 'Backend unavailable'
                    : backendStatus === 'checking'
                      ? 'Checking'
                      : 'Waiting for check'}
              </span>
            </div>

            <p className="status-message">{backendMsg}</p>
            {lastCheckedAt && <p className="checked-at">Last checked: {lastCheckedAt}</p>}

            <button
              type="button"
              className="check-button"
              onClick={checkBackend}
              disabled={backendStatus === 'checking'}
            >
              {backendStatus === 'checking' ? 'Checking...' : 'Check backend connection'}
            </button>
          </div>
        </section>
      )}

      {currentPage === 'orders' && <OrdersPage />}
    </div>
=======
import { Navigate, Route, Routes } from 'react-router-dom'
import './App.css'
import { AppLayout } from './layout/AppLayout'
import {
  AdminDashboardPage,
  AdminMenuPage,
  AdminReportsPage,
  AdminRestaurantsPage,
} from './pages/AdminPlaceholderPage'
import { AdminOrdersPage } from './pages/AdminOrdersPage'
import { AdminPaymentsPage } from './pages/AdminPaymentsPage'
import { AdminUsersPage } from './pages/AdminUsersPage'
import { ChangeEmailPage } from './pages/ChangeEmailPage'
import { CheckEmailPage } from './pages/CheckEmailPage'
import { ConfirmEmailPage } from './pages/ConfirmEmailPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { LoginPage } from './pages/LoginPage'
import { MagicLinkLoginPage } from './pages/MagicLinkLoginPage'
import { OAuthCallbackPage } from './pages/OAuthCallbackPage'
import { PaymentResultPage } from './pages/PaymentResultPage'
import { ProfilePage } from './pages/ProfilePage'
import { RegisterCustomerPage } from './pages/RegisterCustomerPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
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
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/me" element={<ProfilePage />} />
            <Route element={<ProtectedRoute roles={['PlatformOwner', 'RestaurantOwner', 'Admin']} />}>
              <Route path="/admin" element={<AdminDashboardPage />} />
              <Route path="/admin/users" element={<AdminUsersPage />} />
              <Route path="/admin/restaurants" element={<AdminRestaurantsPage />} />
              <Route path="/admin/orders" element={<AdminOrdersPage />} />
              <Route path="/admin/menu" element={<AdminMenuPage />} />
              <Route path="/admin/payments" element={<AdminPaymentsPage />} />
              <Route path="/admin/reports" element={<AdminReportsPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/me" replace />} />
      </Routes>
      <Toaster position="top-center" richColors />
    </>
>>>>>>> origin/main
  )
}

export default App
