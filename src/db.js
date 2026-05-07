// =====================================================
// IndexedDB 저장소
// =====================================================
// 책: { id, title, author, parts, addedAt, fileSize }
// 진행률: { bookId, currentChapter, currentPagePair, fontSize, lastReadAt }
// 북마크: { id, bookId, chapterIdx, pagePair, snippet, note, createdAt }
// =====================================================

const DB_NAME = 'BookReaderDB';
const DB_VERSION = 1;
const STORE_BOOKS = 'books';
const STORE_PROGRESS = 'progress';
const STORE_BOOKMARKS = 'bookmarks';

let _db = null;

function openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => { _db = req.result; resolve(_db); };
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_BOOKS)) {
                const s = db.createObjectStore(STORE_BOOKS, { keyPath: 'id' });
                s.createIndex('addedAt', 'addedAt');
            }
            if (!db.objectStoreNames.contains(STORE_PROGRESS)) {
                db.createObjectStore(STORE_PROGRESS, { keyPath: 'bookId' });
            }
            if (!db.objectStoreNames.contains(STORE_BOOKMARKS)) {
                const s = db.createObjectStore(STORE_BOOKMARKS, { keyPath: 'id' });
                s.createIndex('bookId', 'bookId');
            }
        };
    });
}

function tx(storeName, mode = 'readonly') {
    return openDB().then(db => {
        const t = db.transaction(storeName, mode);
        return t.objectStore(storeName);
    });
}

function reqAsPromise(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// === Books ===
export async function saveBook(book) {
    const store = await tx(STORE_BOOKS, 'readwrite');
    return reqAsPromise(store.put(book));
}

export async function getBook(id) {
    const store = await tx(STORE_BOOKS);
    return reqAsPromise(store.get(id));
}

export async function listBooks() {
    const store = await tx(STORE_BOOKS);
    return reqAsPromise(store.getAll());
}

export async function deleteBook(id) {
    // 책 + 관련 진행률 + 북마크 모두 제거
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const t = db.transaction([STORE_BOOKS, STORE_PROGRESS, STORE_BOOKMARKS], 'readwrite');
        t.objectStore(STORE_BOOKS).delete(id);
        t.objectStore(STORE_PROGRESS).delete(id);
        // 북마크는 인덱스로 찾아서 일괄 삭제
        const idx = t.objectStore(STORE_BOOKMARKS).index('bookId');
        const req = idx.openCursor(IDBKeyRange.only(id));
        req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            }
        };
        t.oncomplete = resolve;
        t.onerror = () => reject(t.error);
    });
}

// === Progress ===
export async function saveProgress(bookId, data) {
    const store = await tx(STORE_PROGRESS, 'readwrite');
    return reqAsPromise(store.put({ bookId, ...data, lastReadAt: Date.now() }));
}

export async function getProgress(bookId) {
    const store = await tx(STORE_PROGRESS);
    return reqAsPromise(store.get(bookId));
}

// === Bookmarks ===
export async function addBookmark(bookmark) {
    const store = await tx(STORE_BOOKMARKS, 'readwrite');
    return reqAsPromise(store.put(bookmark));
}

export async function listBookmarks(bookId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const t = db.transaction(STORE_BOOKMARKS, 'readonly');
        const idx = t.objectStore(STORE_BOOKMARKS).index('bookId');
        const req = idx.getAll(IDBKeyRange.only(bookId));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function deleteBookmark(id) {
    const store = await tx(STORE_BOOKMARKS, 'readwrite');
    return reqAsPromise(store.delete(id));
}

// === 유틸 ===
export function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

// === 앱 전역 설정 (localStorage) ===
const APP_SETTINGS_KEY = 'bookreader.appSettings';
const DEFAULT_SETTINGS = {
    // 모바일 터치 영역 비율 (전체 폭 기준 0~1)
    touchPrev: 0.30,    // 좌측 30% → 이전 페이지
    touchNext: 0.30,    // 우측 30% → 다음 페이지
    // 중앙 영역(나머지)은 탭하면 메뉴 토글
    tapCenterAction: 'menu', // 'menu' | 'next' | 'none'
};

export function getAppSettings() {
    try {
        const raw = localStorage.getItem(APP_SETTINGS_KEY);
        if (!raw) return { ...DEFAULT_SETTINGS };
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_SETTINGS, ...parsed };
    } catch (e) {
        return { ...DEFAULT_SETTINGS };
    }
}

export function saveAppSettings(settings) {
    try {
        localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) { console.warn('설정 저장 실패', e); }
}
