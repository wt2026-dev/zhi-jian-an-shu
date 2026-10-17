// 大屏取景反解（fitFrameRadius）与浮层安全区的几何守卫。
//
// 为什么钉在这里：这一轮的现象是"省域地图只占中间一小块、四周大片深蓝"，
// 根因有两处且都不在渲染代码里 ——
//   ① 落位半径写死（城市层 30 / 全国层 62），画布与安全区变化时不会重算；
//   ② 光柱按绝对单位给高度，省幅只有全国的 1/3，柱顶却一样高，
//      于是"必须容下这根柱子"把相机顶远，陆面被压成一小块。
// 这两条都能纯数值复算（DOM-free），不需要等浏览器面板可见。
import * as fs from "fs";
import * as path from "path";
import { describe, it, expect } from "vitest";
import { buildFitPoints, fitFrameRadius, type FitPoint } from "../src/components/equipment3d/mapScene.ts";
import { pillarSizeFor, ringsSpan } from "../src/components/equipment3d/mapGeo.ts";
import { CHINA_FILL_RINGS } from "../src/components/equipment3d/mapData/chinaOutline.ts";
import { PROVINCE_VIEW_BY_CODE } from "../src/components/equipment3d/provinceViews.ts";
import {
  HUD_BOTTOM_BAND,
  HUD_COLUMN_MARGIN,
  HUD_COLUMN_SPAN,
  HUD_COLUMN_W,
  HUD_TOP_BAND,
} from "../src/components/equipment3d/mapStyle.ts";

const ROOT = path.resolve(__dirname, "..");
const citySrc = () => fs.readFileSync(path.join(ROOT, "src/components/equipment3d/CityOverview.tsx"), "utf8");
const mapSrc = () => fs.readFileSync(path.join(ROOT, "src/components/equipment3d/MapOverview.tsx"), "utf8");
const shellSrc = () => fs.readFileSync(path.join(ROOT, "src/components/equipment3d/DrilldownShell.tsx"), "utf8");

const FOV = 55;
const PHI = 0.62;
const INSETS = {
  left: HUD_COLUMN_SPAN + HUD_COLUMN_MARGIN,
  right: HUD_COLUMN_SPAN + HUD_COLUMN_MARGIN,
  top: HUD_TOP_BAND,
  bottom: HUD_BOTTOM_BAND,
};

/** 广东省轮廓 + 单厂区（真实台账：广州主厂 18 台，该城仅此一座厂） */
const GD = PROVINCE_VIEW_BY_CODE["440000"];
const GD_SPAN = ringsSpan(GD.fill, GD.center, GD.scale);
const GD_BOX = { halfX: GD_SPAN.x / 2 + 1, halfZ: GD_SPAN.z / 2 + 1, groundTop: 1.5 };
/** 厂区就在省幅中心附近（广州主厂 113.31,23.12 相对视图中心 113.6,23.4） */
const PLANT_AT = { x: -0.7, z: 0.67 };

const gdFit = (pillarTop: number, width = 1920, height = 612) =>
  fitFrameRadius({
    points: buildFitPoints(GD_BOX, [{ ...PLANT_AT, top: pillarTop }], 3),
    phi: PHI,
    fovDeg: FOV,
    width,
    height,
    insets: INSETS,
  });

/** 给定的点集在半径 r 下最多占到安全区的几成（>1 即压到卡片上） */
const worstShare = (points: FitPoint[], r: number, width = 1920, height = 612) => {
  const safeW = width - INSETS.left - INSETS.right;
  const safeH = height - INSETS.top - INSETS.bottom;
  const tanV = Math.tan((FOV * Math.PI) / 360);
  const tanH = tanV * (width / height);
  const sinP = Math.sin(PHI);
  const cosP = Math.cos(PHI);
  let m = 0;
  for (const p of points) {
    const depth = r - p.y * cosP - p.z * sinP;
    m = Math.max(m, Math.abs(p.x) / (depth * tanH * ((safeW / width) * 0.92)), Math.abs(p.y * sinP - p.z * cosP) / (depth * tanV * ((safeH / height) * 0.92)));
  }
  return m;
};

describe("落位半径反解：按内容包围盒 + HUD 安全区", () => {
  it("解是「紧贴」的：解出的半径把最挤的点送到 92% 处，退 2% 就压到卡片", () => {
    const points = buildFitPoints(GD_BOX, [{ ...PLANT_AT, top: 4.2 }], 3);
    const r = fitFrameRadius({ points, phi: PHI, fovDeg: FOV, width: 1920, height: 612, insets: INSETS });
    expect(worstShare(points, r)).toBeLessThanOrEqual(1.001);
    expect(worstShare(points, r * 0.98)).toBeGreaterThan(1);
  });

  it("内容越大相机越远：省幅翻倍 → 半径变大", () => {
    const small = fitFrameRadius({ points: buildFitPoints(GD_BOX, [], 3), phi: PHI, fovDeg: FOV, width: 1920, height: 612, insets: INSETS });
    const big = fitFrameRadius({
      points: buildFitPoints({ ...GD_BOX, halfX: GD_BOX.halfX * 2, halfZ: GD_BOX.halfZ * 2 }, [], 3),
      phi: PHI,
      fovDeg: FOV,
      width: 1920,
      height: 612,
      insets: INSETS,
    });
    expect(big).toBeGreaterThan(small * 1.6);
  });

  it("安全区越窄相机越远：画布从 1920 缩到 1024，落位半径显著变大（不再压在卡片底下）", () => {
    const points = buildFitPoints(GD_BOX, [{ ...PLANT_AT, top: 4.2 }], 3);
    const rWide = fitFrameRadius({ points, phi: PHI, fovDeg: FOV, width: 1920, height: 612, insets: INSETS });
    const rNarrow = fitFrameRadius({ points, phi: PHI, fovDeg: FOV, width: 1024, height: 612, insets: INSETS });
    expect(rNarrow).toBeGreaterThan(rWide * 1.5);
    // 窄画布下若沿用写死的 30，最挤的点会冲出安全区 3 成多（就是"顶进卡片"）
    expect(worstShare(points, 30, 1024, 612)).toBeGreaterThan(1.3);
  });

  it("柱顶越高相机越远 —— 这就是省层地图被压成一小块的量级", () => {
    const short = gdFit(pillarSizeFor(GD_SPAN.x, 1).height);
    const tall = gdFit(8.8 + 0.6 + 1.12);
    expect(tall).toBeGreaterThan(short * 1.4);
    // 屏幕上的陆面宽度与半径成反比：旧口径（柱高 8.8）相当于把地图缩到 6 成
    expect(short / tall).toBeLessThan(0.72);
  });
});

describe("光柱尺寸按地图自身宽度归一", () => {
  it("省层柱高 ≤ 省幅的 20%，与全国层同比例（绝对常数不许回归）", () => {
    const cityMax = pillarSizeFor(GD_SPAN.x, 1);
    const chinaSpanX = ringsSpan(CHINA_FILL_RINGS, [104, 37], 0.92).x;
    const nationMax = pillarSizeFor(chinaSpanX, 1);
    expect(cityMax.height / GD_SPAN.x).toBeLessThanOrEqual(0.2);
    expect(Math.abs(cityMax.height / GD_SPAN.x - nationMax.height / chinaSpanX)).toBeLessThan(1e-9);
    // 柱宽同理：省层旧值 0.8 = 省幅的 4.4%，是全国层的 3 倍粗
    expect(cityMax.radius / GD_SPAN.x).toBeLessThan(0.02);
  });

  it("设备台数单调拉高柱子，演示厂按 0.86 收敛；share 越界不炸", () => {
    const a = pillarSizeFor(GD_SPAN.x, 0);
    const b = pillarSizeFor(GD_SPAN.x, 1);
    expect(b.height).toBeGreaterThan(a.height);
    expect(pillarSizeFor(GD_SPAN.x, 5).height).toBe(b.height);
    expect(pillarSizeFor(GD_SPAN.x, -3).height).toBe(a.height);
    expect(pillarSizeFor(GD_SPAN.x, 1, true).height).toBeCloseTo(b.height * 0.86, 10);
  });
});

describe("浮层几何单一口径：取景安全区 = 卡片实际占位", () => {
  /**
   * 药丸实测：top-3(12) + 33px 高 = 底边 45（2026-09-22 在真实 DOM 上按 1440/1920
   * 两档量到的，比原来"约 30px"估的多 3px —— 按估值只留了 19px，差 1px 也不合格）。
   */
  const CRUMB_BOTTOM = 45;

  it(`面包屑与两栏首张卡片之间 ≥20px（药丸底边按实测 ${CRUMB_BOTTOM}px 算）`, () => {
    expect(HUD_TOP_BAND - CRUMB_BOTTOM).toBeGreaterThanOrEqual(20);
  });

  it("一栏占位 = 外边距 + 卡宽，图例与取景共用同一算法", () => {
    expect(HUD_COLUMN_SPAN).toBe(HUD_COLUMN_W + HUD_COLUMN_MARGIN);
  });

  it("两层都把 frameFit 交给舞台，且左右两栏从面包屑带下方起排", () => {
    for (const src of [citySrc(), mapSrc()]) {
      expect(src).toContain("frameFit:");
      expect(src).toContain("top: HUD_TOP_BAND");
      expect(src).toContain("width: HUD_COLUMN_W");
      // 旧的贴顶排布不再出现（top-3 就是与居中面包屑相撞的那一处）
      expect(src).not.toContain("top-3 bottom-3 flex w-[300px]");
      expect(src).not.toContain("right-3 top-3 bottom-3");
    }
  });

  it("光柱尺寸改由 spanX 归一，绝对常数组合作废", () => {
    expect(citySrc()).toContain("pillarSizeFor(");
    expect(mapSrc()).toContain("pillarSizeFor(");
    expect(citySrc()).not.toContain("height: 6.2 + 2.6 * share");
    expect(mapSrc()).not.toContain("const height = 4.4 + 4.6 * share");
  });

  it("面包屑居中挂在壳层，左右两侧留白由同一条带承担", () => {
    const src = shellSrc();
    expect(src).toContain("left-1/2");
    expect(src).toContain("-translate-x-1/2");
  });
});
