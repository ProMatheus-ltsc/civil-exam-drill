import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { ToastProvider } from '@shared/core/hooks/useToast'
import { AuthProvider } from '@shared/core/auth'
import '@shared/core/styles/responsive.css'
import './styles.css'
import { App } from './App'
import { restAuthDriver } from './api/authDriver'

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode><HashRouter><ToastProvider>
    {/* 认证 Provider（shared-core 统一认证，本项目走服务端 REST + HttpOnly Cookie） */}
    <AuthProvider driver={restAuthDriver} errorMode="throw">
      <App />
    </AuthProvider>
  </ToastProvider></HashRouter></React.StrictMode>,
)
if ('serviceWorker' in navigator && import.meta.env.PROD) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'))
