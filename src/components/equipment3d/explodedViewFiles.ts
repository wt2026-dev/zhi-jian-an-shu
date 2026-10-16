/**
 * 设备台账 ID → 拆解视图 HTML 映射表。
 *
 * 拆解视图是 9 份**独立生成的静态页**（`public/exploded/*.html`：three.js 爆炸分解 + BOM 检视），
 * 本模块只负责「哪台设备对应哪份 HTML」，不改动这些页面本身；右侧详情面板用**同源 iframe** 加载
 * （CSP 的 frame-src 已是 'self'，见 src/server/index.ts）。
 *
 * 文件名口径：每一行的文件名都取自该 HTML 自己的 <title>，与设备台账编号一一对齐，不做语义猜测。
 *
 * 覆盖度：台账共 16 台设备，只有下列 9 台生成了拆解视图。其余 7 台
 * （eq-101 离心主循环给水泵、eq-108 烧结主抽风机电机、eq-109 五轴龙门加工中心、
 *   eq-110 六轴重载搬运机器人、eq-111 板式热交换器、eq-113 螺杆制冷机组、eq-116 热管换热器）
 * 未生成 → 面板显示「该设备暂未生成拆解视图」，不编造、不用占位图。
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
