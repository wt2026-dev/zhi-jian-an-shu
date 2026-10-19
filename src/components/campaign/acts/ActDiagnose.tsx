/**
 * 第 3 幕 · AI 诊断 —— 把真实遥测交给当前应答引擎，拿回结构化诊断报告。
 *
 * 对应项目功能：AI 多维故障诊断、故障树诊断、知识图谱。
 *
 * 数据红线：
 * - 入参只有台账里真实存在的字段与已落库遥测；缺测写"—"，不估算（与
 *   `DeviceAnalysisPanel` 同一句话口径，避免同一项目在两处给出不同说法）。
 * - `safetyNotice` 是**对象**，必须经 `normalizeSafetyNotice` 归一化再渲染，
 *   直接塞进 JSX 会让整棵树被错误边界卸载（那边注释里记着这个事故）。
 * - 模型降级（degraded / unavailable）时如实标注"结论可能不完整"，不粉饰。
 * - 没有返回结论就是没有结论：显示失败原因，不给兜底诊断。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppData } from '../../../context/AppDataContext';
import { cancelSpeech, speakChinese } from '../../digital-human/speech';
import { normalizeSafetyNotice, type AiSafetyNotice } from '../../equipment3d/aiDiagnosis';
import { buildHuntSpots } from '../../game/levelPlay';
import { pickIncident, type ActOutcome } from '../campaignModel';
import { useActClock } from '../useActClock';
import type { ActProps } from '../actContract';
import { ActFooter, ApiNotice, DataRow, Missing, Panel } from '../CampaignPanels';

/** `/api/v1/ai/diagnose` 的 diagnosis 字段（服务端比前端 AiDiagnosis 定义多几项，这里按实际返回声明） */
interface DiagnoseReport {
  severity: string;
  urgencyScore: number;
  summary: string;
  probableCauses?: Array<{ cause: string; probability?: number; detail?: string }>;
  safetyPrecautions?: string[];
  recommendedActions?: Array<{ step?: number; action: string; tools?: string[]; standard?: string }>;
  spareParts?: Array<{ name: string; spec?: string; qty?: number | string }>;
  estimatedRepairHours?: number | string;
}

const NOT_APPLICABLE = '—';

function readingOr(value: unknown, unit: string): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value}${unit}` : NOT_APPLICABLE;
}

export function ActDiagnose(props: ActProps) {
  const { run, stage, finish } = props;
  const { equipments } = useAppData();
  const elapsed = useActClock();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<DiagnoseReport | null>(null);
  const [safety, setSafety] = useState<AiSafetyNotice | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState(0);
  const [causePick, setCausePick] = useState<string | null>(null);
  const [causeMisses, setCauseMisses] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const incident = useMemo(() => run.incident ?? pickIncident(equipments), [run.incident, equipments]);
  const equipment = incident?.equipment ?? null;
  const telemetry = equipment?.telemetry;

  useEffect(() => () => abortRef.current?.abort(), []);

  const runDiagnose = useCallback(async () => {
    if (!equipment || !telemetry || busy) return;
    setBusy(true);
    setError(null);
    setReport(null);
    setSafety(null);
    setDegraded(false);
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const spots = buildHuntSpots(equipment);
    const abnormalLine = spots.filter((s) => s.abnormal).map((s) => `${s.label} ${s.reading}`);
    try {
      const res = await fetch('/api/v1/ai/diagnose', {
        method: 'POST',
        signal: controller.signal,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipmentName: equipment.name,
          equipmentCode: equipment.code,
          category: equipment.category,
          symptoms:
            `已落库遥测: 轴温 ${readingOr(telemetry.temperature, '℃')}，振动 ${readingOr(telemetry.vibration, 'mm/s')}，` +
            `电流 ${readingOr(telemetry.current, 'A')}，电压 ${readingOr(telemetry.voltage, 'V')}，` +
            `负载率 ${readingOr(telemetry.loadRate, '%')}；${NOT_APPLICABLE} 表示缺测，不估算。` +
            (abnormalLine.length ? ` 超限测点：${abnormalLine.join('、')}。` : ' 各阈值测点读数均在限值内。') +
            (incident ? ` 台账状态：${incident.faultType}。` : ''),
          telemetry,
          // 服务端 schema 是 string 而非数组：给数组会被 Zod 判 400，第 3 幕直接失败
          errorCodes: [equipment.status, ...abnormalLine].join('、'),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      if (!data?.success || !data?.diagnosis) throw new Error(data?.error || 'AI 研判未返回结论');
      setReport(data.diagnosis as DiagnoseReport);
      setSafety(normalizeSafetyNotice(data.safetyNotice));
      setDegraded(data.degraded === true || data.outcome === 'degraded' || data.outcome === 'unavailable');
      stage.setMood('celebrate');
      void speakChinese(`诊断回来了。${String(data.diagnosis.summary ?? '').slice(0, 90)}`, { gender: 'male', maxChars: 120 });
    } catch (err) {
      if (controller.signal.aborted) return;
      setErrors((n) => n + 1);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [busy, equipment, incident, stage, telemetry]);

  const causes = useMemo(() => report?.probableCauses ?? [], [report]);
  const topCause = useMemo(() => causes.reduce((best, c) => (!best || (c.probability ?? 0) > (best.probability ?? 0) ? c : best), null), [causes]);
  const causePicked = causePick !== null;

  const pickCause = (cause: string) => {
    if (causePicked) return;
    setCausePick(cause);
    if (topCause && cause !== topCause.cause) {
      setCauseMisses((n) => n + 1);
      stage.setMood('regret');
      void speakChinese('这条不是概率最高的。看括号里的置信度。', { gender: 'male', maxChars: 60 });
    } else {
      stage.setMood('celebrate');
    }
  };

  const next = () => {
    const seconds = elapsed();
    const mistakeCount = errors + causeMisses;
    const outcome: ActOutcome = {
      actId: 'diagnose',
      firstTryRate: mistakeCount === 0 ? 1 : Math.max(0.3, 1 - mistakeCount * 0.3),
      mistakes: mistakeCount,
      seconds,
    };
    stage.setMood('idle');
    cancelSpeech();
    finish(outcome, { diagnosis: report, diagnosisDegraded: degraded });
  };

  if (!equipment) {
    return (
      <Panel title="AI 诊断" accent="rose">
        <ApiNotice kind="empty" text="第 2 幕没有选定报警设备（台账当前无异常），AI 诊断没有可分析的标的。" />
      </Panel>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <Panel
        title={`AI 多维故障诊断 · ${equipment.name}`}
        accent="cyan"
        right={<span className="text-[10px] text-slate-500">POST /api/v1/ai/diagnose</span>}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mb-1.5 rounded-md border border-white/10 bg-white/2 px-2 py-1.5 text-[10px] leading-relaxed text-slate-400">
          送入模型的是台账与已落库遥测：轴温 {readingOr(telemetry?.temperature, '℃')}、振动 {readingOr(telemetry?.vibration, 'mm/s')}、
          电流 {readingOr(telemetry?.current, 'A')}、负载率 {readingOr(telemetry?.loadRate, '%')}；{NOT_APPLICABLE} 表示缺测，不估算。
        </div>

        {busy && <div className="py-4 text-center text-[11px] text-cyan-300/80">诊断引擎正在研判…</div>}
        {!busy && !report && !error && (
          <div className="py-4 text-center text-[11px] text-slate-500">点下方"启动 AI 诊断"，把这台设备的真实读数交给模型。</div>
        )}
        {error && <ApiNotice kind="error" text={`${error}（未获得结论，不做人工兜底诊断）`} />}

        {report && (
          <div className="space-y-2">
            {degraded && <ApiNotice kind="degraded" text="模型返回被标记为降级/不可用，以下结论仅供参考，须现场复核。" />}
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded border border-rose-400/40 bg-rose-400/10 px-1.5 py-0.5 text-[10px] font-bold text-rose-200">
                等级 {report.severity || NOT_APPLICABLE}
              </span>
              <span className="hud-tabular-nums rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-200">
                紧急度 {report.urgencyScore ?? NOT_APPLICABLE}
              </span>
              {report.estimatedRepairHours !== undefined && (
                <span className="hud-tabular-nums rounded border border-cyan-400/35 bg-cyan-400/8 px-1.5 py-0.5 text-[10px] text-cyan-200">
                  预计 {report.estimatedRepairHours} 工时
                </span>
              )}
            </div>
            <p className="text-[11px] leading-relaxed text-slate-200">{report.summary || <Missing text="模型未给出结论摘要" />}</p>

            <div>
              <div className="mb-1 text-[10px] font-bold tracking-wide text-slate-400">最可能的故障原因（点一条你判断概率最高的）</div>
              {causes.length === 0 && <ApiNotice kind="empty" text="模型未返回原因清单。" />}
              <ul className="space-y-1">
                {causes.map((c) => {
                  const isTop = topCause?.cause === c.cause;
                  const chosen = causePick === c.cause;
                  return (
                    <li key={c.cause}>
                      <button
                        type="button"
                        disabled={causePicked}
                        onClick={() => pickCause(c.cause)}
                        className={`w-full rounded-md border px-2 py-1 text-left text-[11px] ${
                          chosen
                            ? isTop
                              ? 'border-emerald-400/60 bg-emerald-400/12 text-emerald-100'
                              : 'border-rose-400/60 bg-rose-400/12 text-rose-100'
                            : causePicked && isTop
                              ? 'border-emerald-400/40 bg-emerald-400/8 text-emerald-100'
                              : 'border-white/10 bg-white/2 text-slate-300 hover:border-cyan-400/40'
                        }`}
                      >
                        <span className="font-semibold">{c.cause}</span>
                        {typeof c.probability === 'number' && <span className="hud-tabular-nums ml-1.5 text-[10px] text-amber-300">{c.probability}%</span>}
                        {c.detail && <span className="mt-0.5 block text-[10px] leading-relaxed text-slate-400">{c.detail}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {report.recommendedActions?.length ? (
              <div>
                <div className="mb-1 text-[10px] font-bold tracking-wide text-slate-400">建议排查与处置步骤</div>
                <ol className="space-y-1">
                  {report.recommendedActions.map((a, i) => (
                    <li key={`${a.action}-${i}`} className="text-[11px] leading-relaxed">
                      <span className="hud-tabular-nums mr-1 text-cyan-300">{a.step ?? i + 1}.</span>
                      {a.action}
                      {a.tools?.length ? <span className="ml-1 text-[10px] text-slate-500">工具：{a.tools.join('、')}</span> : null}
                      {a.standard ? <span className="ml-1 text-[10px] text-emerald-300/75">标准：{a.standard}</span> : null}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}

            {report.spareParts?.length ? (
              <div>
                <div className="mb-1 text-[10px] font-bold tracking-wide text-slate-400">AI 判断需要的备件</div>
                <ul className="space-y-0.5">
                  {report.spareParts.map((p, i) => (
                    <li key={`${p.name}-${i}`}>
                      <DataRow label={p.spec ? `${p.name}（${p.spec}）` : p.name} value={p.qty ?? '数量未给出'} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {report.safetyPrecautions?.length ? (
              <div className="rounded-md border border-amber-400/30 bg-amber-400/6 px-2 py-1.5">
                <div className="mb-0.5 text-[10px] font-bold text-amber-200">安全注意事项</div>
                <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-amber-100/85">
                  {report.safetyPrecautions.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {safety && (
              <ApiNotice
                kind={safety.degraded ? 'degraded' : safety.required ? 'error' : 'empty'}
                text={`${safety.reason || '服务端未给出安全提示'}${safety.riskTypes?.length ? `（风险类型：${safety.riskTypes.join('、')}）` : ''}${
                  safety.requiresConfirmation ? ' 需现场二次确认后方可作业。' : ''
                }`}
              />
            )}
          </div>
        )}
      </Panel>

      <ActFooter
        hint={
          report
            ? causePicked || !topCause
              ? '结论已到手，下一幕据此制定检修方案。'
              : '先在原因清单里点一条，再进下一幕。'
            : error
              ? '诊断失败可以重试；不带结论也能往下走，但方案幕会缺少依据。'
              : '这一步就是把真实遥测喂给大模型，看它给出机理、风险与处置建议。'
        }
        busy={busy}
        primary={
          report || error
            ? { text: '进入第 4 幕 · 制定方案', onClick: next, disabled: !!topCause && !causePicked }
            : { text: '启动 AI 诊断', onClick: runDiagnose }
        }
        secondary={error && !report ? { text: '重试诊断', onClick: runDiagnose } : undefined}
      />
    </div>
  );
}
