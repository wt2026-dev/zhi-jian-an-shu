#!/usr/bin/env node
// ============================================================
// 智检安枢 · 资产完整性校验（工业级可信的基石之一）
//
// 目的：杜绝「全新 clone 静默降级」与「损坏资产伪装成 GLB」这类信任破坏。
//   - 清单（assets-manifest.json）中的每项关键资产必须：纳入版本控制、
//     魔数为 glTF、SHA256 与清单一致；
//   - public/models 下任何未被清单收录 / 未跟踪 / 魔数非 glTF 的 .glb，
//     一律判为完整性破坏（例如曾出现的 asian_worker.glb 实为 2.3KB 残页、
//     asian_worker_new.glb 实为 HTML 下载失败残页）。
//
// 用法：
//   node scripts/verify-assets.mjs            # 校验（CI / 提交前）
//   node scripts/verify-assets.mjs --gen      # 依据当前 public/models 下已跟踪的 glTF 资产重新生成清单
//
// 退出码：0 = 通过；1 = 存在完整性破坏。
// ============================================================
import { readFileSync, writeFileSync, readdirSync, statSync, openSync, readSync, closeSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'assets-manifest.json');
const modelsDir = join(root, 'public/models');

function sha256Of(file) {
  const buf = readFileSync(file);
  return createHash('sha256').update(buf).digest('hex');
}

function magic4(file) {
  const fd = openSync(file, 'r');
  const b = Buffer.alloc(4);
  try {
    readSync(fd, b, 0, 4, 0);
  } finally {
    closeSync(fd);
  }
  return b.toString('latin1');
}

function isTracked(rel) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', rel], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

function walkGlbs(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walkGlbs(p, out);
    else if (e.toLowerCase().endsWith('.glb')) out.push(p);
  }
  return out;
}

// ── 生成模式：扫描 public/models 下「已跟踪且魔数为 glTF」的资产，重写清单 ──
if (process.argv.includes('--gen')) {
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8'))
    : { version: 1, algorithm: 'sha256', expectedMagic: 'glTF', assets: [] };
  const assets = [];
  for (const f of walkGlbs(modelsDir)) {
    const rel = relative(root, f).replace(/\\/g, '/');
    if (!isTracked(rel)) {
      console.warn(`跳过未跟踪资产（不纳入清单）: ${rel}`);
      continue;
    }
    if (magic4(f) !== 'glTF') {
      console.warn(`跳过魔数非 glTF 的资产（不纳入清单）: ${rel}`);
      continue;
    }
    const st = statSync(f);
    assets.push({ path: rel, size: st.size, sha256: sha256Of(f) });
  }
  assets.sort((a, b) => a.path.localeCompare(b.path));
  manifest.assets = assets;
  manifest.generatedAt = new Date().toISOString().slice(0, 10);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`✓ 已重新生成清单：${assets.length} 项关键资产。`);
  process.exit(0);
}

// ── 校验模式 ──
let failures = 0;
const fail = (m) => {
  console.error('✗ ' + m);
  failures++;
};

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const manifestPaths = new Set();
const expectedMagic = manifest.expectedMagic || 'glTF';

for (const a of manifest.assets) {
  const abs = join(root, a.path);
  const rel = relative(root, abs).replace(/\\/g, '/');
  manifestPaths.add(rel);
  if (!existsSync(abs)) {
    fail(`缺失资产: ${a.path}`);
    continue;
  }
  if (!isTracked(rel)) fail(`未纳入版本控制: ${a.path}`);
  const m = magic4(abs);
  if (m !== expectedMagic) fail(`魔数错误（应为 ${expectedMagic}，实为 ${JSON.stringify(m)}）: ${a.path}`);
  const h = sha256Of(abs);
  if (h !== a.sha256) fail(`SHA256 不符: ${a.path}\n    期望 ${a.sha256}\n    实际 ${h}`);
}

// 扫描 public/models 下所有 .glb：凡不在清单内，一律判失败（含未跟踪 / 损坏残页）
for (const f of walkGlbs(modelsDir)) {
  const rel = relative(root, f).replace(/\\/g, '/');
  if (!manifestPaths.has(rel)) {
    const m = magic4(f);
    fail(`清单未收录或多余的 .glb: ${rel}（魔数 ${JSON.stringify(m)}）`);
  }
}

if (failures) {
  console.error(`\n资产完整性校验失败：${failures} 项。`);
  process.exit(1);
}
console.log(`✓ 资产完整性校验通过：${manifest.assets.length} 项关键资产全部在版本控制内、魔数正确、哈希一致。`);
