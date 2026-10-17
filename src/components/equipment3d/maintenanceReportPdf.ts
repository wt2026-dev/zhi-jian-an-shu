/**
 * 检修报告 PDF 生成（拆解视图 F7）。
 *
 * ## 技术口径
 *   · 版面用离屏 Canvas 2D 绘制（A4 210×297mm，150dpi → 1240×1754 像素/页），
 *     再逐页 addImage 进 jsPDF：中文渲染交给系统字体（canvas fillText），
 *     不依赖 jsPDF 内置字体（标准 14 字体不含 CJK，中文必然乱码），也避免
 *     强推一个十几 MB 的中文字体包。150dpi 满足 A4 现场打印清晰度。
 *   · 3D 截图：调用方从已打开的拆解 iframe 里取真实画面 PNG dataURL
 *     （页面暴露 __EXPL_CAPTURE；渲染器已补 preserveDrawingBuffer），本模块
 *     只负责等比安放进「设备信息页」，拿不到截图时如实写明，不用占位图。
 *   · 数据全部来自服务端 /maintenance-report 聚合端点（真实台账/遥测/完工单），
 *     本模块不做数据发明：字段缺失显示"—"，建议为空如实写"当前无"。
 */
import { jsPDF } from 'jspdf';
import type { MaintenanceReportData, MaintenanceReportBomRow } from '../../api';

/* A4 几何：mm 与 px（150dpi） */
const PAGE_W_MM = 210;
const PAGE_H_MM = 297;
const PAGE_W_PX = 1240;
const PAGE_H_PX = 1754;
const PX_PER_MM = PAGE_W_PX / PAGE_W_MM;

interface DrawCtx {
  pdf: jsPDF;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  y: number;
}

/** 截图载荷：调用方把 iframe 画面解码成 HTMLImageElement 后传入 */
export interface ReportScreenshot {
  image: HTMLImageElement;
  naturalW: number;
  naturalH: number;
}

const MARGIN = 64;
const CONTENT_W = PAGE_W_PX - MARGIN * 2;
const BOTTOM = PAGE_H_PX - 80;
const FONT_STACK = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
const CINK = '#0f172a';
const CKEY = '#334155';
const CMUT = '#64748b';
const CACCENT = '#0369a1';
const C_HEAD_BG = '#0c4a6e';
const C_HEAD_FG = '#f0f9ff';
const CBAND = '#f1f5f9';

/* ---------------- 基础绘制工具 ---------------- */
function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(digits);
}

function statusText(s: string): string {
  const map: Record<string, string> = {
    running: '运行中',
    stopped: '已停机',
    maintenance: '检修中',
    fault: '故障',
    idle: '待机',
    offline: '离线',
  };
  return map[s] ?? (s || '—');
}

/** 按字体宽度换行（CJK 逐字口径） */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number, font: string): string[] {
  ctx.font = font;
  const lines: string[] = [];
  let cur = '';
  for (const ch of text) {
    if (cur && ctx.measureText(cur + ch).width > maxW) {
      lines.push(cur);
      cur = '';
    }
    cur += ch;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/* ---------------- 页面构件 ---------------- */
/** 翻新整页：白底 + 页眉 + 页脚（页码事后统一盖） */
function newPage(draw: DrawCtx, report: MaintenanceReportData, title: string): void {
  const { ctx } = draw;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE_W_PX, PAGE_H_PX);
  ctx.fillStyle = C_HEAD_BG;
  ctx.fillRect(0, 0, PAGE_W_PX, 88);
  ctx.font = `bold 30px ${FONT_STACK}`;
  ctx.fillStyle = C_HEAD_FG;
  ctx.fillText(title, MARGIN, 56);
  ctx.font = `normal 20px ${FONT_STACK}`;
  ctx.textAlign = 'right';
  ctx.fillText(`${report.device.name}（${report.device.code}）`, PAGE_W_PX - MARGIN, 56);
  ctx.textAlign = 'left';
  draw.y = 124;
}

/** 小节标题 */
function sectionTitle(draw: DrawCtx, text: string): void {
  draw.y += 14;
  draw.ctx.fillStyle = CACCENT;
  draw.ctx.fillRect(MARGIN, draw.y, 6, 30);
  draw.ctx.fillStyle = CINK;
  draw.ctx.font = `bold 26px ${FONT_STACK}`;
  draw.ctx.fillText(text, MARGIN + 18, draw.y + 24);
  draw.y += 46;
}

/** 键值网格（n 列布局，自动分块） */
function drawKeyValueGrid(draw: DrawCtx, rows: Array<[string, string]>, columns: number): void {
  const colW = Math.floor(CONTENT_W / columns);
  for (const group of chunk(rows, columns)) {
    const cellH = 48;
    for (let c = 0; c < columns; c++) {
      const kv = group[c];
      if (!kv) break;
      const x = MARGIN + c * colW;
      draw.ctx.fillStyle = CBAND;
      draw.ctx.fillRect(x + 2, draw.y, colW - 10, cellH);
      draw.ctx.fillStyle = CKEY;
      draw.ctx.font = `normal 15px ${FONT_STACK}`;
      draw.ctx.fillText(String(kv[0]), x + 14, draw.y + 20);
      draw.ctx.fillStyle = CINK;
      draw.ctx.font = `bold 15px ${FONT_STACK}`;
      const val = String(kv[1]);
      draw.ctx.fillText(val.length > 24 ? val.slice(0, 24) + '…' : val, x + 14, draw.y + 40);
    }
    draw.y += cellH + 6;
  }
}

/* ---------------- BOM 表格 ---------------- */
const BOM_COLS_INIT: Array<{ label: string; w: number; align?: 'left' | 'center' | 'right' }> = [
  { label: '位号', w: 78 },
  { label: '零件名称', w: 236 },
  { label: '规格', w: 210 },
  { label: '材质', w: 186, align: 'center' },
  { label: '数量', w: 52, align: 'right' },
  { label: '重量(kg)', w: 80, align: 'right' },
  { label: '标注', w: 218, align: 'center' },
];
const BOM_COLS = BOM_COLS_INIT.reduce<Array<{ label: string; x: number; w: number; align?: 'left' | 'center' | 'right' }>>(
  (acc, c) => [...acc, { ...c, x: acc.reduce((a, p) => a + p.w, 0) }],
  []
);

function bomCellText(row: MaintenanceReportBomRow, ci: number): string {
  switch (ci) {
    case 0: return row.posNo;
    case 1: return row.name;
    case 2: return row.spec || '—';
    case 3: return row.material || '—';
    case 4: return row.qty != null ? String(row.qty) : '—';
    case 5: return row.weight != null ? fmtNum(row.weight) : '—';
    default: return bomMarks(row) || '—';
  }
}

/** 标注列：●故障／●到期／●临近／●缺件（真实台账/遥测/寿命判定） */
function bomMarks(row: MaintenanceReportBomRow): string {
  const marks: string[] = [];
  if (row.flags.fault) marks.push('●故障');
  if (row.flags.lifeReplace) marks.push('●到期');
  else if (row.flags.lifeNearing) marks.push('●临近');
  if (row.flags.lowStock) marks.push('●缺件');
  return marks.join(' ');
}

function bomFont(ci: number): string {
  if (ci === 0) return `bold 16px ${FONT_STACK}`;
  if (ci === 1) return `bold 16px ${FONT_STACK}`;
  return `normal 16px ${FONT_STACK}`;
}

function bomWrap(ctx: CanvasRenderingContext2D, row: MaintenanceReportBomRow): string[][] {
  return BOM_COLS.map((col, ci) => wrapText(ctx, bomCellText(row, ci), col.w - 20, bomFont(ci)));
}

function drawBomHead(draw: DrawCtx): void {
  draw.ctx.fillStyle = C_HEAD_BG;
  draw.ctx.fillRect(MARGIN, draw.y, CONTENT_W, 40);
  draw.ctx.fillStyle = C_HEAD_FG;
  draw.ctx.font = `bold 18px ${FONT_STACK}`;
  for (const col of BOM_COLS) {
    const x = MARGIN + col.x;
    draw.ctx.textAlign = col.align === 'right' ? 'right' : 'left';
    draw.ctx.fillText(col.label, col.align === 'right' ? x + col.w - 10 : x + 10, draw.y + 27);
  }
  draw.ctx.textAlign = 'left';
  draw.y += 44;
}

function drawBomRow(draw: DrawCtx, row: MaintenanceReportBomRow, zebra: boolean, prewrapped?: string[][]): void {
  const wrapped = prewrapped ?? bomWrap(draw.ctx, row);
  const lineH = 22;
  const rowH = Math.max(38, Math.max(...wrapped.map((w) => w.length)) * lineH + 16);
  if (zebra) {
    draw.ctx.fillStyle = CBAND;
    draw.ctx.fillRect(MARGIN, draw.y, CONTENT_W, rowH);
  }
  BOM_COLS.forEach((col, ci) => {
    const lines = wrapped[ci];
    draw.ctx.fillStyle = ci <= 1 ? CINK : CKEY;
    draw.ctx.font = bomFont(ci);
    draw.ctx.textAlign = col.align === 'right' ? 'right' : 'left';
    const x = MARGIN + col.x;
    const xDraw = col.align === 'right' ? x + col.w - 10 : x + 10;
    lines.forEach((ln, li) => {
      draw.ctx.fillText(ln, xDraw, draw.y + 26 + li * lineH);
    });
  });
  draw.ctx.textAlign = 'left';
  draw.y += rowH + 2;
}

function drawBomLegend(draw: DrawCtx): void {
  const lines = wrapText(draw.ctx, '标注图例：●故障＝遥测读数达阈值（未处理故障观察部位）；●到期＝寿命已到更换线；●临近＝寿命低于预警线；●缺件＝备件台账库存≤预警阈值。数量/重量为拆解页出厂标注，"—"＝页面未标注。', CONTENT_W, `17px ${FONT_STACK}`);
  for (const ln of lines) {
    draw.ctx.fillStyle = CMUT;
    draw.ctx.font = `17px ${FONT_STACK}`;
    draw.ctx.fillText(ln, MARGIN, draw.y + 20);
    draw.y += 26;
  }
  draw.y += 6;
}

/* ---------------- 维修历史 ---------------- */
interface HistoryHit {
  orderNo: string;
  title: string;
  faultType: string | null;
  completedAt: string | null;
  causeAnalysis: string | null;
  resolutionSteps: string | null;
  usedParts: Array<{ name: string; code: string; spec: string; qty: number; unit: string }> | null;
}

function historyPartsText(h: HistoryHit): string {
  if (h.usedParts && h.usedParts.length) {
    return `更换备件：${h.usedParts.map((u) => `${u.name}${u.spec ? `（${u.spec}）` : ''}×${u.qty}${u.unit || ''}`).join('，')}`;
  }
  return '更换备件：完工单未登记备件耗用（如实展示）';
}

function historyWrap(ctx: CanvasRenderingContext2D, h: HistoryHit): { head: string; lines: string[][] } {
  const head = `${h.orderNo} · ${h.completedAt ? fmtDateTime(h.completedAt) : '完工时间不详'}${h.faultType ? ' · ' + h.faultType : ''}`;
  return {
    head,
    lines: [
      wrapText(ctx, h.title || '（无标题）', CONTENT_W - 40, `bold 16px ${FONT_STACK}`),
      h.causeAnalysis ? wrapText(ctx, `根本原因：${h.causeAnalysis}`, CONTENT_W - 40, `normal 15px ${FONT_STACK}`) : [],
      h.resolutionSteps ? wrapText(ctx, `作业步骤：${h.resolutionSteps}`, CONTENT_W - 40, `normal 15px ${FONT_STACK}`) : [],
      wrapText(ctx, historyPartsText(h), CONTENT_W - 40, `normal 15px ${FONT_STACK}`),
    ],
  };
}

function drawHistoryRow(draw: DrawCtx, h: HistoryHit, zebra: boolean, precached?: { head: string; lines: string[][] }): void {
  const lineH = 22;
  const lines = precached ?? historyWrap(draw.ctx, h);
  const textLines = lines.lines;
  const bodyH = textLines.reduce((acc, blk) => acc + blk.length, 0) * lineH;
  const rowH = 26 + bodyH + 14;
  if (zebra) {
    draw.ctx.fillStyle = CBAND;
    draw.ctx.fillRect(MARGIN, draw.y, CONTENT_W, rowH);
  }
  draw.ctx.fillStyle = CACCENT;
  draw.ctx.font = `bold 15px ${FONT_STACK}`;
  draw.ctx.fillText(lines.head, MARGIN + 12, draw.y + 20);
  draw.y += 28;
  const colors = [CINK, CKEY, CKEY, CMUT];
  const fonts = [`bold 16px ${FONT_STACK}`, `normal 15px ${FONT_STACK}`, `normal 15px ${FONT_STACK}`, `normal 15px ${FONT_STACK}`];
  textLines.forEach((blk, bi) => {
    for (const ln of blk) {
      draw.ctx.fillStyle = colors[bi];
      draw.ctx.font = fonts[bi];
      draw.ctx.fillText(ln, MARGIN + 20, draw.y + 20);
      draw.y += lineH;
    }
  });
  draw.y += 10;
}

/* ---------------- 维修建议 ---------------- */
function drawBulleted(draw: DrawCtx, items: string[]): void {
  for (const item of items) {
    const lines = wrapText(draw.ctx, item, CONTENT_W - 8, `normal 17px ${FONT_STACK}`);
    lines.forEach((ln, li) => {
      draw.ctx.fillStyle = CINK;
      draw.ctx.font = `normal 17px ${FONT_STACK}`;
      draw.ctx.fillText((li === 0 ? '· ' : '  ') + ln, MARGIN + 8, draw.y + 24);
      draw.y += 28;
    });
    draw.y += 4;
  }
}

function drawRecommendations(draw: DrawCtx, report: MaintenanceReportData): void {
  const rec = report.recommendations;
  sectionTitle(draw, '① 现在就需要维修/更换');
  if (rec.mustReplaceNow.length === 0) {
    drawText(draw, '当前无（没有遥测故障观察部位，也没有寿命到期的零件）——不造建议。', MARGIN, CONTENT_W, 18, CMUT);
  } else {
    drawBulleted(draw, rec.mustReplaceNow.map((r) => `${r.posNo} ${r.name} —— ${r.reason}`));
  }
  sectionTitle(draw, '② 建议近期安排保养');
  if (rec.scheduleSoon.length === 0) {
    drawText(draw, '当前无（没有临近寿命阈值的零件）。', MARGIN, CONTENT_W, 18, CMUT);
  } else {
    drawBulleted(draw, rec.scheduleSoon.map((r) => `${r.posNo} ${r.name} —— ${r.reason}`));
  }
  sectionTitle(draw, '③ 库存不足提醒（采购/调拨）');
  if (rec.stockShortages.length === 0) {
    drawText(draw, '当前无（相关备件在台账中均高于预警阈值）。', MARGIN, CONTENT_W, 18, CMUT);
  } else {
    drawBulleted(draw, rec.stockShortages.map((r) => `${r.posNo} ${r.name} —— 缺口 ${fmtNum(r.shortage, 0)} 件${r.location ? `，存放于 ${r.location}` : ''}（详见备件台账）`));
  }
  if (report.faults.length > 0) {
    sectionTitle(draw, '④ 遥测故障概要（真实读数 × 报警阈值）');
    for (const f of report.faults) {
      const sev = f.severity === 'critical' ? '严重' : f.severity === 'fault' ? '故障' : '预警';
      drawText(draw, `${f.metricLabel}：当前 ${fmtNum(f.value)} ${f.unit}，阈值 ${fmtNum(f.warningThreshold)} ${f.unit}（${sev}）。建议：${f.suggestion || '（无建议字段）'}`, MARGIN, CONTENT_W, 17, CKEY);
      draw.y += 6;
    }
  }
}

/** 单行（或已定长）直接文本，返回占用高度 */
function drawText(draw: DrawCtx, text: string, x: number, w: number, size: number, color: string, bold = false): number {
  const lines = wrapText(draw.ctx, text, w, `${bold ? 'bold ' : ''}${size}px ${FONT_STACK}`);
  const lineH = Math.round(size * 1.5);
  draw.ctx.fillStyle = color;
  for (const ln of lines) {
    draw.ctx.font = `${bold ? 'bold ' : ''}${size}px ${FONT_STACK}`;
    draw.ctx.fillText(ln, x, draw.y + 24);
    draw.y += lineH;
  }
  return lines.length * lineH;
}

/* ---------------- 各页内容 ---------------- */
/** 封面（第 1 页）：标题 + 设备三行档案 + 生成时间/导出人 + 数据出处声明 */
function drawCover(draw: DrawCtx, report: MaintenanceReportData, exporterName: string): void {
  const { ctx } = draw;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE_W_PX, PAGE_H_PX);
  ctx.fillStyle = C_HEAD_BG;
  ctx.fillRect(0, 0, PAGE_W_PX, 18);
  ctx.fillRect(0, PAGE_H_PX - 18, PAGE_W_PX, 18);
  ctx.textAlign = 'center';
  ctx.fillStyle = CINK;
  ctx.font = `bold 52px ${FONT_STACK}`;
  ctx.fillText(`《${report.device.name}设备检修拆解报告》`, PAGE_W_PX / 2, 236);
  ctx.font = `normal 24px ${FONT_STACK}`;
  ctx.fillStyle = CMUT;
  ctx.fillText(`型号 ${report.device.model || '—'} · ${report.device.category || ''}${report.device.manufacturer ? ' · ' + report.device.manufacturer : ''}`, PAGE_W_PX / 2, 284);

  const cardW = 700;
  const rows: Array<[string, string]> = [
    ['设备名称', report.device.name || '—'],
    ['设备编号', report.device.code || '—'],
    ['所属车间', report.device.workshop || '—'],
    ['安装位置', report.device.location || '—'],
    ['报告生成时间', fmtDateTime(report.generatedAt)],
    ['导出人', exporterName || '—'],
  ];
  let ry = 372;
  for (const [k, v] of rows) {
    ctx.textAlign = 'left';
    ctx.font = `normal 24px ${FONT_STACK}`;
    ctx.fillStyle = CKEY;
    ctx.fillText(k, PAGE_W_PX / 2 - cardW / 2, ry);
    ctx.font = `bold 24px ${FONT_STACK}`;
    ctx.fillStyle = CINK;
    ctx.fillText(v, PAGE_W_PX / 2 - cardW / 2 + 250, ry);
    ry += 58;
  }
  // 数据出处声明（真实、无占位）
  ctx.textAlign = 'center';
  ctx.font = `normal 16px ${FONT_STACK}`;
  ctx.fillStyle = CMUT;
  const note = wrapText(ctx, `数据出处：${report.dataNote}`, 940, `normal 16px ${FONT_STACK}`);
  let ny = PAGE_H_PX - 96 - note.length * 26;
  for (const line of note) {
    ctx.fillText(line, PAGE_W_PX / 2, ny);
    ny += 26;
  }
  ctx.textAlign = 'left';
}

/** 设备基本信息页：台账档案 + 主要参数 + 3D 实时截图 */
function drawDeviceInfo(draw: DrawCtx, report: MaintenanceReportData, shot: ReportScreenshot | null): void {
  sectionTitle(draw, '设备基本信息（设备台账）');
  const kv: Array<[string, string]> = [
    ['设备型号', report.device.model || '—'],
    ['设备类别', report.device.category || '—'],
    ['制造厂商', report.device.manufacturer || '—'],
    ['所属车间', report.device.workshop || '—'],
    ['安装位置', report.device.location || '—'],
    ['投运日期', report.device.installDate ? report.device.installDate.slice(0, 10) : '—'],
    ['当前运行状态', statusText(report.device.status)],
    ['健康度评分', report.device.healthScore != null ? `${fmtNum(report.device.healthScore, 0)} / 100` : '—'],
    ['关键等级', report.device.criticality || '—'],
    ['下次点检', report.device.nextInspectionDate ? report.device.nextInspectionDate.slice(0, 10) : '—'],
  ];
  drawKeyValueGrid(draw, kv, 2);

  if (report.device.specs.length > 0) {
    sectionTitle(draw, '主要技术参数（台账 specs 原样）');
    drawKeyValueGrid(draw, report.device.specs.map((s) => [s.label, s.value || '—']), 2);
  }

  sectionTitle(draw, '3D 拆解视图截图（导出时的实时画面）');
  if (shot) {
    const w = CONTENT_W;
    const h = Math.min(Math.round((w * shot.naturalH) / shot.naturalW), 860);
    const wMm = w / PX_PER_MM;
    const hMm = h / PX_PER_MM;
    draw.pdf.addImage(shot.image, 'PNG', MARGIN / PX_PER_MM, draw.y / PX_PER_MM, wMm, hMm);
    // 截图直接贴进 PDF；画布只负责说明文字（不压图）
    draw.y += h + 18;
    drawText(draw, '截图说明：来自拆解页渲染画面（导出时刻），非示意占位图。', MARGIN, CONTENT_W, 16, CMUT);
  } else {
    drawText(draw, '截图不可用：导出时无法从拆解页取得实时画面（页面未完成初始化或上下文受限）——本报告不放示意占位图。', MARGIN, CONTENT_W, 18, CMUT);
  }
}

/* ---------------- 主流程 ---------------- */
export interface ReportPdfOptions {
  /** 导出人（当前登录用户名，来自前端会话，不造假） */
  exporterName: string;
  /** iframe 捕获的画面 PNG dataURL（可能为 null → 报告如实标注"截图不可用"） */
  screenshotDataUrl: string | null;
  fileName?: string;
}

/** 把 dataURL 解码成可用于 addImage 的 HTMLImageElement（拿不到返回 null） */
function decodeScreenshot(dataUrl: string | null): Promise<ReportScreenshot | null> {
  return new Promise((resolve) => {
    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () => resolve({ image: img, naturalW: img.naturalWidth || PAGE_W_PX, naturalH: img.naturalHeight || 700 });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function measureBomRowHeight(ctx: CanvasRenderingContext2D, row: MaintenanceReportBomRow): number {
  const wrapped = bomWrap(ctx, row);
  const lineH = 22;
  return Math.max(38, Math.max(...wrapped.map((w) => w.length)) * lineH + 16) + 2;
}

function measureHistoryHeight(ctx: CanvasRenderingContext2D, h: HistoryHit): number {
  const lineH = 22;
  const lines = historyWrap(ctx, h);
  const bodyH = lines.lines.reduce((acc, blk) => acc + blk.length, 0) * lineH;
  return 26 + bodyH + 14 + 10;
}

/**
 * 生成并下载检修报告 PDF（A4 竖版）。返回 PDF 页数。
 * 流程：封面 → 设备信息页（含 3D 实时截图）→ BOM 清单（多页）→ 维修历史（多页）
 * → 维修建议；页脚页码在装订后统一补写（jsPDF 矢量文本，任何查看器都清晰）。
 */
export async function buildMaintenanceReportPdf(report: MaintenanceReportData, opts: ReportPdfOptions): Promise<number> {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W_PX;
  canvas.height = PAGE_H_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建离屏画布（当前环境不支持 Canvas 2D）');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  const draw: DrawCtx = { pdf, canvas, ctx, y: 0 };
  const title = `${report.device.name}设备检修拆解报告`;
  const shot = await decodeScreenshot(opts.screenshotDataUrl);

  const stamp = (): void => {
    pdf.addImage(canvas, 'PNG', 0, 0, PAGE_W_MM, PAGE_H_MM);
  };

  // ---- 封面 ----
  drawCover(draw, report, opts.exporterName);
  stamp();

  // ---- 设备基本信息页 ----
  pdf.addPage();
  newPage(draw, report, title);
  drawDeviceInfo(draw, report, shot);
  stamp();

  // ---- BOM 页（内容自适应，向下溢出即翻页） ----
  if (report.bom.length > 0) {
    const turnToBomContinuation = (): void => {
      stamp();
      pdf.addPage();
      newPage(draw, report, title);
      sectionTitle(draw, '零件清单（BOM）· 续');
      drawBomHead(draw);
      drawBomLegend(draw);
    };
    pdf.addPage();
    newPage(draw, report, title);
    sectionTitle(draw, '零件清单（BOM）· 拆解页 PARTS 原样数据');
    drawBomHead(draw);
    drawBomLegend(draw);
    let zebra = false;
    for (const row of report.bom) {
      const rowH = measureBomRowHeight(ctx, row);
      if (draw.y + rowH > BOTTOM) {
        turnToBomContinuation();
        zebra = false;
      }
      const precached = bomWrap(ctx, row);
      drawBomRow(draw, row, zebra, precached);
      zebra = !zebra;
    }
    stamp();
  }

  // ---- 维修历史页 ----
  if (report.history.length > 0) {
    pdf.addPage();
    newPage(draw, report, title);
    sectionTitle(draw, '维修历史记录（已完工单 × repair_log）');
    let zebra = false;
    for (const h of report.history) {
      const precached = historyWrap(ctx, h);
      const rowH = measureHistoryHeight(ctx, h);
      if (draw.y + rowH > BOTTOM) {
        stamp();
        pdf.addPage();
        newPage(draw, report, title);
        sectionTitle(draw, '维修历史记录 · 续');
        zebra = false;
      }
      drawHistoryRow(draw, h, zebra, precached);
      zebra = !zebra;
    }
    stamp();
  }

  // ---- 维修建议页 ----
  pdf.addPage();
  newPage(draw, report, title);
  drawRecommendations(draw, report);
  stamp();

  // ---- 装订后补页脚（矢量文字，任何 PDF 查看器/打印机都清晰） ----
  const total = pdf.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    pdf.setPage(p);
    pdf.setFillColor(255, 255, 255);
    pdf.rect(0, PAGE_H_MM - 12, PAGE_W_MM, 12, 'F');
    pdf.setFontSize(9);
    pdf.setTextColor(110, 122, 138);
    pdf.text(`第 ${p} / ${total} 页`, PAGE_W_MM - 14, PAGE_H_MM - 4, { align: 'right' });
  }

  const fileName = opts.fileName
    || `检修拆解报告_${report.device.name}_${report.device.code}_${fmtDateTime(report.generatedAt).replace(/[^\d-]+/g, '')}.pdf`;
  pdf.save(fileName);
  return total;
}
