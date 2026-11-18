/**
 * 应用外壳缓存。
 *
 * 只做两件事：让 PWA 能离线打开、让第二次进入不用重新下载资源。
 *
 * 两条硬约束：
 *   1. `/api/` 一律放行——接口必须直连网络，缓存了会返回过期数据；
 *   2. **导航请求强制绕过 HTTP 缓存**（cache: 'reload'）。曾经出现过「代码上线了、
 *      用户还看到旧版报错」：SW 的 network-first 其实命中浏览器磁盘缓存里的旧
 *      index.html，于是加载的是一整包旧 JS。改完必须升 CACHE 版本号，
 *      否则老 SW 不会重装、旧缓存也不会被清掉。
 */
const CACHE = 'civil-exam-shell-v4'
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return
  // 导航请求必须拿最新的 index.html：它指向带 hash 的 JS 包，文件一旦更新，
  // 旧 index.html 就会去加载已经不在服务器上的旧包。
  const request =
    event.request.mode === 'navigate' ? new Request(event.request, { cache: 'reload' }) : event.request
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()))
        return response
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/index.html'))),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus()
      }
      return self.clients.openWindow('/#/plan')
    }),
  )
})
