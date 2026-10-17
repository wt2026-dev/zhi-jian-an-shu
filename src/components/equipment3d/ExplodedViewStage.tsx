/**
 * 拆解视图舞台：在**当前页面内**把主显示区域（原本显示 3D 设备模型的那块）换成
 * 拆解视图 HTML（同源 iframe），右上角给一颗「返回 3D 设备视图」。
 *
 * ## 两层结构（2026-10-16 用户口径第二次：不要留边、不要露 3D 背景）
 *
 * ```
 * [data-testid=equipment3d-exploded-stage]   背板：absolute inset-0 + 不透明底色
 *   └ [data-testid=equipment3d-exploded-panel]  内容列：吃调用方给的内缩（top/right/…）
 *       ├ 顶部条：这是谁的拆解视图 + 「返回 3D 设备视图」
 *       └ iframe：拆解页本体
 * ```
 *
 * 为什么必须拆成两层：背板铺满整个主区域 ⇒ 3D 画面**一点都露不出来**（画布在 DOM 里排在
 * 舞台之前，不透明背板一盖就没了）；而内容列仍然内缩，给右侧详情面板与 HUD 顶部浮片让位
 * —— 那两块是 `z-20`、排在舞台之后，**内缩不是为了它们可见，而是为了不压住拆解页自己的
 * 内容**（拆解页自带的 BOM 面板贴在它自己右边），以及让右上角的返回按钮不被浮片盖住。
 *
 * 反过来：如果只内缩一层（没有背板），内缩的那几圈就是露出来的 3D 场景 —— 用户原话
 * 「周围还能看到原来的 3D 场景背景露出来」。
 *
 * ## 为什么是同源 iframe
 *
 * 9 份拆解页是**独立生成的静态单页**（自带 three.js，BOM 检视 + 爆炸分解动画），
 * 不可能改写成 React 组件（用户明确要求：不改这些 HTML 本身）。iframe 是唯一
 * 能把"另一个完整单页"原样嵌进来的手段。同源 + `public/exploded/` 静态托管，
 * 不需要额外的 CSP 白名单。
 *
 * ## 沙箱口径
 *
 * `sandbox="allow-scripts allow-same-origin allow-downloads"`：
 *   - `allow-scripts`：拆解页的 three.js 渲染与交互全靠脚本；
 *   - `allow-same-origin`：**必须**。拆解页从 CDN 拉 three.js，且需要自己的
 *     localStorage/WebGL 上下文；去掉它会让页面降级成 opaque origin 而白屏。
 *     同时它也是"父页面能往 iframe 里注入样式"的前提（见 `hideBuiltinBackLink`）。
 *   - `allow-downloads`：BOM 表导出（页面自带的下载入口）。
 *   不给 `allow-top-navigation` —— 拆解页不允许把整个应用导航走。
 *
 * ## 顶部条
 *
 * 只占 36px，左侧写"这是谁的拆解视图"，右侧是「返回 3D 设备视图」。
 * 应用自己的顶部工具栏（面包屑 / 视图设置）在 workspace **之外**，不受影响。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Boxes, X, Wrench } from 'lucide-react';
import { getExplodedViewUrl } from './explodedViewFiles';
import { ExplodedPartHistoryPanel } from './ExplodedPartHistoryPanel';

/** 注入到拆解页里的样式表 id —— 幂等标记，重复注入靠它去重。 */
const EMBED_STYLE_ID = 'equipment3d-embed-overrides';

/**
 * 隐藏拆解页自带的「← 返回拆解总览」入口。
 *
 * 那 9 份静态页在 `</body>` 前被统一注入了一个
 * `<a href="exploded_index.html" style="position:fixed;top:16px;left:16px;z-index:9999">`：
 * **单独打开**那些页面时它是唯一的返回路径，必须留着；但**嵌进本应用**后，外壳已经在
 * 右上角给了「返回 3D 设备视图」，它就只剩一个多余的浮标。
 *
 * 做法：从父页面往同源 iframe 里注入 CSS，而**不去改那 9 份 HTML** ——
 * 它们是可单开的独立交付物，改了就回不去；注入只影响"被嵌进来"这一种场景。
 * 沙箱带 `allow-same-origin`，所以 `contentDocument` 可读可写。
 *
 * 全部失败路径都静默跳过（跨源 / 还没 load / 结构变了）：这只是个装饰性清理，
 * 绝不能让宿主因为它崩掉或空白。
 */
const hideBuiltinBackLink = (frame: HTMLIFrameElement | null): void => {
  const doc = frame?.contentDocument;
  if (!doc?.head) return;
  // 双保险①：9 份页面的 href 恒为 exploded_index.html，用声明式规则盖掉，并增强 BOM 滚动条与滚动能力
  if (!doc.getElementById(EMBED_STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = EMBED_STYLE_ID;
    style.textContent = `
      a[href="exploded_index.html"] { display: none !important; }
      /* 强制所有 BOM 滚动容器 min-height: 0，确保在 flex 容器中正常触发滚动，不被截断卡死 */
      #bomTableBody, #bom-tbody, #bom-table-body, div:has(> #bom-tbody), div:has(> table), .overflow-y-auto {
        min-height: 0 !important;
        overflow-y: auto !important;
        scrollbar-width: thin !important;
        scrollbar-color: rgba(56, 189, 248, 0.65) rgba(15, 23, 42, 0.8) !important;
      }
      ::-webkit-scrollbar {
        width: 8px !important;
        height: 8px !important;
      }
      ::-webkit-scrollbar-track {
        background: rgba(15, 23, 42, 0.8) !important;
        border-radius: 4px !important;
      }
      ::-webkit-scrollbar-thumb {
        background: rgba(56, 189, 248, 0.5) !important;
        border-radius: 4px !important;
        border: 1px solid rgba(56, 189, 248, 0.25) !important;
      }
      ::-webkit-scrollbar-thumb:hover {
        background: rgba(0, 229, 255, 0.9) !important;
      }
    `;
    doc.head.appendChild(style);
  }
  // 双保险②：万一某份页面的 href 变了，按文案兜一层（只影响这一处浮标）
  for (const a of Array.from(doc.querySelectorAll('a'))) {
    if (a.textContent?.includes('返回拆解总览')) a.style.setProperty('display', 'none', 'important');
  }
};

/* ==================== iframe ↔ 宿主 双向桥 ==================== */

/** 待注入到 iframe 里的全局函数名（9 份页面命名不统一：selectPart ×7 / selectPartById ×2）。 */
const SELECT_FN_CANDIDATES = ['selectPart', 'selectPartById'] as const;

/**
 * 安装 iframe 双向桥：
 *  ① 外发：wrap 页面的 selectPart / selectPartById（顶层 function 声明即全局绑定，
 *     赋值 window.selectPart 会替换同一绑定 → 页面内部调用也走包装层），
 *     3D 零件点击 / BOM 行点击 / 自动定位无论哪条路径选中零件都会上报 partId。
 *  ② 兜底外发：capture 相 click 监听 BOM 行（tr[data-part-id]），防个别页面函数声明在闭包里。
 *  ③ 内联：宿主经 iframe window.selectPart(partId, true) 定位高亮（同源可行）。
 *
 * 沙箱已带 allow-same-origin，contentWindow 可编程；onLoad 时注入，页面内部
 * window.onload 里首次 selectPart('P16') 会先于包装层执行 → 不会误报"初始默认选中"。
 */
function installIframeBridge(
  frame: HTMLIFrameElement,
  report: (partId: string | null) => void
): void {
  const win = frame.contentWindow as (Window & Record<string, unknown>) | null;
  const doc = frame.contentDocument;
  if (!win || !doc) return;

  for (const fnName of SELECT_FN_CANDIDATES) {
    const orig = win[fnName];
    if (typeof orig !== 'function') continue;
    const origAny = orig as unknown as { __bridgeWrapped?: boolean };
    if (origAny.__bridgeWrapped) continue;
    const wrapped = function (this: unknown, partId: unknown, ...rest: unknown[]) {
      if (typeof partId === 'string' && partId) report(partId);
      else if (partId === null || partId === undefined) report(null);
      return (orig as unknown as (...args: unknown[]) => unknown).apply(this, [partId, ...rest]);
    } as unknown as typeof orig;
    (wrapped as unknown as { __bridgeWrapped?: boolean }).__bridgeWrapped = true;
    win[fnName] = wrapped;
  }

  // 兜底②：BOM 行点击（只认 data-part-id 属性，误触别的 tr 不报）
  doc.addEventListener('click', (ev: Event) => {
    const target = ev.target as HTMLElement | null;
    const row = target?.closest?.('tr[data-part-id]') as HTMLElement | null;
    if (row) {
      const id = row.getAttribute('data-part-id');
      if (id) report(id);
    }
  }, true);
}

/** 高亮定位：优先点击 BOM 行（复用页面自身交互 = 相机聚焦 + 详情卡更新），退回全局 selectPart。 */
function tryHighlightPart(frame: HTMLIFrameElement, partId: string): void {
  const doc = frame.contentDocument;
  if (!doc) return;
  const row = doc.querySelector(`tr[data-part-id="${CSS.escape(partId)}"]`) as HTMLElement | null;
  if (row) {
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.click();
    return;
  }
  const win = frame.contentWindow as (Window & Record<string, unknown>) | null;
  for (const fnName of SELECT_FN_CANDIDATES) {
    const fn = win?.[fnName];
    if (typeof fn === 'function') {
      fn.call(win, partId, true);
      return;
    }
  }
}

/** 从工单跳转过来时携带的「工单上下文」卡片数据（全部为真实工单字段，由服务端 brief 提供）。 */
export interface ExplodedViewWorkOrderContext {
  id: string;
  orderNo: string;
  title: string;
  description: string;
  faultType: string;
  priority: string;
  status: string;
  createdAt?: string | null;
  equipmentName?: string;
  partsUsed: Array<{ name: string; code?: string; qty?: number; spec?: string }>;
  /** 服务端用真实 parts_used/描述 在 BOM 里匹配到的目标位号（未命中为 null，如实展示） */
  targetPart?: {
    posNo: string;
    name: string;
    matchedBy: string[];
    matchSource: string;
  } | null;
  /** 服务端匹配请求尚未返回（此时目标行显示"正在匹配目标零件…"，不可提前下"未命中"结论） */
  briefLoading?: boolean;
  dataNote?: string;
}

export interface ExplodedViewStageProps {
  /** 台账设备 ID（必须有对应拆解页，调用方负责先用 hasExplodedView 判过） */
  deviceId: string;
  /** 设备名（展示或备用，缺失时退回 ID） */
  deviceName?: string | null;
  /** 设备编号（如 EQ-2024-ROB-15） */
  deviceCode?: string | null;
  /** 点「返回 3D 设备视图」 */
  onBack: () => void;
  /**
   * 内容列的内缩（默认铺满 `inset-0`，不留边）
   */
  className?: string;
  /** 工单上下文（检修工单「查看拆解视图」跳入时给） */
  workOrderBrief?: ExplodedViewWorkOrderContext | null;
  /** 要自动高亮定位的零件位号（来自工单上下文的服务端匹配结果） */
  targetPartPosNo?: string | null;
  /** 点击面板里的工单号 / 「返回工单详情」 */
  onOpenWorkOrder?: (orderId: string) => void;
}

const STATUS_TEXT: Record<string, string> = {
  created: '待检修', dispatched: '已派发', in_progress: '检修中',
  pending_acceptance: '待验收', completed: '已完成', cancelled: '已取消',
};

const PRIORITY_CLS: Record<string, string> = {
  urgent: 'bg-rose-500/20 text-rose-300 border-rose-400/40',
  major: 'bg-amber-500/20 text-amber-300 border-amber-400/40',
  general: 'bg-sky-500/15 text-sky-300 border-sky-400/35',
};

/** 供拆解页内部给宿主回传选中位号用的回调容器（避免把 callback effect 化）。 */
type ReportRef = { current: (partId: string | null) => void };

export const ExplodedViewStage: React.FC<ExplodedViewStageProps> = ({
  deviceId,
  deviceName,
  deviceCode: _deviceCode,
  onBack,
  className = 'inset-0',
  workOrderBrief = null,
  targetPartPosNo = null,
  onOpenWorkOrder,
}) => {
  const url = getExplodedViewUrl(deviceId);
  const title = `${deviceName ?? deviceId} · 设备拆解视图`;

  /* ---- 零件选中态（iframe 桥上报，驱动左侧维修历史面板） ---- */
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [briefCollapsed, setBriefCollapsed] = useState(false);
  const [highlightTick, setHighlightTick] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // useRef 而非 useCallback 常驻：installIframeBridge 里闭包捕获的是 ref，桥内调用永远最新
  const reportRef: ReportRef = useRef<(partId: string | null) => void>(() => {});
  reportRef.current = (partId) => setSelectedPartId(partId);

  // 换设备：清选中态与折叠态（旧的 iframe 会被 key 强制重建，旧 JS 状态一并丢弃）
  useEffect(() => {
    setSelectedPartId(null);
    setBriefCollapsed(false);
  }, [deviceId]);

  const handleIframeLoad = useCallback((e: React.SyntheticEvent<HTMLIFrameElement>) => {
    const frame = e.currentTarget;
    hideBuiltinBackLink(frame);
    installIframeBridge(frame, (partId) => reportRef.current(partId));
    // 桥安装完成，重触发一次高亮（深链 brief 可能早于 iframe onLoad 到达）
    setHighlightTick((t) => t + 1);
  }, []);

  /* ---- 自动高亮定位工单目标零件 ---- */
  useEffect(() => {
    if (!targetPartPosNo || !iframeRef.current) return;
    tryHighlightPart(iframeRef.current, targetPartPosNo);
    // highlightTick: iframe onLoad 后再补试一次（此时尚未渲染完成的 BOM 行也能点到）
  }, [targetPartPosNo, highlightTick]);

  return (
    /* ---- 背板：铺满整个主显示区域（3D 画面到此为止，高层级置顶） ---- */
    <div
      data-testid="equipment3d-exploded-stage"
      data-device-id={deviceId}
      className="absolute inset-0 bg-slate-950 z-40 overflow-hidden"
    >
      {/* ---- 主舞台面板：占满全屏，无边框与内缩 ---- */}
      <div
        data-testid="equipment3d-exploded-panel"
        className={`absolute inset-0 flex flex-col overflow-hidden ${className}`}
      >
        {/* ---- 右上角浮动返回按钮：小巧精致、不占独立标题栏高度 ---- */}
        <button
          type="button"
          data-testid="equipment3d-exploded-back"
          onClick={onBack}
          title="关闭拆解视图，回到 3D 设备模型"
          className="absolute top-3 right-3 z-50 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-cyan-200 bg-slate-900/85 hover:bg-slate-800/95 hover:text-white border border-cyan-500/40 hover:border-cyan-400 shadow-[0_4px_16px_rgba(0,0,0,0.6)] backdrop-blur transition-all cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>返回 3D 设备视图</span>
        </button>

        {/* ---- 左侧栏：工单上下文卡（F1：从检修工单跳入时显示工单关键信息）+ 零件维修历史面板（F2：点零件显示真实历史） ---- */}
        {(workOrderBrief || selectedPartId) && (
          <div className="absolute left-2 top-2 bottom-3 z-50 w-[340px] max-w-[36vw] flex flex-col gap-2 pointer-events-none" data-testid="equipment3d-exploded-leftcol">
            {workOrderBrief &&
              (briefCollapsed ? (
                <button
                  type="button"
                  data-testid="equipment3d-exploded-brief-chip"
                  onClick={() => setBriefCollapsed(false)}
                  className="pointer-events-auto self-start inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-cyan-100 bg-slate-900/90 border border-cyan-500/40 hover:border-cyan-400 backdrop-blur shadow cursor-pointer"
                >
                  <Wrench className="w-3.5 h-3.5" />
                  工单 {workOrderBrief.orderNo}
                  {workOrderBrief.targetPart ? ` · ${workOrderBrief.targetPart.posNo} ${workOrderBrief.targetPart.name}` : ''}
                </button>
              ) : (
                <div
                  data-testid="equipment3d-exploded-brief-card"
                  className="pointer-events-auto overflow-hidden rounded-xl border border-cyan-500/30 bg-slate-950/92 text-slate-200 shadow-[0_10px_40px_rgba(0,0,0,0.55)] backdrop-blur"
                >
                  {/* 卡头：工单号 + 状态 + 优先级 + 收起 */}
                  <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-slate-900/80 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Wrench className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
                      <span className="font-mono text-[11px] text-cyan-300">{workOrderBrief.orderNo}</span>
                      <span className={`rounded border px-1 py-px text-[9px] font-medium ${STATUS_TEXT[workOrderBrief.status] ? 'border-white/15 bg-white/10 text-slate-300' : 'border-transparent'}`}>
                        {STATUS_TEXT[workOrderBrief.status] ?? workOrderBrief.status}
                      </span>
                      <span className={`rounded border px-1 py-px text-[9px] font-medium ${PRIORITY_CLS[workOrderBrief.priority] ?? PRIORITY_CLS.general}`}>
                        {workOrderBrief.priority === 'urgent' ? '紧急' : workOrderBrief.priority === 'major' ? '重大' : '一般'}
                      </span>
                    </div>
                    <button type="button" onClick={() => setBriefCollapsed(true)} title="收起" className="shrink-0 cursor-pointer text-slate-400 hover:text-white">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  {/* 卡身 */}
                  <div className="max-h-[42vh] overflow-y-auto px-3 py-2 text-[11px] leading-relaxed">
                    <div className="text-[12px] font-semibold text-white">{workOrderBrief.title}</div>
                    {workOrderBrief.description && (
                      <div className="mt-0.5 line-clamp-2 text-slate-400">{workOrderBrief.description}</div>
                    )}
                    {/* 目标零件（服务端按真实 parts_used/描述匹配；未命中 = 未识别到具体零件） */}
                    {workOrderBrief.targetPart ? (
                      <div className="mt-2 rounded-lg border border-cyan-400/40 bg-cyan-500/10 px-2.5 py-2" data-testid="equipment3d-exploded-brief-target">
                        <div className="text-[9px] tracking-wide text-cyan-300">目标零件 · 已自动高亮</div>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <span className="rounded bg-cyan-500/25 px-1.5 py-0.5 font-mono text-[10px] font-bold text-cyan-200">{workOrderBrief.targetPart.posNo}</span>
                          <span className="text-[11px] font-medium text-white">{workOrderBrief.targetPart.name}</span>
                        </div>
                        {workOrderBrief.targetPart.matchedBy.length > 0 && (
                          <div className="mt-0.5 line-clamp-1 text-[9px] text-cyan-200/70">依据: {workOrderBrief.targetPart.matchedBy.join(' · ')}</div>
                        )}
                      </div>
                    ) : workOrderBrief.briefLoading ? (
                      <div className="mt-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-slate-400" data-testid="equipment3d-exploded-brief-target-pending">
                        正在匹配目标零件…
                      </div>
                    ) : (
                      <div className="mt-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-slate-400" data-testid="equipment3d-exploded-brief-target-none">
                        未识别到具体零件，请在左侧 BOM 中点选查看维修历史
                      </div>
                    )}
                    {/* 真实耗用备件 */}
                    {workOrderBrief.partsUsed.length > 0 && (
                      <div className="mt-2">
                        <div className="text-[9px] tracking-wide text-slate-400">事后使用的真实耗用备件</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {workOrderBrief.partsUsed.map((p, i) => (
                            <span key={`${p.name}-${i}`} className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] text-slate-300">
                              {p.name}{p.qty != null ? ` ×${p.qty}` : ''}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {workOrderBrief.dataNote && (
                      <div className="mt-2 border-t border-white/10 pt-1.5 text-[9px] text-slate-500">{workOrderBrief.dataNote}</div>
                    )}
                  </div>
                  {/* 卡脚：返回工单详情 */}
                  <button
                    type="button"
                    data-testid="equipment3d-exploded-brief-open-order"
                    onClick={() => onOpenWorkOrder?.(workOrderBrief.id)}
                    className="border-t border-white/10 bg-slate-900/70 px-3 py-2 text-left text-[11px] font-medium text-cyan-300 transition hover:bg-cyan-500/15 hover:text-cyan-100 cursor-pointer w-full"
                  >
                    ← 返回工单详情
                  </button>
                </div>
              ))}
            {/* 零件维修历史（点零件后出现；未点零件 = 干净的拆解视图原样） */}
            <ExplodedPartHistoryPanel
              deviceId={deviceId}
              posNo={selectedPartId}
              onOpenWorkOrder={onOpenWorkOrder}
              onClose={() => setSelectedPartId(null)}
            />
          </div>
        )}

        {/* ---- 拆解页本体：100% 占满可用区域 ---- */}
        {url ? (
          <iframe
            key={deviceId}
            ref={iframeRef}
            data-testid="equipment3d-exploded-iframe"
            src={url}
            title={title}
            onLoad={handleIframeLoad}
            className="w-full h-full min-h-0 border-0 bg-slate-950 flex-1"
            sandbox="allow-scripts allow-same-origin allow-downloads"
            referrerPolicy="no-referrer"
            allow="fullscreen"
          />
        ) : (
          /* 兜底：正常不可达（宿主已判过 hasExplodedView），但绝不留白屏 */
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-400 text-[11px]">
            <Boxes className="w-6 h-6 text-slate-500" />
            该设备暂未生成拆解视图
            <button
              type="button"
              onClick={onBack}
              className="mt-1 px-2.5 py-1 rounded text-[11px] text-cyan-100 bg-cyan-500/20 hover:bg-cyan-500/35 border border-cyan-400/50 transition"
            >
              返回 3D 设备视图
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ExplodedViewStage;
