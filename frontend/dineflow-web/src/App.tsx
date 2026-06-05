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
  )
}

export default App
