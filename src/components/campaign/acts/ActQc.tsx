/**
 * 第 6 幕 · AI 质检 —— 上传复装后的现场照片，让视觉模型按验收口径复核。
 *
 * 对应项目功能：AI 视觉质检（多模态模型）。
 *
 * 数据红线：
 * - 照片来自玩家本机文件（`<input type=file>`），压缩后走真实 `POST /upload/image` 落盘，
 *   再把 dataURL 与外链一起交给 `POST /ai/vision-defect-detect`；不上传就没有质检结论。
 * - 合格与否**只由模型返回的 severity 映射**：正常/轻微 = 合格，一般/较大/严重 = 不合格。
 *   接口降级（modelEngine = fallback-degraded、confidence 0）时不出结论，只如实说降级 ——
 *   服务不可用时给一个"检修合格"是造假。
 * - 判为不合格的工单，第 7 幕验收就判不合格（`pass: false`），工单退回检修中，
 *   锁具也因此解不开；这一幕的结论会真的影响下一幕的走法。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppData } from '../../../context/AppDataContext';
import { aiApi, ApiError } from '../../../api';
import { cancelSpeech, speakChinese } from '../../digital-human/speech';
import { pickIncident } from '../campaignModel';
import { useActClock } from '../useActClock';
import type { ActProps } from '../actContract';
import { ActFooter, ApiNotice, Panel } from '../CampaignPanels';

interface VisionResult {
  severity?: string;
  defectType?: string;
  confidence?: number;
  summary?: string;
  location?: string;
  probableCauses?: string[];
  recommendations?: string[];
  safetyNotice?: string;
  modelEngine?: string;
}

/** 只按模型评级映射，映射不到就是"无结论" */
const PASS_SEVERITIES = ['正常', '轻微'];
const FAIL_SEVERITIES = ['一般', '较大', '严重', '严重隐患'];

function errMsg(x: unknown): string {
  if (x instanceof ApiError || x instanceof Error) return x.message;
  return String(x);
}

/**
 * 把手机原图压到长边 1280 的 JPEG：上传接口有 5MB 请求体上限，
 * 而视觉模型只需要看清表面缺陷，原图尺寸没有意义。
 */
async function compressToDataUrl(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('图片解码失败'));
      img.src = objectUrl;
    });
    const scale = Math.min(1, 1280 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
    canvas.height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('浏览器不支持 canvas 压缩');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function ActQc(props: ActProps) {
  const { run, currentUser, finish } = props;
  const { equipments } = useAppData();
  const elapsed = useActClock();

  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [hostedUrl, setHostedUrl] = useState<string | null>(null);
  const [result, setResult] = useState<VisionResult | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState(0);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const inspectorName = currentUser?.name ?? '';
  const incident = useMemo(() => run.incident ?? pickIncident(equipments), [run.incident, equipments]);
  const equipment = incident?.equipment ?? null;
  const eqCategory = equipment?.category ?? '';
  const eqName = equipment?.name ?? '';
  const eqCode = equipment?.code ?? '';

  const severity = String(result?.severity ?? '').trim();
  const verdict: boolean | null = useMemo(() => {
    if (!result || degraded) return null;
    if (PASS_SEVERITIES.includes(severity)) return true;
    if (FAIL_SEVERITIES.includes(severity)) return false;
    return null;
  }, [result, degraded, severity]);

  useEffect(() => {
    if (!result) return;
    void speakChinese(`视觉复核结果：${severity || '未给评级'}。${String(result.summary ?? '').slice(0, 60)}`, { gender: 'male', maxChars: 160 });
  }, [result, severity]);

  const runQc = useCallback(
    async (image: string) => {
      setBusy(true);
      setError(null);
      try {
        const upload = await aiApi.uploadImage(image, `campaign-qc-${eqCode || 'site'}.jpg`);
        const url = String(upload?.url ?? '');
        setHostedUrl(url || null);
        const detect = await aiApi.detectVisionDefects({
          imageBase64: image,
          imageUrl: url || undefined,
          equipmentType: eqCategory || eqName || '旋转机电设备',
          promptText:
            '这是检修复装完成后的现场复检照片。请按检修验收口径判断：紧固件是否装回到位、防护罩是否复位、有无渗漏油迹、有无遗留工具与开口、密封件是否安装。' +
            '若已恢复到位，severity 给"正常"；仍有可观察缺陷时按 轻微/一般/较大/严重 分级，并在 recommendations 里给出返工动作。',
        });
        const res = (detect?.defectResult ?? null) as VisionResult | null;
        // 降级分支由服务端在响应根上带 degraded（接口类型未声明该字段，这里按实际返回读）
        const isDegraded = (detect as { degraded?: boolean })?.degraded === true || res?.modelEngine === 'fallback-degraded' || res?.confidence === 0;
        setDegraded(Boolean(isDegraded));
        setResult(res);
        if (!res) setError('视觉接口未返回 defectResult');
      } catch (err) {
        setErrors((n) => n + 1);
        setError(errMsg(err));
        setResult(null);
        setDegraded(false);
      } finally {
        setBusy(false);
      }
    },
    [eqCategory, eqCode, eqName]
  );

  const onPickFile = useCallback(
    async (file: File | undefined) => {
      if (!file || !inspectorName) return;
      setBusy(true);
      try {
        const image = await compressToDataUrl(file);
        setDataUrl(image);
        await runQc(image);
      } catch (err) {
        setErrors((n) => n + 1);
        setError(errMsg(err));
        setBusy(false);
      }
    },
    [inspectorName, runQc]
  );

  const next = () => {
    cancelSpeech();
    finish(
      {
        actId: 'qc',
        firstTryRate: verdict === null ? 0.4 : errors === 0 ? 1 : Math.max(0.4, 1 - errors * 0.3),
        mistakes: errors,
        seconds: elapsed(),
      },
      {
        qcImageUrl: hostedUrl,
        qcVerdict: result ? `${severity || '未给评级'} · ${String(result.summary ?? '接口未给结论')}` : null,
        qcPass: verdict,
      }
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <Panel title="复装照片与视觉复核" accent="cyan" right={<span className="text-[10px] text-slate-500">/upload/image · /ai/vision-defect-detect</span>}>
        {!equipment && <ApiNotice kind="empty" text="前序幕次没有选定设备，本幕没有复核对象。" />}
        {!inspectorName && <ApiNotice kind="empty" text="未登录：不上传、不复核（不代填质检人）。" />}
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-cyan-400/40 bg-cyan-400/6 px-2 py-3 text-[11px] text-cyan-100 hover:bg-cyan-400/12">
          {dataUrl ? '换一张照片重新复核' : '选择现场照片（本机文件，压缩后真实上传）'}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            disabled={!inspectorName || busy}
            onChange={(e) => void onPickFile(e.target.files?.[0])}
          />
        </label>
        {dataUrl && <img src={dataUrl} alt="复检现场照片预览" className="mt-2 max-h-40 w-full rounded-md border border-white/10 object-contain" />}
        {busy && <div className="mt-1.5 text-[11px] text-cyan-300/85">上传中 / 视觉模型分析中…</div>}
        {error && (
          <div className="mt-1.5">
            <ApiNotice kind="error" text={`${error}（可换一张照片重试，本幕不用假结论兜底）`} />
          </div>
        )}
        {degraded && (
          <div className="mt-1.5">
            <ApiNotice kind="degraded" text="视觉服务返回降级结果（confidence 0 / fallback-degraded），本幕不出合格与否的结论。" />
          </div>
        )}
        <div className="mt-1 text-[10px] text-slate-500">
          照片落盘地址：{hostedUrl ? <span className="text-slate-300">{hostedUrl}</span> : '未上传'}
        </div>
      </Panel>

      <Panel title="AI 质检报告" accent="emerald" className="min-h-0 flex-1 overflow-y-auto">
        {!result && !busy && <ApiNotice kind="empty" text="还没有复核结果：上传照片后才会有 AI 结论。" />}
        {result && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span
                className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${
                  verdict === null
                    ? 'border-slate-500/40 bg-slate-500/10 text-slate-300'
                    : verdict
                      ? 'border-emerald-400/50 bg-emerald-400/12 text-emerald-100'
                      : 'border-rose-400/50 bg-rose-400/12 text-rose-100'
                }`}
              >
                {verdict === null ? '不出结论' : verdict ? '复检合格' : '需返工'}
              </span>
              <span className="text-[10px] text-slate-500">模型：{result.modelEngine ?? '接口未标注'}</span>
            </div>
            <div className="text-[11px] text-slate-200">
              评级 {severity || '未给'} · 缺陷 {String(result.defectType ?? '未给')} · 置信度{' '}
              {typeof result.confidence === 'number' ? `${Math.round(result.confidence * 100)}%` : '未给'}
            </div>
            <p className="text-[11px] leading-relaxed text-slate-300">{String(result.summary ?? '接口未给结论')}</p>
            {result.location && <div className="text-[10px] text-slate-400">部位：{String(result.location)}</div>}
            {result.probableCauses?.length ? <div className="text-[10px] text-slate-400">可能原因：{result.probableCauses.join('；')}</div> : null}
            {result.recommendations?.length ? (
              <ul className="space-y-0.5 text-[10px] text-slate-300">
                {result.recommendations.map((r, i) => (
                  <li key={`${i}-${String(r).slice(0, 8)}`}>· {String(r)}</li>
                ))}
              </ul>
            ) : null}
            {result.safetyNotice && (
              <div className="rounded-md border border-amber-400/25 bg-amber-400/6 px-2 py-1 text-[10px] text-amber-100/90">{String(result.safetyNotice)}</div>
            )}
            {verdict === false && (
              <div className="text-[10px] text-rose-200/85">判为不合格后，第 7 幕验收会如实判不合格，工单退回检修中。</div>
            )}
          </div>
        )}
      </Panel>

      <ActFooter
        hint={
          verdict === null
            ? '没有 AI 结论也能归档，但第 7 幕只能按人工复核口径写验收意见。'
            : verdict
              ? 'AI 认可复装到位，进入第 7 幕归档复盘。'
              : 'AI 判需返工：本批不支持回退重做，验收时如实记不合格。'
        }
        busy={busy}
        primary={{ text: '进入第 7 幕 · 归档复盘', onClick: next, disabled: !equipment }}
      />
    </div>
  );
}
