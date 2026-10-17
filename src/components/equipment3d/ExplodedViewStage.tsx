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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Boxes,
  X,
  Wrench,
  FileDown,
  ChevronRight,
  ChevronLeft,
  ListOrdered,
  History,
  AlertTriangle,
  Package,
  Search,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import { getExplodedViewUrl } from './explodedViewFiles';
import { ExplodedPartHistoryPanel } from './ExplodedPartHistoryPanel';
import { MaintenanceStepGuidePanel } from './MaintenanceStepGuidePanel';
import { ExplodedFaultPanel } from './ExplodedFaultPanel';
import { ExplodedPartLifePanel } from './ExplodedPartLifePanel';
import { ExplodedPartInventoryPanel } from './ExplodedPartInventoryPanel';
import { buildMaintenanceReportPdf } from './maintenanceReportPdf';
import { explodedViewApi } from '../../api';
import type {
  ExplodedOrderStep,
  ExplodedFaultDiagnostics,
  ExplodedPartLifeDiagnostics,
  ExplodedPartInventoryDiagnostics,
  SpareProcurePrefill,
  MaintenanceReportBomRow,
} from '../../api';
import type { WorkOrderCreatePrefill } from '../../types';

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
      /* BOM 物料清单面板：确保顶部留出 76px 间隙，彻底避开顶部工具栏按钮（轴测/正视/平铺/标注等） */
      #bom-panel {
        top: 76px !important;
        bottom: 16px !important;
      }
      /* 针对带底部高控制台的页面（如机械臂底部 h-18 工具栏），底部留出 88px 间隙 */
      body:has(footer.h-18) #bom-panel, footer.h-18 ~ #bom-panel, #bom-panel.w-85 {
        bottom: 88px !important;
      }
      /* 左侧详情卡片在宿主手柄旁留出 60px 间隙，绝不发生重叠（仅针对浮动/固定定位的卡片，不影响表格内嵌子元素） */
      aside#detail-card, div#detail-card.absolute, div#detail-card.fixed, #detail-card:not([class*="border-b"]) {
        left: 60px !important;
      }
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

      /* 3D 浮动标签与 BOM 维修提示样式（进入维修模式后自动激活，兼容全量 9 设备标注） */
      .part-label-3d.has-fault, .part-label-tag.has-fault, .part-label.has-fault {
        border-color: #ef4444 !important;
        background: rgba(185, 28, 28, 0.92) !important;
        color: #ffffff !important;
        box-shadow: 0 0 16px rgba(239, 68, 68, 0.85) !important;
        animation: maint3dPulse 1.8s ease-in-out infinite !important;
      }
      .part-label-3d.has-life-warn, .part-label-tag.has-life-warn, .part-label.has-life-warn {
        border-color: #eab308 !important;
        background: rgba(161, 98, 7, 0.92) !important;
        color: #ffffff !important;
        box-shadow: 0 0 12px rgba(234, 179, 8, 0.75) !important;
      }
      .part-label-3d.has-low-stock, .part-label-tag.has-low-stock, .part-label.has-low-stock {
        border-right: 3px solid #f97316 !important;
      }
      .maint-3d-badge {
        display: inline-flex;
        align-items: center;
        margin-left: 4px;
        padding: 1px 4px;
        border-radius: 3px;
        font-size: 9px;
        font-weight: 700;
        line-height: 1.2;
      }
      .maint-3d-fault {
        background: #ef4444;
        color: #ffffff;
      }
      .maint-3d-life {
        background: #eab308;
        color: #0f172a;
      }
      .maint-3d-stock {
        background: #f97316;
        color: #ffffff;
      }
      tr[data-part-id].has-fault td, .bom-row.has-fault, [data-part-id].has-fault, [data-id].has-fault {
        background-color: rgba(239, 68, 68, 0.16) !important;
        border-left: 3px solid #ef4444 !important;
      }
      tr[data-part-id].has-life-warn td, .bom-row.has-life-warn, [data-part-id].has-life-warn, [data-id].has-life-warn {
        background-color: rgba(234, 179, 8, 0.14) !important;
        border-left: 3px solid #eab308 !important;
      }
      tr[data-part-id].has-low-stock td, .bom-row.has-low-stock, [data-part-id].has-low-stock, [data-id].has-low-stock {
        background-color: rgba(249, 115, 22, 0.12) !important;
      }
      @keyframes maint3dPulse {
        0%, 100% { transform: translate(-50%, -100%) scale(1); }
        50% { transform: translate(-50%, -100%) scale(1.06); }
      }
    `;
    doc.head.appendChild(style);
  }
  // 双保险②：万一某份页面的 href 变了，按文案兜一层（只影响这一处浮标）
  for (const a of Array.from(doc.querySelectorAll('a'))) {
    if (a.textContent?.includes('返回拆解总览')) a.style.setProperty('display', 'none', 'important');
  }

  // 默认收起拆解页自带的左上角巨大参考图悬浮窗（避免遮挡 3D 视图）
  const refIds = ['ref-card', 'refPopup', 'ref-popup'];
  for (const id of refIds) {
    const el = doc.getElementById(id);
    if (el) {
      el.classList.add('hidden');
      el.style.setProperty('display', 'none', 'important');
    }
  }
  const refBtn = doc.getElementById('btnToggleRefPopup') || doc.getElementById('btn-toggle-ref');
  if (refBtn && refBtn.classList.contains('active')) {
    refBtn.classList.remove('active');
  }
  if (refBtn && !(refBtn as any).__boundRefToggle) {
    (refBtn as any).__boundRefToggle = true;
    refBtn.addEventListener('click', () => {
      for (const id of refIds) {
        const el = doc.getElementById(id);
        if (el) {
          const cur = el.style.getPropertyValue('display');
          el.style.setProperty('display', cur === 'none' ? 'block' : 'none', 'important');
        }
      }
    });
  }

  // BOM 面板安全边距适配（避免在机械臂与压缩机等页面中顶格遮挡工具栏或被底部控制条截断）
  const bomPanel = doc.getElementById('bom-panel');
  if (bomPanel) {
    bomPanel.style.setProperty('top', '76px', 'important');
    const hasTallFooter = Boolean(doc.querySelector('footer.h-18, footer[class*="h-18"]'));
    bomPanel.style.setProperty('bottom', hasTallFooter ? '88px' : '16px', 'important');
  }

  // 默认收起左侧独立弹出的详情卡片（如机械臂工程档案），避免初始加载时遮挡 3D 主体模型
  const robotDetail = doc.getElementById('detail-card');
  if (robotDetail && !robotDetail.classList.contains('-translate-x-[120%]')) {
    robotDetail.classList.add('-translate-x-[120%]');
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

/**
 * 播放拆解动画（维修步骤指引 F3）：全部走页面**原生**入口，不在宿主里模拟。
 *   · A 族（compressor ×2 / gearbox ×2 / motor / pump）：真实调用页面的
 *     setExplodeTarget(0, true) + setPlayingState(true) —— 页面自己的 animate 循环
 *     会从装配态播放到 100% 分解态（滑杆/文案由页面同步）。
 *   · B 族（cooling_v3 / motor14 / robot）：点击页面自己的播放按钮 —— 页面的
 *     click 监听器负责 appState/图标/文案。用按钮 DOM 的 "playing" 标记与文案
 *     判断当前态（script 域的 let 读不到，也不读），避免"点一下反而暂停"。
 * 返回是否成功触发宿主可见的动画（供调试/测试兜底断言用）。
 */
function startExplodeAnimation(frame: HTMLIFrameElement): boolean {
  const win = frame.contentWindow as (Window & Record<string, unknown>) | null;
  const doc = frame.contentDocument;
  if (!win || !doc) return false;
  const setExplodeTarget = win['setExplodeTarget'];
  const setPlayingState = win['setPlayingState'];
  if (typeof setExplodeTarget === 'function' && typeof setPlayingState === 'function') {
    const asExplode = setExplodeTarget as unknown as (val: number, stopPlay?: boolean) => void;
    const asPlay = setPlayingState as unknown as (playing: boolean) => void;
    try {
      asExplode.call(win, 0, true);
      asPlay.call(win, true);
      return true;
    } catch {
      /* fallthrough */
    }
  }
  const btn = doc.querySelector<HTMLElement>('#btn-play-explode, #btn-play, button[id*="play"]');
  if (btn) {
    const isPlayingNow =
      btn.classList.contains('playing') ||
      /暂停/.test(btn.textContent ?? '') ||
      Boolean(btn.querySelector('.fa-pause'));
    if (!isPlayingNow) {
      try {
        btn.click();
      } catch {
        return false;
      }
    }
    return true;
  }
  return false;
}

/**
 * 3D 浮动标签与 BOM 行在维修模式下的状态高亮打标
 */
function applyMaintenanceOverlayToIframe(
  frame: HTMLIFrameElement | null,
  active: boolean,
  faultPosNos: string[],
  lifeWarnings: Array<{ id: string; level: 'warn' | 'replace' }>,
  lowStockPosNos: string[]
): void {
  const doc = frame?.contentDocument;
  if (!doc) return;

  // 清除旧的动态角标
  doc.querySelectorAll('.maint-3d-badge').forEach((el) => el.remove());
  doc.querySelectorAll('.has-fault, .has-life-warn, .has-low-stock').forEach((el) => {
    el.classList.remove('has-fault', 'has-life-warn', 'has-low-stock');
  });

  if (!active) return;

  // 1. 打标 3D 浮动引线标签（兼容全量 9 设备的 .part-label-3d / .part-label-tag / .part-label）
  const labels = Array.from(doc.querySelectorAll<HTMLElement>('.part-label-3d, .part-label-tag, .part-label'));
  for (const label of labels) {
    const text = label.textContent ?? '';
    const isFault = faultPosNos.some((pos) => pos && text.includes(pos));
    const lifeItem = lifeWarnings.find((w) => w.id && text.includes(w.id));
    const isLowStock = lowStockPosNos.some((pos) => pos && text.includes(pos));

    if (isFault) {
      label.classList.add('has-fault');
      const badge = doc.createElement('span');
      badge.className = 'maint-3d-badge maint-3d-fault';
      badge.textContent = '🔴 故障';
      label.appendChild(badge);
    } else if (lifeItem) {
      label.classList.add('has-life-warn');
      const badge = doc.createElement('span');
      badge.className = 'maint-3d-badge maint-3d-life';
      badge.textContent = lifeItem.level === 'replace' ? '🔴 待换' : '🟡 到期';
      label.appendChild(badge);
    }

    if (isLowStock) {
      label.classList.add('has-low-stock');
      const badge = doc.createElement('span');
      badge.className = 'maint-3d-badge maint-3d-stock';
      badge.textContent = '📦 缺件';
      label.appendChild(badge);
    }
  }

  // 2. 打标 BOM 物料清单表格行（兼容 table/tr 以及 div.bom-row）
  const rows = Array.from(doc.querySelectorAll<HTMLElement>('tr[data-part-id], .bom-row, [data-part-id], [data-id]'));
  for (const row of rows) {
    const partId = row.getAttribute('data-part-id') || row.getAttribute('data-id') || '';
    const text = row.textContent ?? '';
    const isFault = faultPosNos.some((pos) => pos && (partId === pos || text.includes(pos)));
    const lifeItem = lifeWarnings.find((w) => w.id && (partId === w.id || text.includes(w.id)));
    const isLowStock = lowStockPosNos.some((pos) => pos && (partId === pos || text.includes(pos)));

    if (isFault) row.classList.add('has-fault');
    if (lifeItem) row.classList.add('has-life-warn');
    if (isLowStock) row.classList.add('has-low-stock');
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
  /** 工单真实检修步骤（服务端由 repair_log.resolutionSteps 切分 + 逐行 BOM 匹配；沙箱内空数组 = 未填写） */
  steps?: ExplodedOrderStep[] | null;
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
  /** 内容列的内缩（默认铺满 `inset-0`，不留边） */
  className?: string;
  /** 工单上下文（检修工单「查看拆解视图」跳入时给） */
  workOrderBrief?: ExplodedViewWorkOrderContext | null;
  /** 要自动高亮定位的零件位号（来自工单上下文的服务端匹配结果） */
  targetPartPosNo?: string | null;
  /** 点击面板里的工单号 / 「返回工单详情」 */
  onOpenWorkOrder?: (orderId: string) => void;
  /** 设备遥测故障诊断（真实 equipment_telemetry 读数超标 → 拆解页红色脉冲定位观察部位） */
  faultInfo?: ExplodedFaultDiagnostics | null;
  /** 零件寿命预警（真实更换记录 × 运行时钟 → 拆解页黄/暗红寿命高亮 + 侧边汇总） */
  lifeInfo?: ExplodedPartLifeDiagnostics | null;
  /** 备件库存联动（spare_parts 真实台账 → 库存四要素 + 低库存采购申请） */
  inventoryInfo?: ExplodedPartInventoryDiagnostics | null;
  /** 库存面板「一键生成采购申请」→ App 切备件库存页并预填采购入库单 */
  onOpenProcure?: (prefill: SpareProcurePrefill) => void;
  /** 故障面板「创建维修工单」→ App 深链切换到工单页并预填建单表单 */
  onOpenWorkOrderCreate?: (prefill: WorkOrderCreatePrefill) => void;
  /** 检修报告导出人（当前登录用户名；来自会话，不造假） */
  exporterName?: string | null;
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

type ExplodedTabKey = 'parts' | 'history' | 'steps' | 'faults' | 'inventory';

/** 供拆解页内部给宿主回传选中位号用的回调容器（避免把 callback effect 化）。 */
type ReportRef = { current: (partId: string | null) => void };

export const ExplodedViewStage: React.FC<ExplodedViewStageProps> = ({
  deviceId,
  deviceName,
  deviceCode,
  onBack,
  className = 'inset-0',
  workOrderBrief = null,
  targetPartPosNo = null,
  onOpenWorkOrder,
  faultInfo = null,
  lifeInfo = null,
  inventoryInfo = null,
  onOpenProcure,
  onOpenWorkOrderCreate,
  exporterName = null,
}) => {
  const url = getExplodedViewUrl(deviceId);
  const title = `${deviceName ?? deviceId} · 设备拆解视图`;

  /* ---- 维修模式切换：平时普通模式，点击后进入高亮维修模式 ---- */
  const [maintenanceMode, setMaintenanceMode] = useState<boolean>(() => Boolean(workOrderBrief));

  /* ---- 侧边抽屉面板与标签页切换 ---- */
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => Boolean(workOrderBrief));
  const [activeTab, setActiveTab] = useState<ExplodedTabKey>(() => {
    if (workOrderBrief) return 'steps';
    if (faultInfo && faultInfo.faults.length > 0) return 'faults';
    return 'parts';
  });

  /* ---- 支持按 Escape 快速收起侧边工作台面板 ---- */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sidebarOpen) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sidebarOpen]);

  /* ---- 零件清单（从服务端聚合端点拉取 BOM） ---- */
  const [bomList, setBomList] = useState<MaintenanceReportBomRow[]>([]);
  const [bomLoading, setBomLoading] = useState(false);
  const [partSearch, setPartSearch] = useState('');
  const [partCategoryFilter, setPartCategoryFilter] = useState('ALL');

  /* ---- 零件选中态（iframe 桥上报，驱动左侧维修历史面板） ---- */
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [briefCollapsed, setBriefCollapsed] = useState(false);
  const [highlightTick, setHighlightTick] = useState(0);
  const [guideActiveStep, setGuideActiveStep] = useState<number | null>(null);
  /** 故障红色脉冲高亮的「观察部位」位号（页面原生 setFaultHighlight 的入参） */
  const [faultPartPosNo, setFaultPartPosNo] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // useRef 而非 useCallback 常驻：installIframeBridge 里闭包捕获的是 ref，桥内调用永远最新
  const reportRef: ReportRef = useRef<(partId: string | null) => void>(() => {});
  const suppressReportRef = useRef(false);
  reportRef.current = (partId) => {
    if (!suppressReportRef.current) setSelectedPartId(partId);
  };
  const quietHostAction = useCallback((act: () => void) => {
    suppressReportRef.current = true;
    try {
      act();
    } finally {
      window.setTimeout(() => {
        suppressReportRef.current = false;
      }, 400);
    }
  }, []);

  // 换设备：清选中态与折叠态，重拉 BOM
  useEffect(() => {
    setSelectedPartId(null);
    setBriefCollapsed(false);
    setGuideActiveStep(null);
    setFaultPartPosNo(null);
  }, [deviceId]);

  useEffect(() => {
    let alive = true;
    setBomLoading(true);
    explodedViewApi
      .getMaintenanceReport(deviceId)
      .then((data) => {
        if (!alive) return;
        setBomList(data.bom || []);
      })
      .catch(() => {
        if (!alive) return;
        setBomList([]);
      })
      .finally(() => {
        if (alive) setBomLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [deviceId]);

  /* ---- 检修报告导出（F7）：聚合端点取真实数据 + iframe 实时画面截图 → 前端组装 PDF ---- */
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const handleExportReport = useCallback(async () => {
    if (exportBusy) return;
    setExportBusy(true);
    setExportError(null);
    try {
      const report = await explodedViewApi.getMaintenanceReport(deviceId);
      let screenshot: string | null = null;
      try {
        const win = iframeRef.current?.contentWindow as (Window & { __EXPL_CAPTURE?: () => string | null }) | null;
        const dataUrl = win && typeof win.__EXPL_CAPTURE === 'function' ? win.__EXPL_CAPTURE() : null;
        screenshot = typeof dataUrl === 'string' ? dataUrl : null;
      } catch {
        screenshot = null;
      }
      await buildMaintenanceReportPdf(report, {
        exporterName: exporterName || '（未署名会话）',
        screenshotDataUrl: screenshot,
      });
    } catch (err: unknown) {
      setExportError(err instanceof Error && err.message ? err.message : '报告生成失败，请稍后重试');
    } finally {
      setExportBusy(false);
    }
  }, [exportBusy, deviceId, exporterName]);

  /* ---- 寿命预警（F5）：维修模式下经页面原生 setLifeAlert 下发黄/暗红高亮 ---- */
  useEffect(() => {
    const win = iframeRef.current?.contentWindow as (Window & Record<string, unknown>) | null;
    const fn = win?.['setLifeAlert'];
    if (typeof fn !== 'function') return;
    if (!maintenanceMode) {
      try {
        fn.call(win, []);
      } catch {
        /* noop */
      }
      return;
    }
    const entries = (lifeInfo?.parts ?? [])
      .filter((p) => p.status === 'nearing' || p.status === 'replace')
      .map((p) => ({ id: p.posNo, level: p.status === 'replace' ? ('replace' as const) : ('warn' as const) }));
    try {
      fn.call(win, entries);
    } catch {
      /* 页面未就绪时忽略 */
    }
  }, [lifeInfo, highlightTick, maintenanceMode]);

  const handleIframeLoad = useCallback((e: React.SyntheticEvent<HTMLIFrameElement>) => {
    const frame = e.currentTarget;
    hideBuiltinBackLink(frame);
    installIframeBridge(frame, (partId) => reportRef.current(partId));
    setHighlightTick((t) => t + 1);
  }, []);

  /* ---- 自动高亮定位工单目标零件 ---- */
  useEffect(() => {
    if (!targetPartPosNo || !iframeRef.current) return;
    quietHostAction(() => tryHighlightPart(iframeRef.current, targetPartPosNo));
  }, [targetPartPosNo, highlightTick, quietHostAction]);

  /* ---- 故障红色脉冲（F4）：维修模式下经页面原生 setFaultHighlight 下发 ---- */
  useEffect(() => {
    const win = iframeRef.current?.contentWindow as (Window & Record<string, unknown>) | null;
    if (!win) return;
    const fn = win['setFaultHighlight'];
    if (typeof fn === 'function') {
      try {
        fn.call(win, maintenanceMode ? faultPartPosNo : null);
      } catch {
        /* noop */
      }
    }
  }, [faultPartPosNo, highlightTick, maintenanceMode]);

  /* ---- 故障数据到位：自动记录第一观察部位 ---- */
  useEffect(() => {
    const primary = faultInfo?.faults[0]?.observationParts[0]?.posNo ?? null;
    setFaultPartPosNo(primary);
    if (primary && iframeRef.current && maintenanceMode) {
      quietHostAction(() => tryHighlightPart(iframeRef.current, primary));
    }
  }, [faultInfo, quietHostAction, maintenanceMode]);

  /* ---- 3D 浮动标签与 BOM 行角标打标联动 ---- */
  useEffect(() => {
    const faultPosNos: string[] = [];
    if (faultInfo?.faults) {
      for (const f of faultInfo.faults) {
        for (const obs of f.observationParts) {
          if (obs.posNo) faultPosNos.push(obs.posNo);
        }
      }
    }
    const lifeWarnings = (lifeInfo?.parts ?? [])
      .filter((p) => p.status === 'nearing' || p.status === 'replace')
      .map((p) => ({ id: p.posNo, level: p.status === 'replace' ? ('replace' as const) : ('warn' as const) }));

    const lowStockPosNos = (inventoryInfo?.parts ?? [])
      .filter((p) => p.inventory && ((p.inventory.shortage ?? 0) > 0 || p.inventory.low || (p.inventory.stock ?? 0) <= (p.inventory.safeStock ?? 0)))
      .map((p) => p.posNo);

    applyMaintenanceOverlayToIframe(
      iframeRef.current,
      maintenanceMode,
      faultPosNos,
      lifeWarnings,
      lowStockPosNos
    );
  }, [maintenanceMode, highlightTick, faultInfo, lifeInfo, inventoryInfo]);

  /* ---- 切换维修模式按钮动作 ---- */
  const handleToggleMaintenanceMode = useCallback(() => {
    setMaintenanceMode((prev) => {
      const next = !prev;
      if (next) {
        setSidebarOpen(true);
        if (faultInfo && faultInfo.faults.length > 0) {
          setActiveTab('faults');
        } else if (lifeInfo && lifeInfo.parts.some((p) => p.status === 'nearing' || p.status === 'replace')) {
          setActiveTab('faults');
        } else if (workOrderBrief) {
          setActiveTab('steps');
        } else {
          setActiveTab('parts');
        }
      }
      return next;
    });
  }, [faultInfo, lifeInfo, workOrderBrief]);

  /* ---- 寿命面板「定位查看」 ---- */
  const handleLifePartHighlight = useCallback(
    (posNo: string) => {
      if (iframeRef.current) {
        quietHostAction(() => tryHighlightPart(iframeRef.current, posNo));
      }
    },
    [quietHostAction]
  );

  /* ---- 故障面板「定位查看」 ---- */
  const handleFaultPartHighlight = useCallback(
    (posNo: string) => {
      setFaultPartPosNo(posNo);
      if (iframeRef.current) {
        quietHostAction(() => tryHighlightPart(iframeRef.current, posNo));
      }
    },
    [quietHostAction]
  );

  /* ---- 维修步骤指引：点步骤 → 高亮该步目标零件 + 播放页面原生拆解动画 ---- */
  const handleRunStep = useCallback(
    (step: ExplodedOrderStep) => {
      setGuideActiveStep(step.index);
      if (!step.matchedPart || !iframeRef.current) return;
      quietHostAction(() => {
        tryHighlightPart(iframeRef.current, step.matchedPart!.posNo);
        startExplodeAnimation(iframeRef.current);
      });
    },
    [quietHostAction]
  );

  /* ---- 零件分类与过滤 ---- */
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const b of bomList) {
      if (b.category) set.add(b.category);
    }
    return Array.from(set);
  }, [bomList]);

  const filteredBom = useMemo(() => {
    return bomList.filter((b) => {
      if (partCategoryFilter !== 'ALL' && b.category !== partCategoryFilter) return false;
      if (!partSearch.trim()) return true;
      const q = partSearch.trim().toLowerCase();
      return (
        b.posNo.toLowerCase().includes(q) ||
        b.name.toLowerCase().includes(q) ||
        (b.spec && b.spec.toLowerCase().includes(q)) ||
        (b.material && b.material.toLowerCase().includes(q))
      );
    });
  }, [bomList, partCategoryFilter, partSearch]);

  const faultCount = faultInfo?.faults.length ?? 0;
  const lifeCount = (lifeInfo?.parts ?? []).filter((p) => p.status === 'nearing' || p.status === 'replace').length;
  const shortageCount = inventoryInfo?.summary?.lowCount ?? (inventoryInfo?.parts ?? []).filter((p) => (p.inventory?.shortage ?? 0) > 0 || p.inventory?.low).length;

  return (
    /* ---- 背板：铺满整个主显示区域（3D 画面到此为止，高层级置顶） ---- */
    <div
      data-testid="equipment3d-exploded-stage"
      data-device-id={deviceId}
      className="absolute inset-0 bg-slate-950 z-40 overflow-hidden"
    >
      {/* ---- 主舞台面板：占满全屏，维修模式带高科技微光边框提示 ---- */}
      <div
        data-testid="equipment3d-exploded-panel"
        className={`absolute inset-0 flex flex-col overflow-hidden ${className}${
          maintenanceMode ? ' ring-1 ring-cyan-500/40 shadow-[inset_0_0_24px_rgba(6,182,212,0.12)]' : ''
        }`}
      >
        {/* ---- 专属独立顶栏：包含设备标识、维修模式激活提示与核心操作组，彻底消除与 iframe 原生工具栏的重叠冲突 ---- */}
        <header className="h-10 shrink-0 px-3 bg-slate-950/95 border-b border-cyan-500/30 flex items-center justify-between z-30 pointer-events-auto">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center">
              <Wrench className="w-3.5 h-3.5 text-cyan-400" />
            </div>
            <span className="text-xs font-bold text-slate-100 tracking-wide">3D 拆解与维修工作台</span>
            <span className="text-slate-600 text-xs">/</span>
            <span className="text-cyan-300 font-medium text-xs truncate max-w-[200px]">{deviceName ?? deviceId}</span>
            {deviceCode && (
              <span className="px-1.5 py-0.5 rounded bg-cyan-950/60 text-cyan-400 border border-cyan-500/30 text-[10px] font-mono">
                {deviceCode}
              </span>
            )}
            {maintenanceMode && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-200 border border-cyan-400/40 text-[10px] font-medium animate-pulse ml-1">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                维修模式已激活
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* 维修模式开关：深蓝底色 + 青色科技感（深色系一体化设计） */}
            <button
              type="button"
              data-testid="equipment3d-exploded-maintenance-toggle"
              onClick={handleToggleMaintenanceMode}
              title={maintenanceMode ? '点击退出维修模式，返回普通查看' : '进入维修模式：3D高亮故障与到期零件，展开维修工作台'}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold backdrop-blur shadow-[0_2px_10px_rgba(0,0,0,0.5)] transition-all cursor-pointer ${
                maintenanceMode
                  ? 'bg-cyan-950/90 hover:bg-cyan-900/90 text-cyan-200 border border-cyan-400 shadow-[0_0_14px_rgba(6,182,212,0.4)] ring-1 ring-cyan-400/50'
                  : 'bg-slate-900/90 hover:bg-slate-800/95 text-cyan-300 hover:text-cyan-100 border border-cyan-500/50 hover:border-cyan-400'
              }`}
            >
              <Wrench className="w-3.5 h-3.5 text-cyan-400" />
              <span>{maintenanceMode ? '🔧 退出维修模式' : '🔧 进入维修模式'}</span>
              {maintenanceMode && (
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse ml-0.5" />
              )}
            </button>

            {/* 导出检修报告 */}
            <button
              type="button"
              data-testid="equipment3d-exploded-export-report"
              onClick={handleExportReport}
              disabled={exportBusy}
              title="生成 PDF 检修报告（设备台账 / BOM / 故障 / 寿命 / 库存 / 维修历史，全部真实数据 + 3D 实时截图）"
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium border shadow-[0_2px_10px_rgba(0,0,0,0.5)] backdrop-blur transition-all ${
                exportBusy
                  ? 'opacity-60 cursor-wait text-slate-300 bg-slate-900/85 border-cyan-500/30'
                  : 'cursor-pointer text-emerald-200 bg-slate-900/85 hover:bg-slate-800/95 hover:text-white border-emerald-500/40 hover:border-emerald-400'
              }`}
            >
              <FileDown className="w-3.5 h-3.5" />
              <span>{exportBusy ? '生成中…' : '导出检修报告'}</span>
            </button>

            {exportError && (
              <span
                data-testid="equipment3d-exploded-export-error"
                title={exportError}
                className="max-w-[200px] truncate rounded-lg border border-rose-500/40 bg-rose-950/80 px-2 py-1 text-[11px] text-rose-200"
              >
                {exportError}
              </span>
            )}

            {/* 返回 3D 设备视图 */}
            <button
              type="button"
              data-testid="equipment3d-exploded-back"
              onClick={onBack}
              title="关闭拆解视图，回到 3D 设备模型"
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium text-cyan-200 bg-slate-900/85 hover:bg-slate-800/95 hover:text-white border border-cyan-500/40 hover:border-cyan-400 shadow-[0_2px_10px_rgba(0,0,0,0.5)] backdrop-blur transition-all cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>返回 3D 设备视图</span>
            </button>
          </div>
        </header>

        {/* ---- 3D 主视区：包裹侧边栏与 iframe，100% 占满顶栏下方的全部区域 ---- */}
        <div className="relative flex-1 min-h-0 w-full overflow-hidden">
          {/* ---- 左侧栏容器（收纳多余面板，支持折叠与 5 标签页切换） ---- */}
          <div
            data-testid="equipment3d-exploded-leftcol"
            className="absolute inset-0 pointer-events-none z-40 overflow-hidden"
          >
            {/* 折叠态侧边浮动把手：居中放置在左侧中间垂直区域，彻底不挡底部的交互指南与顶部的工具栏 */}
            {!sidebarOpen && (
              <aside
                aria-label="展开维修工作台"
                className="absolute left-3 top-1/2 -translate-y-1/2 z-40 flex flex-col gap-1.5 pointer-events-auto bg-slate-950/90 border border-cyan-500/40 rounded-xl p-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.7)] backdrop-blur"
              >
              <button
                type="button"
                data-testid="equipment3d-exploded-sidebar-toggle"
                onClick={() => setSidebarOpen(true)}
                title="展开零件与维修面板"
                className="p-2 rounded-lg bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/35 border border-cyan-400/50 flex items-center justify-center transition-all cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              <div className="h-px bg-white/10 my-0.5" />

              <button
                type="button"
                onClick={() => {
                  setActiveTab('parts');
                  setSidebarOpen(true);
                }}
                title="零件清单"
                className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors relative cursor-pointer"
              >
                <ListOrdered className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTab('history');
                  setSidebarOpen(true);
                }}
                title="维修历史"
                className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors relative cursor-pointer"
              >
                <History className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTab('steps');
                  setSidebarOpen(true);
                }}
                title="维修步骤"
                className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors relative cursor-pointer"
              >
                <Wrench className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTab('faults');
                  setSidebarOpen(true);
                }}
                title="故障提醒"
                className="p-2 rounded-lg text-rose-300 hover:text-rose-100 hover:bg-rose-500/20 transition-colors relative cursor-pointer"
              >
                <AlertTriangle className="w-4 h-4" />
                {(faultCount > 0 || lifeCount > 0) && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTab('inventory');
                  setSidebarOpen(true);
                }}
                title="备件库存"
                className="p-2 rounded-lg text-amber-300 hover:text-amber-100 hover:bg-amber-500/20 transition-colors relative cursor-pointer"
              >
                <Package className="w-4 h-4" />
                {shortageCount > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-500" />
                )}
              </button>

              {workOrderBrief && (
                <button
                  type="button"
                  data-testid="equipment3d-exploded-brief-chip"
                  onClick={() => {
                    setActiveTab('steps');
                    setSidebarOpen(true);
                  }}
                  className="mt-1 p-1.5 rounded-lg text-[10px] bg-cyan-500/20 text-cyan-200 border border-cyan-400/40 hover:bg-cyan-500/35 cursor-pointer text-center font-mono"
                  title={`工单 ${workOrderBrief.orderNo}`}
                >
                  工单
                </button>
              )}
            </aside>
          )}

          {/* 展开态侧边抽屉面板（5个独立标签页，不堆在一屏） */}
          {sidebarOpen && (
            <aside
              aria-label="设备拆解与维修工作台"
              className="absolute left-3 top-2.5 bottom-2.5 z-50 w-[390px] max-w-[calc(100vw-24px)] flex flex-col rounded-2xl bg-slate-950/95 border border-cyan-500/35 shadow-[0_16px_48px_rgba(0,0,0,0.75)] backdrop-blur-md overflow-hidden pointer-events-auto transition-all duration-300 ease-in-out"
            >
              {/* 抽屉卡头：标题 + 收起按钮 */}
              <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-cyan-500/20 bg-slate-900/80 shrink-0">
                <div className="flex items-center gap-2">
                  <Wrench className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs font-bold text-white tracking-wide">设备维修工作台</span>
                  {maintenanceMode && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-400/40">
                      维修模式
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setSidebarOpen(false)}
                  title="收起侧边面板 (Esc)"
                  className="p-1 px-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer flex items-center gap-1 text-[11px]"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>收起</span>
                </button>
              </div>

              {/* 5 独立标签页切换导航 */}
              <div className="grid grid-cols-5 p-1 gap-0.5 bg-slate-900/90 border-b border-white/10 text-[11px] shrink-0">
                <button
                  type="button"
                  data-testid="equipment3d-exploded-tab-parts"
                  onClick={() => setActiveTab('parts')}
                  className={`flex flex-col items-center justify-center py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                    activeTab === 'parts'
                      ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/50'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                  }`}
                  title="零件清单"
                >
                  <ListOrdered className="w-3.5 h-3.5 mb-0.5" />
                  <span>零件清单</span>
                </button>

                <button
                  type="button"
                  data-testid="equipment3d-exploded-tab-history"
                  onClick={() => setActiveTab('history')}
                  className={`flex flex-col items-center justify-center py-1.5 rounded-lg font-medium transition-colors cursor-pointer relative ${
                    activeTab === 'history'
                      ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/50'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                  }`}
                  title="维修历史"
                >
                  <History className="w-3.5 h-3.5 mb-0.5" />
                  <span>维修历史</span>
                  {selectedPartId && (
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 absolute top-1 right-1" />
                  )}
                </button>

                <button
                  type="button"
                  data-testid="equipment3d-exploded-tab-steps"
                  onClick={() => setActiveTab('steps')}
                  className={`flex flex-col items-center justify-center py-1.5 rounded-lg font-medium transition-colors cursor-pointer relative ${
                    activeTab === 'steps'
                      ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/50'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                  }`}
                  title="维修步骤"
                >
                  <Wrench className="w-3.5 h-3.5 mb-0.5" />
                  <span>维修步骤</span>
                  {workOrderBrief && (
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 absolute top-1 right-1" />
                  )}
                </button>

                <button
                  type="button"
                  data-testid="equipment3d-exploded-tab-faults"
                  onClick={() => setActiveTab('faults')}
                  className={`flex flex-col items-center justify-center py-1.5 rounded-lg font-medium transition-colors cursor-pointer relative ${
                    activeTab === 'faults'
                      ? 'bg-rose-500/25 text-rose-200 border border-rose-400/50'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                  }`}
                  title="故障提醒"
                >
                  <AlertTriangle className="w-3.5 h-3.5 mb-0.5" />
                  <span>故障提醒</span>
                  {(faultCount > 0 || lifeCount > 0) && (
                    <span className="absolute top-1 right-1.5 px-1 py-px rounded-full bg-rose-500 text-[8px] font-bold text-white">
                      {faultCount + lifeCount}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  data-testid="equipment3d-exploded-tab-inventory"
                  onClick={() => setActiveTab('inventory')}
                  className={`flex flex-col items-center justify-center py-1.5 rounded-lg font-medium transition-colors cursor-pointer relative ${
                    activeTab === 'inventory'
                      ? 'bg-amber-500/25 text-amber-200 border border-amber-400/50'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                  }`}
                  title="备件库存"
                >
                  <Package className="w-3.5 h-3.5 mb-0.5" />
                  <span>备件库存</span>
                  {shortageCount > 0 && (
                    <span className="absolute top-1 right-1.5 px-1 py-px rounded-full bg-amber-500 text-[8px] font-bold text-slate-950">
                      {shortageCount}
                    </span>
                  )}
                </button>
              </div>

              {/* 标签页主体内容区域：单屏聚焦一类功能 */}
              <div className="flex-1 overflow-y-auto overflow-x-hidden p-2.5 flex flex-col gap-2">
                {/* ──────────────── 标签 1：📋 零件清单 ──────────────── */}
                {activeTab === 'parts' && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
                      <span>零件物料总览 ({filteredBom.length}/{bomList.length})</span>
                      <span className="text-[10px] text-cyan-400">点击零件在 3D 模型聚焦</span>
                    </div>

                    {/* 搜索与分类快速过滤 */}
                    <div className="flex items-center gap-1.5">
                      <div className="relative flex-1">
                        <Search className="w-3 h-3 text-slate-500 absolute left-2 top-2" />
                        <input
                          type="text"
                          value={partSearch}
                          onChange={(e) => setPartSearch(e.target.value)}
                          placeholder="搜索零件名称或位号..."
                          className="w-full bg-slate-900 border border-white/10 rounded-lg pl-6 pr-2 py-1 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-cyan-400/60"
                        />
                      </div>
                      {categories.length > 0 && (
                        <select
                          value={partCategoryFilter}
                          onChange={(e) => setPartCategoryFilter(e.target.value)}
                          className="bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-xs text-slate-300 outline-none focus:border-cyan-400/60"
                        >
                          <option value="ALL">全部分类</option>
                          {categories.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    {/* 列表项 */}
                    {bomLoading ? (
                      <div className="py-8 text-center text-xs text-slate-400">正在拉取零件台账…</div>
                    ) : filteredBom.length === 0 ? (
                      <div className="py-8 text-center text-xs text-slate-500">未找到匹配零件</div>
                    ) : (
                      <div className="flex flex-col gap-1.5 max-h-[60vh] overflow-y-auto pr-1">
                        {filteredBom.map((part) => {
                          const isSelected = selectedPartId === part.posNo;
                          return (
                            <div
                              key={part.posNo}
                              onClick={() => {
                                quietHostAction(() => {
                                  if (iframeRef.current) tryHighlightPart(iframeRef.current, part.posNo);
                                });
                                setSelectedPartId(part.posNo);
                              }}
                              className={`p-2 rounded-xl border transition-all cursor-pointer flex flex-col gap-1 ${
                                isSelected
                                  ? 'bg-cyan-500/20 border-cyan-400/60 shadow-[0_0_12px_rgba(56,189,248,0.25)]'
                                  : 'bg-slate-900/60 hover:bg-slate-900/90 border-white/8 hover:border-cyan-500/30'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1.5">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 border border-cyan-500/30 shrink-0">
                                    {part.posNo}
                                  </span>
                                  <span className="text-xs font-semibold text-white truncate">
                                    {part.name}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  {part.flags.fault && (
                                    <span className="px-1.5 py-0.5 rounded bg-rose-500/25 border border-rose-500/50 text-[9px] font-bold text-rose-300">
                                      🔴 故障
                                    </span>
                                  )}
                                  {part.flags.lifeReplace && (
                                    <span className="px-1.5 py-0.5 rounded bg-rose-500/25 border border-rose-500/50 text-[9px] font-bold text-rose-300">
                                      🔴 待换
                                    </span>
                                  )}
                                  {part.flags.lifeNearing && !part.flags.lifeReplace && (
                                    <span className="px-1.5 py-0.5 rounded bg-amber-500/25 border border-amber-500/50 text-[9px] font-bold text-amber-300">
                                      🟡 到期
                                    </span>
                                  )}
                                  {part.flags.lowStock && (
                                    <span className="px-1.5 py-0.5 rounded bg-orange-500/25 border border-orange-500/50 text-[9px] font-bold text-orange-300">
                                      📦 缺件
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center justify-between text-[10px] text-slate-400">
                                <span>{part.category || '核心部件'}</span>
                                {part.material && <span className="truncate max-w-[150px]">{part.material}</span>}
                              </div>

                              <div className="flex items-center justify-between pt-1 border-t border-white/5 text-[10px]">
                                <span className="text-slate-500">点击聚焦 3D 零件</span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedPartId(part.posNo);
                                    setActiveTab('history');
                                  }}
                                  className="text-cyan-400 hover:text-cyan-200 cursor-pointer font-medium"
                                >
                                  查看维修历史 →
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* ──────────────── 标签 2：🛠️ 维修历史 ──────────────── */}
                {activeTab === 'history' && (
                  <div className="flex flex-col gap-2">
                    <ExplodedPartHistoryPanel
                      deviceId={deviceId}
                      posNo={selectedPartId}
                      onOpenWorkOrder={onOpenWorkOrder}
                      onClose={() => setSelectedPartId(null)}
                    />
                    {!selectedPartId && (
                      <div className="p-4 rounded-xl border border-cyan-500/30 bg-slate-900/60 text-slate-300 text-xs flex flex-col items-center justify-center text-center gap-2">
                        <History className="w-8 h-8 text-cyan-400/60" />
                        <div className="font-semibold text-white">暂未选择特定零件</div>
                        <p className="text-slate-400 text-[11px] leading-relaxed">
                          请在 3D 模型中点击零件，或在「零件清单」中点选，即可在此查看该零件的历史维修工单、耗用备件与更换记录。
                        </p>
                        <button
                          type="button"
                          onClick={() => setActiveTab('parts')}
                          className="mt-1 px-3 py-1.5 rounded-lg text-xs font-medium text-cyan-200 bg-cyan-500/20 hover:bg-cyan-500/35 border border-cyan-400/50 cursor-pointer"
                        >
                          前往选择零件
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* ──────────────── 标签 3：📝 维修步骤 ──────────────── */}
                {activeTab === 'steps' && (
                  <div className="flex flex-col gap-2">
                    {/* 工单上下文卡片 */}
                    {workOrderBrief ? (
                      briefCollapsed ? (
                        <button
                          type="button"
                          data-testid="equipment3d-exploded-brief-chip"
                          onClick={() => setBriefCollapsed(false)}
                          className="self-start inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-cyan-100 bg-slate-900/90 border border-cyan-500/40 hover:border-cyan-400 shadow cursor-pointer"
                        >
                          <Wrench className="w-3.5 h-3.5" />
                          工单 {workOrderBrief.orderNo}
                          {workOrderBrief.targetPart ? ` · ${workOrderBrief.targetPart.posNo} ${workOrderBrief.targetPart.name}` : ''}
                        </button>
                      ) : (
                        <div
                          data-testid="equipment3d-exploded-brief-card"
                          className="overflow-hidden rounded-xl border border-cyan-500/30 bg-slate-950/92 text-slate-200 shadow-md backdrop-blur"
                        >
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

                          <div className="max-h-[25vh] overflow-y-auto px-3 py-2 text-[11px] leading-relaxed">
                            <div className="text-[12px] font-semibold text-white">{workOrderBrief.title}</div>
                            {workOrderBrief.description && (
                              <div className="mt-0.5 line-clamp-2 text-slate-400">{workOrderBrief.description}</div>
                            )}

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

                          <button
                            type="button"
                            data-testid="equipment3d-exploded-brief-open-order"
                            onClick={() => onOpenWorkOrder?.(workOrderBrief.id)}
                            className="border-t border-white/10 bg-slate-900/70 px-3 py-2 text-left text-[11px] font-medium text-cyan-300 transition hover:bg-cyan-500/15 hover:text-cyan-100 cursor-pointer w-full"
                          >
                            ← 返回工单详情
                          </button>
                        </div>
                      )
                    ) : null}

                    {/* 维修步骤指引 */}
                    {workOrderBrief ? (
                      <MaintenanceStepGuidePanel
                        orderId={workOrderBrief.id}
                        steps={workOrderBrief.steps ?? null}
                        activeStepIndex={guideActiveStep}
                        onRunStep={handleRunStep}
                      />
                    ) : (
                      <div className="p-4 rounded-xl border border-cyan-500/30 bg-slate-900/60 text-slate-300 text-xs flex flex-col gap-2.5">
                        <div className="flex items-center gap-2 text-white font-semibold">
                          <Wrench className="w-4 h-4 text-cyan-400" />
                          <span>标准作业步骤指引</span>
                        </div>
                        <p className="text-slate-400 text-[11px] leading-relaxed">
                          当前处于自由检修浏览模式。若需具体工单指引，请在「故障提醒」标签中点击「创建维修工单」，或在检修工单中点击「查看拆解视图」。
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            if (iframeRef.current) startExplodeAnimation(iframeRef.current);
                          }}
                          className="mt-1 px-3 py-2 rounded-lg text-xs font-semibold bg-cyan-500/20 text-cyan-100 border border-cyan-400/50 hover:bg-cyan-500/35 transition cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-cyan-300" />
                          <span>▶ 播放标准五级拆解演示</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* ──────────────── 标签 4：⚠️ 故障提醒 ──────────────── */}
                {activeTab === 'faults' && (
                  <div className="flex flex-col gap-2">
                    {faultInfo ? (
                      <ExplodedFaultPanel
                        fault={faultInfo}
                        highlightedPosNo={faultPartPosNo}
                        onHighlightPart={handleFaultPartHighlight}
                        onCreateWorkOrder={onOpenWorkOrderCreate}
                      />
                    ) : null}

                    {lifeInfo && lifeInfo.parts.length > 0 ? (
                      <ExplodedPartLifePanel
                        life={lifeInfo}
                        onHighlightPart={handleLifePartHighlight}
                        onCreateMaintenanceWorkOrder={onOpenWorkOrderCreate}
                      />
                    ) : null}

                    {!faultInfo && (!lifeInfo || lifeInfo.parts.length === 0) && (
                      <div className="p-6 rounded-xl border border-emerald-500/30 bg-emerald-950/20 text-emerald-300 text-xs flex flex-col items-center justify-center text-center gap-2">
                        <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                        <div className="font-semibold text-white">遥测指标良好，无部件故障报警</div>
                        <p className="text-slate-400 text-[11px]">
                          该设备各点位温度、振动传感器读数均在正常阈值范围内，且关键运动部件处于额定寿命安全期。
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* ──────────────── 标签 5：📦 备件库存 ──────────────── */}
                {activeTab === 'inventory' && (
                  <div className="flex flex-col gap-2">
                    {inventoryInfo && inventoryInfo.parts.length > 0 ? (
                      <ExplodedPartInventoryPanel
                        inventory={inventoryInfo}
                        onOpenProcure={onOpenProcure}
                      />
                    ) : (
                      <div className="p-6 rounded-xl border border-emerald-500/30 bg-emerald-950/20 text-emerald-300 text-xs flex flex-col items-center justify-center text-center gap-2">
                        <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                        <div className="font-semibold text-white">易损备件库存充足</div>
                        <p className="text-slate-400 text-[11px]">
                          当前拆解视图对应各部件均有安全库存储备，暂无短缺缺口。
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </aside>
          )}
        </div>

        {/* ---- 拆解页本体：100% 占满可用区域 ---- */}
        {url ? (
          <iframe
            key={deviceId}
            ref={iframeRef}
            data-testid="equipment3d-exploded-iframe"
            src={url}
            title={title}
            onLoad={handleIframeLoad}
            className="w-full h-full min-h-0 border-0 bg-slate-950 block"
            sandbox="allow-scripts allow-same-origin allow-downloads"
            referrerPolicy="no-referrer"
            allow="fullscreen"
          />
        ) : (
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
    </div>
  );
};

export default ExplodedViewStage;
