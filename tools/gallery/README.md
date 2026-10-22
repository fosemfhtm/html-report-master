# 부품 갤러리 만들기

`skills/html-report-master/assets/gallery.html`은 이 폴더의 조각을 합쳐 만든다. 부품을 고치거나 더할 때는 `parts/`를 고치고 조립 스크립트를 다시 돌린다.

```bash
node tools/gallery/assemble.mjs                    # 전체 갤러리 + references/gallery.md 목록을 다시 만든다
node tools/gallery/assemble.mjs D1 -o preview.html # 한 그룹만 미리보기
node skills/html-report-master/scripts/screenshot.mjs preview.html --in-place --out shots
```

## 파일
- `parts/<그룹>.html`: 부품 섹션을 이어 붙인 조각(문서 머리·body 없음). 그룹은 `S1 S2`(큰 구조), `D1 D2`(도식), `M1`(작동 모형), `C1 C2`(차트·글 부품).
- `parts/<그룹>.md`: 목록 표 행. 형식 `| ID | 이름 | 언제 쓰나 | 핵심 요소 |` (헤더 없이 행만). 조립할 때 `references/gallery.md`로 모인다.

## 섹션 형식
```html
<section class="gx" id="D1-03" data-name="되돌림 화살표가 있는 반복 과정">
  <div class="gx-head"><span class="gx-id">D1-03</span><h2>되돌림 화살표가 있는 반복 과정</h2></div>
  <p class="gx-when">언제 쓰나: 어떤 설명이 막힐 때 이 부품이 푸는지 한 문장.</p>
  <style>#D1-03 .loop { … }</style>          <!-- 이 부품만의 CSS. 선택자는 #ID 로 시작 -->
  … 부품 본체 (보고서 본문 폭 그대로) …
  <script>(() => { const root = document.getElementById('D1-03'); … })();</script>
</section>
```
- ID는 `<그룹>-<두 자리 번호>`. 요소 id도 전부 `D1-03-`처럼 부품 ID를 앞에 붙인다.
- 이름은 명사형, 무엇을 하는 부품인지 바로 알 수 있게.

## 디자인 규칙
- 색은 `report_template.html`의 `:root` 토큰만 쓴다. 예외는 `#fff`와 검정 투명도 그림자. SVG도 `style="fill:var(--…)"` 식으로 쓴다. 강조는 대표색 하나, 비교 대상은 회색 단계.
- 글꼴은 `var(--font)`, 코드는 `var(--mono)`, 식은 `var(--math)`. 화면에 보이는 글자는 1440px 폭에서 14px 이상.
- 틀에 있는 부품 클래스(`.card .grid .tbl .fig .stepper .eq details.calc` 등)를 먼저 쓴다.
- 도식은 실물 모양으로 그린다. 글 상자를 화살표로 잇기만 한 도식은 만들지 않는다. 라벨은 대상 바로 옆에 붙인다.
- 900px 이하에서 깨지지 않게: 격자는 1열로, 넓은 SVG는 `min-width`를 주고 가로 스크롤.
- 외부 라이브러리·외부 주소 없이 SVG/Canvas/DOM으로 직접 그린다.

## 글 규칙
- "~한다" 평서문. 제목·라벨은 명사형. 방어 문구, 메타 서술, 조작 안내("누르면 ~")를 쓰지 않는다.
- 부품 안 내용은 진짜 설명처럼 쓴다. 숫자는 서로 맞아야 하고, 예시 수치에는 `<span class="tag tag--mock">예시</span>`를 단다.
