/**
 * 3D 模型资产「署名完整性 + 可加载性」守卫。
 *
 * 背景：L2 车间引入了 12 个第三方 GLB（10 台设备 + 1 台机械臂 + 1 个数字人），
 * 全部为 CC BY 4.0 —— **署名是许可条件，不是可选文档**。
 * 同时 `EQUIPMENT_GLB_MAP` 里任何一个路径写错，都会在浏览器控制台报 404，
 * 直接违反验收项「控制台无 GLB 加载报错」。
 *
 * 这两件事都无法靠"看一眼画面"发现，所以在这里锁成可执行的不变量：
 *   1. public/models 下每个 .glb 都被某份 ATTRIBUTION.md 提到（不遗漏署名）；
 *   2. EQUIPMENT_GLB_MAP 的每个路径都真实存在（不产生 404）；
 *   3. 设备清单与署名表一一对应；
 *   4. 缺元数据的模型必须诚实标"待补"，不得编造作者名；
 *   5. 曾经编造过的那批假工作室名不得回归。
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { EQUIPMENT_GLB_MAP } from '../src/components/equipment3d/equipment';

const MODELS_DIR = path.resolve(process.cwd(), 'public', 'models');

/** 递归收集目录下所有 .glb。 */
function collectGlb(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectGlb(full));
    else if (entry.name.toLowerCase().endsWith('.glb')) out.push(full);
  }
  return out;
}

/** 递归收集目录下所有 ATTRIBUTION.md 的正文。 */
function collectAttributionText(dir: string): string {
  let text = '';
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) text += collectAttributionText(full);
    else if (/^ATTRIBUTION\.md$/i.test(entry.name)) text += fs.readFileSync(full, 'utf8');
  }
  return text;
}

const glbFiles = collectGlb(MODELS_DIR);
const attributionText = collectAttributionText(MODELS_DIR);

describe('3D 模型资产署名守卫', () => {
  it('public/models 下确实有模型资产（守卫本身不能空跑）', () => {
    expect(glbFiles.length).toBeGreaterThanOrEqual(10);
  });

  it('每个 .glb 都在某份 ATTRIBUTION.md 里被署名', () => {
    const missing = glbFiles
      .map((f) => path.basename(f))
      .filter((name) => !attributionText.includes(name));
    expect(missing, `以下模型缺少署名：${missing.join(', ')}`).toEqual([]);
  });

  it('EQUIPMENT_GLB_MAP 的每个路径都真实存在（防控制台 404）', () => {
    const broken: string[] = [];
    for (const [deviceId, url] of Object.entries(EQUIPMENT_GLB_MAP)) {
      const abs = path.resolve(process.cwd(), 'public', url.replace(/^\//, ''));
      if (!fs.existsSync(abs)) broken.push(`${deviceId} → ${url}`);
    }
    expect(broken, `以下映射指向不存在的文件：\n${broken.join('\n')}`).toEqual([]);
  });

  it('EQUIPMENT_GLB_MAP 用到的每个模型都在设备署名表里', () => {
    const used = new Set(Object.values(EQUIPMENT_GLB_MAP).map((u) => path.basename(u)));
    const missing = [...used].filter((name) => !attributionText.includes(name));
    expect(missing, `被引用但未署名：${missing.join(', ')}`).toEqual([]);
  });

  it('缺元数据的 lathe_machine 标"待补"而不是编造作者', () => {
    // 该文件是目录内唯一没有 asset.extras 授权块的模型（Khronos Blender 导出）。
    const rows = attributionText
      .split('\n')
      .filter((line) => line.includes('lathe_machine.glb'));
    expect(rows.length, 'lathe_machine.glb 必须出现在署名表中').toBeGreaterThan(0);
    expect(rows.some((r) => r.includes('待补') || r.includes('待确认'))).toBe(true);
  });

  it('曾经编造的工作室名不得回归', () => {
    // 这些名字不在任何 GLB 的 asset.extras 中，是历史版本的杜撰产物。
    const fabricated = [
      'Industrial Asset Vault',
      'Mechanical 3D Lab',
      'FabWorks 3D',
      'TechMech Studio',
      'Workshop Assets Hub',
      'CNC Modeler Guild',
      'Plant Facility 3D',
      'Heavy Machinery Design',
      'Automation Mesh Works',
    ];
    const found = fabricated.filter((name) => attributionText.includes(name));
    expect(found, `署名表中出现编造来源：${found.join(', ')}`).toEqual([]);
  });

  it('真实作者名来自 GLB 内嵌元数据（抽查两个已知值）', () => {
    expect(attributionText).toContain('ENGIPROS');
    expect(attributionText).toContain('Jayson Stauffer');
  });
});
