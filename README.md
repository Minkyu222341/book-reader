# 북 리더 (PWA)

텍본 파일을 책처럼 보여주는 웹앱입니다.

## 사용법

### 1. 빠르게 써보기 (PC)
`index.html`을 그냥 더블클릭하지 말고, 간단한 로컬 서버로 띄워야 합니다 (서비스워커/모듈 때문):

```bash
# Python 3 (대부분 PC에 있음)
python3 -m http.server 8000
# 또는
python -m http.server 8000

# Node.js 가 있으면
npx serve .
```

그 다음 브라우저에서 `http://localhost:8000` 접속.

### 2. GitHub Pages 배포 (폰에 앱처럼 설치하려면)

이 방식이 추천 — 5분이면 끝납니다.

1. GitHub에 새 저장소 생성 (예: `book-reader`), public으로
2. 이 폴더의 모든 파일을 그 저장소에 push
3. Settings → Pages → Source를 `main` 브랜치 `/(root)`로 설정
4. 1~2분 후 `https://<사용자명>.github.io/book-reader/` 접속 가능
5. **iOS Safari**: 공유 → 홈 화면에 추가
6. **Android Chrome**: 메뉴 → 홈 화면에 설치

### 3. 폴더 구조

```
index.html          - 메인 페이지
manifest.json       - PWA 매니페스트
sw.js               - 서비스 워커 (오프라인용)
src/
  main.js           - 진입점
  app.js            - UI 로직 (라이브러리 + 리더)
  parser.js         - 텍본 파서
  db.js             - IndexedDB 래퍼
  styles.css        - 스타일
icons/              - PWA 아이콘들
```

## 챕터 자동 인식 패턴

- `프롤로그`, `에필로그`, `서장`, `종장`
- `Chapter 1`, `Chapter I`
- `제1장`, `제1화`, `1장. ...`, `1화. ...`
- 부 마커: `<1부 : 제목>`, `[제1부]`, `Part 1`, `제1부.`
- 외전: `... 외전 - 제목`, `<외전>`, `[외전]`

이 패턴들이 한 줄에 단독으로 있어야 인식됩니다.

## 데이터 저장

브라우저의 IndexedDB에 저장됩니다.
- 책 본문, 진행률, 북마크 모두 로컬 저장
- 브라우저 데이터 삭제 시 함께 삭제됩니다
- 다른 브라우저/기기와 동기화는 안 됩니다 (의도적)
