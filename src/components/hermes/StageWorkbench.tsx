import React, { useState } from 'react';
import {
  Sparkles,
  Lock,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  SlidersHorizontal,
  ExternalLink,
  ShieldCheck,
  FileText,
  Info,
  Layers,
  Wrench,
  Check,
  Eye,
  X,
  FileCheck,
  Hammer,
  ClipboardCheck,
  BookOpen
} from 'lucide-react';
import type { StageId, StageStepMeta, LotoConfirmationItem, BusinessClosedLoopData } from './demoData';
import { useToast } from '../../context/ToastContext';

interface StageWorkbenchProps {
  currentStageId: StageId;
  stages: StageStepMeta[];
  lotoItems: LotoConfirmationItem[];
  loopData: BusinessClosedLoopData;
  onToggleLotoItem: (itemId: string) => void;
  onAdvanceStage: (fromStageId: StageId) => void;
  onNavigateToTab?: (tabKey: string) => void;
}

export const StageWorkbench: React.FC<StageWorkbenchProps> = ({
  currentStageId,
  stages,
  lotoItems,
  loopData,
  onToggleLotoItem,
  onAdvanceStage,
  onNavigateToTab,
}) => {
  const { show: showToast } = useToast();
  const [showAiReasonModal, setShowAiReasonModal] = useState(false);
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustNote, setAdjustNote] = useState('隔离方案由智能管家根据Atlas Copco维护手册与电气单线图自动匹配，参数已校准。');

  const currentStage = stages.find((s) => s.id === currentStageId) || stages[2];
  const confirmedCount = lotoItems.filter((i) => i.confirmed).length;
  const isAllConfirmed = confirmedCount === lotoItems.length;

  const handleAdvance = () => {
    // TODO: 调用后端接口进行状态推进与自动化流转
    // - 环节 1 (现场报修): POST /api/ai/generate-work-order
    // - 环节 2 (高危作业票): POST /api/ai/safety-risk-assessment
    // - 环节 3 (LOTO能量隔离): GET /api/loto-locks & POST /api/ai/safety-risk-assessment
    // - 环节 4 (检修执行): POST /api/ai/generate-maintenance-plan
    // - 环节 5 (完工): POST /api/ai/generate-report
    // - 环节 6 (质检归档): POST /api/ai/suggest-contribution & POST /api/knowledge/contributions

    if (currentStageId === 'stage_loto' && !isAllConfirmed) {
      showToast({
        type: 'warning',
        title: '关键安全环节未确认',
        message: 'LOTO 能量隔离要求必须 100% 确认（当前已确认 2/3 项），请勾选残余能量泄压后再推进！',
        duration: 4000,
      });
      return;
    }

    onAdvanceStage(currentStageId);
  };

  const handleAdjustSubmit = () => {
    setShowAdjustModal(false);
    showToast({
      type: 'success',
      title: '内容调整已暂存',
      message: '人工补充说明已更新至本环节元数据中，AI 依据已同步沉淀日志',
      duration: 3000,
    });
  };

  return (
    <div className="rounded-2xl bg-white/95 border border-slate-200/90 shadow-sm p-4 sm:p-5 lg:p-6 backdrop-blur-md flex flex-col justify-between space-y-5">
      {/* 顶部环节标题栏 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200/80">
              环节 {currentStage.order}/6
            </span>
            <h2 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <span>{currentStage.title}</span>
            </h2>
            <span className="text-slate-300">·</span>
            <span className="text-xs text-slate-500">
              对应页面：<strong className="text-slate-700">{currentStage.targetPage}</strong>
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {currentStageId === 'stage_loto' && '对动力源进行机械与电气彻底闭锁，严格防范检修期间误合闸或残余蓄压伤害'}
            {currentStageId === 'stage_report' && '遥测超温自动生成现场报修工单，结合设备健康画像与 AI 根因推演'}
            {currentStageId === 'stage_permit' && '作业安全分析 (JSA) 自动识别高危能量，出具二级动火与机械拆装许可'}
            {currentStageId === 'stage_execution' && '根据历史优秀工单与 SOP 自动派发离心机轴承拆装更换作业指引'}
            {currentStageId === 'stage_completion' && '检修完成后就地试车、轴温振动遥测复核、现场工完料净场地清验收'}
            {currentStageId === 'stage_archive' && '全链路数据汇总质检评估，形成闭环电子档案包，沉淀典型案例至知识库'}
          </p>
        </div>

        {/* 跳转关联页面 */}
        {onNavigateToTab && (
          <button
            type="button"
            onClick={() => onNavigateToTab(currentStage.targetTabKey)}
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium px-2.5 py-1.5 rounded-lg hover:bg-blue-50 border border-transparent hover:border-blue-200 transition-colors cursor-pointer self-start sm:self-center"
          >
            <span>前往「{currentStage.targetPage}」</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* ── 环节 3：LOTO 能量隔离专属工作台（核心演示区） ── */}
      {currentStageId === 'stage_loto' && (
        <div className="space-y-4">
          {/* 金色标识卡：「AI 已预填」 */}
          <div 
            className="relative overflow-hidden rounded-xl p-4 border"
            style={{
              backgroundColor: 'rgba(232, 163, 61, 0.08)',
              borderColor: 'rgba(232, 163, 61, 0.4)',
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div 
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0 shadow-xs"
                  style={{ backgroundColor: '#E8A33D' }}
                >
                  <Sparkles className="w-4 h-4" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span 
                      className="text-xs font-bold px-2 py-0.5 rounded text-amber-900"
                      style={{ backgroundColor: 'rgba(232, 163, 61, 0.25)' }}
                    >
                      AI 已预填
                    </span>
                    <span className="text-[11px] text-amber-800 font-mono">
                      10:28 完成 · 基于设备图谱与 14 条历史工单
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-800 font-medium leading-relaxed">
                    智能建议：建议隔离主电源 <strong className="text-amber-900 underline underline-offset-2">QF-03</strong>、关闭压缩空气入口阀 <strong className="text-amber-900 underline underline-offset-2">V-301</strong>、管路泄压至 <strong className="text-amber-900 underline underline-offset-2">0MPa</strong>。
                  </p>
                </div>
              </div>

              <div className="hidden sm:flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-white/80 text-amber-800 border border-amber-200/80">
                  图谱匹配 99%
                </span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-white/80 text-amber-800 border border-amber-200/80">
                  GB/T 33579 合规
                </span>
              </div>
            </div>
          </div>

          {/* 隔离确认表格 */}
          <div className="rounded-xl border border-slate-200/80 overflow-hidden bg-white shadow-2xs">
            <div className="px-3.5 py-2.5 bg-slate-50/90 border-b border-slate-200/80 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-blue-600" />
                LOTO 能量隔离确认矩阵
              </span>
              <span className="text-[11px] text-slate-500">
                严格遵循断电上锁挂牌双人复核流程
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50/50 text-slate-500 border-b border-slate-100 font-medium">
                    <th className="py-2.5 px-3 w-24">隔离类型</th>
                    <th className="py-2.5 px-3 w-40">隔离点</th>
                    <th className="py-2.5 px-3 min-w-[200px]">操作要求与规范</th>
                    <th className="py-2.5 px-3 w-28">锁具/牌号</th>
                    <th className="py-2.5 px-3 w-28 text-center">确认勾选</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {lotoItems.map((item) => (
                    <tr 
                      key={item.id} 
                      className={`hover:bg-slate-50/80 transition-colors ${
                        item.confirmed ? 'bg-emerald-50/20' : 'bg-amber-50/15'
                      }`}
                    >
                      <td className="py-3 px-3 font-semibold text-slate-800">
                        <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-medium ${
                          item.type === '电气隔离' 
                            ? 'bg-blue-50 text-blue-700 border border-blue-200/60'
                            : item.type === '气源隔离'
                            ? 'bg-cyan-50 text-cyan-700 border border-cyan-200/60'
                            : 'bg-amber-50 text-amber-700 border border-amber-200/60'
                        }`}>
                          {item.type}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-medium text-slate-900">
                        <div>{item.point}</div>
                      </td>
                      <td className="py-3 px-3 text-slate-600 leading-relaxed">
                        {item.requirement}
                      </td>
                      <td className="py-3 px-3 font-mono text-[11px] text-slate-500">
                        <span className="bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200/70">
                          {item.lockNumber}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <label className="inline-flex items-center justify-center cursor-pointer p-1">
                          <input
                            type="checkbox"
                            checked={item.confirmed}
                            onChange={() => onToggleLotoItem(item.id)}
                            className="sr-only"
                          />
                          <div 
                            className={`w-5 h-5 rounded flex items-center justify-center transition-all ${
                              item.confirmed 
                                ? 'bg-emerald-500 text-white shadow-2xs' 
                                : 'border-2 border-slate-300 bg-white hover:border-blue-500'
                            }`}
                          >
                            {item.confirmed && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                          </div>
                        </label>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {item.confirmed ? `${item.confirmTime || '已确认'}` : '点击确认'}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 关键安全环节人工确认提示横条 */}
          <div 
            className={`p-3 rounded-xl border flex items-center justify-between text-xs transition-colors ${
              isAllConfirmed 
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                : 'bg-amber-50/80 text-amber-900 border-amber-200/80'
            }`}
          >
            <div className="flex items-center gap-2">
              {isAllConfirmed ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              )}
              <span>
                关键安全环节需人工逐项确认 · <strong>当前已确认 {confirmedCount}/3 项</strong>
              </span>
            </div>

            <span className="text-[11px] font-semibold">
              {isAllConfirmed ? '安全核准已满足，允许推进下发检修' : '待操作技师完成第 3 项管路泄压确认'}
            </span>
          </div>
        </div>
      )}

      {/* ── 环节 1：现场报修工作台 ── */}
      {currentStageId === 'stage_report' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-blue-50/60 border border-blue-200/80 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-blue-900">报修信息预填 (工单 WO-2025-0618-042)</span>
              <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
                已由陈主管下发
              </span>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              <strong>故障现象：</strong>3#离心式空压机非驱动端轴承温度实测 68.4℃（越上限阈值 65℃），振动烈度 3.8mm/s。
            </p>
            <p className="text-xs text-slate-700 leading-relaxed">
              <strong>AI 诊断推演：</strong>基于时序遥测与故障树机理分析，推断为润滑脂热降解与局部点蚀，置信度 94.2%。已自动匹配备件储备库（SKF 6314-2Z 现存 4 件）。
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
              <div className="text-slate-400 text-[11px]">报修单号</div>
              <div className="font-mono font-bold text-slate-800 mt-0.5">WO-2025-0618-042</div>
            </div>
            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
              <div className="text-slate-400 text-[11px]">指定主修</div>
              <div className="font-bold text-slate-800 mt-0.5">李工 (机修一班班长)</div>
            </div>
            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
              <div className="text-slate-400 text-[11px]">优先级评定</div>
              <div className="font-bold text-rose-600 mt-0.5">P1 - 紧急工单</div>
            </div>
          </div>
        </div>
      )}

      {/* ── 环节 2：高危作业票工作台 ── */}
      {currentStageId === 'stage_permit' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-indigo-50/50 border border-indigo-200/80 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-indigo-900">作业安全分析 JSA 与安全许可</span>
              <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
                安监专员已签发
              </span>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              <strong>识别危险能量：</strong>高压电气 (380V)、蓄能管路气压 (0.85MPa)、转动部件挤夹、高温表面烫伤。
            </p>
            <p className="text-xs text-slate-700 leading-relaxed">
              <strong>核准控制要求：</strong>实施严格 LOTO 上锁挂牌，划定 10 米现场警戒区，配备 ABC 干粉灭火器，全程佩戴防烫手套与护目镜。
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
              <div className="text-slate-400 text-[11px]">许可票号</div>
              <div className="font-mono font-bold text-slate-800 mt-0.5">HWP-250618-011</div>
            </div>
            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
              <div className="text-slate-400 text-[11px]">风险等级</div>
              <div className="font-bold text-amber-600 mt-0.5">Level II (中度高危)</div>
            </div>
          </div>
        </div>
      )}

      {/* ── 环节 4：检修执行工作台 ── */}
      {currentStageId === 'stage_execution' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-blue-50/50 border border-blue-200/80 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-blue-900">检修方案与作业步骤 (SOP-AC-008)</span>
              <span className="text-[10px] font-semibold text-blue-700 bg-blue-100 px-2 py-0.5 rounded">
                AI 已编排就绪
              </span>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              <strong>执行指引：</strong>① 拆卸联轴器护罩 → ② 电磁感应加热拆卸轴承内圈 (加热温度 ≤ 110℃) → ③ 轴颈跳动测量与清理 → ④ 安装新备件 SKF 6314-2Z → ⑤ 涂抹美孚 Mobilith SHC 220 润滑脂 (400g)。
            </p>
          </div>
          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 text-xs flex items-center justify-between">
            <span className="text-slate-600">领料清单已自动预占备件库存：</span>
            <span className="font-mono font-medium text-blue-700">SKF 6314-2Z × 1 / 耐温密封圈 × 2</span>
          </div>
        </div>
      )}

      {/* ── 环节 5：完工工作台 ── */}
      {currentStageId === 'stage_completion' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-emerald-50/50 border border-emerald-200/80 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-900">现场完工与试运行核验标准</span>
              <span className="text-[10px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                待现场试车
              </span>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              <strong>验收标准：</strong>空载试运转 30 分钟，轴承温度温升不得超过 20℃，实测轴温 ≤ 50℃，振动速度有效值 ≤ 1.8mm/s，盘车均匀无杂音。
            </p>
          </div>
        </div>
      )}

      {/* ── 环节 6：质检归档工作台 ── */}
      {currentStageId === 'stage_archive' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-indigo-50/50 border border-indigo-200/80 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-indigo-900">闭环综合评估与知识库沉淀</span>
              <span className="text-[10px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                待终审归档
              </span>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              <strong>归档内容：</strong>本次闭环自动聚合 8 项标准业务资料，并自动提炼出《3#空压机轴承高温劣化快速应急排查案例》，一键挂载至工业知识库 RAG 索引树。
            </p>
          </div>
        </div>
      )}

      {/* 底部操作区 */}
      <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setShowAdjustModal(true)}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
            <span>调整内容</span>
          </button>

          <button
            type="button"
            onClick={() => setShowAiReasonModal(true)}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-blue-700 bg-blue-50/70 border border-blue-200/70 hover:bg-blue-100 transition-colors cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5 text-blue-600" />
            <span>查看 AI 依据</span>
          </button>
        </div>

        <button
          type="button"
          onClick={handleAdvance}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-700 hover:to-indigo-800 shadow-sm hover:shadow transition-all cursor-pointer"
        >
          <span>确认并推进环节 →</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* ── 弹窗：查看 AI 依据 ── */}
      {showAiReasonModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 shadow-2xl border border-slate-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200/80">
                  <Sparkles className="w-4 h-4 text-[#E8A33D]" />
                </div>
                <h3 className="text-sm font-bold text-slate-900">AI 推理依据与图谱链条</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAiReasonModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-600 max-h-[60vh] overflow-y-auto pr-1">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/70 space-y-1">
                <div className="font-bold text-slate-800">1. 设备图谱拓扑推导 (Knowledge Graph)</div>
                <p>3#空压机进线电源隶属于 10kV变电所 0.4kV 低压配电段 QF-03 抽屉开关；出风管线直连车间压缩空气总管，通过手动截止阀 V-301 切断返压。</p>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/70 space-y-1">
                <div className="font-bold text-slate-800">2. 历史相似检修案例召回 (14 条)</div>
                <p>在过去 24 个月内，同车间 1#、2#、3# 空压机共发生 14 起轴承温度偏高检修，历史工单均记录断开 QF-03 与关闭 V-301 为标准隔离防线，零发生能量反串。</p>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/70 space-y-1">
                <div className="font-bold text-slate-800">3. 国家安全规范合规校验</div>
                <p>严格符合 GB/T 33579-2017《机械安全 危险能量控制方法》：对于气动受压管路，除关闭切断阀外，必须包含泄放降压并就地目视确认归零的要求。</p>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setShowAiReasonModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors cursor-pointer"
              >
                已知晓关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 弹窗：调整内容 ── */}
      {showAdjustModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl border border-slate-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-900">人工调整本环节参数</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAdjustModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-medium mb-1">人工干预说明 / 补充约束</label>
                <textarea
                  value={adjustNote}
                  onChange={(e) => setAdjustNote(e.target.value)}
                  rows={4}
                  className="w-full p-2.5 rounded-xl border border-slate-300 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>
              <p className="text-[11px] text-slate-400">
                提示：人工干预将生成独立审计留痕，并在闭环归档报告中加盖「人工校准」标签。
              </p>
            </div>

            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAdjustModal(false)}
                className="px-3.5 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleAdjustSubmit}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors cursor-pointer"
              >
                保存调整
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
