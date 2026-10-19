import React, { useState } from 'react';
import {
  Activity,
  BookOpen,
  ChevronRight,
  Cpu,
  FileText,
  ShieldCheck,
  Sparkles,
  Thermometer,
  Wrench,
  X,
} from 'lucide-react';
import type { BusinessClosedLoopData, Stage1Prefill, Stage2Prefill, Stage4Prefill } from './types';

interface AiContextRailProps {
  data: BusinessClosedLoopData;
}

/** 速览条目：问题固定，答案一律取自接口已回写的真实内容，缺失就写「尚未生成」 */
interface RailInsight {
  question: string;
  answer: string | null;
}

export const AiContextRail: React.FC<AiContextRailProps> = ({ data }) => {
  const [activeQuestion, setActiveQuestion] = useState<RailInsight | null>(null);

  // 后端未识别到目标设备时（equipment.id 为空），数值一律如实显示「—」，不得编造。
  // v 也要接住 null：服务端把"遥测未接入"如实回成 null，而 `${null}°C` 会渲染成
  // 字面量 "null°C"，既不是数字也不是「—」。
  const hasEquipment = data.equipment.id !== '';
  const eq = data.equipment;
  const dash = (v: string | number | undefined | null) =>
    (hasEquipment && v !== null && v !== undefined ? v : '—');
  // 数值+单位：缺测返回「—」。不能用模板串再交给 dash —— `${null}°C` 已经是 "null°C"，
  // dash 拿到的是一个非空字符串，拦不住。
  const withUnit = (v: number | null | undefined, unit: string) =>
    (hasEquipment && typeof v === 'number' && Number.isFinite(v) ? `${v}${unit}` : '—');

  const stagePrefill = (order: number) => data.stages.find((s) => s.order === order)?.aiPrefill;
  const draft1 = (stagePrefill(1)?.raw as Stage1Prefill | undefined)?.workOrderDraft;
  const jsa2 = (stagePrefill(2)?.raw as Stage2Prefill | undefined)?.assessment;
  const plan4 = (stagePrefill(4)?.raw as Stage4Prefill | undefined)?.plan;

  const workOrderArtifact = data.artifacts.find((a) => a.category === '检修工单' && a.status === 'ready');
  const permitArtifact = data.artifacts.find((a) => a.category === '安全许可' && a.status === 'ready');
  const knowledgeArtifact = data.artifacts.find((a) => a.category === '知识沉淀');
  const readyCount = data.artifacts.filter((a) => a.status === 'ready').length;

  const lotoConfirmed = data.lotoItems.filter((i) => i.confirmed).length;

  const insights: RailInsight[] = [
    {
      question: '本闭环的工单草稿要点',
      answer: draft1
        ? [
            `标题：${draft1.title || '—'}`,
            `故障类型：${draft1.faultType || '—'}｜优先级：${draft1.priority || '—'}`,
            draft1.description ? `现场描述：${draft1.description}` : '',
            draft1.recommendedSteps?.length ? `建议工序：${draft1.recommendedSteps.join('；')}` : '',
          ]
            .filter(Boolean)
            .join('\n')
        : null,
    },
    {
      question: 'JSA 识别出的危险能量与控制措施',
      answer: jsa2
        ? [
            `风险等级：${jsa2.riskLevel || '—'}${jsa2.riskReason ? `（${jsa2.riskReason}）` : ''}`,
            jsa2.hazardIdentifications?.length
              ? `危险源：${jsa2.hazardIdentifications.map((h) => `${h.category || ''}${h.hazard || ''}`).join('；')}`
              : '',
            jsa2.jsaMeasures?.length ? `控制措施：${jsa2.jsaMeasures.map((m) => `${m.hazard || ''}→${m.control || ''}`).join('；')}` : '',
          ]
            .filter(Boolean)
            .join('\n')
        : null,
    },
    {
      question: 'LOTO 隔离点与确认进度',
      answer: data.lotoItems.length
        ? `隔离点 ${data.lotoItems.length} 处，现场已确认 ${lotoConfirmed}/${data.lotoItems.length}：${data.lotoItems
            .map((i) => `${i.point}（${i.confirmed ? `已确认 ${i.operator || ''}` : '待确认'}）`)
            .join('；')}`
        : null,
    },
    {
      question: '检修方案与备件工器具',
      answer: plan4
        ? [
            plan4.overview ? `方案概述：${plan4.overview}` : '',
            plan4.spareParts?.length ? `备件：${plan4.spareParts.map((p) => `${p.name || ''}${p.spec ? `（${p.spec}）` : ''}×${p.qty ?? 1}`).join('；')}` : '',
            plan4.safetyMeasures?.ppe?.length ? `PPE：${plan4.safetyMeasures.ppe.join('、')}` : '',
            plan4.estimatedHours != null ? `预估工时：${plan4.estimatedHours} 小时` : '',
          ]
            .filter(Boolean)
            .join('\n')
        : null,
    },
    {
      question: '本次闭环的产出物与知识沉淀',
      answer: `已生成 ${readyCount}/${data.artifacts.length} 项产出物。${
        knowledgeArtifact
          ? knowledgeArtifact.status === 'ready'
            ? `知识条目：${knowledgeArtifact.code}`
            : '知识沉淀：AI 判定未达复用标准，可在知识库手动提交'
          : ''
      }`,
    },
  ];

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
        <span className="text-[10px] text-slate-400 font-mono">取自 /business-loops 详情</span>
      </div>

      {/* 1. 设备健康画像 */}
      <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-2xs space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-blue-600" />
            设备健康画像
          </span>
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200/80">
            健康评分 {withUnit(eq.healthScore, '')}
          </span>
        </div>

        <div className="text-xs font-semibold text-slate-800">
          {eq.name || '未识别设备'}
          <span className="font-mono text-slate-400 font-normal ml-1">{eq.model ? `(${eq.model})` : ''}</span>
        </div>
        {eq.workshop && <div className="text-[11px] text-slate-500">{eq.workshop}</div>}

        <div className="grid grid-cols-3 gap-2 pt-1 text-[11px]">
          <div className="p-2 rounded-lg bg-rose-50/80 border border-rose-200/80">
            <div className="text-rose-600 flex items-center gap-1 font-medium">
              <Thermometer className="w-3 h-3" />
              温度
            </div>
            <div className="font-mono font-bold text-rose-700 text-xs mt-0.5">{withUnit(eq.temperature, '°C')}</div>
            <div className="text-[9px] text-rose-500 font-medium">经验限值 {eq.temperatureThreshold}°C</div>
          </div>

          <div className="p-2 rounded-lg bg-slate-50 border border-slate-200/80">
            <div className="text-slate-500 font-medium flex items-center gap-1">
              <Activity className="w-3 h-3 text-slate-400" />
              振动RMS
            </div>
            <div className="font-mono font-bold text-slate-800 text-xs mt-0.5">{withUnit(eq.vibration, ' mm/s')}</div>
            <div className="text-[9px] text-slate-400">台账遥测</div>
          </div>

          <div className="p-2 rounded-lg bg-slate-50 border border-slate-200/80">
            <div className="text-slate-500 font-medium">负荷工况</div>
            <div className="font-mono font-bold text-slate-800 text-xs mt-0.5">{withUnit(eq.loadRate, '%')}</div>
            <div className="text-[9px] text-slate-400">负载率</div>
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
          <div className="flex items-center justify-between gap-2 p-1.5 rounded bg-slate-50 border border-slate-100">
            <span className="text-slate-400 text-[11px]">检修工单</span>
            <span className="font-mono font-bold text-blue-700">{workOrderArtifact ? workOrderArtifact.code : '确认环节 1 后落库'}</span>
          </div>
          <div className="flex items-center justify-between gap-2 p-1.5 rounded bg-slate-50 border border-slate-100">
            <span className="text-slate-400 text-[11px]">高危安全票</span>
            <span className="font-mono font-bold text-amber-700">{permitArtifact ? permitArtifact.code : '确认环节 2 后落库'}</span>
          </div>
          <div className="flex items-center justify-between gap-2 p-1.5 rounded bg-slate-50 border border-slate-100">
            <span className="text-slate-400 text-[11px]">发起人</span>
            <span className="font-medium text-slate-800">
              {data.initiator.name}
              {data.initiator.role ? `（${data.initiator.role}）` : ''}
            </span>
          </div>
        </div>
      </div>

      {/* 3. AI 环节结论（逐环节真实预填摘要） */}
      <div className="rounded-xl border border-blue-200/80 bg-gradient-to-b from-blue-50/40 to-white p-3.5 shadow-2xs space-y-2">
        <span className="text-xs font-bold text-blue-900 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-blue-600" />
          AI 环节结论
        </span>
        {data.stages.some((s) => s.aiPrefill?.content) ? (
          <ul className="space-y-1.5">
            {data.stages
              .filter((s) => s.aiPrefill?.content)
              .map((s) => (
                <li key={s.id} className="text-[11px] leading-relaxed flex gap-1.5">
                  <span className="text-blue-500 shrink-0">·</span>
                  <span className="text-slate-700">
                    <strong className="text-slate-800">环节{s.order} {s.title}</strong>
                    {s.aiPrefill?.status === 'degraded' ? '（AI 降级）' : ''}：{s.aiPrefill?.content}
                  </span>
                </li>
              ))}
          </ul>
        ) : (
          <p className="text-[11px] text-slate-500 leading-relaxed">服务端尚未回写任何环节的 AI 结论。</p>
        )}
      </div>

      {/* 4. 检修方案 SOP */}
      <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-2xs space-y-2">
        <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
          <Wrench className="w-3.5 h-3.5 text-indigo-600" />
          检修方案 SOP
        </div>
        {plan4?.overview ? (
          <>
            <div className="text-xs text-slate-700 font-semibold text-indigo-900 line-clamp-2">{plan4.overview}</div>
            <p className="text-slate-500 text-[11px] leading-relaxed">
              {plan4.steps?.length ? `已编排 ${plan4.steps.length} 道工序` : '工序待 AI 回写'}
              {plan4.estimatedHours != null ? ` · 预估 ${plan4.estimatedHours} 小时` : ''}
              {plan4.workers != null ? ` · ${plan4.workers} 人` : ''}
            </p>
          </>
        ) : (
          <p className="text-[11px] text-slate-500">环节 4 的检修方案尚未回写（generate-maintenance-plan）。</p>
        )}
      </div>

      {/* 5. 安全措施 JSA + LOTO */}
      <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-2xs space-y-2">
        <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          安全措施 JSA + LOTO
        </div>
        <div className="text-xs text-slate-600 space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">
              JSA {jsa2?.riskLevel || '待评估'}
            </span>
            {jsa2?.riskReason && <span className="text-[11px] text-slate-700">{jsa2.riskReason}</span>}
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            {data.lotoItems.length
              ? `隔离点 ${data.lotoItems.length} 处，现场已确认 ${lotoConfirmed} 处；锁具未匹配台账时由现场登记。`
              : 'LOTO 隔离点由 JSA 结果推演，未回写前需在安全与LOTO页人工补充。'}
          </p>
        </div>
      </div>

      {/* 6. 产出物与知识沉淀 */}
      <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-2xs space-y-2">
        <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
          <BookOpen className="w-3.5 h-3.5 text-slate-600" />
          闭环产出物进度
        </div>
        <div className="space-y-1.5 text-[11px]">
          <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between gap-2">
            <span className="text-slate-700 font-medium">已生成 / 应生成</span>
            <span className="font-mono text-emerald-600 font-bold shrink-0">
              {readyCount}/{data.artifacts.length}
            </span>
          </div>
          {data.artifacts
            .filter((a) => a.status === 'ready')
            .slice(-3)
            .map((a) => (
              <div key={a.id} className="p-2 rounded-lg bg-slate-50 border border-slate-100">
                <div className="flex items-center justify-between gap-2 text-slate-700 font-medium">
                  <span className="truncate">{a.name}</span>
                  <span className="font-mono text-slate-500 shrink-0 ml-1">{a.code}</span>
                </div>
                <div className="text-slate-400 text-[10px] mt-0.5">{a.category}</div>
              </div>
            ))}
          {knowledgeArtifact && (
            <div className="p-2 rounded-lg bg-indigo-50/60 border border-indigo-100">
              <div className="text-slate-700 font-medium">{knowledgeArtifact.name}</div>
              <div className="text-slate-500 text-[10px] mt-0.5">
                {knowledgeArtifact.status === 'ready' ? '已提交至知识贡献审核台' : 'AI 判定未达沉淀标准'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 7. 上下文速览（答案均来自本接口已回写字段） */}
      <div className="rounded-xl border border-indigo-200/70 bg-indigo-50/30 p-3.5 shadow-2xs space-y-2">
        <div className="text-xs font-bold text-indigo-900 flex items-center gap-1.5">
          <ChevronRight className="w-3.5 h-3.5 text-indigo-600" />
          上下文速览
        </div>
        <div className="space-y-1.5">
          {insights.map((item) => (
            <button
              key={item.question}
              type="button"
              onClick={() => setActiveQuestion(item)}
              className="w-full text-left p-2 rounded-lg bg-white border border-indigo-100 hover:border-indigo-300 hover:bg-indigo-50/50 text-[11px] text-slate-700 font-medium flex items-center justify-between gap-2 group transition-colors cursor-pointer"
            >
              <span className="truncate">{item.question}</span>
              <ChevronRight className="w-3 h-3 text-indigo-400 group-hover:text-indigo-600 shrink-0" />
            </button>
          ))}
        </div>
      </div>

      {activeQuestion && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl border border-slate-200 space-y-3 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-600" />
                <h4 className="text-xs font-bold text-slate-900">闭环上下文</h4>
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
              问：{activeQuestion.question}
            </div>

            <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">
              {activeQuestion.answer || '该信息尚未由服务端回写，完成对应环节后即可查看。'}
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
