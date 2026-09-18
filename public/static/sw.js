/* NOVA CODE Service Worker — full offline shell.
   Strategy:
   - App shell + all static assets: cache-first (served from disk, zero network).
   - /api/*: network-only (this is the ONLY thing that touches the internet — a few KB per message).
   - Background refresh of the shell so updates arrive silently. */
const VERSION = 'nova-v6'
const SHELL = [
  '/',
  '/static/app.css',
  '/static/store.js',
  '/static/app.js',
  '/static/app2.js',
  '/static/manifest.json',
  '/static/icon.svg',
  '/static/vendor/tw.css',
  '/static/vendor/hljs.css',
  '/static/vendor/hljs.min.js',
  '/static/vendor/marked.min.js',
  '/static/vendor/purify.min.js',
  '/static/vendor/jszip.min.js',
  '/static/vendor/fa/all.min.css',
  '/static/vendor/fa/webfonts/fa-solid-900.woff2',
  '/static/vendor/fa/webfonts/fa-regular-400.woff2',
  '/static/vendor/fa/webfonts/fa-brands-400.woff2',
  '/static/vendor/fa/webfonts/fa-v4compatibility.woff2',
  '/static/vendor/fonts/fonts.css',
]

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then(async (c) => {
      await c.addAll(SHELL)
      // fonts referenced from fonts.css
      try {
        const css = await (await c.match('/static/vendor/fonts/fonts.css')).text()
        const files = [...css.matchAll(/url\(([^)]+\.ttf)\)/g)].map((m) => '/static/vendor/fonts/' + m[1].replace(/['"]/g, ''))
        await c.addAll([...new Set(files)])
      } catch {}
    }).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (url.origin !== location.origin) return // never touch third-party (there is none)
  if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js' || url.pathname === '/static/sw.js') return // network-only, streaming

  if (e.request.method !== 'GET') return
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((cached) => {
      // stale-while-revalidate: serve instantly from disk, refresh silently in background
      const refresh = fetch(e.request).then((res) => { if (res.ok) caches.open(VERSION).then((c) => c.put(e.request, res.clone())); return res }).catch(() => null)
      return cached || refresh.then((r) => r || (url.pathname === '/' ? caches.match('/') : new Response('offline', { status: 503 })))
    })
  )
})

// allow the page to ask for the cache to be warmed / cleared
self.addEventListener('message', (e) => {
  if (e.data === 'clear') caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)))
})
