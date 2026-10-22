/**
 * 设备健康状态域（自 equipment.ts 机械切出，纯移动不改行为）。
 *
 * 内聚在此：状态联合类型、状态元数据（颜色/告警口径）、状态归一化、
 * 状态 → 颜色的三条取色通路、状态驱动动画的激活判据与闪烁参数。
 *
 * 不在此：设备几何构建、GLB 装载、原型分类（分别留在 equipment.ts /
 * equipmentPrototype.ts）。状态口径是 3D 层与 UI 图例共用的唯一来源。
 */
import * as THREE from 'three';
import type { ScenePreset } from './styles';
import type { AnimKind } from './parts';

export type StatusKey =
  | 'running'
  | 'warning'
  | 'fault'
  | 'critical'
  | 'overhauling'
  | 'standby'
  | 'scrapped'
  | 'nodata';

export interface StatusMeta {
  label: string;
  /** 主色（设备本体 / 地面光环） */
  colour: number;
  /** 高亮色（顶部指示灯 / 光柱） */
  glow: number;
  /** 是否属于需要立刻被看见的异常态 */
  alert: boolean;
}

export const STATUS_META: Record<StatusKey, StatusMeta> = {
  running: { label: '正常', colour: 0x27c46b, glow: 0x5cffa3, alert: false },
  warning: { label: '预警', colour: 0xf2c327, glow: 0xffe066, alert: true },
  fault: { label: '故障', colour: 0xe03b2f, glow: 0xff7a66, alert: true },
  // 后端台账里出现过 `critical`（不在 EquipmentStatus 联合类型内），单独映射为"紧急"，
  // 比 fault 更偏橙红，避免与普通故障混淆。
  critical: { label: '紧急', colour: 0xff4a1f, glow: 0xffa06a, alert: true },
  overhauling: { label: '检修中', colour: 0x2f8fe0, glow: 0x8ecdff, alert: false },
  standby: { label: '待机', colour: 0x8f9aa6, glow: 0xc2cdd8, alert: false },
  scrapped: { label: '已报废', colour: 0x596069, glow: 0x8a929b, alert: false },
  nodata: { label: '无数据', colour: 0x9aa0a6, glow: 0xc8ced3, alert: false },
};

/** 状态色图例（顺序即 UI 展示顺序）。 */
export const STATUS_ORDER: StatusKey[] = [
  'running',
  'warning',
  'fault',
  'critical',
  'overhauling',
  'standby',
  'scrapped',
  'nodata',
];

/**
 * 归一化状态字符串。
 * 关键点：后端 `critical` 不在前端 `EquipmentStatus` 联合类型里，
 * 因此这里必须容错，未知值统一落到「无数据」灰，而不是抛错或误判为正常。
 */
export function statusKey(raw: string | null | undefined): StatusKey {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s in STATUS_META) return s as StatusKey;
  if (s === 'ok' || s === 'normal' || s === 'healthy' || s === 'good') return 'running';
  if (s === 'warn') return 'warning';
  if (s === 'alarm' || s === 'error' || s === 'broken' || s === 'down') return 'fault';
  if (s === 'maintenance' || s === 'repair' || s === 'overhaul') return 'overhauling';
  if (s === 'idle' || s === 'offline' || s === 'stopped') return 'standby';
  return 'nodata';
}

/** 设备本体色：以调色板钢灰为底，混入状态色，保证"像喷漆钢件"同时状态一眼可辨。 */
export function bodyColour(key: StatusKey, preset: ScenePreset): THREE.Color {
  const base = new THREE.Color(preset.palette.steel);
  const st = new THREE.Color(STATUS_META[key].colour);
  // 无数据态刻意压低饱和度，避免"没有数据"被误读成"状态良好"
  return base.lerp(st, key === 'nodata' ? 0.42 : 0.62);
}

export function bandColour(key: StatusKey): THREE.Color {
  return new THREE.Color(STATUS_META[key].colour).multiplyScalar(0.74);
}

export function glowColour(key: StatusKey): THREE.Color {
  return new THREE.Color(STATUS_META[key].glow);
}

/* ========================= 状态动画规格 ========================= */

/**
 * 动画是否在当前状态下激活。
 * 这是「状态驱动动画」的唯一判据 —— 不存在随机播放或与状态无关的自转。
 */
export function animActive(kind: AnimKind, status: StatusKey): boolean {
  switch (kind) {
    case 'spin':
    case 'slide':
      return status === 'running';
    case 'shake':
      return status === 'fault' || status === 'critical';
    case 'blink':
      // 预警黄灯闪烁 / 故障与紧急红灯脉冲，都走同一条闪烁通路，参数不同
      return STATUS_META[status].alert;
    default:
      return false;
  }
}

/** 闪烁参数：预警慢闪、故障快闪、紧急最快且最低亮度更低（"脉冲"感更强）。 */
export function blinkParams(status: StatusKey): { hz: number; floor: number } {
  if (status === 'critical') return { hz: 4.6, floor: 0.06 };
  if (status === 'fault') return { hz: 3.4, floor: 0.12 };
  if (status === 'warning') return { hz: 1.6, floor: 0.35 };
  return { hz: 0, floor: 1 };
}
