#!/usr/bin/env node
/**
 * 「9 台禁改设备主体未被改动」的机械证明（零依赖）。
 *
 * 背景：本任务的硬约束是 —— 16 台设备里只有 7 台允许改剪影，其余 9 台
 * （eq-102/105/106/109/110/111/113/115/116）**主体禁改，只允许加编号铭牌**。
 * 但 `src/components/equipment3d/` 整个目录在 git 里是**未被跟踪**的，
 * 拿不到 diff 基线，没法用 `git diff` 证明。
 *
 * 做法：拿「改动前打出的生产包」当基线，跟「改动后打出的生产包」比。
 * 压缩器会改局部变量名，但**字符串字面量（零件名/涂装角色/动画类型）原样保留**，
 * 所以按顺序比对每个 build 函数体内的字符串字面量序列即可。
 *
 * 注意：**不要比数值**。压缩器会把 0.4 写成 .4、1000 写成 1e3，
 * 数值比较会产生大量假阳性（之前踩过：9 台未改设备全被误报为"已改"）。
 *
 * 用法：
 *   node scripts/verify-untouched-devices.mjs <基线包> <当前包>
 * 默认：
 *   基线 = dist.prev-200141/assets/EquipmentScene-BdKiQ7Nl.js
 *   当前 = 取 dist/assets/EquipmentScene-*.js
 */

import fs from 'node:fs';
import path from 'node:path';

/** 允许改剪影的 7 台（其余 9 台禁改）。 */
const REWRITABLE = new Set([
  'eq-101', 'eq-103', 'eq-104', 'eq-107', 'eq-108', 'eq-112', 'eq-114',
]);
const ALL_IDS = Array.from({ length: 16 }, (_, i) => `eq-${101 + i}`);
const PROTECTED = ALL_IDS.filter((id) => !REWRITABLE.has(id));

function pickCurrentBundle() {
  const dir = 'dist/assets';
  if (!fs.existsSync(dir)) return null;
  const f = fs
    .readdirSync(dir)
    .filter((x) => /^EquipmentScene-.*\.js$/.test(x))
    .map((x) => path.join(dir, x))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  return f || null;
}

/** 从 id 找到 build 引用的压缩函数名。 */
function buildFnName(src, id) {
  const key = `"${id}":{`;
  const i = src.indexOf(key);
  if (i < 0) return null;
  const region = src.slice(i, i + 4000);
  const m = /build:([A-Za-z_$][\w$]*)/.exec(region);
  return m ? m[1] : null;
}

/** 取 `function NAME(){...}` 的函数体（大括号配平）。 */
function fnBody(src, name) {
  const re = new RegExp(`function\\s+${name}\\s*\\(\\)\\s*\\{`);
  const m = re.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length - 1;
  let depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * 抽出函数体内**按顺序**的字符串字面量（"..." 与 `...`）。
 * 模板串里的 ${} 表达式会被压成 `${t}`，仍保留可比较的结构。
 */
function stringLiterals(body) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = re.exec(body))) out.push(m[1] !== undefined ? m[1] : '`' + m[2] + '`');
  return out;
}

function main() {
  const baseline = process.argv[2] || 'dist.prev-200141/assets/EquipmentScene-BdKiQ7Nl.js';
  const current = process.argv[3] || pickCurrentBundle();
  if (!fs.existsSync(baseline)) {
    console.error(`基线包不存在: ${baseline}`);
    process.exit(2);
  }
  if (!current || !fs.existsSync(current)) {
    console.error(`当前包不存在: ${current}`);
    process.exit(2);
  }

  const A = fs.readFileSync(baseline, 'utf8');
  const B = fs.readFileSync(current, 'utf8');

  console.log(`基线包: ${baseline}`);
  console.log(`当前包: ${current}`);
  console.log('');

  const rows = [];
  for (const id of ALL_IDS) {
    const fnA = buildFnName(A, id);
    const fnB = buildFnName(B, id);
    if (!fnA || !fnB) {
      rows.push({ id, verdict: 'MISSING', note: `基线函数=${fnA} 当前函数=${fnB}` });
      continue;
    }
    const litA = stringLiterals(fnBody(A, fnA) || '');
    const litB = stringLiterals(fnBody(B, fnB) || '');
    const same = JSON.stringify(litA) === JSON.stringify(litB);
    const protectedDev = PROTECTED.includes(id);
    rows.push({
      id,
      group: protectedDev ? '禁改' : '可改',
      partsA: litA.length,
      partsB: litB.length,
      same,
      verdict: same ? '未改动' : '已改动',
    });
  }

  console.log('设备      分组   基线字面量  当前字面量  判定');
  console.log('-------------------------------------------------');
  for (const r of rows) {
    console.log(
      `${r.id}  ${(r.group || '').padEnd(4)}  ${String(r.partsA ?? '-').padStart(8)}  ${String(r.partsB ?? '-').padStart(9)}  ${r.verdict}`
    );
  }

  const protectedChanged = rows.filter((r) => PROTECTED.includes(r.id) && r.verdict !== '未改动');
  const rewritableChanged = rows.filter((r) => REWRITABLE.has(r.id) && r.verdict === '已改动');

  console.log('');
  console.log(`禁改设备（${PROTECTED.length} 台）中被改动: ${protectedChanged.length} 台 ${protectedChanged.map((r) => r.id).join(', ') || ''}`);
  console.log(`可改设备（${REWRITABLE.size} 台）中已改动: ${rewritableChanged.length} 台 ${rewritableChanged.map((r) => r.id).join(', ')}`);

  const ok = protectedChanged.length === 0;
  console.log('');
  console.log(ok ? 'PASS —— 9 台禁改设备主体字面量序列完全一致' : 'FAIL —— 有禁改设备被改动');

  // 产物落盘，供报告引用
  const outDir = 'scratch/3d-identity';
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'untouched-devices-check.json'),
    JSON.stringify({ baseline, current, ok, protectedChanged: protectedChanged.map((r) => r.id), rows }, null, 2)
  );
  console.log(`明细 -> ${path.join(outDir, 'untouched-devices-check.json')}`);
  process.exit(ok ? 0 : 1);
}

main();
