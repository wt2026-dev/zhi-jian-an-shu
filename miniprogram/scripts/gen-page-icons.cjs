#!/usr/bin/env node
/**
 * 生成页面常用图标 (64x64px PNG 透明底)
 * 明亮线性风格: #3b82f6 蓝色, 2px 线条
 */
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SIZE = 64;
const SW = 2;
const OUT_DIR = path.join(__dirname, '..', 'images', 'icons');
const COLOR = '#3b82f6';

const ICONS = {
  gear: '<circle cx="12" cy="12" r="3" stroke-width="2" fill="none"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke-width="2" fill="none"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke-width="2" fill="none"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke-width="2" fill="none"/><circle cx="12" cy="7" r="4" stroke-width="2" fill="none"/>',
  warn: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke-width="2" fill="none"/><line x1="12" y1="9" x2="12" y2="13" stroke-width="2"/><line x1="12" y1="17" x2="12.01" y2="17" stroke-width="2"/>',
  clock: '<circle cx="12" cy="12" r="10" stroke-width="2" fill="none"/><polyline points="12 6 12 12 16 14" stroke-width="2" fill="none"/>',
  check: '<polyline points="20 6 9 17 4 12" stroke-width="2" fill="none"/>',
  close: '<line x1="18" y1="6" x2="6" y2="18" stroke-width="2"/><line x1="6" y1="6" x2="18" y2="18" stroke-width="2"/>',
  back: '<line x1="19" y1="12" x2="5" y2="12" stroke-width="2"/><polyline points="12 19 5 12 12 5" stroke-width="2" fill="none"/>',
  arrow: '<polyline points="9 18 15 12 9 6" stroke-width="2" fill="none"/>',
  sparkles: '<path d="M12 2l2.09 6.26L20.18 10l-6.09 1.74L12 18l-2.09-6.26L3.82 10l6.09-1.74L12 2z" stroke-width="2" fill="none" stroke-linejoin="round"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" stroke-width="2" fill="none"/><circle cx="12" cy="13" r="4" stroke-width="2" fill="none"/>',
  bulb: '<path d="M9 18h6" stroke-width="2"/><path d="M10 22h4" stroke-width="2"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" stroke-width="2" fill="none"/>',
  bolt: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" stroke-width="2" fill="none"/>',
  tree: '<path d="M12 22V8" stroke-width="2"/><path d="M5 12l7-7 7 7" stroke-width="2" fill="none"/><path d="M8 17l4-4 4 4" stroke-width="2" fill="none"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke-width="2" fill="none"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke-width="2" fill="none"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2" stroke-width="2" fill="none"/><path d="M7 11V7a5 5 0 0 1 10 0v4" stroke-width="2" fill="none"/>',
  unlock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2" stroke-width="2" fill="none"/><path d="M7 11V7a5 5 0 0 1 9.9-1" stroke-width="2" fill="none"/>',
  team: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke-width="2" fill="none"/><circle cx="9" cy="7" r="4" stroke-width="2" fill="none"/><path d="M23 21v-2a4 4 0 0 0-3-3.87" stroke-width="2" fill="none"/><path d="M16 3.13a4 4 0 0 1 0 7.75" stroke-width="2" fill="none"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" stroke-width="2" fill="none"/><polyline points="16 17 21 12 16 7" stroke-width="2" fill="none"/><line x1="21" y1="12" x2="9" y2="12" stroke-width="2"/>',
  permit: '<rect x="2" y="7" width="20" height="14" rx="2" ry="2" stroke-width="2" fill="none"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" stroke-width="2" fill="none"/>',
  bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" stroke-width="2" fill="none"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2" stroke-width="2" fill="none"/><line x1="16" y1="2" x2="16" y2="6" stroke-width="2"/><line x1="8" y1="2" x2="8" y2="6" stroke-width="2"/><line x1="3" y1="10" x2="21" y2="10" stroke-width="2"/>',
  location: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" stroke-width="2" fill="none"/><circle cx="12" cy="10" r="3" stroke-width="2" fill="none"/>',
  dot: '<circle cx="12" cy="12" r="3" stroke-width="2" fill="none"/>',
  sync: '<polyline points="23 4 23 10 17 10" stroke-width="2" fill="none"/><polyline points="1 20 1 14 7 14" stroke-width="2" fill="none"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" stroke-width="2" fill="none"/>',
  approval: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" stroke-width="2" fill="none"/><polyline points="22 4 12 14.01 9 11.01" stroke-width="2" fill="none"/>',
};

function makeSvg(iconPath, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${SW}" stroke-linecap="round" stroke-linejoin="round">${iconPath}</svg>`;
}

async function generate() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const entries = Object.entries(ICONS);
  let count = 0;
  for (const [name, iconPath] of entries) {
    const svg = makeSvg(iconPath, COLOR);
    const outPath = path.join(OUT_DIR, `${name}.png`);
    await sharp(Buffer.from(svg)).resize(SIZE, SIZE).png().toFile(outPath);
    count++;
    console.log(`✓ ${name}.png`);
  }

  console.log(`\n✅ 共生成 ${count} 个页面图标 → ${OUT_DIR}`);
}

generate().catch(err => { console.error(err); process.exit(1); });
