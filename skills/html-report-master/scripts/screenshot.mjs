#!/usr/bin/env node
// 화면 폭별 전체 페이지 스크린샷과 배치 검사. Chrome/Edge 를 DevTools 프로토콜로 직접 제어한다.
//
// 배포본 검사(기본): 파일 하나만 빈 임시 폴더로 복사하고 네트워크를 막은 채 연다.
//   node screenshot.mjs dist/report.html --out shots
// 작업본 검사: 상대 경로 자산을 쓰는 원래 위치에서 연다.
//   node screenshot.mjs report.html --out shots --in-place
// 대표색 비교: 표지만 후보 색으로 찍는다(파일은 바꾸지 않는다).
//   node screenshot.mjs report.html --out shots --in-place --accents '#004191,#0a84ff' --widths 1440 --cover
// 모션 발표: 스텝이 끝난 화면을 1920×1080 으로 모두 찍고 넘침·자막 겹침·작은 글자를 본다. 테마 기본은 둘 다.
//   node screenshot.mjs deck.html --out shots --in-place --motion [--themes dark,light]
import { spawn } from 'node:child_process';
import { mkdtempSync, copyFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, findChrome, resolveAccent } from './lib.mjs';

const args = parseArgs(process.argv.slice(2), { 'in-place': 'bool', cover: 'bool', motion: 'bool' });
const input = args._[0];
if (!input) {
  console.error("사용법: node screenshot.mjs <파일.html> [--out 폴더] [--widths 1440,1240,900,390] [--accents '#rrggbb,#rrggbb'] [--in-place] [--cover] [--motion [--themes dark,light]]");
  process.exit(2);
}
const widths = (args.widths || '1440,1240,900,390').split(',').map(Number);
const accents = args.accents ? args.accents.split(',').map(a => resolveAccent(a.trim())) : [null];
const outDir = resolve(args.out || 'shots');
mkdirSync(outDir, { recursive: true });

let target = resolve(input);
const work = mkdtempSync(join(tmpdir(), 'lab-report-'));
if (!args['in-place']) {
  target = join(work, 'isolated', basename(input));
  mkdirSync(join(work, 'isolated'));
  copyFileSync(resolve(input), target);
}

// --- Chrome 실행과 CDP 연결 ---
const chrome = spawn(findChrome(), [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(work, 'profile')}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-device-scale-factor=1',
  '--allow-file-access-from-files', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

const wsUrl = await new Promise((ok, fail) => {
  let buf = '';
  const timer = setTimeout(() => fail(new Error('Chrome DevTools 연결 시간 초과')), 20000);
  chrome.stderr.on('data', d => {
    buf += d;
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) { clearTimeout(timer); ok(m[1]); }
  });
  chrome.on('exit', c => fail(new Error(`Chrome 종료 (${c})`)));
});

const ws = new WebSocket(wsUrl);
await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
let seq = 0;
const pending = new Map();
const listeners = [];
ws.onmessage = ev => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { ok, fail } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
  } else if (msg.method) listeners.forEach(fn => fn(msg));
};
const send = (method, params = {}, sessionId) => new Promise((ok, fail) => {
  const id = ++seq;
  pending.set(id, { ok, fail });
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const page = (m, p) => send(m, p, sessionId);

const issues = { failed: new Set(), blocked: new Set(), errors: new Set() };
listeners.push(msg => {
  if (msg.sessionId !== sessionId) return;
  if (msg.method === 'Network.loadingFailed') {
    const p = msg.params;
    (p.blockedReason ? issues.blocked : issues.failed).add(`${p.errorText}${p.blockedReason ? ` (${p.blockedReason})` : ''} ${requests.get(p.requestId) || ''}`);
  }
  if (msg.method === 'Network.requestWillBeSent') requests.set(msg.params.requestId, msg.params.request.url.slice(0, 140));
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    issues.errors.add((d.exception && d.exception.description) || d.text);
  }
});
const requests = new Map();

await page('Page.enable');
await page('Runtime.enable');
await page('Network.enable');
if (!args['in-place']) await page('Network.setBlockedURLs', { urls: ['http://*', 'https://*', 'ws://*', 'wss://*'] });

const evaluate = async expr => {
  const r = await page('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};

// --- 화면 폭마다 촬영과 검사 ---
const LAYOUT_PROBE = `(() => {
  const vw = document.documentElement.clientWidth;
  const inScroller = el => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
  const visible = el => { const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && el.getClientRects().length > 0; };
  const nameOf = el => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).join('.') : '');
  const over = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || getComputedStyle(el).position === 'fixed') continue;
    if (el.closest('.lightbox') || inScroller(el)) continue;
    if (r.right > vw + 1) over.push(nameOf(el) + ' → ' + Math.round(r.right - vw) + 'px');
  }
  const clipped = [];
  for (const el of document.querySelectorAll('h1,h2,h3,p,li,td,th,figcaption,.big,.linkbtn')) {
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'hidden') clipped.push(el.textContent.trim().slice(0, 30));
  }
  // 화면에 실제로 보이는 글자 크기. HTML 글자는 계산된 크기, SVG 글자는 화면에 그려진 높이로 본다.
  const small = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.lightbox, script, style') || !visible(el)) continue;
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    let px;
    if (el instanceof SVGElement) { const ctm = el.getScreenCTM(); px = parseFloat(getComputedStyle(el).fontSize) * (ctm ? Math.hypot(ctm.a, ctm.b) : 1); }
    else px = parseFloat(getComputedStyle(el).fontSize);
    if (px < 13.5) small.push(nameOf(el) + ' "' + el.textContent.trim().slice(0, 16) + '" ' + px.toFixed(1) + 'px');
  }
  return {
    scrollWidth: document.documentElement.scrollWidth, vw,
    height: Math.ceil(document.documentElement.scrollHeight),
    over: over.slice(0, 8), clipped: clipped.slice(0, 8), small: small.slice(0, 8), smallCount: small.length,
    font: document.fonts.check('700 20px Pretendard') && [...document.fonts].some(f => f.family.replace(/"/g, '') === 'Pretendard' && f.status === 'loaded'),
    brokenImgs: [...document.images].filter(i => i.getAttribute('src') && i.complete && i.naturalWidth === 0).map(i => (i.currentSrc || i.src).slice(0, 80)),
  };
})()`;

const url = pathToFileURL(target).href;
const report = [];
let failed = false;

// --- 모션 발표: 스텝마다 촬영과 검사 ---
const MOTION_PROBE = `(() => {
  const stage = document.getElementById('stage'), sr = stage.getBoundingClientRect(), k = sr.width / 1920;
  const scene = [...stage.querySelectorAll('.scene')].find(s => getComputedStyle(s).visibility === 'visible' && +getComputedStyle(s).opacity > .5);
  const shown = el => { for (let p = el; p && p !== stage; p = p.parentElement) { const s = getComputedStyle(p); if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity < .05) return false; } return el.getClientRects().length > 0; };
  const ownText = el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
  const label = el => (el.textContent || el.tagName).trim().slice(0, 18);
  const over = [], band = [], small = [], faint = [];
  const bandTop = sr.top + 944 * k;
  if (scene) for (const el of scene.querySelectorAll('*')) {
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect(); if (!r.width && !r.height) continue;
    const leaf = ownText(el) || el instanceof SVGGeometryElement || el.tagName === 'IMG';
    if (!leaf) continue;
    if (r.left < sr.left - 2 || r.right > sr.right + 2 || r.top < sr.top - 2 || r.bottom > sr.bottom + 2) over.push(label(el));
    else if (r.bottom > bandTop + 2 && r.top < sr.bottom) band.push(label(el));
    if (ownText(el)) {
      let px = parseFloat(getComputedStyle(el).fontSize);
      if (el instanceof SVGElement) { const m = el.getScreenCTM(); px = px * (m ? Math.hypot(m.a, m.b) : 1) / k; }
      if (px < 16.5) small.push(label(el) + ' ' + px.toFixed(1) + 'px');
      const c = getComputedStyle(el).color.match(/[\\d.]+/g) || [], a = c.length > 3 ? +c[3] : 1;
      if (a < .45) faint.push(label(el) + ' α' + a.toFixed(2));
    }
  }
  return { scene: scene ? scene.id : null, over: over.slice(0, 6), band: band.slice(0, 6), small: small.slice(0, 6), faint: faint.slice(0, 6), counts: [over.length, band.length, small.length, faint.length],
    font: document.fonts.check('700 20px Pretendard') };
})()`;

if (args.motion) {
  const themes = (args.themes || 'dark,light').split(',');
  await page('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  const loaded = new Promise(ok => listeners.push(function once(m) { if (m.sessionId === sessionId && m.method === 'Page.loadEventFired') { listeners.splice(listeners.indexOf(once), 1); ok(); } }));
  await page('Page.navigate', { url: pathToFileURL(target).href });
  await loaded;
  await evaluate('document.fonts.ready.then(() => new Promise(r => setTimeout(r, 400))).then(() => document.getElementById("hint")?.remove())');
  const beats = await evaluate('window.__deck ? window.__deck.beats : null');
  if (!beats) { console.log('window.__deck 이 없다. motion_template.html 의 엔진으로 만든 파일인지 확인한다.'); process.exit(1); }
  let bad = 0;
  for (const th of themes) {
    await evaluate(`window.__deck.setTheme(${JSON.stringify(th)})`);
    for (let i = 0; i < beats.length; i++) {
      await evaluate(`window.__deck.seekBeat(${i}); new Promise(r => setTimeout(r, 120))`);
      const p = await evaluate(MOTION_PROBE);
      const file = `${basename(input, '.html')}_${th}_${String(i + 1).padStart(2, '0')}_${beats[i].scene}.png`;
      const shot = await page('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(outDir, file), Buffer.from(shot.data, 'base64'));
      const lines = [];
      if (p.counts[0]) lines.push(`무대 밖 ${p.counts[0]}곳: ${p.over.join(' / ')}`);
      if (p.counts[1]) lines.push(`자막 띠 침범 ${p.counts[1]}곳: ${p.band.join(' / ')}`);
      if (p.counts[2]) lines.push(`17px 미만 ${p.counts[2]}곳: ${p.small.join(' / ')}`);
      if (p.counts[3]) lines.push(`흐린 글자 ${p.counts[3]}곳: ${p.faint.join(' / ')}`);
      if (!p.font) lines.push('Pretendard 가 로드되지 않음');
      if (lines.length) { bad++; report.push(`문제 ${file}` + lines.map(l => `\n    - ${l}`).join('')); }
    }
  }
  report.push(`${bad ? '문제' : '통과'} 스텝 ${beats.length}개 × 테마 ${themes.length}개, 문제 화면 ${bad}장`);
  if (bad) failed = true;
}

for (const accent of args.motion ? [] : accents) {
  for (const w of widths) {
    await page('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 600 });
    const loaded = new Promise(ok => listeners.push(function once(m) {
      if (m.sessionId === sessionId && m.method === 'Page.loadEventFired') { listeners.splice(listeners.indexOf(once), 1); ok(); }
    }));
    await page('Page.navigate', { url });
    await loaded;
    if (accent) await evaluate(`(s => { s.setProperty('--accent', ${JSON.stringify(accent.accent)}); s.setProperty('--accent-soft', ${JSON.stringify(accent.soft)}); })(document.documentElement.style)`);
    await evaluate('document.fonts.ready.then(() => new Promise(r => setTimeout(r, 300)))');

    const probe = await evaluate(LAYOUT_PROBE);
    // 긴 문서는 브라우저 한계(약 16000px)에 걸리지 않게 12000px 조각으로 나눠 찍는다: 이름_폭.png, 이름_폭_2.png …
    const TILE = 12000;
    const total = args.cover ? 900 : probe.height;
    const base = `${basename(input, '.html')}${accent ? '_' + accent.accent.slice(1) : ''}_${w}`;
    const names = [];
    for (let y = 0, k = 1; y < total; y += TILE, k++) {
      const h = Math.min(TILE, total - y);
      await page('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
      await evaluate(`window.scrollTo(0, ${y}); new Promise(r => setTimeout(r, 150))`);
      const shot = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const file = k === 1 ? `${base}.png` : `${base}_${k}.png`;
      writeFileSync(join(outDir, file), Buffer.from(shot.data, 'base64'));
      names.push(file);
    }
    const name = names.length > 1 ? `${names[0]} 외 ${names.length - 1}장` : names[0];

    const lines = [];
    if (probe.scrollWidth > probe.vw + 1) lines.push(`가로 넘침 ${probe.scrollWidth - probe.vw}px: ${probe.over.join(', ')}`);
    if (probe.clipped.length) lines.push(`잘린 글자: ${probe.clipped.join(' / ')}`);
    if (!probe.font) lines.push('Pretendard 가 로드되지 않음');
    if (probe.brokenImgs.length) lines.push(`깨진 이미지: ${probe.brokenImgs.join(', ')}`);
    if (probe.smallCount) lines.push(`14px 미만 글자 ${probe.smallCount}곳: ${probe.small.join(', ')}`);
    if (lines.length) failed = true;
    report.push(`${lines.length ? '문제' : '통과'} ${name} (높이 ${probe.height}px)` + lines.map(l => `\n    - ${l}`).join(''));
  }
}

for (const r of report) console.log(r);
const summary = [
  ['막힌 외부 요청', issues.blocked],
  ['불러오지 못한 자산', issues.failed],
  ['스크립트 오류', issues.errors],
];
for (const [label, set] of summary) {
  if (!set.size) continue;
  failed = true;
  console.log(`${label} ${set.size}건:`);
  for (const s of set) console.log(`    - ${s}`);
}
console.log(`${args['in-place'] ? '작업본 위치에서' : '빈 폴더·네트워크 차단 상태에서'} 확인. 스크린샷: ${outDir}`);

ws.close();
chrome.kill();
await new Promise(r => setTimeout(r, 300));
try { rmSync(work, { recursive: true, force: true }); } catch {}
process.exit(failed ? 1 : 0);
