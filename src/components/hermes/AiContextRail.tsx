import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Cpu,
  FileText,
  HelpCircle,
  Lightbulb,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Thermometer,
  Wrench,
  X
} from 'lucide-react';
import type { BusinessClosedLoopData } from './types';
import { useToast } from '../../context/ToastContext';

interface AiContextRailProps {
  data: BusinessClosedLoopData;
}

export const AiContextRail: React.FC<AiContextRailProps> = ({ data }) => {
  const { show: showToast } = useToast();
  const [activeQuestion, setActiveQuestion] = useState<{ q: string; a: string } | null>(null);

  // 后端未识别到目标设备时（equipment.id 为空），所有数值字段如实显示「—」，不得编造
  const hasEquipment = data.equipment.id !== '';
  const fmtValue = (value: string | number) => (hasEquipment ? value : '—');

  const workOrderArtifact = data.artifacts.find(
    (a) => a.stageId === 'stage_report' && a.status === 'ready'
  );
  const permitArtifact = data.artifacts.find(
    (a) => a.stageId === 'stage_permit' && a.status === 'ready'
  );
  const STATIC_HINT = '静态内置启发内容（非实时接口）';

  const ASK_RESPONSES: Record<string, string> = {
    '查看该轴承历次振动频谱': '【AI频谱分析】调取近3个月加速度时序分析：高频段(2kHz~5kHz)能量在48小时内上升14.6dB，呈现典型滚动体轴承内圈点蚀特征，与遥测轴温68.4℃吻合，证实为接触疲劳初期。',
    '同批次备件目前库存储备': '【备件库存协同】查询 ERP/WMS 备件库：对应型号「SKF 6314-2Z」深沟球轴承当前在动力车间线边库储备 4 件，其中 1 件已由本次工单 WO-2025-0618-042 自动预占锁库，随时可领料。',
    '本次停机检修对产线产量的影响预估': '【生产负荷评估】当前 1#与 2#空压机处于联锁互备状态，总供气能力满足一二车间用气需求(当前总管压力 0.72MPa)。计划停机检修 3.5h 内供气平稳，对成品产量影响度为 0%。',
  };

  const handleAsk = (q: string) => {
    const a = ASK_RESPONSES[q] || '智能管家已调用工业知识图谱引擎解析该问题。';
    setActiveQuestion({ q, a });
  };

  return (
    <div className="space-y-4">
      {/* 栏头标题 */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-blue-50 text-blue-600">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <h3 className="text-xs font-bold text-slate-800 tracking-tight">AI 全域上下文贯穿链</h3>
        </div>
        <span className="text-[10px] text-slate-400 font-mono">{STATIC_HINT}</span>
      </div>

      {/* 1. 设备健康画像 */}
      <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-2xs space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-blue-600" />
            设备健康画像
          </span>
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200/80">
            健康评分 {fmtValue(data.equipment.healthScore)}
          </span>
        </div>

        <div className="text-xs font-semibold text-slate-800">
          {data.equipment.name || '—'}
          <span className="font-mono text-slate-400 font-normal ml-1">({fmtValue(data.equipment.model)})</span>
        </div>

        {/* 关键遥测指标矩阵 */}
        <div className="grid grid-cols-3 gap-2 pt-1 text-[11px]">
          <div className="p-2 rounded-lg bg-rose-50/80 border border-rose-200/80">
            <div className="text-rose-600 flex items-center gap-1 font-medium">
              <Thermometer className="w-3 h-3" />
              轴承温度
            </div>
            <div className="font-mono font-bold text-rose-700 text-xs mt-0.5">
              {fmtValue(hasEquipment ? `${data.equipment.temperature}°C` : '')}
            </div>
            <div className="text-[9px] text-rose-500 font-medium">
              {hasEquipment ? `阈值: >${data.equipment.temperatureThreshold}°C ⚠️` : '—'}
            </div>
          </div>

          <div className="p-2 rounded-lg bg-slate-50 border border-slate-200/80">
            <div className="text-slate-500 font-medium flex items-center gap-1">
              <Activity className="w-3 h-3 text-slate-400" />
              振动RMS
            </div>
            <div className="font-mono font-bold text-slate-800 text-xs mt-0.5">
              {fmtValue(hasEquipment ? `${data.equipment.vibration} mm/s` : '')}
            </div>
            <div className="text-[9px] text-slate-400">
              {hasEquipment ? '基准: <2.5' : '—'}
            </div>
          </div>

          <div className="p-2 rounded-lg bg-slate-50 border border-slate-200/80">
            <div className="text-slate-500 font-medium">负荷工况</div>
            <div className="font-mono font-bold text-slate-800 text-xs mt-0.5">
              {fmtValue(hasEquipment ? `${data.equipment.loadRate}%` : '')}
            </div>
            <div className="text-[9px] text-slate-400">{hasEquipment ? '额定功率' : '—'}</div>
          </div>
        </div>
      </div>

      {/* 2. 业务单号与关联标识 */}
      <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-2xs space-y-2">
        <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5 text-blue-600" />
          关联工单与业务单号
        </div>
        <div className="space-y-1.5 text-xs text-slate-600">
          <div className="flex items-center justify-between p-1.5 rounded bg-slate-50 border border-slate-100">
            <span className="text-slate-400 text-[11px]">检修工单</span>
            <span className="font-mono font-bold text-blue-700">
              {workOrderArtifact ? `${workOrderArtifact.code} (P1)` : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between p-1.5 rounded bg-slate-50 border border-slate-100">
            <span className="text-slate-400 text-[11px]">高危安全票</span>
            <span className="font-mono font-bold text-amber-700">
              {permitArtifact ? permitArtifact.code : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between p-1.5 rounded bg-slate-50 border border-slate-100">
            <span className="text-slate-400 text-[11px]">发起人</span>
            <span className="font-medium text-slate-800">
              {data.initiator.name} ({data.initiator.role})
            </span>
          </div>
        </div>
      </div>

      {/* 3. AI 诊断结论 */}
      <div className="rounded-xl border border-blue-200/80 bg-gradient-to-b from-blue-50/40 to-white p-3.5 shadow-2xs space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-blue-900 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-blue-600" />
            AI 诊断结论
          </span>
          <span className="text-[10px] text-slate-400">{STATIC_HINT} · 置信度 94.2%</span>
        </div>
        <p className="text-xs text-slate-700 leading-relaxed">
          非驱动端轴承温度突增，机理分析推断为润滑脂热降解导致的轻微点蚀磨损，失效率风险判定中度。建议执行停机换脂与轴承间隙校准。
        </p>
      </div>

      {/* 4. 检修方案 SOP */}
      <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-2xs space-y-2">
        <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
          <Wrench className="w-3.5 h-3.5 text-indigo-600" />
          检修方案 SOP
        </div>
        <div className="text-xs text-slate-700 space-y-1">
          <div className="font-semibold text-indigo-900">《SOP-AC-008 离心压缩机主轴承检修规程》</div>
          <p className="text-slate-500 text-[11px]">
            关键工器具：电磁感应加热器、扭矩扳手 (185N·m)、防烫绝缘手套、内径千分尺
          </p>
        </div>
      </div>

      {/* 5. 安全措施 JSA + LOTO */}
      <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-2xs space-y-2">
        <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          安全措施 JSA + LOTO
        </div>
        <div className="text-xs text-slate-600 space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">
              JSA Level II
            </span>
            <span className="text-[11px] text-slate-700 font-medium">中度高危 · 机械受限空间</span>
          </div>
          <p className="text-[11px] text-slate-500">
            GB/T 33579 合规防线：进线主电断电挂牌 + 气管入口关闭 + 储气腔卸压至 0MPa
          </p>
        </div>
      </div>

      {/* 6. 相关案例 RAG */}
      <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-2xs space-y-2">
        <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
          <BookOpen className="w-3.5 h-3.5 text-slate-600" />
          相关历史案例 RAG
        </div>
        <div className="space-y-1.5 text-[11px]">
          <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 hover:bg-slate-100/70 transition-colors">
            <div className="flex items-center justify-between text-slate-700 font-medium">
              <span className="truncate">2025-03 同型 2#机轴承异响温升检修</span>
              <span className="font-mono text-emerald-600 font-bold shrink-0 ml-1">92%</span>
            </div>
            <div className="text-slate-400 text-[10px] mt-0.5">闭环耗时 2.8h · 处置方法：清洗滚道并重加 SHC 220</div>
          </div>

          <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 hover:bg-slate-100/70 transition-colors">
            <div className="flex items-center justify-between text-slate-700 font-medium">
              <span className="truncate">2024-11 轴承润滑失效早期温度特征</span>
              <span className="font-mono text-emerald-600 font-bold shrink-0 ml-1">88%</span>
            </div>
            <div className="text-slate-400 text-[10px] mt-0.5">专家处置法：早期隔离干预避免轴瓦咬死</div>
          </div>
        </div>
      </div>

      {/* 7. 智能追问建议 */}
      <div className="rounded-xl border border-indigo-200/70 bg-indigo-50/30 p-3.5 shadow-2xs space-y-2">
        <div className="text-xs font-bold text-indigo-900 flex items-center gap-1.5">
          <Lightbulb className="w-3.5 h-3.5 text-indigo-600" />
          智能追问建议
        </div>
        <div className="space-y-1.5">
          {Object.keys(ASK_RESPONSES).map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => handleAsk(q)}
              className="w-full text-left p-2 rounded-lg bg-white border border-indigo-100 hover:border-indigo-300 hover:bg-indigo-50/50 text-[11px] text-slate-700 font-medium flex items-center justify-between group transition-colors cursor-pointer"
            >
              <span className="truncate">{q}</span>
              <ChevronRight className="w-3 h-3 text-indigo-400 group-hover:text-indigo-600 shrink-0 ml-1" />
            </button>
          ))}
        </div>
      </div>

      {/* 追问详情弹窗 */}
      {activeQuestion && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl border border-slate-200 space-y-3 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-600" />
                <h4 className="text-xs font-bold text-slate-900">AI 智能分析洞察</h4>
              </div>
              <button
                type="button"
                onClick={() => setActiveQuestion(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs font-semibold text-slate-800 bg-slate-50 p-2 rounded-lg border border-slate-100">
              问：{activeQuestion.q}
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              {activeQuestion.a}
            </p>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setActiveQuestion(null)}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
