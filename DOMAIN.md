# 북 리더 도메인 문서

수정 작업 들어가기 전에 이 문서 한 번 훑어보고 시작. 한 줄로 끝내기 어려운 함정들이 있어서 잘못 건드리면 시간 잡아먹는 부분을 정리해뒀다.

## 1. 프로젝트 한 줄 요약

한국 판타지 텍본(.txt)을 책처럼 보여주는 PWA. GitHub Pages 배포. 모바일/데스크탑 호환. 모든 데이터는 브라우저 IndexedDB에 저장(서버 없음).

- **로컬**: `C:\Users\user-pc\Documents\book-reader`
- **저장소**: https://github.com/Minkyu222341/book-reader
- **배포**: https://minkyu222341.github.io/book-reader/

## 2. 파일 구조

```
book-reader/
├── index.html              진입점 + PWA 메타
├── manifest.json           PWA manifest
├── sw.js                   서비스 워커 (network-first, 빌드 timestamp로 버전 관리)
├── README.md               사용자용 README
├── DOMAIN.md               이 문서 (개발자용)
├── icons/                  PWA 아이콘 (svg + 192/512/maskable PNG)
├── src/
│   ├── main.js             부팅 진입점 + SW 등록 + 자동 갱신
│   ├── app.js (~1700줄)    UI 로직 전부 (라이브러리 + 리더)
│   ├── parser.js (~330줄)  텍본 파서 (챕터/부 패턴, 제목 추출)
│   ├── db.js (~160줄)      IndexedDB 래퍼 + appSettings localStorage
│   └── styles.css (~1700줄) 전체 스타일
└── vendor/
    ├── page-flip.module.js  StPageFlip 라이브러리 (페이지 컬 효과)
    └── page-flip.css         StPageFlip 스타일
```

## 3. 핵심 도메인 개념

```
Book (책)
 ├─ id, title, author, addedAt, fileName, fileSize, _chapterCount
 └─ parts[]
     ├─ title, isSide(외전 여부)
     └─ chapters[]
         ├─ title, partTitle, paragraphs[]
         └─ isPartCover(부 표지 챕터 여부)

Pages (state.pages)
 ├─ paginate()로 챕터 → 페이지 배열 생성 (런타임 메모리만)
 └─ 각 페이지: { type: 'text'|'partcover', html: '...' }

Progress (진행률)
 └─ bookId 별: { currentChapter, currentPagePair, fontSize, lastReadAt }

Bookmark (북마크)
 └─ id, bookId, chapterIdx, pagePair, note, createdAt
```

**flatChapters**: 부와 챕터를 평면화한 배열. `state.flatChapters[currentChapter]`가 현재 위치. 부 표지(`isPartCover: true`)도 챕터 한 개로 취급. `state.currentChapter === -1`은 책 표지(cover).

## 4. 상태 모델 (state)

`app.js`의 모듈 변수 `state`. 한곳에서 관리.

| 필드 | 의미 |
|---|---|
| `view` | `'library'` \| `'reader'` |
| `books` | 라이브러리 책 목록 |
| `currentBook` | 현재 열린 책 (또는 null) |
| `flatChapters` | 현재 책의 평면화 챕터 배열 |
| `currentChapter` | 현재 챕터 인덱스 (`-1` = 책 표지) |
| `currentPagePair` | **page index** (양면이든 단면이든 페이지 단위) |
| `pages` | 현재 챕터의 페이지 배열 (런타임 캐시) |
| `bookmarks` | 현재 책의 북마크 |
| `fontSize` | 13~28 |
| `appSettings` | localStorage 저장 (탭 영역 비율, 페이지 전환, etc.) |

⚠️ **`currentPagePair`는 page index 단위로 통일**. 예전엔 양면 모드에서 spread index였는데 PageFlip 도입 후 page index로 단일화. updateProgress 등에서 `*2` 곱하지 말 것.

## 5. 데이터 저장

**IndexedDB** (`db.js`):
- DB: `bookreader`, version 1
- ObjectStore: `books`, `progress`, `bookmarks`
- API: `saveBook(put)`, `getBook`, `listBooks`, `deleteBook`(progress+bookmarks 함께 삭제), `saveProgress`, `getProgress`, `addBookmark`, `listBookmarks`, `deleteBookmark`
- 책 제목 수정 = `saveBook(book)` 다시 호출 (put이라 upsert)

**localStorage** (`db.js`의 `appSettings`):
- 키: `bookreader.appSettings`
- 필드: `touchPrev`, `touchNext`, `tapCenterAction`, `pageTransition`('curl'|'none')

## 6. 핵심 흐름

### 책 추가
```
파일 input/드래그 → readFileAsText (UTF-8 우선, 실패 시 EUC-KR 자동 재디코딩)
  → parseNovel(text, { fileName }) → { title, author, parts }
    └ parser.js: 챕터/부 패턴 정규식 매칭, fallback은 1권 통째로
  → saveBook(book) → IndexedDB
  → renderLibrary()
```

### 책 열기
```
openBook(bookId)
  → getBook + buildFlatChapters + listBookmarks + getProgress
  → state 채움
  → history.pushState({view:'reader', bookId})  ← 안드로이드 뒤로가기용
  → renderReader() → DOM 그림
  → boot 시 setTimeout으로 rebuildPages + renderCurrentSpread
```

### 페이지 이동 (goNext/goPrev)
PageFlip 모드냐 fallback이냐로 분기:
- **PageFlip 모드** (본문 챕터 + 옵션 'curl'): `_pf.flipNext/flipPrev` 호출. 챕터 끝/시작이면 챕터 변경 후 `renderCurrentSpread`
- **fallback** (부 표지 또는 옵션 'none'): `state.currentPagePair` 변경 후 `renderCurrentSpread`로 직접 그림

`renderCurrentSpread`가 핵심 분기점. PageFlip 사용 가능하면 setupPageFlip, 아니면 .page.left/.page.right에 직접 콘텐츠 채움.

## 7. PageFlip 통합 (가장 함정 많음 — 꼭 읽기)

**라이브러리**: `vendor/page-flip.module.js` (StPageFlip 2.0.7, MIT)

### 구조
```
#book (부모)
 ├─ #cover-spread (z:5, 표지 모드 시 display:flex, 평소 display:none)
 ├─ .page.left (PageFlip 모드 시 display:none, fallback/측정용)
 ├─ .page.right (PageFlip 모드 시 display:none, fallback/측정용)
 └─ #pageflip-mount (영구, z:3)
     └─ .pf-wrap ← PageFlip이 여기에 init (매번 새로 생성/제거)
         └─ .pf-page × N
```

### ⚠️ 함정 1: PageFlip이 destroy 시 자기 컨테이너를 DOM에서 제거함
**과거에 이걸 모르고 mount을 직접 PageFlip에 넘겼다가 챕터 변경마다 mount이 사라져 흰 화면이 됐음.**

해결: mount 안에 매번 새 `.pf-wrap` div를 만들어서 wrap을 PageFlip에 넘김. destroy 시 wrap만 사라지고 mount은 보존됨.

```js
// setupPageFlip()
const wrap = document.createElement('div');
wrap.className = 'pf-wrap';
mount.appendChild(wrap);
// 페이지 div들을 wrap에 append
_pf = new PageFlip(wrap, { ... });  // ← mount 아니라 wrap!
```

### ⚠️ 함정 2: PageFlip의 portrait/landscape 자동 감지
컨테이너 비율로 결정. 폰(`#book` 약 0.48 비율)에선 자동 portrait. 옵션 `usePortrait: true`는 *허용*의 의미일 뿐 강제 X. 우리는 `width:height` 옵션을 1:2로 명시해서 의도 표시.

### ⚠️ 함정 3: useMouseEvents:false 강제
PageFlip 자체 클릭/스와이프와 우리 nav-zone/setupBookInput 탭 처리가 같은 클릭을 둘 다 잡으면 한 번 클릭에 2페이지씩 이동했음. PageFlip은 시각 효과만 담당하게 `useMouseEvents:false`. 모든 입력은 우리 코드가 받아서 `_pf.flipNext/flipPrev` 호출.

### ⚠️ 함정 4: startPage 옵션 + RAF 두 번
`new PageFlip` 직후 즉시 `turnToPage(N)` 호출하면 init 미완성으로 빈 화면 가능. RAF 두 번 후 `update() + turnToPage` 호출이 안전.

### ⚠️ 함정 5: 페이지네이션은 `.page.right` 사이즈로 측정
`paginate()`가 `#content-right`의 `getBoundingClientRect()`를 사용. PageFlip 모드에서 page-right는 `display:none`이니 측정 0이 됨. → `rebuildPages()`에서 측정 직전 임시로 `visibility:hidden + display:''`로 layout 차지하게 한 후 측정 종료 시 복원.

### sig 캐싱
같은 챕터/폰트/디바이스/페이지수면 PageFlip 재사용:
```js
function pfSignature() {
    return `${currentChapter}|${fontSize}|${isMobile}|${pages.length}`;
}
```

다르면 destroy + 재생성.

## 8. 페이지네이션 (parser.js + paginate)

### 챕터/부 패턴 (parser.js)
- **부 패턴**: `<1부 : 제목>`, `[제1부]`, `【제1부】`, `Part 1`, `Volume N`, `Vol. N`, 외전 등
- **챕터 패턴**: `프롤로그/에필로그/서장/종장`, `Chapter N`, `제N장/화/편/회`, `【제N장】`, `◆N화◆`, `===N===`, `##Chapter N##`, `Episode N`
- 한 줄에 단독으로 있어야 인식

### 제목 추출
1. 본문 처음 30줄에서 의미있는 첫 줄 (한글/영문/숫자 ≥ 2자 + 비율 ≥ 30%)
2. 양 끝 구분자 정리 (`sanitizeTitle`)
3. 못 찾으면 `fileName` 확장자 제외 사용
4. 그래도 없으면 '제목 없음'

### paginate (app.js)
실제 DOM에 임시 sample div(`#measure`) 만들어서 `scrollHeight <= targetHeight` 검사로 페이지 분할. fallback은 1페이지로 합침.

## 9. 모바일 vs 데스크탑

| 항목 | 데스크탑 | 모바일 (≤900px) |
|---|---|---|
| 책장 | grid auto-fill 180px | 한 줄 3권 고정 + 표지 텍스트 hidden |
| 리더 페이지 | 양면 spread (.page.left + .page.right) | 단면 (.page.left display:none) |
| PageFlip | 양면 모드 | portrait 단면 모드 |
| 설정 ⚙ | toolbar 안 (`.desktop-only`) | fixed 우측 상단 fab (`.mobile-only`, 풀스크린에서도 보임) |
| 입력 | nav-zone 클릭, 키보드 | 좌/우 탭 영역 (사용자 설정), 스와이프, 중앙 탭 풀스크린 토글 |
| 뒤로가기 | Backspace 키 | 안드로이드 뒤로가기 |

## 10. 안드로이드 뒤로가기 (setupHistoryNav)

`history.pushState({view:'reader'})`를 openBook 시 한 번 호출. popstate 이벤트에서:
1. **모달/패널이 열려있으면 그것만 닫고 reader 상태 복원** (라이브러리로 안 감)
2. 그 외 `state.view === 'reader'`면 라이브러리로

### ⚠️ pushState 위치 규칙
**reader 상태 복원용 `pushState`는 popstate 핸들러 안에서만** 호출. 패널을 열거나 닫을 때 pushState 호출 X.

이유: 예전엔 패널 닫을 때마다 `pushState({view:'reader'})`해서 reader가 history에 중복 쌓이고 뒤로가기를 여러 번 눌러야 라이브러리로 갔음. 그 후 "한 번 = 라이브러리로 직행"으로 단순화했지만, 그러면 패널 열린 상태에서 뒤로가기 한 번에 패널 닫힘 + 라이브러리 이동이 동시에 일어남 (사용자 의도 X).

현재 패턴: 패널 닫기는 popstate 안에서만 처리하고, 그 직후 같은 핸들러에서 `pushState`로 reader 상태를 한 번만 복원. 결과: history 스택은 `[library, reader]` 유지, 다음 뒤로가기는 정상적으로 라이브러리로 감.

## 11. 페이지 전환 옵션

설정 패널 → "페이지 전환":
- **`curl`** (기본): PageFlip 페이지 컬
- **`none`**: 즉시 전환 (페이드만)

`shouldUsePageFlip()`이 `state.appSettings.pageTransition`을 체크. 옵션 변경 시 destroyPageFlip + renderCurrentSpread로 즉시 적용.

## 12. 빌드 / 배포

빌드 스크립트 없음. **로컬 변경 → git push** 그 자체가 배포.

```powershell
# 개발
python -m http.server 8765
# http://localhost:8765/

# 배포
git add . ; git commit -m "..."
git push
# 1~2분 후 GitHub Pages 자동 반영
```

### ⚠️ SW 캐시
**매 배포마다 `sw.js`의 `CACHE = 'book-reader-v...'` 숫자를 새 timestamp로 변경**해야 옛 캐시가 정리됨:

```bash
date +%s  # → 새 timestamp
```

안 바꾸면 Network-first SW가 새 콘텐츠는 받아오지만 옛 캐시 이름이 그대로 남아 정리 안 됨. 큰 문제는 없지만 깔끔하진 않음.

### vendor 파일 캐시
`vendor/page-flip.module.js`와 `vendor/page-flip.css`도 SW `ASSETS`에 포함되어야 오프라인 동작. 새 라이브러리 추가 시 sw.js의 ASSETS 배열에 명시적으로 추가.

## 13. 디버깅 팁 (이게 진짜 중요)

폰에서 안 되는 거 보고 추측으로 fix하지 말고 **Playwright로 모바일 viewport 직접 띄워서 확인**. 7번 추측 fix가 1번 측정 못 이긴다.

```python
from playwright.sync_api import sync_playwright

DEVICE = {
    "viewport": {"width": 393, "height": 851},  # Galaxy S24 기준
    "device_scale_factor": 3.0,
    "is_mobile": True,
    "has_touch": True,
}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(**DEVICE)
    page = context.new_page()
    page.on("console", lambda m: print(f"[CON] {m.text}"))
    page.on("pageerror", lambda e: print(f"[ERR] {e}"))
    page.goto("http://localhost:8765/")
    # 자동화 시나리오
    # page.evaluate(...) 로 DOM 상태 직접 들여다보기
    page.screenshot(path="state.png")
```

`page.evaluate()`로 DOM/computed style 직접 검사. 추측 안 하고 실측이 답.

## 14. 자주 헷갈리는 함정 모음

1. **PageFlip은 destroy 시 컨테이너를 제거** → wrap div 한 단계 더 두기 (위 §7 함정 1)
2. **CSS 미디어쿼리가 외부 정의보다 앞에 있으면 source order로 외부가 이김** → specificity 올리거나 순서 바꾸기
3. **page-right 사이즈 측정은 visibility:hidden + display:'' 트릭** → display:none이면 측정 0
4. **state.currentPagePair는 page index 단위 (양면이든 단면이든)** → spread index로 계산하지 말 것
5. **reader 상태 복원용 pushState는 popstate 핸들러 안에서만** → 패널 열기/닫기 시점에 pushState하면 스택 중복으로 뒤로가기 여러 번 필요. 패널 닫기는 popstate 처리 후 같은 핸들러에서 한 번만 pushState로 복원.
6. **build.py 없음** → 직접 push가 배포. SW 캐시 버전은 수동
7. **모바일은 단면 모드** → page.left는 display:none이지만 DOM에는 있음 (HTML 단순화 위해)
8. **PageFlip 자체 마우스/터치 이벤트는 useMouseEvents:false로 끔** → 모든 입력은 우리 코드 → `_pf.flipPrev/Next`

## 15. 미해결 / 향후 작업 후보

우선순위 순 (대략):
1. **화면 잠금 방지** (Wake Lock API) — 읽는 도중 화면 안 꺼지게
2. **줄 간격/자간 조절** — 글자 크기만 있고 line-height는 없음
3. **테마 (다크/세피아/라이트)**
4. **챕터 예상 시간** ("약 8분")
5. **JSON 백업/복원** — 라이브러리 다른 기기 이관
6. **본문 검색** — 챕터 단위 텍스트 검색
7. **하이라이트/형광펜**
8. **TTS 음성 읽기**

> ~~EUC-KR 인코딩 자동 감지~~ — 완료 (readFileAsText가 UTF-8 실패 시 EUC-KR로 재디코딩)

---

작업 들어가기 전에 §7 (PageFlip 통합), §10 (history), §13 (디버깅), §14 (함정 모음)은 한 번씩 보고 시작.
