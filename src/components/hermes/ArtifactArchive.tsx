import React, { useMemo, useState } from 'react';
import {
  FolderArchive,
  FileText,
  CheckCircle2,
  Clock
} from 'lucide-react';
import type { ArtifactItem } from './types';
import { useToast } from '../../context/ToastContext';
import { ModalShell } from './ModalShell';

interface ArtifactArchiveProps {
  artifacts: ArtifactItem[];
}

interface PreviewField {
  label: string;
  value: string;
}

/**
 * 单据正文是服务端拼的「【字段】值」逐行文本（作业步骤等长值以续行给出，不带标签）。
 * 这里只做版式拆解，不增删任何内容；`。；` 与结尾悬空的分号是历史数据里句子 join 留下的重复标点。
 */
export function parsePreviewFields(text: string): PreviewField[] {
  const fields: PreviewField[] = [];
  for (const rawLine of text.replace(/。；/g, '；').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const matched = /^【([^】]{1,24})】([\s\S]*)$/.exec(line);
    if (matched) {
      fields.push({ label: matched[1], value: matched[2].trim() });
    } else if (fields.length > 0) {
      const last = fields[fields.length - 1];
      last.value = last.value ? `${last.value}\n${line}` : line;
    } else {
      fields.push({ label: '正文', value: line });
    }
  }
  return fields.map((field) => ({ ...field, value: field.value.replace(/[；;]+$/, '') }));
}

export const ArtifactArchive: React.FC<ArtifactArchiveProps> = ({ artifacts }) => {
  const { show: showToast } = useToast();
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactItem | null>(null);

  const previewFields = useMemo(
    () => parsePreviewFields(selectedArtifact?.previewContent ?? ''),
    [selectedArtifact]
  );

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
        <ModalShell
          title={selectedArtifact.name}
          subtitle={selectedArtifact.code}
          icon={
            <span className="p-1.5 rounded-lg bg-blue-50 text-blue-700 shrink-0">
              <FileText className="w-4 h-4" />
            </span>
          }
          onClose={() => setSelectedArtifact(null)}
          footer={
            <>
              <span className="text-[11px] text-slate-500 font-medium flex items-center gap-1.5 flex-wrap">
                <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-600">
                  {selectedArtifact.category}
                </span>
                <span className="text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  已入库 business_loop_artifacts
                </span>
              </span>
              <button
                type="button"
                onClick={() => setSelectedArtifact(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors cursor-pointer"
              >
                关闭预览
              </button>
            </>
          }
        >
          <dl className="space-y-2">
            {previewFields.map((field) => (
              <div
                key={field.label}
                className="grid grid-cols-[68px_1fr] sm:grid-cols-[92px_1fr] gap-x-3 items-baseline"
              >
                <dt className="text-[11px] font-bold text-slate-500 leading-5">{field.label}</dt>
                <dd className="text-[13px] text-slate-800 leading-6 whitespace-pre-wrap break-words">
                  {field.value}
                </dd>
              </div>
            ))}
            {previewFields.length === 0 && (
              <p className="text-xs text-slate-400">该记录正文为空，请核对服务端 preview_text。</p>
            )}
          </dl>
        </ModalShell>
      )}
    </div>
  );
};
