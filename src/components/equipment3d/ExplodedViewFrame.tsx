/**
 * 「拆解视图」标签页 —— 右侧详情面板里用同源 iframe 加载独立生成的静态拆解页。
 *
 * 为什么不内联/重写：public/exploded/*.html 是完整独立应用（自带 three.js r128 +
 * OrbitControls + BOM 侧栏），只读加载即可；设备 ID → 文件名 的映射在 explodedViewFiles.ts。
 *
 * 匹配不上就显示「该设备暂未生成拆解视图」——不编造、不用占位图。
 */

import { useState } from 'react';
import { Boxes, ExternalLink } from 'lucide-react';
import { getExplodedViewUrl } from './explodedViewFiles';

export interface ExplodedViewFrameProps {
  /** 台账设备 ID（如 eq-105），决定加载哪份拆解页 */
  deviceId?: string | null;
  /** 设备名，仅用于 iframe 的无障碍名称 */
  deviceName?: string;
}

export function ExplodedViewFrame({ deviceId, deviceName }: ExplodedViewFrameProps) {
  const url = getExplodedViewUrl(deviceId);
  /** 已加载完成的 URL；与当前 url 不等即「加载中」，换设备时自动回到加载态 */
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const loading = url !== null && loadedUrl !== url;

  return (
    <div className="h-full flex flex-col gap-1.5 p-2">
      {/* 标题行：与「参数 / 日志」等标签页同款（发光竖条 + 发光字） */}
      <div className="flex items-center gap-1.5 px-1 shrink-0">
        <span className="hud-title-bar-indicator" />
        <Boxes className="w-3.5 h-3.5 text-cyan-400 ml-0.5" />
        <span className="text-[11px] font-bold text-cyan-100 hud-title-text truncate">拆解视图</span>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            title="在新窗口打开完整拆解视图"
            className="ml-auto shrink-0 text-slate-400 hover:text-cyan-200 transition"
          >
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {url ? (
        <div className="relative flex-1 min-h-0 rounded hud-data-card overflow-hidden">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center text-[10px] text-slate-400">
              正在加载拆解视图…
            </div>
          )}
          {/* key=url：换设备时整体重建 iframe，避免上一台的画面与 WebGL 上下文残留 */}
          <iframe
            key={url}
            src={url}
            title={`${deviceName ?? '设备'} 拆解视图`}
            onLoad={() => setLoadedUrl(url)}
            className="w-full h-full border-0"
          />
        </div>
      ) : (
        <div className="rounded hud-data-card px-2 py-4 text-[10px] text-slate-400 text-center leading-relaxed">
          该设备暂未生成拆解视图
        </div>
      )}
    </div>
  );
}

export default ExplodedViewFrame;
