import { boot } from './app.js';

async function init() {
    try {
        await boot();
    } catch (e) {
        console.error('부팅 실패', e);
        document.getElementById('app-content').innerHTML =
            `<div style="color:#f4ecd8;text-align:center;padding:60px 20px;">초기화 실패: ${e.message}</div>`;
    } finally {
        // 로더 숨김
        const loader = document.getElementById('loader');
        if (loader) {
            loader.style.transition = 'opacity 0.5s ease';
            loader.style.opacity = '0';
            setTimeout(() => loader.remove(), 500);
        }
    }
}

// 서비스 워커 등록 + 새 버전 자동 갱신
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', async () => {
        try {
            const reg = await navigator.serviceWorker.register('./sw.js');

            // 새 버전 감지 시 자동 활성화
            reg.addEventListener('updatefound', () => {
                const newSW = reg.installing;
                if (!newSW) return;
                newSW.addEventListener('statechange', () => {
                    if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
                        // 새 버전이 설치됨 (기존 SW가 있는 상태) → 즉시 활성화 요청
                        newSW.postMessage({ type: 'SKIP_WAITING' });
                    }
                });
            });

            // controller 변경 감지 (새 SW가 실제로 활성화되면) → 페이지 1회 새로고침
            let reloaded = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (reloaded) return;
                reloaded = true;
                window.location.reload();
            });

            // 페이지가 다시 보일 때마다 업데이트 체크 (앱 켤 때마다)
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    reg.update().catch(() => {});
                }
            });
        } catch (err) {
            console.warn('SW 등록 실패:', err);
        }
    });
}

init();
