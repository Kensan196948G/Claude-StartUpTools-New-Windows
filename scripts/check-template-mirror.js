#!/usr/bin/env node
/**
 * template/mirror consistency check (Issue #17)
 * Claude/templates/claudeos/agents (配布正本) と .claude/claudeos/agents (リポジトリ内ミラー) の
 * ファイル集合と内容の一致を検証する。BOM と改行コード (CRLF/LF) の差は正規化して無視する。
 * Exit 0 = consistent, Exit 1 = drift found.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const TPL = path.join(root, 'Claude', 'templates', 'claudeos', 'agents');
const MIR = path.join(root, '.claude', 'claudeos', 'agents');

let errors = 0;
function fail(msg) { console.error(`::error::${msg}`); errors++; }
function info(msg) { console.log(`::notice::${msg}`); }

function normalize(file) {
  let s = fs.readFileSync(file, 'utf8');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  return s.replace(/\r\n/g, '\n');
}

const tpl = fs.readdirSync(TPL).filter(f => f.endsWith('.md')).sort();
const mir = fs.readdirSync(MIR).filter(f => f.endsWith('.md')).sort();

for (const f of tpl) {
  if (!mir.includes(f)) fail(`mirror missing: .claude/claudeos/agents/${f}`);
}
for (const f of mir) {
  if (!tpl.includes(f)) fail(`template missing: Claude/templates/claudeos/agents/${f}`);
}

let mismatched = 0;
for (const f of tpl.filter(f => mir.includes(f))) {
  if (normalize(path.join(TPL, f)) !== normalize(path.join(MIR, f))) {
    fail(`content drift: ${f} (template と mirror の内容が一致しません)`);
    mismatched++;
  }
}

if (errors === 0) {
  info(`template-mirror check PASSED — ${tpl.length} agent files consistent`);
  process.exit(0);
} else {
  console.error(`template-mirror check FAILED: ${errors} error(s). ` +
    'テンプレ正本を更新した場合は .claude/claudeos/agents へ同一内容を反映してください。');
  process.exit(1);
}
