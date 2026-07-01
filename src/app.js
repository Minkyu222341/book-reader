// =====================================================
// 메인 UI: 라이브러리 + 뷰어
// =====================================================
import { parseNovel } from './parser.js';
import { PageFlip } from '../vendor/page-flip.module.js';
import {
    saveBook, getBook, listBooks, deleteBook,
    saveProgress, getProgress,
    addBookmark, listBookmarks, deleteBookmark,
    generateId,
    getAppSettings, saveAppSettings
} from './db.js';

// =====================================================
// 상태
// =====================================================
const state = {
    view: 'library',       // 'library' | 'reader'
    books: [],             // 라이브러리의 책 목록 (메타만)
    currentBook: null,     // 현재 읽는 책 (전체 데이터)
    flatChapters: [],
    currentChapter: -1,    // -1 = 표지
    currentPagePair: 0,
    pages: [],
    fontSize: 17,
    bookmarks: [],
    sidePanelTab: 'toc',
    appSettings: getAppSettings()
};

// =====================================================
// 유틸
// =====================================================
function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function classifyParagraph(text) {
    const t = text.trim();
    if (!t) return null;
    const isDialogue = /^[“"‘'「『]/.test(t) || /^[—\-]/.test(t);
    return { text: t, isDialogue };
}

let _toastTimer = null;
export function showToast(msg, duration = 1800) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => t.classList.remove('show'), duration);
}

// =====================================================
// 챕터 평탄화
// =====================================================
function buildFlatChapters(book) {
    const flat = [];
    book.parts.forEach((part, pi) => {
        flat.push({
            partIdx: pi,
            partTitle: part.title,
            chapterIdx: -1,
            title: part.title,
            isPartCover: true,
            paragraphs: []
        });
        part.chapters.forEach((ch, ci) => {
            // 텍스트를 단락으로 쪼개기
            const blocks = [];
            let buf = [];
            const lines = ch.text.split('\n');
            for (const ln of lines) {
                if (ln.trim() === '') {
                    if (buf.length > 0) {
                        blocks.push(buf.join(' ').trim());
                        buf = [];
                    }
                } else {
                    buf.push(ln.trim());
                }
            }
            if (buf.length > 0) blocks.push(buf.join(' ').trim());
            const paragraphs = blocks.filter(b => b.length > 0);
            flat.push({
                partIdx: pi,
                partTitle: part.title,
                chapterIdx: ci,
                title: ch.title,
                isPartCover: false,
                paragraphs: paragraphs
            });
        });
    });
    return flat;
}

// =====================================================
// 페이지네이션
// =====================================================
function paginate(chapter) {
    const measure = document.getElementById('measure');
    if (!measure) return [{ type: 'text', html: '' }];
    measure.innerHTML = '';

    // 부 표지는 사이즈 측정 없이 즉시 반환
    if (chapter.isPartCover) {
        const partNum = chapter.partTitle.match(/^(\d+)부/);
        const partNumStr = partNum ? partNum[1] : '';
        const isSide = chapter.partTitle.startsWith('외전');
        let label = isSide ? 'SIDE STORY' : `PART ${partNumStr}`;
        let numDisplay = isSide ? '外' : partNumStr;
        const partTitleClean = isSide
            ? chapter.partTitle.replace(/^외전\s*[—-]\s*/, '').trim()
            : chapter.partTitle.replace(/^\d+부\s*[:：]\s*/, '').trim();
        return [{
            type: 'partcover',
            html: `<div class="part-cover">
                <div class="label">${esc(label)}</div>
                <div class="num">${esc(numDisplay)}</div>
                <div class="title">${esc(partTitleClean || chapter.partTitle)}</div>
                <div class="ornament">✦ ✦ ✦</div>
            </div>`
        }];
    }

    const realContent = document.getElementById('content-right');
    if (!realContent) return [{ type: 'text', html: '' }];
    const coverSpread = document.getElementById('cover-spread');
    if (coverSpread) coverSpread.style.display = 'none';

    const rect = realContent.getBoundingClientRect();
    const targetHeight = rect.height;
    const targetWidth = rect.width;

    if (targetHeight < 50 || targetWidth < 50) {
        return [{
            type: 'text',
            html: chapter.paragraphs.map(p => `<p>${esc(p)}</p>`).join('')
        }];
    }

    const sample = document.createElement('div');
    sample.className = 'page-content';
    sample.style.cssText = `
        width: ${targetWidth}px;
        height: auto;
        max-height: none;
        overflow: visible;
        font-size: ${state.fontSize}px;
        position: absolute;
    `;
    measure.appendChild(sample);

    const pages = [];
    let isFirstPage = true;

    function makePageHtml(paragraphs, includeTitle) {
        const titleHtml = includeTitle
            ? `<h2 class="chapter-title">${esc(chapter.title)}</h2>`
            : '';
        const body = paragraphs.map(p => {
            const c = classifyParagraph(p);
            if (!c) return '';
            const cls = c.isDialogue ? ' class="dialogue"' : '';
            return `<p${cls}>${esc(c.text)}</p>`;
        }).join('');
        return titleHtml + body;
    }

    function fits(html) {
        sample.innerHTML = html;
        return sample.scrollHeight <= targetHeight;
    }

    let i = 0;
    const N = chapter.paragraphs.length;

    while (i < N) {
        const tryParagraphs = [];
        let placed = 0;

        while (i + placed < N) {
            tryParagraphs.push(chapter.paragraphs[i + placed]);
            const html = makePageHtml(tryParagraphs, isFirstPage);
            if (!fits(html)) {
                if (tryParagraphs.length === 1) {
                    placed++;
                    break;
                }
                tryParagraphs.pop();
                break;
            }
            placed++;
        }

        if (placed === 0) placed = 1;

        const pageParagraphs = chapter.paragraphs.slice(i, i + placed);
        pages.push({
            type: 'text',
            html: makePageHtml(pageParagraphs, isFirstPage)
        });
        isFirstPage = false;
        i += placed;
    }

    if (pages.length === 0) {
        pages.push({
            type: 'text',
            html: `<h2 class="chapter-title">${esc(chapter.title)}</h2>`
        });
    }

    measure.innerHTML = '';
    return pages;
}

function rebuildPages() {
    if (state.currentChapter === -1) {
        state.pages = [];
        return;
    }
    const ch = state.flatChapters[state.currentChapter];
    if (!ch) return;

    // PageFlip 활성 시 .page.right가 hidden 상태 → 측정 위해 임시로 layout 차지하게
    const pageRight = document.getElementById('page-right');
    const wasHidden = pageRight && pageRight.style.display === 'none';
    if (wasHidden) {
        pageRight.style.visibility = 'hidden';
        pageRight.style.display = '';
    }

    state.pages = paginate(ch);

    if (wasHidden) {
        pageRight.style.display = 'none';
        pageRight.style.visibility = '';
    }
}

// =====================================================
// 뷰: 책장 (라이브러리)
// =====================================================
async function renderLibrary() {
    const books = await listBooks();
    state.books = books;

    // 진행률을 가져와서 책 카드에 표시
    const progressMap = {};
    for (const b of books) {
        const p = await getProgress(b.id);
        if (p) progressMap[b.id] = p;
    }

    const sortedBooks = books.slice().sort((a, b) => {
        const pa = progressMap[a.id]?.lastReadAt || a.addedAt;
        const pb = progressMap[b.id]?.lastReadAt || b.addedAt;
        return pb - pa;
    });

    let html = `
        <div id="library-view">
            <div class="lib-header">
                <div class="lib-header-text">
                    <h1 class="lib-title">나의 서재</h1>
                    <p class="lib-subtitle">${books.length === 0 ? '텍본 파일을 업로드해 책장을 채워보세요' : `${books.length}권의 책`}</p>
                </div>
                <button class="lib-add-mini" id="lib-add-mini" title="텍본 추가" aria-label="텍본 추가"></button>
                <input type="file" id="file-input" accept=".txt,text/plain" style="display:none" multiple>
            </div>

            <div class="lib-shelves" id="lib-shelves">
    `;

    if (books.length === 0) {
        html += `
            <div class="lib-empty">
                <h2>아직 책이 없습니다</h2>
                <p>우측 상단의 <strong>＋</strong> 버튼을 눌러<br>.txt 파일을 추가해주세요.</p>
            </div>
        `;
    } else {
        html += '<div class="book-grid">';
        for (const book of sortedBooks) {
            const prog = progressMap[book.id];
            const totalCh = book._chapterCount || 0;
            let progPct = 0;
            let progLabel = '읽지 않음';
            if (prog) {
                if (prog.currentChapter === -1) {
                    progLabel = '표지';
                } else {
                    progPct = Math.round(((prog.currentChapter + 1) / totalCh) * 100);
                    progLabel = `${progPct}% 읽음`;
                }
            }

            // 책등 색깔: 책마다 다르게
            const colors = [
                ['#5e2620', '#8b3a2f'],   // 와인
                ['#1f3d2e', '#2d5a44'],   // 깊은 녹색
                ['#1f2d4d', '#33477a'],   // 네이비
                ['#3d2417', '#5e3a26'],   // 갈색
                ['#3d1f47', '#5d3068'],   // 보라
                ['#4d2a1a', '#7a4528'],   // 황토
            ];
            const colorIdx = hashCode(book.id) % colors.length;
            const [c1, c2] = colors[colorIdx];

            html += `
                <div class="book-card" data-book-id="${esc(book.id)}">
                    <div class="book-cover" style="background: linear-gradient(135deg, ${c1} 0%, ${c2} 100%);">
                        <div class="book-cover-inner">
                            <div class="book-cover-deco-top"></div>
                            <div class="book-cover-title">${esc(book.title)}</div>
                            <div class="book-cover-divider"></div>
                            <div class="book-cover-author">${esc(book.author)}</div>
                            <div class="book-cover-deco-bottom"></div>
                        </div>
                    </div>
                    <div class="book-info">
                        <div class="book-info-title">${esc(book.title)}</div>
                        <div class="book-info-meta">
                            <span class="book-info-progress">${progLabel}</span>
                            ${progPct > 0 ? `<div class="book-progress-bar"><div style="width:${progPct}%"></div></div>` : ''}
                        </div>
                    </div>
                    <button class="book-edit" data-edit="${esc(book.id)}" title="제목 수정">✎</button>
                    <button class="book-delete" data-del="${esc(book.id)}" title="삭제">×</button>
                </div>
            `;
        }
        html += '</div>';
    }

    html += `
            </div>
        </div>
    `;

    document.getElementById('app-content').innerHTML = html;

    // 이벤트 바인딩
    document.getElementById('lib-add-mini').addEventListener('click', () => {
        document.getElementById('file-input').click();
    });
    document.getElementById('file-input').addEventListener('change', handleFileUpload);

    document.querySelectorAll('.book-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.dataset.del || e.target.dataset.edit) return;
            openBook(card.dataset.bookId);
        });
    });
    document.querySelectorAll('[data-del]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.del;
            if (confirm('이 책을 삭제할까요? (북마크와 진행률도 함께 삭제됩니다)')) {
                await deleteBook(id);
                showToast('삭제되었습니다');
                renderLibrary();
            }
        });
    });
    document.querySelectorAll('[data-edit]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.edit;
            const book = await getBook(id);
            if (!book) return;
            const newTitle = prompt('새 제목을 입력하세요', book.title);
            if (newTitle === null) return; // 취소
            const trimmed = newTitle.trim();
            if (!trimmed || trimmed === book.title) return;
            book.title = trimmed;
            await saveBook(book);
            showToast('제목이 변경되었습니다');
            renderLibrary();
        });
    });

    // 드래그 & 드롭
    setupDragDrop();
}

function hashCode(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) - h) + str.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h);
}

function setupDragDrop() {
    const target = document.getElementById('lib-shelves');
    if (!target) return;

    let dragOverlay = document.getElementById('drag-overlay');
    if (!dragOverlay) {
        dragOverlay = document.createElement('div');
        dragOverlay.id = 'drag-overlay';
        dragOverlay.innerHTML = '<div class="drag-msg">텍본 파일을 놓으세요</div>';
        document.body.appendChild(dragOverlay);
    }

    let dragCounter = 0;
    document.addEventListener('dragenter', (e) => {
        e.preventDefault();
        if (state.view !== 'library') return;
        dragCounter++;
        dragOverlay.classList.add('show');
    });
    document.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            dragOverlay.classList.remove('show');
        }
    });
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', async (e) => {
        e.preventDefault();
        dragCounter = 0;
        dragOverlay.classList.remove('show');
        if (state.view !== 'library') return;
        const files = Array.from(e.dataTransfer?.files || []);
        const txtFiles = files.filter(f => f.name.toLowerCase().endsWith('.txt') || f.type === 'text/plain');
        if (txtFiles.length === 0) {
            showToast('.txt 파일만 업로드 가능합니다');
            return;
        }
        await processFiles(txtFiles);
    });
}

// =====================================================
// 파일 업로드 처리
// =====================================================
async function handleFileUpload(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // 같은 파일 다시 선택 가능하도록
    if (files.length === 0) return;
    await processFiles(files);
}

async function processFiles(files) {
    const overlay = document.createElement('div');
    overlay.className = 'upload-overlay';
    overlay.innerHTML = `<div class="upload-progress"><div class="upload-spinner"></div><div class="upload-text" id="upload-text">처리 중...</div></div>`;
    document.body.appendChild(overlay);

    const textEl = document.getElementById('upload-text');
    let success = 0;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        textEl.textContent = `${i + 1}/${files.length} · ${file.name} 처리 중...`;
        try {
            const text = await readFileAsText(file);
            const parsed = parseNovel(text, { fileName: file.name });
            if (parsed.parts.length === 0 || parsed.stats.charCount < 100) {
                showToast(`"${file.name}": 본문이 너무 짧습니다`);
                continue;
            }

            // 책 데이터 저장
            const book = {
                id: generateId(),
                title: parsed.title,
                author: parsed.author,
                parts: parsed.parts,
                addedAt: Date.now(),
                fileSize: text.length,
                fileName: file.name,
                _chapterCount: parsed.stats.chapterCount
            };
            await saveBook(book);
            success++;
        } catch (err) {
            console.error(err);
            showToast(`"${file.name}" 처리 실패`);
        }
        // UI 업데이트
        await new Promise(r => setTimeout(r, 30));
    }

    overlay.remove();
    if (success > 0) showToast(`${success}권의 책이 추가되었습니다`);
    renderLibrary();
}

async function readFileAsText(file) {
    const buf = await file.arrayBuffer();
    // UTF-8 우선 시도. fatal:true라 잘못된 바이트열이면 예외 → 옛 텍본용 EUC-KR(CP949)로 재시도.
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
        return new TextDecoder('euc-kr').decode(buf);
    }
}

// =====================================================
// 뷰: 리더
// =====================================================
async function openBook(bookId) {
    const book = await getBook(bookId);
    if (!book) {
        showToast('책을 찾을 수 없습니다');
        return;
    }
    state.currentBook = book;
    state.flatChapters = buildFlatChapters(book);
    state.bookmarks = await listBookmarks(bookId);

    // 진행률 복원
    const progress = await getProgress(bookId);
    if (progress) {
        state.currentChapter = progress.currentChapter ?? -1;
        state.currentPagePair = progress.currentPagePair ?? 0;
        state.fontSize = progress.fontSize ?? 17;
    } else {
        state.currentChapter = -1;
        state.currentPagePair = 0;
        state.fontSize = 17;
    }

    // 범위 보호
    if (state.currentChapter < -1 || state.currentChapter >= state.flatChapters.length) {
        state.currentChapter = -1;
        state.currentPagePair = 0;
    }

    state.view = 'reader';
    history.pushState({ view: 'reader', bookId }, '');
    renderReader();

    // 첫 책 진입 시 탭 영역 안내 (1회만)
    if (!localStorage.getItem('hint-tap-zones-shown')) {
        setTimeout(() => {
            showToast('좌/우 끝 탭으로 페이지 이동 · 영역은 설정에서 조정', 4500);
            localStorage.setItem('hint-tap-zones-shown', '1');
        }, 1500);
    }
}

function renderReader() {
    const html = `
        <div id="reader-view">
            <div id="toolbar">
                <button class="tb-btn" id="btn-toc" title="목차 (T)">≡</button>
                <button class="tb-btn tb-icon" id="btn-bookmark-add" title="북마크 추가 (B)" aria-label="북마크 추가">
                    <svg viewBox="0 0 14 18" width="14" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M2 1 L12 1 L12 17 L7 13 L2 17 Z"/></svg>
                </button>
                <span class="tb-title" id="tb-title">${esc(state.currentBook.title)}</span>
                <span class="tb-progress" id="progress-text">—</span>
                <button class="tb-btn desktop-only" id="btn-settings" title="설정 (S)">⚙</button>
            </div>
            <button class="settings-fab mobile-only" id="btn-settings-mobile" title="설정" aria-label="설정">⚙</button>

            <div id="book-stage">
                <div id="book">
                    <!-- 표지 -->
                    <div id="cover-spread" style="display: none; width: 100%; height: 100%;">
                        <div class="cover-side">
                            <div class="cover-side-text">
                                ${esc(state.currentBook.title)}<br><br>
                                <span style="font-family: 'Cormorant Garamond', serif; font-style: italic; font-size: 13px; letter-spacing: 0.2em; color: rgba(212,175,95,0.5);">written by</span><br>
                                <span style="font-size: 18px; letter-spacing: 0.2em;">${esc(state.currentBook.author)}</span>
                            </div>
                            <div class="cover-side-hint">Open the book</div>
                            <div class="cover-side-arrow">›</div>
                        </div>
                        <div id="cover">
                            <div class="cover-border cover-border-outer"></div>
                            <div class="cover-border cover-border-inner"></div>
                            ${cornerSvg('tl')}${cornerSvg('tr')}${cornerSvg('bl')}${cornerSvg('br')}
                            <div class="cover-inner">
                                <div class="cover-pretitle">A Novel</div>
                                ${emblemSvg()}
                                <h1 class="cover-title">${esc(state.currentBook.title)}</h1>
                                <div class="cover-divider"></div>
                                <div class="cover-author-label">Written by</div>
                                <div class="cover-author">${esc(state.currentBook.author)}</div>
                            </div>
                        </div>
                    </div>

                    <!-- 본문 (측정 + 표지/부표지 fallback용) -->
                    <div class="page left" id="page-left">
                        <div class="page-header" id="header-left"></div>
                        <div class="page-content" id="content-left"></div>
                        <div class="page-footer" id="footer-left"></div>
                    </div>
                    <div class="page right" id="page-right">
                        <div class="page-header" id="header-right"></div>
                        <div class="page-content" id="content-right"></div>
                        <div class="page-footer" id="footer-right"></div>
                        <div class="bookmark-ribbon" id="bookmark-ribbon" title="북마크 있음"></div>
                    </div>

                    <!-- PageFlip 마운트 (본문 챕터 시 활성) -->
                    <div id="pageflip-mount" style="display:none"></div>

                    <div class="nav-zone left" id="nav-prev" title="이전 (←)">
                        <span class="nav-arrow">‹</span>
                    </div>
                    <div class="nav-zone right" id="nav-next" title="다음 (→)">
                        <span class="nav-arrow">›</span>
                    </div>

                    <!-- 모바일 터치 가이드 (설정에서 영역 조절 시에만 표시) -->
                    <div id="touch-guide" class="touch-guide">
                        <div class="tg-zone tg-prev" id="tg-prev"><span>이전</span></div>
                        <div class="tg-zone tg-center" id="tg-center"><span>메뉴</span></div>
                        <div class="tg-zone tg-next" id="tg-next"><span>다음</span></div>
                    </div>
                </div>
            </div>

            <!-- 패널 백드롭 (외부 클릭 시 닫기 + 시각 효과) -->
            <div id="panel-backdrop"></div>

            <!-- 사이드 패널 -->
            <div id="side-panel">
                <div class="sp-tabs">
                    <button class="sp-tab active" data-tab="toc">목차</button>
                    <button class="sp-tab" data-tab="bookmarks">북마크</button>
                </div>
                <div class="sp-content" id="sp-content"></div>
            </div>

            <!-- 설정 패널 -->
            <div id="settings-panel">
                <div class="settings-row">
                    <div class="settings-h">글자 크기</div>
                    <div class="font-size-controls">
                        <button class="fs-btn" id="fs-down">A-</button>
                        <span class="fs-display" id="fs-display">${state.fontSize}</span>
                        <button class="fs-btn" id="fs-up">A+</button>
                    </div>
                </div>

                <div class="settings-row">
                    <div class="settings-h">페이지 전환</div>
                    <div class="seg-row">
                        <button class="seg-btn ${state.appSettings.pageTransition === 'curl' ? 'active' : ''}" data-transition="curl">책장 넘김</button>
                        <button class="seg-btn ${state.appSettings.pageTransition === 'none' ? 'active' : ''}" data-transition="none">즉시 전환</button>
                    </div>
                </div>

                <div class="settings-row mobile-only">
                    <div class="settings-h">탭 영역</div>
                    <div class="settings-desc">화면 좌/우 끝을 탭하면 페이지 이동, 가운데를 탭하면 메뉴가 열립니다.</div>
                    <div class="touch-zones-preview" id="touch-zones-preview">
                        <div class="tzp-prev" id="tzp-prev"></div>
                        <div class="tzp-center"></div>
                        <div class="tzp-next" id="tzp-next"></div>
                        <div class="tzp-label tzp-label-prev">이전</div>
                        <div class="tzp-label tzp-label-center">메뉴</div>
                        <div class="tzp-label tzp-label-next">다음</div>
                    </div>
                    <div class="slider-row">
                        <label>좌측(이전) 영역</label>
                        <input type="range" id="touch-prev-slider" min="10" max="45" step="5" value="${Math.round(state.appSettings.touchPrev * 100)}">
                        <span class="slider-val" id="touch-prev-val">${Math.round(state.appSettings.touchPrev * 100)}%</span>
                    </div>
                    <div class="slider-row">
                        <label>우측(다음) 영역</label>
                        <input type="range" id="touch-next-slider" min="10" max="45" step="5" value="${Math.round(state.appSettings.touchNext * 100)}">
                        <span class="slider-val" id="touch-next-val">${Math.round(state.appSettings.touchNext * 100)}%</span>
                    </div>
                    <div class="settings-h" style="margin-top:18px;">중앙 탭 동작</div>
                    <div class="seg-row">
                        <button class="seg-btn ${state.appSettings.tapCenterAction === 'menu' ? 'active' : ''}" data-center="menu">메뉴 토글</button>
                        <button class="seg-btn ${state.appSettings.tapCenterAction === 'next' ? 'active' : ''}" data-center="next">다음 페이지</button>
                        <button class="seg-btn ${state.appSettings.tapCenterAction === 'none' ? 'active' : ''}" data-center="none">없음</button>
                    </div>
                </div>

                <div class="settings-row desktop-only">
                    <div class="settings-h">단축키</div>
                    <div class="shortcut-row"><span>다음 페이지</span><kbd>→ / Space</kbd></div>
                    <div class="shortcut-row"><span>이전 페이지</span><kbd>←</kbd></div>
                    <div class="shortcut-row"><span>목차 / 북마크</span><kbd>T</kbd></div>
                    <div class="shortcut-row"><span>북마크 추가</span><kbd>B</kbd></div>
                    <div class="shortcut-row"><span>설정</span><kbd>S</kbd></div>
                    <div class="shortcut-row"><span>표지로</span><kbd>H</kbd></div>
                    <div class="shortcut-row"><span>다음 챕터</span><kbd>Shift + →</kbd></div>
                </div>
            </div>

            <!-- 모달 -->
            <div class="modal-backdrop" id="modal-backdrop">
                <div class="modal">
                    <div class="modal-h">북마크 추가</div>
                    <div class="modal-info" id="modal-info"></div>
                    <textarea id="modal-note" placeholder="메모 (선택사항)"></textarea>
                    <div class="modal-actions">
                        <button class="modal-btn" id="modal-cancel">취소</button>
                        <button class="modal-btn primary" id="modal-save">저장</button>
                    </div>
                </div>
            </div>

            <div id="measure"></div>
        </div>
    `;
    document.getElementById('app-content').innerHTML = html;

    document.documentElement.style.setProperty('--font-size', state.fontSize + 'px');
    bindReaderEvents();

    // 페이지 빌드 (폰트 로드 대기)
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
            setTimeout(() => {
                rebuildPages();
                _flip3dSkipNext = true;
                renderCurrentSpread();
            }, 50);
        });
    } else {
        setTimeout(() => {
            rebuildPages();
            _flip3dSkipNext = true;
            renderCurrentSpread();
        }, 100);
    }
}

function cornerSvg(pos) {
    const transform = {
        tl: '', tr: 'transform: scaleX(-1);',
        bl: 'transform: scaleY(-1);', br: 'transform: scale(-1, -1);'
    }[pos];
    return `<svg class="cover-corner cover-corner-${pos}" viewBox="0 0 40 40" fill="none" style="${transform}">
        <path d="M 0 8 Q 0 0 8 0 L 32 0 M 0 8 L 0 32" stroke="currentColor" stroke-width="1"/>
        <path d="M 4 4 L 16 4 M 4 4 L 4 16" stroke="currentColor" stroke-width="0.5" opacity="0.6"/>
        <circle cx="8" cy="8" r="1.5" fill="currentColor"/>
    </svg>`;
}

function emblemSvg() {
    return `<svg class="cover-emblem" viewBox="0 0 120 120" fill="none">
        <circle cx="60" cy="60" r="56" stroke="currentColor" stroke-width="0.8" opacity="0.4"/>
        <circle cx="60" cy="60" r="50" stroke="currentColor" stroke-width="0.6" opacity="0.6"/>
        <g stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none">
            <path d="M 38 50 L 44 38 L 52 40 L 60 34 L 68 40 L 76 38 L 82 50 L 80 62 L 76 72 L 68 78 L 60 80 L 52 78 L 44 72 L 40 62 Z"/>
            <path d="M 44 38 L 40 26 L 50 34"/>
            <path d="M 76 38 L 80 26 L 70 34"/>
            <path d="M 50 54 L 55 56" stroke-width="1.8"/>
            <path d="M 70 56 L 65 54" stroke-width="1.8"/>
            <path d="M 56 64 L 60 70 L 64 64"/>
            <path d="M 60 70 L 60 76"/>
        </g>
        <text x="60" y="105" text-anchor="middle" font-family="serif" font-size="10" fill="currentColor" opacity="0.7">✦</text>
    </svg>`;
}

// =====================================================
// 페이지 렌더링
// =====================================================
function showCover() {
    const cover = document.getElementById('cover-spread');
    if (cover) cover.style.display = 'flex';

    document.getElementById('progress-text').textContent = '표지';
    document.getElementById('bookmark-ribbon')?.classList.remove('active');
    document.querySelectorAll('.toc-chapter').forEach(el => el.classList.remove('current'));
    saveCurrentProgress();
}

function hideCover() {
    document.getElementById('cover-spread').style.display = 'none';
}

function renderCurrentSpread(direction = 'forward') {
    if (_flip3dSkipNext) _flip3dSkipNext = false;

    if (state.currentChapter === -1) {
        // 표지: PageFlip 비활성, 기존 page 영역 보이게
        destroyPageFlip();
        const mount = document.getElementById('pageflip-mount');
        if (mount) mount.style.display = 'none';
        document.getElementById('page-left').style.display = '';
        document.getElementById('page-right').style.display = '';
        showCover();
        return;
    }
    hideCover();

    const ch = state.flatChapters[state.currentChapter];
    if (!ch) return;

    const leftEl = document.getElementById('content-left');
    const rightEl = document.getElementById('content-right');
    const headerL = document.getElementById('header-left');
    const headerR = document.getElementById('header-right');
    const footerL = document.getElementById('footer-left');
    const footerR = document.getElementById('footer-right');

    const isMobile = window.innerWidth <= 900;
    const leftIdx = isMobile ? -1 : state.currentPagePair * 2;
    const rightIdx = isMobile ? state.currentPagePair : state.currentPagePair * 2 + 1;

    const leftPage = leftIdx >= 0 ? state.pages[leftIdx] : null;
    const rightPage = state.pages[rightIdx];

    // 부 표지일 경우: 좌측은 비우고 우측에 부 표지를 표시, 헤더선도 숨김
    if (ch.isPartCover) {
        const partPage = state.pages[0];
        leftEl.innerHTML = '';
        rightEl.innerHTML = partPage ? partPage.html : '';
        headerL.textContent = '';
        headerR.textContent = '';
        headerL.style.borderBottom = 'none';
        headerR.style.borderBottom = 'none';
        footerL.textContent = '';
        footerR.textContent = '';
    } else {
        headerL.style.borderBottom = '';
        headerR.style.borderBottom = '';
        const headerText = `${ch.partTitle} · ${ch.title}`;
        headerL.textContent = headerText;
        headerR.textContent = headerText;

        leftEl.innerHTML = leftPage ? leftPage.html : '';
        rightEl.innerHTML = rightPage ? rightPage.html : '';

        if (leftPage && leftIdx >= 0) {
            footerL.textContent = `${leftIdx + 1} / ${state.pages.length}`;
        } else {
            footerL.textContent = '';
        }
        if (rightPage) {
            footerR.textContent = `${rightIdx + 1} / ${state.pages.length}`;
        } else {
            footerR.textContent = '';
        }
    }

    // PageFlip 모드 / 기존 모드 분기
    const mount = document.getElementById('pageflip-mount');
    if (shouldUsePageFlip()) {
        // 본문 챕터: PageFlip 활성
        document.getElementById('page-left').style.display = 'none';
        document.getElementById('page-right').style.display = 'none';
        if (mount) {
            mount.style.display = '';
            // display 변경 후 layout 강제 → PageFlip이 정확한 사이즈 측정
            void mount.offsetWidth;
        }
        setupPageFlip();
    } else {
        // 부 표지 등: 기존 .page 모드
        destroyPageFlip();
        if (mount) mount.style.display = 'none';
        document.getElementById('page-left').style.display = '';
        document.getElementById('page-right').style.display = '';
    }

    updateBookmarkRibbon();
    updateProgress();
    updateTocHighlight();
    saveCurrentProgress();
}

// =====================================================
// 페이지 컬 (StPageFlip)
// =====================================================
let _pf = null;
let _pfSig = null;

function pfSignature() {
    return `${state.currentChapter}|${state.fontSize}|${window.innerWidth <= 900}|${state.pages.length}`;
}

function destroyPageFlip() {
    if (_pf) {
        try { _pf.destroy(); } catch (e) { /* noop */ }
        _pf = null;
    }
    _pfSig = null;
    // PageFlip의 destroy()가 자기 컨테이너(=mount 안 wrap)를 제거함.
    // 혹시 wrap이 남아있으면 명시 정리. mount 자체는 절대 건드리지 않음.
    const mount = document.getElementById('pageflip-mount');
    if (mount) {
        const wrap = mount.querySelector('.pf-wrap');
        if (wrap) wrap.remove();
        // 혹시 mount 자체에 stf 클래스 잔여 (이전 버그 호환) 정리
        mount.classList.remove('stf__parent');
    }
}

function shouldUsePageFlip() {
    if (state.appSettings && state.appSettings.pageTransition === 'none') return false;
    if (state.currentChapter === -1) return false;
    const ch = state.flatChapters[state.currentChapter];
    if (!ch || ch.isPartCover) return false;
    if (!state.pages || state.pages.length === 0) return false;
    return true;
}

function setupPageFlip() {
    const mount = document.getElementById('pageflip-mount');
    const book = document.getElementById('book');
    if (!mount || !book) return;

    // 사이즈 검증: book(부모)이 0이면 layout 안정 후 retry
    const bookRect = book.getBoundingClientRect();
    if (bookRect.width < 50 || bookRect.height < 50) {
        setTimeout(() => setupPageFlip(), 80);
        return;
    }

    const sig = pfSignature();
    if (_pf && sig === _pfSig) {
        // 동일 시그니처: 페이지 위치만 동기화
        try {
            const cur = _pf.getCurrentPageIndex();
            if (cur !== state.currentPagePair) {
                _pf.turnToPage(state.currentPagePair);
            }
        } catch (e) { /* noop */ }
        return;
    }

    destroyPageFlip();
    // destroyPageFlip이 mount 안의 wrap을 제거함. mount 자체는 영구 보존.
    mount.style.display = '';

    // PageFlip이 destroy 시 자기 컨테이너를 DOM에서 제거하므로
    // mount 안에 wrap div를 만들고 wrap에 PageFlip 적용 → mount은 안전
    const wrap = document.createElement('div');
    wrap.className = 'pf-wrap';
    wrap.style.cssText = 'width:100%;height:100%;position:relative;';
    mount.appendChild(wrap);

    const ch = state.flatChapters[state.currentChapter];
    const headerText = `${esc(ch.partTitle)} · ${esc(ch.title)}`;

    state.pages.forEach((p, idx) => {
        const div = document.createElement('div');
        div.className = 'pf-page';
        div.innerHTML = `
            <div class="page-header">${headerText}</div>
            <div class="page-content" style="font-size: ${state.fontSize}px">${p.html}</div>
            <div class="page-footer">${idx + 1} / ${state.pages.length}</div>
        `;
        wrap.appendChild(div);
    });

    // Layout 강제 (페이지 div 추가 후 wrap 사이즈 정확히 측정)
    void wrap.offsetWidth;

    // RAF로 layout 안정 후 PageFlip 생성 (특히 mode 전환 직후 사이즈 0 방지)
    requestAnimationFrame(() => {
        const isMobile = window.innerWidth <= 900;
        const rect = book.getBoundingClientRect();
        const wrapRect = wrap.getBoundingClientRect();

        // wrap 사이즈가 여전히 0이면 한 번 더 RAF 대기
        if (wrapRect.width < 50 || wrapRect.height < 50) {
            requestAnimationFrame(() => setupPageFlip());
            return;
        }

        try {
            const pfWidth = isMobile ? 400 : Math.max(280, Math.floor(rect.width / 2));
            const pfHeight = isMobile ? 800 : Math.max(400, rect.height);
            const startIdx = Math.max(0, Math.min(state.currentPagePair, state.pages.length - 1));

            _pf = new PageFlip(wrap, {
                width: pfWidth,
                height: pfHeight,
                size: 'stretch',
                minWidth: 280,
                maxWidth: 1400,
                minHeight: 400,
                maxHeight: 1800,
                showCover: false,
                usePortrait: true,
                mobileScrollSupport: false,
                flippingTime: 700,
                drawShadow: true,
                maxShadowOpacity: 0.5,
                startPage: 0,
                useMouseEvents: false,
                clickEventForward: false,
            });

            _pf.loadFromHTML(wrap.querySelectorAll('.pf-page'));
            _pfSig = sig;
            state.currentPagePair = 0;

            _pf.on('flip', (e) => {
                state.currentPagePair = e.data;
                saveCurrentProgress();
                updateProgress();
                updateBookmarkRibbon();
                updateTocHighlight();
            });

            // RAF 두 번으로 PageFlip init 완료 보장 후 update + 시작 페이지 이동
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    try {
                        if (_pf) {
                            if (typeof _pf.update === 'function') _pf.update();
                            if (startIdx > 0) {
                                _pf.turnToPage(startIdx);
                                state.currentPagePair = startIdx;
                            }
                        }
                    } catch (e) { /* noop */ }
                });
            });
        } catch (err) {
            console.error('PageFlip 초기화 실패:', err);
        }
    });
}

let _flip3dActive = false;
let _flip3dSkipNext = false;
function startFlip3D(direction, oldRightHTML, newRightHTML) {
    const book = document.getElementById('book');
    if (!book || _flip3dActive) return;
    if (!oldRightHTML || !newRightHTML || oldRightHTML === newRightHTML) return;

    _flip3dActive = true;
    const isMobile = window.innerWidth <= 900;

    const flipper = document.createElement('div');
    flipper.className = 'page-flip-3d' + (isMobile ? ' pf-mobile' : '');
    flipper.innerHTML = `
        <div class="pf-side pf-front">${direction === 'forward' ? oldRightHTML : newRightHTML}</div>
        <div class="pf-side pf-back">${direction === 'forward' ? newRightHTML : oldRightHTML}</div>
    `;
    if (direction !== 'forward') {
        flipper.classList.add('pf-init-back');
    }
    book.appendChild(flipper);
    void flipper.offsetWidth;

    requestAnimationFrame(() => {
        if (direction === 'forward') {
            flipper.classList.add('pf-go-next');
        } else {
            // pf-init-back 제거 → transition 활성화, 다음 프레임에 transform 변경
            flipper.classList.remove('pf-init-back');
            requestAnimationFrame(() => {
                flipper.classList.add('pf-go-prev');
            });
        }
    });

    let cleaned = false;
    const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        if (flipper.parentNode) flipper.remove();
        _flip3dActive = false;
    };
    flipper.addEventListener('transitionend', cleanup, { once: true });
    setTimeout(cleanup, 800); // 안전망
}

function updateProgress() {
    const total = state.flatChapters.length;
    const cur = state.currentChapter + 1;
    const ch = state.flatChapters[state.currentChapter];
    let pageInfo = '';
    if (ch && !ch.isPartCover && state.pages.length > 1) {
        // PageFlip 모드 통일: state.currentPagePair는 page index
        pageInfo = ` · ${state.currentPagePair + 1}/${state.pages.length}`;
    }
    const el = document.getElementById('progress-text');
    if (el) el.textContent = `${cur}/${total}${pageInfo}`;
}

// =====================================================
// 페이지 이동
// =====================================================
function goNext() {
    if (state.currentChapter === -1) {
        state.currentChapter = 0;
        state.currentPagePair = 0;
        hideCover();
        rebuildPages();
        _flip3dSkipNext = true;
        renderCurrentSpread('forward');
        return;
    }

    // 본문 챕터(PageFlip 모드): 라이브러리 API 사용. 챕터 끝이면 다음 챕터로
    if (shouldUsePageFlip() && _pf) {
        try {
            const cur = _pf.getCurrentPageIndex();
            const total = state.pages.length;
            if (cur < total - 1) {
                _pf.flipNext();
                return;
            }
        } catch (e) { /* fallthrough */ }
        // 마지막 페이지 → 다음 챕터
        if (state.currentChapter < state.flatChapters.length - 1) {
            state.currentChapter++;
            state.currentPagePair = 0;
            rebuildPages();
            renderCurrentSpread('forward');
        }
        return;
    }

    // 부 표지 등 (기존 모드): spread 단위 이동
    const isMobile = window.innerWidth <= 900;
    const pagesPerSpread = isMobile ? 1 : 2;
    const lastSpread = Math.ceil(state.pages.length / pagesPerSpread) - 1;

    if (state.currentPagePair < lastSpread) {
        state.currentPagePair++;
        renderCurrentSpread('forward');
    } else if (state.currentChapter < state.flatChapters.length - 1) {
        state.currentChapter++;
        state.currentPagePair = 0;
        rebuildPages();
        renderCurrentSpread('forward');
    }
}

function goPrev() {
    if (state.currentChapter === -1) return;

    // 본문 챕터(PageFlip 모드): 라이브러리 API 사용. 챕터 시작이면 이전 챕터 마지막으로
    if (shouldUsePageFlip() && _pf) {
        try {
            const cur = _pf.getCurrentPageIndex();
            if (cur > 0) {
                _pf.flipPrev();
                return;
            }
        } catch (e) { /* fallthrough */ }
        // 첫 페이지 → 이전 챕터 마지막
        if (state.currentChapter > 0) {
            state.currentChapter--;
            rebuildPages();
            // PageFlip은 page index 단위 (양면이든 단면이든)
            // fallback (부 표지)이면 단일 페이지라 0 또는 lastIdx 동일
            state.currentPagePair = Math.max(0, state.pages.length - 1);
            renderCurrentSpread('back');
        } else {
            // 첫 챕터 첫 페이지 → 표지로
            state.currentChapter = -1;
            state.currentPagePair = 0;
            renderCurrentSpread('back');
        }
        return;
    }

    // 부 표지 등 (기존 모드)
    if (state.currentPagePair > 0) {
        state.currentPagePair--;
        renderCurrentSpread('back');
    } else if (state.currentChapter > 0) {
        state.currentChapter--;
        rebuildPages();
        const isMobile = window.innerWidth <= 900;
        const pagesPerSpread = isMobile ? 1 : 2;
        state.currentPagePair = Math.max(0, Math.ceil(state.pages.length / pagesPerSpread) - 1);
        renderCurrentSpread('back');
    } else {
        state.currentChapter = -1;
        state.currentPagePair = 0;
        renderCurrentSpread('back');
    }
}

function goToChapter(chapterIdx, pagePair = 0) {
    state.currentChapter = chapterIdx;
    state.currentPagePair = pagePair;
    hideCover();
    rebuildPages();
    if (state.currentPagePair * 2 >= state.pages.length) state.currentPagePair = 0;
    renderCurrentSpread('forward');
}

function goToCover() {
    state.currentChapter = -1;
    state.currentPagePair = 0;
    renderCurrentSpread('back');
}

function goNextChapter() {
    if (state.currentChapter < state.flatChapters.length - 1) {
        goToChapter(state.currentChapter + 1, 0);
    }
}
function goPrevChapter() {
    if (state.currentChapter > 0) goToChapter(state.currentChapter - 1, 0);
    else goToCover();
}

// =====================================================
// 사이드 패널 / 목차 / 북마크
// =====================================================
function openSidePanel(tab = 'toc') {
    state.sidePanelTab = tab;
    // 설정 패널이 열려있으면 먼저 닫기
    const set = document.getElementById('settings-panel');
    if (set && set.classList.contains('open')) {
        set.classList.remove('open');
        document.getElementById('btn-settings')?.classList.remove('active');
        document.getElementById('btn-settings-mobile')?.classList.remove('active');
    }
    document.querySelectorAll('.sp-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tab);
    });
    if (tab === 'toc') renderToc();
    else renderBookmarks();
    document.getElementById('side-panel').classList.add('open');
    document.getElementById('btn-toc').classList.add('active');
    document.getElementById('panel-backdrop')?.classList.add('show');
}
function closeSidePanel() {
    document.getElementById('side-panel').classList.remove('open');
    document.getElementById('btn-toc').classList.remove('active');
    updatePanelBackdrop();
}
function toggleSidePanel() {
    if (document.getElementById('side-panel').classList.contains('open')) closeSidePanel();
    else openSidePanel(state.sidePanelTab);
}

// 둘 다 닫혔으면 백드롭도 끔
function updatePanelBackdrop() {
    const sp = document.getElementById('side-panel');
    const set = document.getElementById('settings-panel');
    const bd = document.getElementById('panel-backdrop');
    if (!bd) return;
    const anyOpen = (sp && sp.classList.contains('open')) || (set && set.classList.contains('open'));
    bd.classList.toggle('show', anyOpen);
}

function renderToc() {
    const container = document.getElementById('sp-content');
    if (!container) return;
    let html = '';

    html += `<div class="toc-part">
        <div class="toc-chapter toc-cover-link" data-chapter-idx="-1" style="padding-left: 24px; color: var(--gold); font-family: 'Nanum Myeongjo', serif; font-weight: 700; letter-spacing: 0.1em;">표지</div>
    </div>`;

    let flatIdx = 0;
    state.currentBook.parts.forEach((part) => {
        html += `<div class="toc-part">`;
        html += `<div class="toc-part-title">${esc(part.title)}</div>`;
        flatIdx++; // 부 표지
        part.chapters.forEach((ch) => {
            html += `<div class="toc-chapter" data-chapter-idx="${flatIdx}">${esc(ch.title)}</div>`;
            flatIdx++;
        });
        html += `</div>`;
    });
    container.innerHTML = html;

    container.querySelectorAll('.toc-chapter').forEach(el => {
        el.addEventListener('click', () => {
            const idx = parseInt(el.dataset.chapterIdx);
            if (idx === -1) goToCover();
            else goToChapter(idx, 0);
            closeSidePanel();
        });
    });

    updateTocHighlight();
}

function updateTocHighlight() {
    document.querySelectorAll('.toc-chapter').forEach(el => {
        const idx = parseInt(el.dataset.chapterIdx);
        el.classList.toggle('current', idx === state.currentChapter);
        if (idx === state.currentChapter) {
            try { el.scrollIntoView({ behavior: 'auto', block: 'nearest' }); } catch(e) {}
        }
    });
}

function getCurrentSnippet() {
    const ch = state.flatChapters[state.currentChapter];
    if (!ch || ch.isPartCover) return '(부 표지)';
    const isMobile = window.innerWidth <= 900;
    const idx = isMobile ? state.currentPagePair : state.currentPagePair * 2 + 1;
    const page = state.pages[idx] || state.pages[idx - 1];
    if (!page) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = page.html;
    tmp.querySelectorAll('.chapter-title').forEach(t => t.remove());
    const text = tmp.textContent.trim().replace(/\s+/g, ' ');
    return text.slice(0, 90) + (text.length > 90 ? '…' : '');
}

function openBookmarkModal() {
    if (state.currentChapter === -1) {
        showToast('표지에는 북마크를 추가할 수 없습니다');
        return;
    }
    const ch = state.flatChapters[state.currentChapter];
    document.getElementById('modal-info').textContent =
        `${ch.partTitle} · ${ch.title} (페이지 ${state.currentPagePair * 2 + 1})`;
    document.getElementById('modal-note').value = '';
    document.getElementById('modal-backdrop').classList.add('show');
    setTimeout(() => document.getElementById('modal-note').focus(), 100);
}

function closeBookmarkModal() {
    document.getElementById('modal-backdrop').classList.remove('show');
}

async function saveBookmarkAction() {
    const note = document.getElementById('modal-note').value.trim();
    const ch = state.flatChapters[state.currentChapter];
    const bm = {
        id: generateId(),
        bookId: state.currentBook.id,
        chapterIdx: state.currentChapter,
        pagePair: state.currentPagePair,
        chapterTitle: ch.title,
        partTitle: ch.partTitle,
        snippet: getCurrentSnippet(),
        note: note,
        createdAt: Date.now()
    };
    state.bookmarks.unshift(bm);
    await addBookmark(bm);
    closeBookmarkModal();
    showToast('북마크가 추가되었습니다');
    updateBookmarkRibbon();
    if (state.sidePanelTab === 'bookmarks') renderBookmarks();
}

async function deleteBookmarkAction(id) {
    state.bookmarks = state.bookmarks.filter(b => b.id !== id);
    await deleteBookmark(id);
    if (state.sidePanelTab === 'bookmarks') renderBookmarks();
    updateBookmarkRibbon();
    showToast('북마크 삭제됨');
}

function renderBookmarks() {
    const container = document.getElementById('sp-content');
    if (!container) return;
    if (state.bookmarks.length === 0) {
        container.innerHTML = `<div class="bm-empty">
            아직 북마크가 없습니다.<br><br>
            상단의 <strong style="color: var(--gold);">북마크</strong> 버튼을 누르거나<br>
            <kbd style="background: rgba(176,141,58,0.15); padding: 2px 6px; border-radius: 2px; color: var(--gold);">B</kbd> 키로 추가하세요.
        </div>`;
        return;
    }

    // 최신순
    const sorted = state.bookmarks.slice().sort((a, b) => b.createdAt - a.createdAt);
    let html = '';
    sorted.forEach(bm => {
        const date = new Date(bm.createdAt);
        const dateStr = `${date.getFullYear()}.${String(date.getMonth()+1).padStart(2,'0')}.${String(date.getDate()).padStart(2,'0')}`;
        html += `<div class="bm-item" data-id="${bm.id}">
            <button class="bm-item-delete" data-del="${bm.id}" title="삭제">×</button>
            <div class="bm-item-chapter">${esc(bm.partTitle)} · ${esc(bm.chapterTitle)}</div>
            <div class="bm-item-snippet">${esc(bm.snippet)}</div>
            ${bm.note ? `<div class="bm-item-note">"${esc(bm.note)}"</div>` : ''}
            <div class="bm-item-meta">
                <span>페이지 ${bm.pagePair * 2 + 1}</span>
                <span>${dateStr}</span>
            </div>
        </div>`;
    });
    container.innerHTML = html;

    container.querySelectorAll('.bm-item').forEach(el => {
        el.addEventListener('click', (e) => {
            if (e.target.dataset.del) return;
            const id = el.dataset.id;
            const bm = state.bookmarks.find(b => b.id === id);
            if (bm) {
                goToChapter(bm.chapterIdx, bm.pagePair);
                closeSidePanel();
            }
        });
    });
    container.querySelectorAll('[data-del]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('이 북마크를 삭제할까요?')) {
                deleteBookmarkAction(btn.dataset.del);
            }
        });
    });
}

function updateBookmarkRibbon() {
    const ribbon = document.getElementById('bookmark-ribbon');
    if (!ribbon) return;
    const has = state.bookmarks.some(b =>
        b.chapterIdx === state.currentChapter && b.pagePair === state.currentPagePair
    );
    ribbon.classList.toggle('active', has);
}

// =====================================================
// 설정
// =====================================================
function toggleSettingsPanel() {
    const panel = document.getElementById('settings-panel');
    const btn = document.getElementById('btn-settings');
    const btnMobile = document.getElementById('btn-settings-mobile');
    // 사이드 패널이 열려있으면 먼저 닫기 (둘 다 동시에 안 띄우게)
    const sp = document.getElementById('side-panel');
    if (sp && sp.classList.contains('open')) closeSidePanel();
    panel.classList.toggle('open');
    const isOpen = panel.classList.contains('open');
    btn?.classList.toggle('active', isOpen);
    btnMobile?.classList.toggle('active', isOpen);
    updatePanelBackdrop();
}

function setFontSize(size) {
    state.fontSize = Math.max(13, Math.min(28, size));
    document.documentElement.style.setProperty('--font-size', state.fontSize + 'px');
    document.getElementById('fs-display').textContent = state.fontSize;
    rebuildPages();
    _flip3dSkipNext = true;
    renderCurrentSpread('forward');
    saveCurrentProgress();
}

// =====================================================
// 저장
// =====================================================
async function saveCurrentProgress() {
    if (!state.currentBook) return;
    try {
        await saveProgress(state.currentBook.id, {
            currentChapter: state.currentChapter,
            currentPagePair: state.currentPagePair,
            fontSize: state.fontSize
        });
    } catch (e) { console.warn('저장 실패', e); }
}

// =====================================================
// 이벤트 바인딩 (리더)
// =====================================================
function bindReaderEvents() {
    // 데스크탑: nav-zone 클릭 (모바일에선 CSS로 숨김)
    document.getElementById('nav-prev').addEventListener('click', goPrev);
    document.getElementById('nav-next').addEventListener('click', goNext);

    document.getElementById('cover-spread').addEventListener('click', (e) => {
        if (e.target.closest('.nav-zone')) return;
        // 패널 열려있으면 패널 닫기
        if (closeOverlaysIfOpen()) return;
        goNext();
    });

    document.getElementById('btn-toc').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSidePanel();
    });
    document.getElementById('btn-bookmark-add').addEventListener('click', (e) => {
        e.stopPropagation();
        openBookmarkModal();
    });
    document.getElementById('btn-settings').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSettingsPanel();
    });
    document.getElementById('btn-settings-mobile')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSettingsPanel();
    });

    document.querySelectorAll('.sp-tab').forEach(t => {
        t.addEventListener('click', () => openSidePanel(t.dataset.tab));
    });

    document.getElementById('fs-up').addEventListener('click', () => setFontSize(state.fontSize + 1));
    document.getElementById('fs-down').addEventListener('click', () => setFontSize(state.fontSize - 1));

    // 터치 영역 슬라이더
    bindTouchZoneSettings();

    document.getElementById('modal-cancel').addEventListener('click', closeBookmarkModal);
    document.getElementById('modal-save').addEventListener('click', saveBookmarkAction);
    document.getElementById('modal-backdrop').addEventListener('click', (e) => {
        if (e.target.id === 'modal-backdrop') closeBookmarkModal();
    });
    document.getElementById('modal-note').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveBookmarkAction();
    });

    document.getElementById('bookmark-ribbon').addEventListener('click', (e) => {
        e.stopPropagation();
        const bm = state.bookmarks.find(b =>
            b.chapterIdx === state.currentChapter && b.pagePair === state.currentPagePair
        );
        if (bm && confirm('이 페이지의 북마크를 삭제할까요?')) {
            deleteBookmarkAction(bm.id);
        }
    });

    // 패널 백드롭 클릭 → 열린 패널 닫기 (페이지 이동 X)
    const backdrop = document.getElementById('panel-backdrop');
    if (backdrop) {
        backdrop.addEventListener('click', (e) => {
            e.stopPropagation();
            closeOverlaysIfOpen();
        });
    }

    // 키보드
    document.addEventListener('keydown', readerKeyHandler);

    // 통합 입력 (탭 + 스와이프)
    setupBookInput();

    // 리사이즈
    let resizeTimer = null;
    window.addEventListener('resize', () => {
        if (state.view !== 'reader') return;
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            rebuildPages();
            _flip3dSkipNext = true;
            renderCurrentSpread('forward');
        }, 200);
    });
}

// 사이드 패널 / 설정 패널이 열려있으면 닫고 true 반환 (= 다른 동작 막기)
function closeOverlaysIfOpen() {
    const sp = document.getElementById('side-panel');
    const set = document.getElementById('settings-panel');
    let closed = false;
    if (sp && sp.classList.contains('open')) {
        sp.classList.remove('open');
        document.getElementById('btn-toc')?.classList.remove('active');
        closed = true;
    }
    if (set && set.classList.contains('open')) {
        set.classList.remove('open');
        document.getElementById('btn-settings')?.classList.remove('active');
        document.getElementById('btn-settings-mobile')?.classList.remove('active');
        closed = true;
    }
    if (closed) updatePanelBackdrop();
    return closed;
}

function bindTouchZoneSettings() {
    const prevSlider = document.getElementById('touch-prev-slider');
    const nextSlider = document.getElementById('touch-next-slider');
    if (!prevSlider) return;

    const sync = () => {
        document.getElementById('touch-prev-val').textContent = prevSlider.value + '%';
        document.getElementById('touch-next-val').textContent = nextSlider.value + '%';
        // 미리보기 업데이트
        const tzp = document.getElementById('touch-zones-preview');
        if (tzp) {
            tzp.style.gridTemplateColumns = `${prevSlider.value}% auto ${nextSlider.value}%`;
        }
    };
    sync();

    const onChange = () => {
        state.appSettings.touchPrev = parseInt(prevSlider.value) / 100;
        state.appSettings.touchNext = parseInt(nextSlider.value) / 100;
        saveAppSettings(state.appSettings);
        sync();
    };
    prevSlider.addEventListener('input', onChange);
    nextSlider.addEventListener('input', onChange);

    document.querySelectorAll('.seg-btn[data-center]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.seg-btn[data-center]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.appSettings.tapCenterAction = btn.dataset.center;
            saveAppSettings(state.appSettings);
        });
    });

    document.querySelectorAll('.seg-btn[data-transition]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.seg-btn[data-transition]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.appSettings.pageTransition = btn.dataset.transition;
            saveAppSettings(state.appSettings);
            // 즉시 적용: PageFlip 인스턴스 정리 후 재렌더
            destroyPageFlip();
            renderCurrentSpread('forward');
        });
    });
}

function readerKeyHandler(e) {
    if (state.view !== 'reader') return;
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;

    const modal = document.getElementById('modal-backdrop');
    if (modal && modal.classList.contains('show')) {
        if (e.key === 'Escape') closeBookmarkModal();
        return;
    }

    switch(e.key) {
        case 'ArrowRight':
        case ' ':
            e.preventDefault();
            if (e.shiftKey) goNextChapter(); else goNext();
            break;
        case 'ArrowLeft':
            e.preventDefault();
            if (e.shiftKey) goPrevChapter(); else goPrev();
            break;
        case 't': case 'T': toggleSidePanel(); break;
        case 'b': case 'B': openBookmarkModal(); break;
        case 's': case 'S': toggleSettingsPanel(); break;
        case 'h': case 'H': goToCover(); break;
        case 'Backspace':
            e.preventDefault();
            history.back();
            break;
        case '+': case '=': setFontSize(state.fontSize + 1); break;
        case '-': case '_': setFontSize(state.fontSize - 1); break;
        case 'Escape':
            closeSidePanel();
            document.getElementById('settings-panel')?.classList.remove('open');
            document.getElementById('btn-settings')?.classList.remove('active');
        document.getElementById('btn-settings-mobile')?.classList.remove('active');
            break;
    }
}

// 터치 + 클릭 통합 입력 처리 (모바일/데스크탑 공통)
function setupBookInput() {
    const stage = document.getElementById('book-stage');
    if (!stage) return;

    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartT = 0;
    let touchMoved = false;
    let lastTouchEnd = 0;

    stage.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartT = Date.now();
        touchMoved = false;
    }, { passive: true });

    stage.addEventListener('touchmove', (e) => {
        if (e.touches.length !== 1) return;
        const dx = Math.abs(e.touches[0].clientX - touchStartX);
        const dy = Math.abs(e.touches[0].clientY - touchStartY);
        if (dx > 10 || dy > 10) touchMoved = true;
    }, { passive: true });

    stage.addEventListener('touchend', (e) => {
        if (e.changedTouches.length !== 1) return;
        const endX = e.changedTouches[0].clientX;
        const endY = e.changedTouches[0].clientY;
        const dx = endX - touchStartX;
        const dy = endY - touchStartY;
        const dt = Date.now() - touchStartT;

        // 1. 사이드 패널/설정 열려있으면 닫기만 (어디 탭이든)
        if (closeOverlaysIfOpen()) {
            lastTouchEnd = Date.now();
            return;
        }

        // 2. 스와이프 (50px 이상, 가로>세로*1.5, 800ms 이내)
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 800) {
            if (dx < 0) goNext();
            else goPrev();
            lastTouchEnd = Date.now();
            return;
        }

        // 3. 탭 (이동 거의 없고, 짧음)
        if (!touchMoved && dt < 400) {
            handleBookTap(endX, e.changedTouches[0].target);
        }
        lastTouchEnd = Date.now();
    }, { passive: true });

    // 클릭 이벤트 (마우스용, 모바일에선 touchend 이미 처리했으니 무시)
    // 모바일에선 touch → 자동 click이 따라오는데 중복 처리되니 무시
    stage.addEventListener('click', (e) => {
        // touch 이벤트 직후 발생한 click은 무시 (중복 방지)
        if (Date.now() - lastTouchEnd < 500) return;
        // 데스크탑 nav-zone이 처리하는 좌/우 영역은 그쪽으로
        if (e.target.closest('.nav-zone')) return;
        // 패널 열려있으면 닫기
        if (closeOverlaysIfOpen()) {
            e.stopPropagation();
            return;
        }
        // 모바일 영역 시스템에 의한 처리
        const isMobile = window.innerWidth <= 900;
        if (isMobile) {
            handleBookTap(e.clientX, e.target);
        }
        // 데스크탑 본문 중앙 클릭 → 메뉴 토글이나 무시 (현재는 무시)
    });
}

// 책 영역 탭 처리 — 좌/중/우 결정
function handleBookTap(clientX, target) {
    // 툴바 버튼 클릭 등은 stopPropagation으로 막혔어야 함, 안전 차원에서 한 번 더
    if (target && target.closest('#toolbar')) return;
    if (target && target.closest('.bookmark-ribbon')) return;
    if (target && target.closest('#side-panel')) return;
    if (target && target.closest('#settings-panel')) return;
    if (target && target.closest('.modal-backdrop')) return;

    const bookEl = document.getElementById('book');
    if (!bookEl) return;
    const rect = bookEl.getBoundingClientRect();
    const x = clientX - rect.left;
    const ratio = x / rect.width;

    const prevR = state.appSettings.touchPrev;
    const nextR = 1 - state.appSettings.touchNext;

    if (ratio < prevR) {
        goPrev();
    } else if (ratio > nextR) {
        goNext();
    } else {
        // 중앙
        const action = state.appSettings.tapCenterAction;
        if (action === 'next') goNext();
        else if (action === 'menu') toggleMobileMenu();
        // 'none' → 아무것도 안 함
    }
}

// 모바일 메뉴 토글: 툴바를 토글
function toggleMobileMenu() {
    const tb = document.getElementById('toolbar');
    if (!tb) return;
    tb.classList.toggle('hidden');
}

// =====================================================
// 안드로이드 뒤로가기 처리 (history navigation)
// =====================================================
function setupHistoryNav() {
    if (!history.state) {
        history.replaceState({ view: 'library' }, '');
    }
    window.addEventListener('popstate', (e) => {
        // 1. 모달/패널이 열려있으면 그것만 닫고 reader 상태 복원
        //    (pushState는 popstate 핸들러 안에서만 호출 → history 중복 없음)
        const modal = document.getElementById('modal-backdrop');
        const modalWasOpen = !!(modal && modal.classList.contains('show'));
        if (modalWasOpen) modal.classList.remove('show');
        const overlayClosed = closeOverlaysIfOpen();

        if (modalWasOpen || overlayClosed) {
            if (state.view === 'reader' && state.currentBook) {
                history.pushState({ view: 'reader', bookId: state.currentBook.id }, '');
            }
            return;
        }

        // 2. 리더 → 라이브러리
        if (state.view === 'reader') {
            state.view = 'library';
            state.currentBook = null;
            destroyPageFlip();
            renderLibrary();
            return;
        }
        // 라이브러리 → (브라우저가 자연스럽게 종료/홈으로)
    });
}

// =====================================================
// 부팅
// =====================================================
export async function boot() {
    state.view = 'library';
    setupHistoryNav();
    await renderLibrary();

    // 라이브러리 키보드 (E 키 등은 추후 확장 여지)
    document.addEventListener('keydown', (e) => {
        if (state.view !== 'library') return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    });
}
