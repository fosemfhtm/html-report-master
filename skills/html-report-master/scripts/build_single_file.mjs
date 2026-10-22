#!/usr/bin/env node
// 작업용 HTML 을 인터넷 없이 열리는 단일 파일로 만든다.
// 글꼴·이미지·CSS·JS 는 data URI 나 인라인으로, 데모 HTML 은 base64 로 넣는다.
//
// node build_single_file.mjs report.html -o dist/report.html [--accent '#004191']
// --accent 를 주면 :root 의 대표색과 연한 색을 바꾼다. 주지 않으면 작업본의 값을 그대로 쓴다. 어느 쪽이든 대비를 검사한다.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, extname, basename } from 'node:path';
import { parseArgs, resolveAccent, accentReport, darkenToContrast } from './lib.mjs';
import { scan } from './check_offline.mjs';

const MIME = {
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.json': 'application/json', '.csv': 'text/csv',
};

const isLocal = ref => ref && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref.trim());

function dataUri(file) {
  const type = MIME[extname(file).toLowerCase()];
  if (!type) throw new Error(`형식을 모르는 자산: ${file}`);
  return `data:${type};base64,${readFileSync(file).toString('base64')}`;
}

function need(base, ref, from) {
  const file = resolve(base, decodeURI(ref.split(/[?#]/)[0]));
  if (!existsSync(file)) throw new Error(`없는 파일: ${ref} (${from})`);
  return file;
}

function inlineCssUrls(css, base, from) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, ref) =>
    isLocal(ref) ? `url("${dataUri(need(base, ref, from))}")` : m);
}

const escapeScript = s => s.replace(/<\/script/gi, '<\\/script');

/** HTML 하나의 로컬 자산을 모두 안으로 넣는다. 데모 HTML 에도 같은 함수를 쓴다. */
export function inlineHtml(html, base, from) {
  // <link rel="stylesheet" href="local.css">
  html = html.replace(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi, tag => {
    const ref = (tag.match(/href=["']([^"']+)["']/i) || [])[1];
    if (!isLocal(ref)) return tag;
    const file = need(base, ref, from);
    return `<style>\n${inlineCssUrls(readFileSync(file, 'utf8'), dirname(file), ref)}\n</style>`;
  });
  // <script src="local.js"></script>
  html = html.replace(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (m, pre, ref, post) => {
    if (!isLocal(ref)) return m;
    const code = readFileSync(need(base, ref, from), 'utf8');
    return `<script${pre}${post}>\n${escapeScript(code)}\n</script>`;
  });
  // <style> 안의 url(...)
  html = html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, a, css, z) => a + inlineCssUrls(css, base, from) + z);
  // style="...url(...)"
  html = html.replace(/style="([^"]*url\([^"]*)"/gi, (m, css) => `style="${inlineCssUrls(css, base, from)}"`);
  // src / poster / href(아이콘) 속성
  html = html.replace(/<(img|source|video|audio|input)\b[^>]*>/gi, tag =>
    tag.replace(/\b(src|poster)=["']([^"']+)["']/gi, (m, attr, ref) =>
      isLocal(ref) ? `${attr}="${dataUri(need(base, ref, from))}"` : m));
  html = html.replace(/<link\b[^>]*rel=["']?(?:icon|shortcut icon|apple-touch-icon)["']?[^>]*>/gi, tag =>
    tag.replace(/href=["']([^"']+)["']/i, (m, ref) => (isLocal(ref) ? `href="${dataUri(need(base, ref, from))}"` : m)));
  return html;
}

function packDemo(html, base) {
  const m = html.match(/<iframe\b[^>]*\bdata-demo=["']([^"']+)["'][^>]*>/i);
  if (!m) return html;
  const ref = m[1];
  if (!isLocal(ref)) throw new Error(`데모는 로컬 HTML 이어야 한다: ${ref}`);
  const file = need(base, ref, 'data-demo');
  const demo = inlineHtml(readFileSync(file, 'utf8'), dirname(file), ref);
  const b64 = Buffer.from(demo, 'utf8').toString('base64');
  html = html.replace(m[0], m[0].replace(/\bdata-demo=["'][^"']+["']/, 'data-demo=""'));
  const packed = `<script type="application/octet-stream" id="demo-b64">${b64}</script>\n`;
  const i = html.lastIndexOf('<script>');
  return i >= 0 ? html.slice(0, i) + packed + html.slice(i) : html.replace('</body>', packed + '</body>');
}

const ACCENT_RE = /--accent:\s*(#[0-9a-fA-F]{6});\s*--accent-soft:\s*(#[0-9a-fA-F]{6});/;

function applyAccent(html, value) {
  if (!ACCENT_RE.test(html)) throw new Error(':root 에서 "--accent: #hex; --accent-soft: #hex;" 선언을 찾지 못했다.');
  const a = resolveAccent(value);
  return html.replace(ACCENT_RE, `--accent: ${a.accent}; --accent-soft: ${a.soft};`);
}

function readAccent(html) {
  const m = html.match(ACCENT_RE);
  if (!m) return null;
  return { ...resolveAccent(m[1]), soft: m[2].toLowerCase() };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args._[0];
  if (!input || !args.o) {
    console.error("사용법: node build_single_file.mjs <작업용.html> -o <배포본.html> [--accent '#rrggbb']");
    process.exit(2);
  }
  const src = resolve(input), base = dirname(src);
  // 작업용 주석(부품 설명, 데모 예시 태그)은 배포본에 남기지 않는다. 주석 속 태그가 실제 태그로 처리되는 일도 막는다.
  let html = readFileSync(src, 'utf8').replace(/<!--[\s\S]*?-->\n?/g, '');
  html = packDemo(html, base);
  html = inlineHtml(html, base, basename(src));

  if (args.accent) html = applyAccent(html, args.accent);

  const out = resolve(args.o);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  console.log(`배포본: ${out} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB)`);

  const accent = readAccent(html);
  if (!accent) {
    console.log('대표색 선언을 찾지 못해 대비 검사를 건너뛴다.');
  } else {
    console.log(`대표색 ${accent.accent} / 연한 색 ${accent.soft}`);
    for (const w of accent.warnings) console.log(`  경고: ${w}`);
    let fail = false;
    for (const r of accentReport(accent)) {
      console.log(`  ${r.ok ? '통과' : '미달'} ${r.label}: ${r.ratio}:1 (기준 ${r.min}:1)`);
      if (!r.ok && r.label.startsWith('흰 글씨')) fail = true;
    }
    if (fail) {
      console.error(`흰 글씨 대비가 4.5:1 미만이다. 같은 색상의 더 어두운 값: ${darkenToContrast(accent.accent)}`);
      process.exit(1);
    }
  }

  const problems = scan(html);
  if (problems.length) {
    console.error(`남은 외부 의존성 ${problems.length}건:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('외부 의존성 없음');
}

if (basename(process.argv[1] || '') === 'build_single_file.mjs') main();
