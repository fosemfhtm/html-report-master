#!/usr/bin/env node
// 배포본에 남은 외부 의존성을 찾는다. 원본 서비스로 가는 <a href> 링크는 허용한다.
//
// node check_offline.mjs dist/report.html
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const REMOTE = /^(?:https?:)?\/\//i;
const LOCAL_ABS = /^(?:file:|[a-z]:[\\/]|\/(?:Users|home|mnt)\/)|localhost|127\.0\.0\.1/i;

/** 문제 목록을 돌려준다. 빈 배열이면 단일 파일로 열린다. */
export function scan(html) {
  const problems = [];
  const body = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script type="application\/octet-stream"[\s\S]*?<\/script>/gi, '');

  const check = (ref, where) => {
    if (!ref || ref.startsWith('data:') || ref.startsWith('blob:') || ref.startsWith('#') || ref === '') return;
    if (REMOTE.test(ref)) problems.push(`외부 자산 ${where}: ${ref.slice(0, 120)}`);
    else if (LOCAL_ABS.test(ref)) problems.push(`개인 경로 ${where}: ${ref.slice(0, 120)}`);
    else if (!/^[a-z][a-z0-9+.-]*:/i.test(ref)) problems.push(`상대 경로 ${where}: ${ref.slice(0, 120)}`);
  };

  for (const m of body.matchAll(/<(img|source|video|audio|iframe|script|embed)\b[^>]*\b(src|poster)=["']([^"']*)["']/gi)) {
    check(m[3], `<${m[1].toLowerCase()} ${m[2]}>`);
  }
  for (const m of body.matchAll(/<link\b[^>]*>/gi)) {
    const href = (m[0].match(/href=["']([^"']*)["']/i) || [])[1];
    check(href, '<link>');
  }
  for (const m of body.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) check(m[1], 'CSS url()');
  for (const m of body.matchAll(/@import\s+(?:url\()?['"]?([^'");]+)/gi)) check(m[1], 'CSS @import');
  for (const m of body.matchAll(/\bsrcset=["']([^"']+)["']/gi)) {
    for (const part of m[1].split(',')) check(part.trim().split(/\s+/)[0], 'srcset');
  }
  for (const m of body.matchAll(/\bdata-demo=["']([^"']+)["']/gi)) check(m[1], 'data-demo');
  for (const m of body.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
    const ref = m[1];
    if (LOCAL_ABS.test(ref)) problems.push(`개인 경로 링크: ${ref}`);
    else if (!REMOTE.test(ref) && !/^(?:#|mailto:|tel:|data:|blob:)/i.test(ref)) problems.push(`로컬 파일 링크: ${ref}`);
  }
  for (const m of body.matchAll(/\bfetch\(\s*['"]([^'"]+)['"]/g)) check(m[1], 'fetch()');
  return [...new Set(problems)];
}

if (basename(process.argv[1] || '') === 'check_offline.mjs') {
  const file = process.argv[2];
  if (!file) { console.error('사용법: node check_offline.mjs <배포본.html>'); process.exit(2); }
  const problems = scan(readFileSync(file, 'utf8'));
  if (!problems.length) { console.log('외부 의존성 없음'); process.exit(0); }
  console.error(`외부 의존성 ${problems.length}건:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
