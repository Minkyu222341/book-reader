// =====================================================
// 텍본 파서: .txt 파일을 부/챕터 구조로 변환
// =====================================================

/**
 * 텍스트를 분석해서 소설 구조를 추출한다.
 * @param {string} rawText - 원본 텍스트
 * @param {object} options - { title, author } (선택)
 * @returns {object} { title, author, parts: [{title, chapters: [{title, text}]}] }
 */
export function parseNovel(rawText, options = {}) {
    // BOM 제거 + 줄바꿈 정규화
    let text = rawText.replace(/^\uFEFF/, '');
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    const lines = text.split('\n');

    // === 1. 제목/저자 추출 시도 ===
    let detectedTitle = options.title || '';
    let detectedAuthor = options.author || '';

    if (!detectedTitle || !detectedAuthor) {
        // 처음 30줄에서 추출 시도
        const head = lines.slice(0, 30);
        for (let i = 0; i < head.length; i++) {
            const ln = head[i].trim();
            if (!ln) continue;
            // "-홍길동" 또는 "by 홍길동" 패턴
            const authorMatch = ln.match(/^[-—]\s*(.+)$/) || ln.match(/^by\s+(.+)$/i) || ln.match(/^지은이\s*[:：]?\s*(.+)$/);
            if (authorMatch && !detectedAuthor) {
                detectedAuthor = authorMatch[1].trim();
                continue;
            }
            // 첫 번째 의미있는 줄을 제목으로
            if (!detectedTitle && ln.length > 0 && ln.length < 80 && !/^<.*>$/.test(ln) && !/^Chapter/i.test(ln) && !/^프롤로그/.test(ln)) {
                detectedTitle = ln;
            }
            if (detectedTitle && detectedAuthor) break;
        }
    }
    if (!detectedTitle) detectedTitle = '제목 없음';
    if (!detectedAuthor) detectedAuthor = '저자 미상';

    // === 2. 패턴 정의 ===
    // 부 패턴: 다양한 변형 포괄
    const partPatterns = [
        /^<\s*(\d+)\s*부\s*[:：.\-—]?\s*([^>]*?)\s*>$/,       // <1부 : 캡틴 카셀>
        /^\[\s*제?\s*(\d+)\s*부\s*\]\s*[:：.\-—]?\s*(.*)$/,   // [제1부] 또는 [1부] :
        /^【\s*제?\s*(\d+)\s*부\s*】\s*[:：.\-—]?\s*(.*)$/,   // 【제1부】
        /^제\s*(\d+)\s*부\s*[:：.\-—]?\s*(.*)$/,              // 제1부.
        /^(\d+)\s*부\s*[:：.\-—]\s*(.*)$/,                    // 1부 : ...
        /^Part\s+(\d+|[IVXLCDM]+)\s*[:：.\-—]?\s*(.*)$/i,     // Part 1 / Part I
        /^Book\s+(\d+|[IVXLCDM]+)\s*[:：.\-—]?\s*(.*)$/i,     // Book 1
        /^Volume\s+(\d+|[IVXLCDM]+)\s*[:：.\-—]?\s*(.*)$/i,   // Volume 1
        /^Vol\.?\s*(\d+)\s*[:：.\-—]?\s*(.*)$/i,              // Vol. 1
    ];

    // 외전/번외 시작 패턴 (별도 부로 처리)
    // "하얀 늑대들 외전 - 전쟁의 주시자", "외전 - ...", "외전 : ...", "<외전>" 등
    const sidePartPatterns = [
        /^.{0,30}외전\s*[-—:：]\s*(.+?)(?:\s*\(.*?\))?$/,    // ... 외전 - 부제
        /^<\s*외전\s*[:：]?\s*([^>]*)\s*>$/,                  // <외전> 또는 <외전: ...>
        /^\[\s*외전\s*\]\s*[:：]?\s*(.*)$/,                   // [외전] 또는 [외전] : ...
    ];

    // 챕터 패턴 — 다양한 텍본 변형 포괄
    const chapterPatterns = [
        // 한국어 기본
        /^(프롤로그|에필로그|서문|서장|종장|머리말|맺음말)\s*[.:：·]?\s*(.*)$/,
        /^제\s*(\d+)\s*장\s*[:：.·]?\s*(.*)$/,                  // 제1장
        /^제\s*(\d+)\s*화\s*[:：.·]?\s*(.*)$/,                  // 제1화
        /^제\s*(\d+)\s*편\s*[:：.·]?\s*(.*)$/,                  // 제1편
        /^제\s*(\d+)\s*회\s*[:：.·]?\s*(.*)$/,                  // 제1회
        /^(\d+)\s*장\s*[:：.·]\s*(.*)$/,                        // 1장. ...
        /^(\d+)\s*화\s*[:：.·]\s*(.*)$/,                        // 1화. ...
        /^(\d+)\s*편\s*[:：.·]\s*(.*)$/,                        // 1편. ...
        /^(\d+)\s*회\s*[:：.·]\s*(.*)$/,                        // 1회. ...
        // 괄호 / 장식 변형
        /^[【\[]\s*제?\s*(\d+)\s*[장화편회]\s*[】\]]\s*[:：.·]?\s*(.*)$/, // 【1장】 [제1화]
        /^[◆◇■□●○★☆※♦]+\s*제?\s*(\d+)\s*[장화편회]?\s*[◆◇■□●○★☆※♦]*\s*[:：.·]?\s*(.*)$/, // ◆ 1화 ◆
        /^[=─━═\-]{2,}\s*제?\s*(\d+)\s*[장화편회]?\s*[=─━═\-]{2,}\s*$/, // === 1 === / ═══ 1 ═══ / --- 제1장 ---
        /^#+\s*Chapter\s+(\d+|[IVXLCDM]+)\s*#*\s*[:：.]?\s*(.*)$/i, // ## Chapter 1 ##
        /^#+\s*제?\s*(\d+)\s*[장화편회]\s*#*\s*[:：.·]?\s*(.*)$/, // ## 1장 ##
        // 영어
        /^Chapter\s+(\d+|[IVXLCDM]+)\s*[:：.\-—]?\s*(.*)$/i,    // Chapter 1 / Chapter I
        /^Ch\.?\s*(\d+)\s*[:：.\-—]?\s*(.*)$/i,                 // Ch. 1 / Ch 1
        /^Prologue\s*[:：.\-—]?\s*(.*)$/i,
        /^Epilogue\s*[:：.\-—]?\s*(.*)$/i,
        /^Episode\s+(\d+)\s*[:：.\-—]?\s*(.*)$/i,               // Episode 1
    ];

    // 부 종료/연결 마커: "끝" 또는 "계속" 포함된 부 헤더는 무시
    const isPartMarker = (line) => {
        for (const re of partPatterns) {
            const m = line.match(re);
            if (m) {
                const fullMatch = m[0];
                if (/(끝|계속|continued|end|종료)/i.test(fullMatch)) {
                    return { type: 'marker' };
                }
                const num = m[1];
                const title = (m[2] || '').trim();
                return { type: 'part', num, title, raw: line };
            }
        }
        // 외전 패턴 체크
        for (const re of sidePartPatterns) {
            const m = line.match(re);
            if (m) {
                if (/(끝|종료|마침)/.test(line)) {
                    return { type: 'marker' };
                }
                let title = (m[1] || '').trim();
                // "전쟁의 주시자(Beholder of the War)" → 괄호 영문 제거
                title = title.replace(/\s*\([^)]*\)\s*$/, '').trim();
                return { type: 'part', num: '외', title: title || '외전', raw: line, isSide: true };
            }
        }
        return null;
    };

    const isChapterMarker = (line) => {
        for (const re of chapterPatterns) {
            const m = line.match(re);
            if (m) {
                return { type: 'chapter', raw: line };
            }
        }
        return null;
    };

    const isEndMarker = (line) => /^<\s*(完|끝|END|FIN)\s*>$/i.test(line);

    // === 3. 1차 스캔: 부/챕터 위치 찾기 ===
    const parts = [];
    let currentPart = null;
    let currentChapter = null;
    let chapterCount = 0;

    const flushChapter = () => {
        if (currentChapter && currentPart) {
            // 끝 빈 줄 정리
            while (currentChapter._lines.length > 0 && currentChapter._lines[currentChapter._lines.length - 1].trim() === '') {
                currentChapter._lines.pop();
            }
            // 시작 빈 줄 정리
            while (currentChapter._lines.length > 0 && currentChapter._lines[0].trim() === '') {
                currentChapter._lines.shift();
            }
            currentChapter.text = currentChapter._lines.join('\n');
            delete currentChapter._lines;
            // 텍스트가 너무 짧으면 (<50자) 스킵
            if (currentChapter.text.length >= 30) {
                currentPart.chapters.push(currentChapter);
            }
            currentChapter = null;
        }
    };

    const ensurePart = () => {
        if (!currentPart) {
            currentPart = { title: '본문', chapters: [] };
            parts.push(currentPart);
        }
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const stripped = line.trim();

        if (isEndMarker(stripped)) {
            continue;
        }

        // 부 마커
        const partInfo = isPartMarker(stripped);
        if (partInfo) {
            if (partInfo.type === 'marker') {
                flushChapter();
                continue;
            }
            // 새 부
            flushChapter();
            let pTitle;
            if (partInfo.isSide) {
                pTitle = partInfo.title ? `외전 — ${partInfo.title}` : '외전';
            } else {
                pTitle = partInfo.title
                    ? `${partInfo.num}부 : ${partInfo.title}`
                    : `${partInfo.num}부`;
            }
            currentPart = { title: pTitle, chapters: [], isSide: !!partInfo.isSide };
            parts.push(currentPart);
            continue;
        }

        // 챕터 마커 (단, 라인 길이가 100자 미만일 때만 — 본문에 우연히 매칭되는 거 방지)
        if (stripped.length > 0 && stripped.length < 100) {
            const chInfo = isChapterMarker(stripped);
            if (chInfo) {
                ensurePart();
                flushChapter();
                currentChapter = {
                    title: stripped,
                    _lines: []
                };
                chapterCount++;
                continue;
            }
        }

        // 본문
        if (currentChapter) {
            currentChapter._lines.push(line);
        } else if (currentPart || parts.length === 0) {
            // 챕터 없이 본문만 있는 경우 (목차 없는 단편)
            ensurePart();
            if (!currentChapter) {
                currentChapter = { title: '본문', _lines: [] };
                chapterCount++;
            }
            currentChapter._lines.push(line);
        }
    }
    flushChapter();

    // === 자동 생성 '본문' 부에서 짧은(표제) 챕터는 제거 ===
    if (parts.length > 1 && parts[0].title === '본문') {
        const firstPart = parts[0];
        let totalChars = 0;
        firstPart.chapters.forEach(c => totalChars += c.text.length);
        if (totalChars < 500) {
            parts.shift();
        }
    }

    // === 4. 챕터를 하나도 못 찾으면: 강제 분할 없이 1권 통째로 ===
    // 사용자 선호: 챕터 인식 실패 시 분할 시도 안 함, 통으로 보여줌.
    let totalChapters = 0;
    parts.forEach(p => totalChapters += p.chapters.length);

    if (totalChapters === 0) {
        // 빈 책 — 빈 부 정리
        parts.length = 0;
    }
    // totalChapters >= 1 이면 그대로 둠 (분할 시도 안 함)

    // === 5. 통계 ===
    let totalChars = 0;
    let chCount = 0;
    parts.forEach(p => {
        chCount += p.chapters.length;
        p.chapters.forEach(c => totalChars += c.text.length);
    });

    return {
        title: detectedTitle,
        author: detectedAuthor,
        parts: parts,
        stats: {
            partCount: parts.length,
            chapterCount: chCount,
            charCount: totalChars
        }
    };
}
