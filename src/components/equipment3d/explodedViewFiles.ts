/**
 * 设备台账 ID → 拆解视图 HTML 映射表。
 *
 * 拆解视图是 9 份**独立生成的静态页**（`public/exploded/*.html`：three.js 爆炸分解 + BOM 检视），
 * 本模块只负责「哪台设备对应哪份 HTML」，不改动这些页面本身。
 *
 * 打开方式（2026-10-16 口径变更，第二次）：**在当前页面内切换主显示区域**。
 * 点「拆解视图」后不新开窗口、不整页跳走，而是把中间那块显示 3D 设备模型的区域
 * 换成拆解视图 HTML（同源 iframe）；右上角给「返回 3D 设备视图」退回。
 * 宿主由 `EquipmentScene` 通过 `setExplodedViewHost()` 注册；**没有宿主时才回退到新标签页**
 * （保证按钮在别处被单独使用时仍然可用）。
 *
 * 文件名口径：每一行的文件名都取自该 HTML 自己的 <title>，与设备台账编号一一对齐，不做语义猜测。
 *
 * 覆盖度：台账共 16 台设备，只有下列 9 台生成了拆解视图。其余 7 台
 * （eq-101 离心主循环给水泵、eq-108 烧结主抽风机电机、eq-109 五轴龙门加工中心、
 *   eq-110 六轴重载搬运机器人、eq-111 板式热交换器、eq-113 螺杆制冷机组、eq-116 热管换热器）
 * 未生成 → 按钮置灰并提示「该设备暂未生成拆解视图」，不编造、不用占位图。
 */

/** 拆解视图静态资源目录（vite publicDir 下的 `exploded/`，构建后复制到 dist 根）。 */
export const EXPLODED_VIEW_DIR = '/exploded/';

/**
 * 设备 ID → 拆解视图文件名。
 * 注意：eq-115 用的是 `robot_exploded_v2.html`（该页标题为「工业六轴机械臂 005」，
 * 页面内不含设备编号，按台账「15#」编号对齐）。
 */
export const EXPLODED_VIEW_FILES: Record<string, string> = {
  'eq-102': 'compressor2_exploded.html',      // 2# 无油螺杆空压机主机
  'eq-103': 'gearbox3_exploded.html',         // 3# 轧机主传动行星减速箱
  'eq-104': 'motor_exploded.html',            // 4# 10kV 高压循环水主电机
  'eq-105': 'pump_exploded.html',             // 5# 多级高压锅炉给水泵
  'eq-106': 'compressor_exploded.html',       // 6# 离心式工艺空气压缩机
  'eq-107': 'gearbox_exploded.html',          // 7# 冷轧卷取机主传动硬齿面减速机
  'eq-109': 'machining_center_exploded.html', // 9# 五轴龙门加工中心
  'eq-112': 'cooling_pump_exploded_v3.html',  // 12# 连铸结晶器冷却循环泵
  'eq-114': 'motor14_exploded.html',          // 14# 成品线变频调速三相异步电机（备用）
  'eq-115': 'robot_exploded_v2.html',         // 15# 成品自动码垛工业机器人（六轴机械臂 005）
};

/**
 * 取该设备的拆解视图 URL；无对应视图时返回 null（调用方据此渲染空状态）。
 * 只认台账 ID，不做名称/类别模糊匹配 —— 匹配不上就是「暂未生成」，不猜。
 */
export function getExplodedViewUrl(deviceId?: string | null): string | null {
  if (!deviceId) return null;
  const file = EXPLODED_VIEW_FILES[deviceId];
  return file ? `${EXPLODED_VIEW_DIR}${file}` : null;
}

/** 该设备是否有拆解视图（按钮的可用性判据）。 */
export function hasExplodedView(deviceId?: string | null): boolean {
  return getExplodedViewUrl(deviceId) !== null;
}

/**
 * 宿主接管回调：返回 true 表示"我已经在页面内把它显示出来了"，返回 false 表示交给兜底。
 * 用模块级单例而不是 props 透传，是为了让按钮在**两个不同面板**（大屏 HUD 右栏 /
 * 普通模式侧栏）里行为一致，而不必把回调穿过 `ProductionHUD` 再传下去。
 */
export type ExplodedViewHost = (deviceId: string) => boolean;

let explodedViewHost: ExplodedViewHost | null = null;

/** 注册 / 注销"页内打开"的宿主实现（`EquipmentScene` 挂载时注册，卸载时传 null）。 */
export function setExplodedViewHost(host: ExplodedViewHost | null): void {
  explodedViewHost = host;
}

/**
 * 请求打开该设备的拆解视图。
 *
 * 优先交给宿主在**当前页面内**切换主显示区域；没有宿主（或宿主拒收）时才回退到新标签页
 * —— 拆解页是自带 three.js 的独立单页，直接开新窗口是它自己也能跑的兜底路径。
 *
 * `noopener,noreferrer`：兜底路径下拆解页不需要也不应该拿到本应用的 window 引用。
 *
 * @returns 是否真的发起了展示；无映射时返回 false，调用方据此提示「暂未生成」。
 */
export function openExplodedView(deviceId?: string | null): boolean {
  const url = getExplodedViewUrl(deviceId);
  if (!url || !deviceId) return false;
  if (explodedViewHost && explodedViewHost(deviceId)) return true;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}
