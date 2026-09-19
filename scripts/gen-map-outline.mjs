// 生成 3D 大屏地图轮廓数据（一次性开发工具，产物提交、原始 GeoJSON 不入库）。
// 用法: node scripts/gen-map-outline.mjs <geojson-dir> <out-dir>
// 输入（DataV Atlas areas_v3）: 100000_full.json + {440000,320000,510000,420000}_full.json
// 输出: chinaOutline.ts / provinceOutlines.ts（Douglas-Peucker 简化后的 [lng,lat] 环数组）
import fs from "node:fs";
import path from "node:path";

const [inDir, outDir] = process.argv.slice(2);
if (!inDir || !outDir) {
  console.error("用法: node scripts/gen-map-outline.mjs <geojson-dir> <out-dir>");
  process.exit(1);
}

// Douglas-Peucker 折线简化
function simplify(points, tolerance) {
  if (points.length <= 3) return points;
  const sqTol = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxSq = 0;
    let idx = -1;
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const dx = bx - ax;
    const dy = by - ay;
    const sqLen = dx * dx + dy * dy || 1e-12;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      let t = ((px - ax) * dx + (py - ay) * dy) / sqLen;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - py;
      const sq = ex * ex + ey * ey;
      if (sq > maxSq) {
        maxSq = sq;
        idx = i;
      }
    }
    if (maxSq > sqTol && idx > 0) {
      keep[idx] = 1;
      stack.push([first, idx], [idx, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(a / 2);
}

// GeoJSON -> { fillRings（每 feature 最大环）, lineRings（全部环，去重相邻重复点） }
function extract(featureCollection, tolerance) {
  const fillRings = [];
  const lineRings = [];
  for (const f of featureCollection.features) {
    const geom = f.geometry;
    if (!geom) continue;
    const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
    let best = null;
    let bestArea = -1;
    for (const poly of polys) {
      for (const ring of poly) {
        const cleaned = ring.filter((p, i) => i === 0 || p[0] !== ring[i - 1][0] || p[1] !== ring[i - 1][1]);
        const simplified = simplify(cleaned, tolerance);
        if (simplified.length >= 4) lineRings.push(simplified);
        const area = ringArea(cleaned);
        if (area > bestArea) {
          bestArea = area;
          best = simplified;
        }
      }
    }
    if (best && best.length >= 4) fillRings.push(best);
  }
  return { fillRings, lineRings };
}

function emit(name, rings, comment) {
  const lines = rings.map((r) => `  [${r.map((p) => `[${p[0].toFixed(3)},${p[1].toFixed(3)}]`).join(",")}]`).join(",\n");
  return `// ${comment}\nexport const ${name}: [number, number][][] = [\n${lines}\n];\n`;
}

// ---- 中国全国 ----
const china = extract(JSON.parse(fs.readFileSync(path.join(inDir, "100000_full.json"), "utf8")), 0.05);
const chinaTs =
  `// 自动生成：node scripts/gen-map-outline.mjs（数据源: DataV Atlas areas_v3 100000_full，仅轮廓几何，无业务数据）\n` +
  emit("CHINA_FILL_RINGS", china.fillRings, "全国填充面（每省外环）") +
  "\n" +
  emit("CHINA_LINE_RINGS", china.lineRings, "全国边界线（含省界）");
fs.writeFileSync(path.join(outDir, "chinaOutline.ts"), chinaTs);

// ---- 城市层省份 ----
const provinces = {
  440000: "广东省（广州主厂）",
  320000: "江苏省（南京分厂·演示）",
  510000: "四川省（成都分厂·演示）",
  420000: "湖北省（武汉分厂·演示）",
};
const parts = [];
for (const [code, label] of Object.entries(provinces)) {
  const p = extract(JSON.parse(fs.readFileSync(path.join(inDir, `${code}_full.json`), "utf8")), 0.03);
  parts.push(
    `// ${label}\nexport const P${code}_FILL: [number, number][][] = ${JSON.stringify(p.fillRings.map((r) => r.map((q) => [+q[0].toFixed(3), +q[1].toFixed(3)])))};\n\nexport const P${code}_LINE: [number, number][][] = ${JSON.stringify(p.lineRings.map((r) => r.map((q) => [+q[0].toFixed(3), +q[1].toFixed(3)])))};`
  );
  console.log(code, label, "fill:", p.fillRings.length, "line:", p.lineRings.length);
}
fs.writeFileSync(
  path.join(outDir, "provinceOutlines.ts"),
  `// 自动生成：node scripts/gen-map-outline.mjs（数据源: DataV Atlas areas_v3，仅轮廓几何，无业务数据）\n\n` +
    parts.join("\n\n") +
    "\n"
);

console.log("china fill:", china.fillRings.length, "line:", china.lineRings.length);
