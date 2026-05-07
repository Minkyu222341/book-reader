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

// 서비스 워커 등록 (file:// 로 열린 경우엔 스킵)
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => {
            console.warn('SW 등록 실패:', err);
        });
    });
}

init();
