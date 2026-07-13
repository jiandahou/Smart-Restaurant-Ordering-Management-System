import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import { Provider } from 'react-redux'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthContext.tsx'
import { TooltipProvider } from './components/ui/tooltip.tsx'
import { store } from './store.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <Provider store={store}>
        <BrowserRouter>
          <AuthProvider>
            <TooltipProvider>
              <App />
            </TooltipProvider>
          </AuthProvider>
        </BrowserRouter>
      </Provider>
    </ThemeProvider>
  </StrictMode>,
)
