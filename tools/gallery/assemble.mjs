// 부품 조각(parts/*.html)을 틀의 CSS·스크립트와 합쳐 갤러리 HTML을 만든다.
// node assemble.mjs                     → ../../skills/html-report-master/assets/gallery.html (전체)
// node assemble.mjs S1 D1 -o preview.html → 지정한 조각만
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ORDER = ['S1', 'S2', 'D1', 'D2', 'M1', 'C1', 'C2'];
const KIND = { S: '큰 구조', D: '도식', M: '작동 모형', C: '차트·글' };

const args = process.argv.slice(2);
const oi = args.indexOf('-o');
const out = oi >= 0 ? resolve(args[oi + 1]) : resolve(here, '../../skills/html-report-master/assets/gallery.html');
const pick = args.filter((a, i) => a !== '-o' && i !== oi + 1);
const groups = (pick.length ? pick : ORDER).filter(g => existsSync(join(here, 'parts', g + '.html')));

const tpl = readFileSync(resolve(here, '../../skills/html-report-master/assets/report_template.html'), 'utf8');
const css = tpl.slice(tpl.indexOf('<style>') + 7, tpl.indexOf('</style>'));
const js = tpl.slice(tpl.lastIndexOf('<script>') + 8, tpl.lastIndexOf('</script>'));

const frags = groups.map(g => readFileSync(join(here, 'parts', g + '.html'), 'utf8'));
const body = frags.join('\n');
const items = [...body.matchAll(/<section class="gx"[^>]*id="([^"]+)"[^>]*data-name="([^"]+)"/g)].map(m => ({ id: m[1], name: m[2] }));
const toc = Object.entries(KIND).map(([k, label]) => {
  const list = items.filter(it => it.id.startsWith(k));
  if (!list.length) return '';
  return `<div class="gx-toc-col"><h3>${label}</h3>${list.map(it => `<a href="#${it.id}"><b>${it.id}</b>${it.name}</a>`).join('')}</div>`;
}).join('');

const galleryCss = `
.gx { padding: 56px 0 40px; border-top: 1px solid var(--line); }
.gx-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 14px; margin-bottom: 6px; }
.gx-head .gx-id { padding: 3px 10px; border-radius: 8px; background: var(--ink); color: #fff; font: 700 15px/1.3 var(--mono); }
.gx-head h2 { margin: 0; font-size: 28px; }
.gx-when { margin: 0 0 26px; color: var(--ink-3); font-size: 17px; }
.gx-toc { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; margin-top: 26px; }
.gx-toc h3 { font-size: 18px; color: var(--accent); }
.gx-toc a { display: flex; gap: 8px; padding: 4px 0; color: var(--ink-2); font-size: 15px; text-decoration: none; line-height: 1.4; }
.gx-toc a b { flex-shrink: 0; width: 56px; white-space: nowrap; color: var(--ink-3); font-family: var(--mono); font-size: 14px; }
@media (max-width: 900px) { .gx-toc { grid-template-columns: 1fr 1fr; } }
`;

const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>부품 갤러리</title>
<!-- 보고서에 골라 쓸 구조·도식·모형·차트 모음. 내용은 모두 설명용 예시다.
     쓸 때는 필요한 <section class="gx"> 안의 마크업과 그 섹션의 <style>·<script>를 보고서로 옮기고, #부품ID 선택자를 보고서에 맞게 바꾼다. -->
<style>${css}${galleryCss}</style>
</head>
<body>
<div class="top"><strong>부품 갤러리</strong><nav>${Object.entries(KIND).map(([k, l]) => `<a href="#toc-${k}">${l}</a>`).join('')}</nav></div>
<div class="wrap">
<header class="hero">
  <div class="eyebrow">html-report-master · 부품 갤러리</div>
  <h1>보고서에 골라 쓰는 구조와 도식</h1>
  <p>장·절의 배치, 실물 도식, 만져 보는 모형, 차트, 글 부품을 모았다. 내용은 모두 설명용 예시이고, 보고서에서는 자료에 맞는 것을 골라 내용과 형태를 바꿔 쓴다.</p>
  <div class="gx-toc">${toc.replace(/<div class="gx-toc-col"><h3>([^<]+)<\/h3>/g, (m, l) => `<div class="gx-toc-col" id="toc-${Object.keys(KIND).find(k => KIND[k] === l)}"><h3>${l}</h3>`)}</div>
</header>
${body}
<footer>부품 갤러리 · 모든 수치와 대상은 설명용 예시</footer>
</div>
<div class="lightbox" role="dialog" aria-label="확대 이미지"><img alt=""></div>
<script>${js}</script>
</body>
</html>`;
writeFileSync(out, html);

// 전체 조립일 때만 목록 문서도 다시 쓴다(조각 옆의 <그룹>.md 행을 모은다).
if (!pick.length) {
  const LABEL = { S1: '큰 구조 · 설명 흐름과 배치', S2: '큰 구조 · 실험·과정·수치 배치', D1: '도식 · 실물과 공간', D2: '도식 · 과정·모델 구조·추상', M1: '작동 모형 · 조작하면 그림과 숫자가 함께 바뀜', C1: '차트', C2: '차트 · 글 부품' };
  const doc = ['# 부품 갤러리 목록', '',
    '`assets/gallery.html`에 있는 부품 목록이다. 보고서를 만들 때 장마다 "이 장에서 독자가 어디서 막히는가"를 먼저 정하고, 그걸 푸는 부품을 여기서 고른다. 고른 부품은 갤러리를 브라우저로 열어 화면을 보고, `<section id="부품ID">` 안의 마크업과 그 섹션의 `<style>`·`<script>`를 보고서로 옮긴 뒤 선택자의 `#부품ID`를 보고서에 맞게 바꾼다.', '',
    '갤러리의 주제와 숫자는 모두 설명용 예시다. 형태만 가져오고 내용은 자료로 다시 채운다. 맞는 부품이 없으면 비슷한 부품의 기법을 섞거나 새로 만든다.', ''];
  for (const g of groups) {
    const rows = readFileSync(join(here, 'parts', g + '.md'), 'utf8').split('\n').filter(r => /^\| [A-Z]\d-\d\d /.test(r));
    doc.push(`## ${LABEL[g] ?? g}`, '', '| ID | 이름 | 언제 쓰나 | 핵심 요소 |', '|---|---|---|---|', ...rows, '');
  }
  writeFileSync(resolve(here, '../../skills/html-report-master/references/gallery.md'), doc.join('\n'));
}
console.log(`${out} · 조각 ${groups.join(', ')} · 부품 ${items.length}개`);
