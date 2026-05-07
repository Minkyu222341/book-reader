// 간단한 캐시 우선 서비스 워커
const CACHE = 'book-reader-v1';
const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './src/styles.css',
    './src/parser.js',
    './src/db.js',
    './src/app.js',
    './src/main.js',
    'https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@300;400;500;600;700;900&family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Nanum+Myeongjo:wght@400;700;800&display=swap'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE).then(cache => {
            // 실패해도 install은 성공시키기 (외부 폰트가 차단된 상황 등)
            return Promise.allSettled(ASSETS.map(url => cache.add(url).catch(() => {})));
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);
    // 같은 origin이거나 폰트만 캐싱 처리
    if (e.request.method !== 'GET') return;

    e.respondWith(
        caches.match(e.request).then(cached => {
            if (cached) return cached;
            return fetch(e.request).then(resp => {
                // 동적으로 캐싱 (성공한 것만)
                if (resp.ok && (url.origin === location.origin || url.host.includes('fonts.g'))) {
                    const copy = resp.clone();
                    caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
                }
                return resp;
            }).catch(() => cached || Response.error());
        })
    );
});
