// 캐시 이름 — 빌드 시 build.py가 __BUILD_VERSION__ 부분을 timestamp로 치환합니다
const CACHE = 'book-reader-v1778127319';

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
        caches.open(CACHE).then(cache =>
            Promise.allSettled(ASSETS.map(url => cache.add(url).catch(() => {})))
        ).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// Network-first (자기 도메인) / Cache-first (외부 폰트)
self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET') return;
    const url = new URL(e.request.url);
    const isOwnOrigin = url.origin === location.origin;
    const isFont = url.host.includes('fonts.g');

    if (isOwnOrigin) {
        e.respondWith(
            fetch(e.request).then(resp => {
                if (resp.ok) {
                    const copy = resp.clone();
                    caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
                }
                return resp;
            }).catch(() =>
                caches.match(e.request).then(c => c || Response.error())
            )
        );
    } else if (isFont) {
        e.respondWith(
            caches.match(e.request).then(cached =>
                cached || fetch(e.request).then(resp => {
                    if (resp.ok) {
                        const copy = resp.clone();
                        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
                    }
                    return resp;
                })
            )
        );
    }
});

self.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
