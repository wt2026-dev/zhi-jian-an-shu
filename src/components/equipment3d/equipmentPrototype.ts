/**
 * 设备原型分类域（自 equipment.ts 机械切出，纯移动不改行为）。
 *
 * 内聚在此：原型联合类型、原型中文标签、台账 category / 名称关键词 → 原型的
 * 推断链、原型包围盒。供 buildEquipment 选配方、未知设备兜底取景、游戏场景共用。
 */
/* ========================= 设备原型（未知设备兜底） ========================= */

export type PrototypeKey =
  | 'pump'
  | 'compressor'
  | 'gearbox'
  | 'reducer'
  | 'motor'
  | 'cnc'
  | 'robot'
  | 'exchanger'
  | 'cabinet'
  | 'generic';

export const PROTOTYPE_LABEL: Record<PrototypeKey, string> = {
  pump: '离心泵组',
  compressor: '压缩机组',
  gearbox: '齿轮箱',
  reducer: '减速机',
  motor: '大型电机',
  cnc: '数控机床',
  robot: '工业机器人',
  exchanger: '换热容器',
  cabinet: '配电柜',
  generic: '通用机组',
};

/** 项目台账里的 category → 原型。项目 8 类设备全部覆盖。 */
const CATEGORY_PROTOTYPE: Record<string, PrototypeKey> = {
  泵类设备: 'pump',
  压缩机类: 'compressor',
  压缩机: 'compressor',
  齿轮传动: 'gearbox',
  传动减速机: 'reducer',
  大型电机: 'motor',
  数控机床: 'cnc',
  工业机器人: 'robot',
  换热容器: 'exchanger',
  电气柜: 'cabinet',
  配电柜: 'cabinet',
};

const NAME_HINTS: Array<[RegExp, PrototypeKey]> = [
  [/泵/, 'pump'],
  [/空压|压缩机|制冷压缩/, 'compressor'],
  [/齿轮箱|行星|齿轮传动/, 'gearbox'],
  [/减速机|减速箱/, 'reducer'],
  [/电机|电动机/, 'motor'],
  [/数控|加工中心|机床|龙门/, 'cnc'],
  [/机器人|机械臂|码垛/, 'robot'],
  [/换热|热交换|热管|容器|罐/, 'exchanger'],
  [/配电|开关柜|电气柜/, 'cabinet'],
  [/管道|管线|管路/, 'generic'],
];

/** 由台账条目推断设备原型（category 优先，其次名称关键词，最后通用）。 */
export function prototypeFor(device: { category?: string; name?: string }): PrototypeKey {
  const cat = String(device.category ?? '').trim();
  if (CATEGORY_PROTOTYPE[cat]) return CATEGORY_PROTOTYPE[cat];
  const name = String(device.name ?? '');
  for (const [re, key] of NAME_HINTS) if (re.test(name)) return key;
  return 'generic';
}

/** 原型包围盒（米，scale = 1 时）。仅用于未知设备的兜底取景与代理尺寸。 */
export const PROTOTYPE_BOUNDS: Record<PrototypeKey, { w: number; h: number; d: number }> = {
  pump: { w: 5.6, h: 3.0, d: 2.2 },
  compressor: { w: 4.8, h: 3.4, d: 2.6 },
  gearbox: { w: 5.2, h: 2.7, d: 2.4 },
  reducer: { w: 4.2, h: 2.3, d: 2.1 },
  motor: { w: 5.6, h: 3.2, d: 2.3 },
  cnc: { w: 5.6, h: 3.7, d: 3.5 },
  robot: { w: 3.2, h: 5.0, d: 3.2 },
  exchanger: { w: 6.0, h: 3.0, d: 2.4 },
  cabinet: { w: 2.6, h: 2.4, d: 1.2 },
  generic: { w: 3.0, h: 2.5, d: 2.0 },
};

