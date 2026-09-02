import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { ToastProvider } from '@shared/core/hooks/useToast'
import '@shared/core/styles/responsive.css'
import './styles.css'
import { App } from './App'

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode><HashRouter><ToastProvider><App /></ToastProvider></HashRouter></React.StrictMode>,
)
if ('serviceWorker' in navigator && import.meta.env.PROD) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'))
