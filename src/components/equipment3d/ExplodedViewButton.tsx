/**
 * 「打开拆解视图」按钮 —— 设备详情面板里唯一的拆解视图入口。
 *
 * 口径（2026-10-16 用户规格，第二次变更）：**不在右侧面板里嵌 iframe，也不新开标签页**，
 * 而是请求宿主（`EquipmentScene`）在**当前页面内**把中间那块显示 3D 设备模型的区域
 * 换成拆解视图 HTML（那 9 份是自带 three.js 的完整单页），右上角给「返回 3D 设备视图」。
 * 设备 ID → 文件名映射见 `explodedViewFiles.ts`；宿主未注册时那里才有新标签页兜底。
 *
 * 因此本按钮的文案/图标**不能**再暗示"新标签页"：`title` 说的是页面内的行为，
 * 图标用「就地展开」语义。文案与实际行为不一致时，用户会以为功能坏了（这正是
 * 2026-10-16 那次"点了没反应"的误判来源之一）。
 *
 * 无对应拆解页的设备：按钮**置灰并给出原因**（title / aria-label），而不是把按钮藏掉
 * —— 藏掉会让用户以为"这台设备没有这个功能"，而真相是"这份拆解图还没生成"。
 */
import { Boxes, Expand } from 'lucide-react';
import { hasExplodedView, openExplodedView } from './explodedViewFiles';

export interface ExplodedViewButtonProps {
  /** 当前选中设备 ID（台账口径，如 eq-105）。 */
  deviceId?: string | null;
  /** 仅用于提示文案，可选。 */
  deviceName?: string;
  /** 紧凑版：大屏 HUD 面板（9px 青色系）。默认标准版：普通模式侧栏（11px 石板色系）。 */
  compact?: boolean;
  className?: string;
}

export function ExplodedViewButton({
  deviceId,
  deviceName,
  compact = false,
  className = '',
}: ExplodedViewButtonProps) {
  const available = hasExplodedView(deviceId);
  const who = deviceName ? `「${deviceName}」` : '该设备';
  const title = available
    ? `在当前页面查看${who}的拆解视图（替换中间的 3D 模型区）`
    : '该设备暂未生成拆解视图';

  const base = 'inline-flex items-center gap-1 rounded transition-colors disabled:cursor-not-allowed';
  const skin = compact
    ? 'px-1.5 py-0.5 text-[9px] border border-cyan-500/40 text-cyan-100 bg-cyan-500/15 hover:bg-cyan-500/25 disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500'
    : 'px-2 py-1 text-[11px] font-medium border border-white/12 bg-white/8 text-slate-100 hover:bg-white/15 disabled:bg-transparent disabled:text-slate-500 disabled:border-white/8';

  return (
    <button
      type="button"
      data-testid="equipment3d-open-exploded"
      data-available={available ? 'true' : 'false'}
      disabled={!available}
      title={title}
      aria-label={title}
      onClick={() => openExplodedView(deviceId)}
      className={`${base} ${skin} ${className}`}
    >
      <Boxes className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
      {compact ? '拆解视图' : '打开拆解视图'}
      {available && <Expand className={compact ? 'w-2.5 h-2.5 opacity-70' : 'w-3 h-3 opacity-70'} />}
    </button>
  );
}

export default ExplodedViewButton;
