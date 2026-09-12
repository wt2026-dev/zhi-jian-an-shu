#!/usr/bin/env node
/**
 * 生成明亮线性风格 tabbar 图标 (81x81px PNG 透明底)
 * - 常态: #94A3B8 (灰色)
 * - 选中态: #3b82f6 (蓝色)
 * - 2px 线性、圆角端点
 */
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SIZE = 81;
const STROKE_WIDTH = 2.5;
const OUT_DIR = path.join(__dirname, '..', 'images', 'tabbar');

// SVG path data for each icon (viewBox 0 0 24 24, lucide-style)
const ICONS = {
  dashboard: {
    // 仪表盘: 网格
    path: '<rect x="3" y="3" width="7" height="7" rx="1.5" stroke-width="2" fill="none"/><rect x="14" y="3" width="7" height="7" rx="1.5" stroke-width="2" fill="none"/><rect x="3" y="14" width="7" height="7" rx="1.5" stroke-width="2" fill="none"/><rect x="14" y="14" width="7" height="7" rx="1.5" stroke-width="2" fill="none"/>'
  },
  orders: {
    // 工单: 扳手+文档
    path: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
  },
  inspect: {
    // 巡检: 放大镜+勾
    path: '<circle cx="11" cy="11" r="8" stroke-width="2" fill="none"/><path d="m21 21-4.35-4.35" stroke-width="2" fill="none" stroke-linecap="round"/><path d="m8 11 2 2 4-4" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
  },
  ai: {
    // AI: 火花
    path: '<path d="M12 2l2.09 6.26L20.18 10l-6.09 1.74L12 18l-2.09-6.26L3.82 10l6.09-1.74L12 2z" stroke-width="2" fill="none" stroke-linejoin="round"/><path d="M5 19l2-2m10 2l2-2" stroke-width="1.5" fill="none" stroke-linecap="round"/>'
  },
  profile: {
    // 我的: 人
    path: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="7" r="4" stroke-width="2" fill="none"/>'
  }
};

function makeSvg(iconPath, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round">${iconPath}</svg>`;
}

async function generate() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const entries = Object.entries(ICONS);
  for (const [name, icon] of entries) {
    // Normal (gray)
    const normalSvg = makeSvg(icon.path, '#94A3B8');
    const normalPath = path.join(OUT_DIR, `${name}.png`);
    await sharp(Buffer.from(normalSvg)).resize(SIZE, SIZE).png().toFile(normalPath);
    console.log(`✓ ${name}.png`);

    // Active (blue)
    const activeSvg = makeSvg(icon.path, '#3b82f6');
    const activePath = path.join(OUT_DIR, `${name}-active.png`);
    await sharp(Buffer.from(activeSvg)).resize(SIZE, SIZE).png().toFile(activePath);
    console.log(`✓ ${name}-active.png`);
  }

  console.log(`\n✅ 共生成 ${entries.length * 2} 个图标 → ${OUT_DIR}`);
}

generate().catch(err => { console.error(err); process.exit(1); });
