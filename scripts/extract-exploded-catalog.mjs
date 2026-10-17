/**
 * 从 public/exploded/*.html 提取每台设备拆解页的真实 BOM 零件清单，
 * 生成 src/server/services/explodedCatalog.generated.ts。
 *
 * 数据来源是拆解页 `<script>` 里的真实零件数组（PUMP_PARTS / PARTS_DATA /
 * COMPRESSOR_PARTS / MOTOR_PARTS），这些数组是每台设备拆解视图的**唯一权威清单**
 * —— 位号(P01…)、名称、规格、材质全部来自这些数组本身，本脚本不做任何语义补写。
 *
 * 用法：`node scripts/extract-exploded-catalog.mjs`（需要重新生成时再跑）
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'public', 'exploded');
const OUT_FILE = path.join(ROOT, 'src', 'server', 'services', 'explodedCatalog.generated.ts');

/** 拆解页里真正的零件数组变量名（按脚本扫描核实，与 9 份 HTML 一一对应）。 */
const PART_ARRAY_NAMES = ['PUMP_PARTS', 'MOTOR_PARTS', 'COMPRESSOR_PARTS', 'PARTS_DATA', 'MACHINING_PARTS'];

/** 提取顶层 `const NAME = [ ... ];` 数组字面量（方括号配平）。 */
function extractArrayLiteral(source, name) {
  const decl = source.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[`));
  if (!decl) return null;
  let i = source.indexOf('[', decl.index);
  let depth = 0;
  let inStr = null;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return source.slice(source.indexOf('[', decl.index), i + 1);
    }
  }
  return null;
}

/** 提取该设备零件数组（首个包含 id+name 记录的候选名）。 */
function extractParts(source) {
  for (const name of PART_ARRAY_NAMES) {
    const literal = extractArrayLiteral(source, name);
    if (!literal) continue;
    try {
      const value = vm.runInNewContext(`(${literal})`, {}, { timeout: 2000 });
      if (!Array.isArray(value)) continue;
      const isPlausiblePosNo = (v) =>
        typeof v === 'string' && /^[A-Za-z][\w-]*\d+/.test(v.trim());
      const parts = value.filter(
        (p) =>
          p && typeof p === 'object' && typeof p.name === 'string' &&
          // 位号两种真实形态：字符串 id（P01 / P-01 / base_plate），或数字 id + 独立 code（BOM-01）
          (isPlausiblePosNo(p.id) || isPlausiblePosNo(p.code))
      ).map((p) => ({ ...p, id: isPlausiblePosNo(p.code) ? p.code : p.id }));
      if (parts.length > 0) {
        return { varName: name, parts };
      }
    } catch {
      // 该数组不是纯字面量（可能引用了前面变量），换下一个候选名
    }
  }
  return null;
}

const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.html')).sort();
const catalog = {};
for (const file of files) {
  const source = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
  const found = extractParts(source);
  if (!found) {
    console.error(`[extract] ${file}: 未找到零件数组，跳过`);
    catalog[file] = [];
    continue;
  }
  const parts = found.parts.map((p) => ({
    posNo: p.id,
    name: p.name,
    ...(p.category ? { category: p.category } : {}),
    ...(p.spec ? { spec: p.spec } : {}),
    ...(p.material ? { material: p.material } : {}),
  }));
  catalog[file] = parts;
  console.log(`[extract] ${file}: ${found.varName} → ${parts.length} 个位号（示例 ${parts[0]?.posNo} ${parts[0]?.name}）`);
}

const banner = `/**
 * ⚠️ 本文件由 scripts/extract-exploded-catalog.mjs 自动生成 —— 不要手改。
 * 数据来源：public/exploded/*.html（${files.length} 份拆解页脚本里的真实零件数组），
 * 位号/名称/规格/材质与拆解页 BOM 完全一致，仅作服务端"工单文本 ↔ 位号"匹配用。
 * 重新生成：node scripts/extract-exploded-catalog.mjs
 */

/** 拆解页 BOM 中的一条零件记录（全部字段来自拆解页自身的零件数组原文）。 */
export interface ExplodedCatalogPart {
  /** 位号（拆解页零件 id，如 P01 / C01），与 BOM 行 data-part-id 一致 */
  posNo: string;
  name: string;
  category?: string;
  spec?: string;
  material?: string;
}

export const EXPLODED_CATALOG_BY_FILE: Record<string, ExplodedCatalogPart[]> = ${JSON.stringify(catalog, null, 2)};
`;
fs.writeFileSync(OUT_FILE, banner, 'utf8');
console.log(`[extract] 已写入 ${OUT_FILE}`);
