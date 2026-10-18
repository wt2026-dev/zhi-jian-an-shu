import React from 'react';
import { Play, Loader2, AlertTriangle } from 'lucide-react';
import { Equipment } from '../../types';
import { PRESET_SCENARIOS } from './pipelineConfig';

interface PipelineTriggerConsoleProps {
  equipments: Equipment[];
  equipmentId: string;
  onSelectEquipment: (id: string) => void;
  problem: string;
  onChangeProblem: (prob: string) => void;
  starting: boolean;
  error: string | null;
  onStart: () => void;
}

export const PipelineTriggerConsole: React.FC<PipelineTriggerConsoleProps> = ({
  equipments,
  equipmentId,
  onSelectEquipment,
  problem,
  onChangeProblem,
  starting,
  error,
  onStart,
}) => {
  return (
    <div className="card-saas p-6 border border-slate-200/80 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-slate-100">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
            <Play className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">发起 AI 协同诊断</h2>
            <p className="text-xs text-slate-500">选择受检设备并输入异常现象，一键编排启动全链路决策</p>
          </div>
        </div>
        {/* 预设工况快捷填入 */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-slate-500 font-medium mr-1">快捷测试工况:</span>
          {PRESET_SCENARIOS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => {
                onChangeProblem(preset.problem);
                // 自动尝试寻找匹配关键字的设备
                const matched = equipments.find((eq) =>
                  eq.name.includes(preset.equipmentKeyword) || eq.type?.includes(preset.equipmentKeyword)
                );
                if (matched) onSelectEquipment(matched.id);
              }}
              className="text-xs px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-600 transition-colors border border-slate-200/70 font-medium cursor-pointer"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,280px)_1fr_auto] gap-3.5 items-start">
        <div>
          <label className="text-xs font-semibold text-slate-700 block mb-1.5">受检设备</label>
          <select
            value={equipmentId}
            onChange={(e) => onSelectEquipment(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-2xs"
          >
            {equipments.map((eq) => (
              <option key={eq.id} value={eq.id}>
                {eq.name}（{eq.code}）
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-700 block mb-1.5">异常现象与遥测特征描述</label>
          <textarea
            value={problem}
            onChange={(e) => onChangeProblem(e.target.value)}
            rows={2}
            placeholder="例：运行中轴承箱温度持续升高并伴有金属摩擦异响，振动值接近报警上限"
            className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none shadow-2xs"
          />
        </div>
        <button
          type="button"
          onClick={onStart}
          disabled={starting}
          className="h-[42px] px-6 rounded-xl btn-gradient text-sm font-semibold text-white flex items-center justify-center space-x-2 cursor-pointer shadow-sm hover:shadow-md hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-60 md:mt-6"
        >
          {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          <span>{starting ? '协同编排中…' : '启动协同诊断'}</span>
        </button>
      </div>
      {error && (
        <p className="text-xs text-rose-600 flex items-center bg-rose-50 border border-rose-200/80 px-3 py-2 rounded-lg">
          <AlertTriangle className="w-4 h-4 mr-1.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
};
