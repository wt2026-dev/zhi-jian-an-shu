/**
 * 场景预设 —— 3D 场景的「身份层」。
 *
 * 结构移植自「中国程序化城市生成器」src/styles.js：每套预设都是一份完整配方
 * （地坪 / 调色板 / 厂房形态 / 布局 / 道具 / 光照 / 相机）。
 * 内容整体替换为工业车间与场站场景 —— 切换预设后厂房形态、色调、布局应一眼可辨。
 */

export type FloorStyle = 'concrete' | 'lanes' | 'apron';
export type LayoutPattern = 'grid' | 'ring' | 'wall';
export type RoofType = 'truss' | 'flat' | 'none';

export interface ScenePreset {
  id: string;
  name: string;
  nameEn: string;
  tagline: string;
  blurb: string;
  floor: {
    style: FloorStyle;
    roughness: number;
    /** 地坪微起伏振幅（米），0 = 完全平整 */
    relief: number;
    colour: number;
    colourAlt: number;
    lane: number;
  };
  palette: {
    floor: number;
    floorAlt: number;
    lane: number;
    wall: number;
    wallAlt: number;
    column: number;
    roof: number;
    steel: number;
    pipe: number;
    accent: number;
    fog: number;
    sky: number;
    light: { sun: number; ambient: number; hemi: number };
    emissive: number;
  };
  hall: {
    walls: boolean;
    roof: RoofType;
    wallHeight: number;
    baySpacing: number;
    spanX: number;
    spanZ: number;
    crane: boolean;
    craneHeight: number;
    pipeRacks: boolean;
  };
  morphology: {
    equipmentScale: number;
    heightVariance: number;
    /** 厂房形态细节（柱网/桁架密度），设备几何 LOD 由 QUALITY.detail 单独驱动 */
    detail: number;
  };
  layout: {
    pattern: LayoutPattern;
    spacing: number;
  };
  lighting: {
    exposure: number;
    ambient: number;
    sun: number;
    sunHeight: number;
    fogDensity: number;
    preset: 'bright' | 'dusty' | 'daylight';
  };
  camera: { distance: number; height: number; tilt: number };
}

export const SCENE_PRESETS: Record<string, ScenePreset> = {
  industrial: {
    id: 'industrial',
    name: '工业数字孪生',
    nameEn: 'Industrial Digital Twin',
    tagline: '深蓝车间 · 设备聚焦 · 状态联动',
    blurb: '开放式设备总览，保留安全通道与管架；点击设备进入独立特写，监测值来自现有设备接口。',
    floor: { style: 'lanes', roughness: 0.72, relief: 0, colour: 0x101e32, colourAlt: 0x14263e, lane: 0xe4b83f },
    palette: {
      floor: 0x101e32, floorAlt: 0x14263e, lane: 0xe4b83f,
      wall: 0x162a43, wallAlt: 0x102037, column: 0x29445e, roof: 0x1c344d,
      steel: 0x7895ad, pipe: 0x365d77, accent: 0x22d3ee,
      fog: 0x0b1220, sky: 0x0b1220,
      light: { sun: 0xc5eaff, ambient: 0x90b6d8, hemi: 0x8ccfe9 },
      emissive: 0x22d3ee,
    },
    hall: { walls: false, roof: 'none', wallHeight: 8, baySpacing: 16, spanX: 54, spanZ: 40, crane: false, craneHeight: 8, pipeRacks: true },
    morphology: { equipmentScale: 1.18, heightVariance: 0, detail: 1 },
    layout: { pattern: 'grid', spacing: 1 },
    lighting: { exposure: 1.15, ambient: 0.45, sun: 2.4, sunHeight: 85, fogDensity: 0.0012, preset: 'bright' },
    camera: { distance: 95, height: 52, tilt: 0.6 },
  },
  standard: {
    id: 'standard',
    name: '标准车间',
    nameEn: 'Standard Workshop',
    tagline: '混凝土地坪 · 规则柱网 · 明亮均匀',
    blurb:
      '最常见的机加工与动力车间：平整的混凝土地坪，整齐的柱网，设备沿通道一字排开，顶部桁架挂着照明。',
    floor: { style: 'concrete', roughness: 0.92, relief: 0.06, colour: 0x8f9296, colourAlt: 0x9ea1a5, lane: 0xd9c14a },
    palette: {
      floor: 0x8f9296,
      floorAlt: 0x9ea1a5,
      lane: 0xd9c14a,
      wall: 0xd8dbdd,
      wallAlt: 0xc3c7ca,
      column: 0xb6babd,
      roof: 0xa8adb1,
      steel: 0x8d949a,
      pipe: 0x7c838a,
      accent: 0x2f6fb5,
      fog: 0xd2d7da,
      sky: 0xe3e8eb,
      light: { sun: 0xfff4e2, ambient: 0xb8c2c8, hemi: 0xdfe6ea },
      emissive: 0xffe9b8,
    },
    hall: {
      walls: true,
      roof: 'truss',
      wallHeight: 13,
      baySpacing: 11,
      spanX: 62,
      spanZ: 46,
      crane: false,
      craneHeight: 10,
      pipeRacks: true,
    },
    morphology: { equipmentScale: 1.0, heightVariance: 0.18, detail: 1 },
    layout: { pattern: 'grid', spacing: 1.0 },
    lighting: { exposure: 1.06, ambient: 0.66, sun: 1.15, sunHeight: 120, fogDensity: 0.0009, preset: 'bright' },
    camera: { distance: 118, height: 62, tilt: 0.6 },
  },

  heavy: {
    id: 'heavy',
    name: '重工车间',
    nameEn: 'Heavy Industry Bay',
    tagline: '安全通道 · 行车轨道 · 高大跨度',
    blurb:
      '重型热轧与传动车间：地坪刷着黄色安全通道线，跨度更大、净空更高，头顶两组行车轨道贯穿全跨，设备体量明显更大。',
    floor: { style: 'lanes', roughness: 0.95, relief: 0.1, colour: 0x6e6a66, colourAlt: 0x7d7873, lane: 0xe0b02a },
    palette: {
      floor: 0x6e6a66,
      floorAlt: 0x7d7873,
      lane: 0xe0b02a,
      wall: 0x8d8479,
      wallAlt: 0x7a7268,
      column: 0x6f6a63,
      roof: 0x6a655e,
      steel: 0x7d858c,
      pipe: 0x8a7f6e,
      accent: 0xd9762f,
      fog: 0xa9a49b,
      sky: 0xcdc9c1,
      light: { sun: 0xffe2b8, ambient: 0x9c9488, hemi: 0xc8c0b2 },
      emissive: 0xffb347,
    },
    hall: {
      walls: true,
      roof: 'truss',
      wallHeight: 22,
      baySpacing: 15,
      spanX: 78,
      spanZ: 52,
      crane: true,
      craneHeight: 17,
      pipeRacks: true,
    },
    morphology: { equipmentScale: 1.38, heightVariance: 0.24, detail: 2 },
    layout: { pattern: 'wall', spacing: 1.12 },
    lighting: { exposure: 1.1, ambient: 0.5, sun: 1.35, sunHeight: 165, fogDensity: 0.0018, preset: 'dusty' },
    camera: { distance: 145, height: 78, tilt: 0.62 },
  },

  yard: {
    id: 'yard',
    name: '户外场站',
    nameEn: 'Outdoor Tank Yard',
    tagline: '罐区环布 · 露天管廊 · 冷调日光',
    blurb:
      '没有屋顶的罐区与公用工程场站：碎石与混凝土拼接的露天场坪，储罐沿环形布置，管廊架空横穿，光线是清冷的日间散射。',
    floor: { style: 'apron', roughness: 0.98, relief: 0.32, colour: 0x7b7d78, colourAlt: 0x8b8d87, lane: 0xcfd4d8 },
    palette: {
      floor: 0x7b7d78,
      floorAlt: 0x8b8d87,
      lane: 0xcfd4d8,
      wall: 0x9aa0a4,
      wallAlt: 0x888e92,
      column: 0x8d9296,
      roof: 0x9aa0a4,
      steel: 0x9aa3aa,
      pipe: 0x9fb0bb,
      accent: 0x2f8f7a,
      fog: 0xc4ccd2,
      sky: 0xd8e2ea,
      light: { sun: 0xf2f6ff, ambient: 0xa8b6c2, hemi: 0xd6e2ec },
      emissive: 0x9fd4ff,
    },
    hall: {
      walls: false,
      roof: 'none',
      wallHeight: 0,
      baySpacing: 13,
      spanX: 70,
      spanZ: 58,
      crane: false,
      craneHeight: 0,
      pipeRacks: true,
    },
    morphology: { equipmentScale: 1.16, heightVariance: 0.3, detail: 2 },
    layout: { pattern: 'ring', spacing: 1.05 },
    lighting: { exposure: 1.0, ambient: 0.78, sun: 1.05, sunHeight: 210, fogDensity: 0.0011, preset: 'daylight' },
    camera: { distance: 132, height: 88, tilt: 0.56 },
  },
};

export const PRESET_ORDER = ['industrial', 'standard', 'heavy', 'yard'];

/** 画质预设：控制阴影、像素比、设备几何 LOD 与三角面上限。
 *  detail 必须真正驱动圆柱/球体分段与小件取舍 —— 三档不得共用同一套几何。 */
export const QUALITY = {
  low: {
    label: '流畅',
    shadows: false,
    shadowMap: 512,
    pixelRatio: 1,
    aa: false,
    detail: 0,
    detailBias: 0,
    maxTriangles: 25000,
    floorRes: 16,
  },
  medium: {
    label: '均衡',
    shadows: true,
    shadowMap: 1024,
    pixelRatio: 1,
    aa: true,
    detail: 1,
    detailBias: 0,
    maxTriangles: 80000,
    floorRes: 32,
  },
  high: {
    label: '精细',
    shadows: true,
    shadowMap: 2048,
    pixelRatio: 1.5,
    aa: true,
    detail: 2,
    detailBias: 0,
    maxTriangles: 160000,
    floorRes: 48,
  },
} as const;

export type QualityKey = keyof typeof QUALITY;
