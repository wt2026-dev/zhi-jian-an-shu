import React, { useState } from 'react';
import {
  FolderArchive,
  FileText,
  CheckCircle2,
  Clock,
  X
} from 'lucide-react';
import type { ArtifactItem } from './types';
import { useToast } from '../../context/ToastContext';

interface ArtifactArchiveProps {
  artifacts: ArtifactItem[];
}

export const ArtifactArchive: React.FC<ArtifactArchiveProps> = ({ artifacts }) => {
  const { show: showToast } = useToast();
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactItem | null>(null);

  const readyCount = artifacts.filter((a) => a.status === 'ready').length;

  const handleClickArtifact = (art: ArtifactItem) => {
    if (art.status === 'ready') {
      setSelectedArtifact(art);
    } else {
      showToast({
        type: 'info',
        title: '资料尚未生成',
        message: `「${art.name}」将在业务推进到对应环节后，由 AI 与人工核准自动生成并入库`,
        duration: 3500,
      });
    }
  };

  return (
    <div className="rounded-2xl bg-white/95 border border-slate-200/90 shadow-sm p-4 sm:p-5 backdrop-blur-md flex flex-col justify-between space-y-3.5">
      {/* 标题栏 */}
      <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-indigo-50 text-indigo-600">
            <FolderArchive className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-800 tracking-tight">业务闭环产出物档案</h3>
            <p className="text-[11px] text-slate-400">
              本闭环登记 {artifacts.length} 项单据，已入库 {readyCount} 项
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200/70">
            已就绪 {readyCount}/{artifacts.length}
          </span>
        </div>
      </div>

      {/* 产出物网格（行数由 business_loop_artifacts 真实记录决定） */}
      {artifacts.length === 0 && (
        <div className="py-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl">
          该闭环尚未登记任何产出物记录
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {artifacts.map((art) => {
          const isReady = art.status === 'ready';

          return (
            <div
              key={art.id}
              role="button"
              tabIndex={0}
              onClick={() => handleClickArtifact(art)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleClickArtifact(art);
                }
              }}
              className={`text-left p-2.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                isReady
                  ? 'bg-gradient-to-b from-white to-blue-50/20 border-blue-200/90 hover:border-blue-400 hover:shadow-2xs'
                  : 'bg-slate-50/60 border-slate-200/70 hover:bg-slate-50 opacity-75'
              }`}
            >
              <div>
                <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono mb-1">
                  <span className="truncate max-w-[90px]">{art.code}</span>
                  {isReady ? (
                    <span className="text-emerald-600 font-bold flex items-center gap-0.5">
                      <CheckCircle2 className="w-3 h-3" />
                    </span>
                  ) : (
                    <span className="text-slate-400">
                      <Clock className="w-3 h-3" />
                    </span>
                  )}
                </div>
                <div className="text-xs font-bold text-slate-800 line-clamp-1">
                  {art.name}
                </div>
              </div>

              <div className="mt-2 pt-1.5 border-t border-slate-100 flex items-center justify-between text-[10px]">
                <span className="text-slate-500">{art.category}</span>
                <span className={isReady ? 'text-blue-600 font-medium' : 'text-slate-400'}>
                  {isReady ? '点击查看' : '待生成'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* 档案详情预览弹窗 */}
      {selectedArtifact && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 shadow-2xl border border-slate-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-blue-50 text-blue-700">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{selectedArtifact.name}</h3>
                  <p className="text-[11px] font-mono text-slate-500">{selectedArtifact.code}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedArtifact(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/70 text-xs font-mono text-slate-700 whitespace-pre-wrap leading-relaxed max-h-[50vh] overflow-y-auto">
              {selectedArtifact.previewContent}
            </div>

            <div className="pt-2 flex items-center justify-between gap-3">
              <span className="text-[11px] text-slate-500 font-medium flex items-center gap-1.5 flex-wrap">
                <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-600">
                  {selectedArtifact.category}
                </span>
                <span className="font-mono">{selectedArtifact.code}</span>
                <span className="text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  已入库 business_loop_artifacts
                </span>
              </span>
              <button
                type="button"
                onClick={() => setSelectedArtifact(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700"
              >
                关闭预览
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
