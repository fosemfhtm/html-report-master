// 스크립트 공통 함수. 외부 패키지 없이 Node 20+ 에서 실행한다.
import { existsSync } from 'node:fs';

/** 틀의 기본 대표색. KAIST 로고 색 규정의 KAIST Dark Blue (PANTONE 286C, R0 G65 B145). */
export const KAIST = { accent: '#004191', soft: '#e8eef5', label: 'KAIST Dark Blue (PANTONE 286C)' };

export function parseArgs(argv, flags = {}) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o') { out.o = argv[++i]; continue; }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (flags[key] === 'bool') out[key] = true;
      else {
        // 같은 옵션을 여러 번 주면 쉼표로 이어 붙인다. 예: --exclude a --exclude b → "a,b"
        const v = argv[++i];
        out[key] = out[key] === undefined ? v : `${out[key]},${v}`;
      }
    } else out._.push(a);
  }
  return out;
}

const hex = h => h.replace('#', '').match(/../g).map(x => parseInt(x, 16));

export function luminance(h) {
  const c = hex(h).map(v => v / 255).map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** 흰색과 섞어 연한 배경색을 만든다. t 는 대표색 비율. */
export function tint(h, t = 0.09) {
  return '#' + hex(h).map(v => Math.round(255 + (v - 255) * t).toString(16).padStart(2, '0')).join('');
}

export function hue(h) {
  const [r, g, b] = hex(h).map(v => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  let H;
  if (max === r) H = ((g - b) / d) % 6;
  else if (max === g) H = (b - r) / d + 2;
  else H = (r - g) / d + 4;
  H = (H * 60 + 360) % 360;
  const l = (max + min) / 2;
  return { h: H, s: d / (1 - Math.abs(2 * l - 1)) };
}

/** #hex 대표색을 받아 토큰과 경고를 돌려준다. */
export function resolveAccent(value) {
  if (!/^#[0-9a-fA-F]{6}$/.test(value || '')) throw new Error(`대표색은 #rrggbb 형식이다: ${value}`);
  const accent = value.toLowerCase();
  const warnings = [];
  const { h, s } = hue(accent);
  if (s > 0.25 && ((h >= 90 && h <= 165) || h < 50 || h >= 340)) {
    warnings.push(`색상각 ${Math.round(h)}°: 상태색(초록·주황·빨강)과 겹쳐 좋음/주의/나쁨 표시와 혼동된다.`);
  }
  return { accent, soft: tint(accent), warnings };
}

/** 흰 글씨 대비가 min 이상이 될 때까지 같은 색상으로 어둡게 한다. */
export function darkenToContrast(h, min = 4.5) {
  let rgb = hex(h);
  for (let i = 0; i < 100 && contrast('#ffffff', toHex(rgb)) < min; i++) rgb = rgb.map(v => Math.max(0, Math.round(v * 0.96)));
  return toHex(rgb);
}

const toHex = rgb => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');

/** 대표색이 쓰이는 세 자리의 대비를 계산한다. 흰 글씨 버튼은 4.5 미만이면 실패. */
export function accentReport({ accent, soft }) {
  const rows = [
    ['흰 글씨 / 대표색 버튼·번호', contrast('#ffffff', accent), 4.5],
    ['대표색 글씨 / 흰 카드', contrast(accent, '#ffffff'), 4.5],
    ['대표색 글씨 / 연한 대표색(질문 번호, 보조 버튼)', contrast(accent, soft), 3.0],
  ];
  return rows.map(([label, ratio, min]) => ({ label, ratio: Math.round(ratio * 100) / 100, min, ok: ratio >= min }));
}

export function findChrome() {
  const env = process.env.CHROME_PATH;
  const candidates = [
    env,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
  ].filter(Boolean);
  const found = candidates.find(p => existsSync(p));
  if (!found) throw new Error('Chrome 또는 Edge 를 찾지 못했다. CHROME_PATH 환경 변수로 경로를 지정한다.');
  return found;
}
