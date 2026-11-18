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
/**
 * Service Worker 注册 + 版本接管。
 *
 * 为什么需要 controllerchange 这一段：sw.js 里用了 skipWaiting + clients.claim，
 * 新版本会立刻接管，但**当前页面跑的还是旧 JS 包**。代码上线后用户仍然看到旧版报错
 * （例如已经被替换掉的 `Load failed` 原文），就是这个原因。新 SW 接管后刷新一次即可。
 * 首次访问时 controller 本来是 null，这次接管不能刷新——会打断刚进站的用户。
 */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const hadController = Boolean(navigator.serviceWorker.controller)
    let reloading = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return
      reloading = true
      window.location.reload()
    })
    void navigator.serviceWorker.register('/sw.js')
  })
}
