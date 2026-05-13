import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { DialogProvider } from './components/Dialog'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastProvider } from './components/Toast'
import { initTheme } from './lib/theme'
import './index.css'

initTheme()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <DialogProvider>
          <App />
        </DialogProvider>
      </ToastProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
