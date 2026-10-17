/**
 * 教学视频字幕脚本（"操作说明 + 安全提示"两段式）。
 *
 * ## 为什么不直接用规程里的 `content` / `safety`
 *
 * 1. `content` 是**工单正文**（含工具清单、参数区间、验收口径，平均 60+ 字）。教学视频底部
 *    只放得下 1~2 行，旧实现于是只能截断 —— 成片里出现过的
 *    `安全：观察机组仪表严禁随意改动PLC内部出…` 就是被截断的产物：一句话没说完就断了，
 *    而"禁止改动 PLC 出厂保护定值"这个**真正的安全要求**恰好落在省略号后面。
 * 2. 教学口径与工单口径不同：工单写给检修工看，教学视频要一句话讲清"做什么、注意什么"。
 * 3. 术语需要按教学口径统一（如"油气桶"→"油气分离器"、"外观品质判定"→"油质外观检查"）。
 *
 * 所以这里单独维护一份**已按字幕宽度排好版、保证不会被截断**的脚本。
 * 没有脚本的规程会自动回退到原有的 `content`/`safety` 路径（行为逐字不变）。
 *
 * ## 排版约束（由 `tests/video-teaching-script.test.ts` 守卫）
 *
 * - 每步 = 1~2 行"操作说明"（白色常规字）+ **恰好 1 行**"安全提示"（红色字 + `⚠ 安全：` 前缀）；
 * - 每行显示宽度 ≤ `SUBTITLE_LINE_MAX_WIDTH`（40 单位 ≈ 20 个汉字），
 *   **不截断、不加 "…"** —— 超宽会在测试里报错，而不是在成片里悄悄断句；
 * - 安全提示**不与操作说明同处一行**（两者颜色/前缀不同，混排会让"哪句是警告"看不出来）。
 *
 * ⚠️ 改这里的文案时请同步跑 `npx vitest run tests/video-teaching-script.test.ts`：
 * 该守卫会把"超出 2 行"直接判为失败，避免又退回"截断"老路。
 */

/** 一步的教学字幕：标题（顶部红条 + 口播开场白）、操作说明、安全提示 */
export interface TeachingStep {
  /** 顶部红色标题条用的步骤名（同时作为口播开场白"第N步，<title>。"） */
  title: string;
  /** 底部操作说明（白色常规字），按宽度自动折成 1~2 行 */
  operation: string;
  /** 底部安全提示（红色字，渲染时自动加 `⚠ 安全：` 前缀），恰好 1 行 */
  safety: string;
}

/**
 * 按 `规程 id → 步骤号` 索引的教学字幕脚本。
 *
 * 只收录**已经人工校订过**的规程；未收录的规程走原有 `content`/`safety` 路径。
 */
export const TEACHING_SCRIPTS: Record<string, Record<number, TeachingStep>> = {
  "proc-compressor-daily": {
    1: {
      title: "排气压力与机组排气温度运行巡检",
      operation: "记录排气压力（0.7~0.8 MPa），排气温度 ≤ 95℃",
      safety: "运行中禁止触碰高温排气管路",
    },
    2: {
      // 术语修正：油气桶 → 油气分离器（正式名称）；"冷凝水手动排放" → "冷凝水排放"
      title: "储气罐与油气分离器冷凝水排放",
      operation: "打开排污阀，排放冷凝水至无水流出后关闭",
      safety: "排放前确认罐内压力已降至 0 MPa",
    },
    3: {
      // 术语修正：外观品质判定 → 油质外观检查
      title: "润滑油油位观察与油质外观检查",
      operation: "观察油位在视镜刻度范围内，油色清澈无乳化",
      safety: "严禁带压运行时旋开加油堵",
    },
    4: {
      // 术语修正：外部反吹除尘 → 外表面反吹清灰
      title: "进气空气过滤器滤芯外表面反吹清灰",
      operation: "取出滤芯，用 0.3~0.5 MPa 压缩空气从内向外反吹",
      safety: "必须佩戴 KN95 防尘口罩及护目镜",
    },
  },
};

/** 取某一步的教学脚本；没有则返回 null（调用方回退到规程原文路径） */
export function getTeachingStep(
  procId: string | null | undefined,
  stepNo: number | null | undefined
): TeachingStep | null {
  if (!procId || stepNo == null) return null;
  const byStep = TEACHING_SCRIPTS[String(procId)];
  if (!byStep) return null;
  return byStep[Number(stepNo)] || null;
}
