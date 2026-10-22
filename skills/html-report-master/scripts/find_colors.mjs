#!/usr/bin/env node
// 사용자가 준 코드·자료에서 대표색 후보를 찾는다. 화면 캡처와 로고는 에이전트가 직접 보고 판단한다.
// 이름에 primary/brand/accent/theme 가 붙은 색을 앞에 두고, 회색·흰색·검정은 뺀다.
//
// node find_colors.mjs <폴더 또는 파일> [더 많은 경로] [--exclude 경로1,경로2] [--top 8]
// node find_colors.mjs --check '#0c3f9d,#004191'     그림·로고에서 찾은 색의 대비와 연한 색만 확인
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname, relative, resolve, sep, dirname } from 'node:path';
import { parseArgs, resolveAccent, contrast, darkenToContrast, hue, luminance, KAIST } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));

if (args.check) {
  for (const raw of args.check.split(',')) {
    const a = resolveAccent(raw.trim());
    const c = contrast('#ffffff', a.accent);
    console.log(`${a.accent}  흰 글씨 대비 ${c.toFixed(2)}:1 ${c >= 4.5 ? '통과' : `미달 → 같은 색상의 어두운 값 ${darkenToContrast(a.accent)}`}, 연한 색 ${a.soft}`);
    for (const w of a.warnings) console.log(`    ! ${w}`);
  }
  process.exit(0);
}

if (!args._.length) { console.error('사용법: node find_colors.mjs <폴더|파일> [...] [--exclude 경로,경로] [--top 8] | --check "#hex,#hex"'); process.exit(2); }
const TOP = Number(args.top || 8);
// 제외 경로: 사용자가 보지 말라고 한 폴더, 이미 만든 보고서 등. 자료 경로 기준 상대 경로나 절대 경로.
const EXCLUDE = (args.exclude ? args.exclude.split(',') : []).map(p => p.trim()).filter(Boolean);

const EXT = new Set(['.css', '.scss', '.sass', '.less', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.vue', '.svelte',
  '.html', '.htm', '.json', '.yaml', '.yml', '.toml', '.py', '.svg', '.xml', '.kt', '.swift', '.dart']);
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.venv', 'venv', '__pycache__', '.cache', 'coverage', 'vendor']);
const ROLE = /(primary|brand|accent|theme|main|key|point|highlight|signature)/i;

function excluded(p, base) {
  const abs = resolve(p);
  return EXCLUDE.some(e => {
    const target = resolve(base, e);
    return abs === target || abs.startsWith(target + sep);
  });
}

function* walk(p, base) {
  if (excluded(p, base)) return;
  const st = statSync(p);
  if (st.isFile()) { if (EXT.has(extname(p).toLowerCase()) && st.size < 2_000_000) yield p; return; }
  for (const name of readdirSync(p)) {
    if (SKIP.has(name) || name.startsWith('.')) continue;
    yield* walk(join(p, name), base);
  }
}

const toHex6 = h => (h.length === 4 ? '#' + [...h.slice(1)].map(c => c + c).join('') : h).toLowerCase();
const rgbToHex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(+v))).toString(16).padStart(2, '0')).join('');
const COLOR = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z])|rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/g;

const found = new Map(); // hex -> { count, roles:Set, where:[] }
for (const root of args._) {
  const base = resolve(root);
  for (const file of walk(base, statSync(base).isDirectory() ? base : dirname(base))) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const m of line.matchAll(COLOR)) {
        const hex = m[1] ? rgbToHex(m[1], m[2], m[3]) : toHex6(m[0]);
        const before = line.slice(0, m.index);
        const name = (before.match(/([\w-]+)\s*["']?\s*[:=]\s*["'`]?\s*$/) || [])[1] || '';
        const e = found.get(hex) || { count: 0, roles: new Set(), where: [] };
        e.count++;
        if (ROLE.test(name)) e.roles.add(name);
        if (e.where.length < 3) e.where.push(`${relative(process.cwd(), file)}:${i + 1}${name ? ` (${name})` : ''}`);
        found.set(hex, e);
      }
    });
  }
}

// 회색, 거의 흰색, 거의 검정은 대표색 후보가 아니다.
const usable = [...found.entries()].filter(([h]) => {
  const { s } = hue(h), L = luminance(h);
  return s >= 0.2 && L < 0.8 && L > 0.01;
});

// 비슷한 색은 하나로 묶는다.
const dist = (a, b) => Math.hypot(...[0, 2, 4].map(i => parseInt(a.substr(1 + i, 2), 16) - parseInt(b.substr(1 + i, 2), 16)));
const groups = [];
for (const [h, e] of usable.sort((a, b) => b[1].count - a[1].count)) {
  const g = groups.find(x => dist(x.hex, h) < 18);
  if (g) { g.count += e.count; e.roles.forEach(r => g.roles.add(r)); g.alias.push(h); }
  else groups.push({ hex: h, count: e.count, roles: new Set(e.roles), where: e.where, alias: [] });
}
const ranked = groups.sort((a, b) => (b.roles.size ? 1000 : 0) + b.count - ((a.roles.size ? 1000 : 0) + a.count)).slice(0, TOP);

const describe = hex => {
  const a = resolveAccent(hex);
  const c = contrast('#ffffff', hex);
  const notes = [...a.warnings];
  if (c < 4.5) notes.push(`흰 글씨 대비 ${c.toFixed(2)}:1 미달 → 같은 색상의 어두운 값 ${darkenToContrast(hex)}`);
  return { soft: a.soft, contrast: c.toFixed(2), notes };
};

const k = describe(KAIST.accent);
console.log(`기본 후보: ${KAIST.accent} ${KAIST.label}, 흰 글씨 대비 ${k.contrast}:1\n`);
if (!ranked.length) { console.log('자료에서 대표색으로 쓸 만한 색을 찾지 못했다. 화면 캡처·로고를 직접 보고 판단한다.'); process.exit(0); }
console.log(`자료에서 찾은 후보 ${ranked.length}개 (이름 붙은 색 우선, 그다음 빈도):`);
ranked.forEach((g, i) => {
  const d = describe(g.hex);
  console.log(`\n[${i + 1}] ${g.hex}  ${g.count}회${g.roles.size ? `  역할: ${[...g.roles].join(', ')}` : ''}${g.alias.length ? `  비슷한 색: ${g.alias.slice(0, 3).join(', ')}` : ''}`);
  console.log(`    흰 글씨 대비 ${d.contrast}:1, 연한 색 ${d.soft}`);
  for (const w of g.where) console.log(`    - ${w}`);
  for (const n of d.notes) console.log(`    ! ${n}`);
});
