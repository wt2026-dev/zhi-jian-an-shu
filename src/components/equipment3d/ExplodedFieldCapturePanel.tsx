/**
 * 零件详情的「现场采集」面板：测量数据录入 + 现场照片关联。
 *
 * 挂在拆解工作台「维修历史」标签页里，随 3D/BOM 选中的零件位号联动 ——
 * 也就是维修人员"把这个零件拆下来，就地记一条"的入口。
 *
 * 数据契约（真实，禁止 mock）：
 *   · 可录科目**只**来自 `field-session.measurementItems`，即该设备在真实点检系统
 *     （inspections.points）里的测点与限值；没有科目时如实拒绝录入，不编造允许区间；
 *   · 数值提交走 `POST /api/v1/work-orders/:id/field-actions/measure`，
 *     合格性由**服务端**按 minLimit/maxLimit 复算（无限值时 ok=null 仅留痕）；
 *   · 照片必须先经 `POST /api/v1/upload/image` 真实落盘（/uploads/*.jpg），
 *     再打 `POST .../field-actions/photo` 把 url 与拆解 BOM 位号关联进工单档案；
 *   · 未通过 LOTO 安全确认时服务端 403 拒绝，本面板同步置灰并给出确认入口。
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Ruler,
  Camera,
  Loader2,
  AlertTriangle,
  ShieldCheck,
  CheckCircle2,
  MinusCircle,
  Trash2,
  ImageIcon,
} from 'lucide-react';
import { ApiError, aiApi, fieldOpsApi } from '../../api';
import type { FieldSessionData, FieldMeasurementItem } from '../../api';

export interface ExplodedFieldCapturePanelProps {
  session: FieldSessionData | null;
  /** 当前选中零件位号（拆解 BOM 真实 posNo；null = 未选中零件） */
  posNo: string | null;
  /** 位号对应的真实零件名（宿主从 BOM 台账取，取不到则只显示位号） */
  partName?: string | null;
  /** 写操作成功后回传服务端最新会话（单一数据源） */
  onSessionChange: (session: FieldSessionData) => void;
  /** 记录被服务端安全闸门拦下时，请求打开 LOTO 弹窗 */
  onRequestLoto: () => void;
}

function errMsg(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.data?.code === 'FIELD_LOTO_REQUIRED') return 'SAFETY_GATE';
    return err.message || '提交失败';
  }
  return err instanceof Error && err.message ? err.message : '提交失败，请稍后重试';
}

/**
 * 现场照片压到长边 1600 的 JPEG：上传接口请求体上限 15MB，
 * 而零件档案要能看清磨损/裂纹表面，比 1280 稍高一档。
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
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
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

/** 限值文案：只读真实点检标准，缺失时如实显示"—" */
function limitText(item: FieldMeasurementItem): string {
  if (item.minLimit == null && item.maxLimit == null) return '无限值（仅留痕，不判合格）';
  const lo = item.minLimit == null ? '—' : item.minLimit;
  const hi = item.maxLimit == null ? '—' : item.maxLimit;
  return `标准区间 ${lo} ~ ${hi}${item.unit ? ` ${item.unit}` : ''}`;
}

export const ExplodedFieldCapturePanel: React.FC<ExplodedFieldCapturePanelProps> = ({
  session,
  posNo,
  partName = null,
  onSessionChange,
  onRequestLoto,
}) => {
  const [checkPoint, setCheckPoint] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState<'measure' | 'photo' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const orderId = session?.order?.id ?? null;
  const recordable = Boolean(session?.canOperate && session?.loto);
  const items = useMemo(() => session?.measurementItems ?? [], [session?.measurementItems]);
  const picked = useMemo(() => items.find((i) => i.key === checkPoint) ?? null, [items, checkPoint]);
  const numericValue = Number.parseFloat(value);
  const valueOk = value.trim() !== '' && Number.isFinite(numericValue);

  // 已属于该零件的真实测量与照片（服务端留痕，按位号过滤）
  const partMeasurements = useMemo(
    () => (session?.measurements ?? []).filter((m) => m.posNo === posNo),
    [session?.measurements, posNo]
  );
  const partPhotos = useMemo(() => (session?.partPhotos ?? []).filter((p) => p.posNo === posNo), [session?.partPhotos, posNo]);

  const guard = useCallback(
    (err: unknown): void => {
      const msg = errMsg(err);
      if (msg === 'SAFETY_GATE') {
        setError('安全确认未完成：先通过 LOTO 四项强制检查才能现场采集。');
        onRequestLoto();
      } else {
        setError(msg);
      }
    },
    [onRequestLoto]
  );

  const submitMeasure = useCallback(async () => {
    if (!orderId || !posNo || !picked || !valueOk || busy) return;
    setBusy('measure');
    setError(null);
    try {
      const res = await fieldOpsApi.addMeasurement(orderId, { posNo, checkPoint: picked.key, value: numericValue });
      onSessionChange(res);
      setValue('');
    } catch (err: unknown) {
      guard(err);
    } finally {
      setBusy(null);
    }
  }, [orderId, posNo, picked, valueOk, busy, numericValue, onSessionChange, guard]);

  const onPickFile = useCallback(
    async (file: File | null) => {
      if (!file || !orderId || !posNo) return;
      setBusy('photo');
      setError(null);
      try {
        const dataUrl = await compressToDataUrl(file);
        const uploaded = await aiApi.uploadImage(dataUrl, `field-${posNo}-${Date.now()}.jpg`);
        const url = String(uploaded?.url ?? '');
        if (!url.startsWith('/uploads/')) throw new Error('上传接口未返回 /uploads/ 资源地址');
        const res = await fieldOpsApi.addPartPhoto(orderId, {
          posNo,
          url,
          filename: uploaded?.filename ?? file.name,
          size: typeof uploaded?.size === 'number' ? uploaded.size : file.size,
        });
        onSessionChange(res);
      } catch (err: unknown) {
        guard(err);
      } finally {
        setBusy(null);
        if (fileRef.current) fileRef.current.value = '';
      }
    },
    [orderId, posNo, onSessionChange, guard]
  );

  if (!posNo) {
    return (
      <div
        data-testid="equipment3d-field-capture-panel"
        className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-[10px] text-slate-500"
      >
        现场采集（测量 / 照片）针对具体零件：请先在 3D 模型或「零件清单」里选中一个拆下来的零件。
      </div>
    );
  }

  return (
    <div
      data-testid="equipment3d-field-capture-panel"
      className="flex flex-col gap-2 rounded-xl border border-cyan-500/30 bg-slate-950/92 text-slate-200 shadow-md backdrop-blur"
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-slate-900/80 px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Ruler className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
          <span className="text-[12px] font-semibold text-white">现场采集</span>
          <span className="truncate font-mono text-[10px] text-cyan-300">
            {posNo}
            {partName ? ` · ${partName}` : ''}
          </span>
        </div>
        {!recordable && (
          <button
            type="button"
            data-testid="equipment3d-field-capture-loto"
            onClick={onRequestLoto}
            className="shrink-0 rounded border border-amber-400/50 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-200 hover:bg-amber-500/25 cursor-pointer"
          >
            <ShieldCheck className="mr-1 inline h-3 w-3" />
            {session?.canOperate ? '待 LOTO 确认' : '不可记录'}
          </button>
        )}
      </div>

      <div className="px-3 pb-3 pt-2 text-[11px] leading-relaxed">
        {/* ── 录入测量数据 ── */}
        <div data-testid="equipment3d-field-measure-block">
          <div className="mb-1 text-[10px] tracking-wide text-slate-400">录入测量数据（拆下零件的间隙 / 振动 / 磨损量）</div>
          {items.length === 0 ? (
            <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-2.5 py-2 text-[10px] text-amber-200" data-testid="equipment3d-field-measure-no-standard">
              该设备在真实点检系统（inspections.points）里没有登记任何带标准的测点，因此不提供测量录入 —— 无标准可比对时不做测量留痕，不编造允许区间。
            </div>
          ) : (
            <>
              <select
                data-testid="equipment3d-field-measure-select"
                value={checkPoint}
                onChange={(e) => setCheckPoint(e.target.value)}
                className="w-full rounded-lg border border-white/15 bg-slate-900 px-2 py-2.5 text-[11px] text-slate-100 outline-none focus:border-cyan-400 cursor-pointer"
              >
                <option value="">选择点检科目（{items.length} 项真实标准）…</option>
                {items.map((i) => (
                  <option key={i.key} value={i.key}>
                    {i.checkPoint}
                    {i.unit ? `（${i.unit}）` : ''}
                  </option>
                ))}
              </select>

              {picked && (
                <div className="mt-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[10px] text-slate-300" data-testid="equipment3d-field-measure-standard">
                  <div>标准：{picked.standard ?? '—'}</div>
                  <div className="mt-0.5 text-slate-400">
                    {limitText(picked)}
                    {picked.method ? ` · 方法 ${picked.method}` : ''}
                  </div>
                </div>
              )}

              <div className="mt-1.5 flex items-stretch gap-1.5">
                <input
                  data-testid="equipment3d-field-measure-input"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={picked?.unit ? `实测值（${picked.unit}）` : '实测值'}
                  className="min-w-0 flex-1 rounded-lg border border-white/15 bg-slate-900 px-2.5 py-2.5 text-[13px] font-mono text-white outline-none focus:border-cyan-400"
                />
                <button
                  type="button"
                  data-testid="equipment3d-field-measure-submit"
                  disabled={!recordable || !picked || !valueOk || busy !== null}
                  onClick={() => void submitMeasure()}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2.5 text-[12px] font-bold transition ${
                    recordable && picked && valueOk && busy === null
                      ? 'cursor-pointer border-cyan-400/60 bg-cyan-500/25 text-cyan-100 hover:bg-cyan-500/40'
                      : 'border-white/10 bg-white/5 text-slate-600'
                  }`}
                >
                  {busy === 'measure' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ruler className="h-3.5 w-3.5" />}
                  记录测量
                </button>
              </div>
            </>
          )}

          {partMeasurements.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-1" data-testid="equipment3d-field-measure-list">
              {partMeasurements.map((m) => (
                <li
                  key={m.id}
                  data-testid={`equipment3d-field-measure-row-${m.checkPoint}`}
                  className={`rounded-lg border px-2 py-1.5 text-[10px] ${
                    m.ok === false ? 'border-rose-400/50 bg-rose-500/12' : m.ok === true ? 'border-emerald-400/35 bg-emerald-500/8' : 'border-white/10 bg-white/5'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    {m.ok === false ? (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-300" />
                    ) : m.ok === true ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
                    ) : (
                      <MinusCircle className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    )}
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-100">{m.checkPoint}</span>
                    <span className={`font-mono text-[11px] font-bold ${m.ok === false ? 'text-rose-200' : 'text-cyan-200'}`}>
                      {m.value}
                      {m.unit ?? ''}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[9px] text-slate-400">
                    <span>标准 {m.standard ?? '—'}</span>
                    <span>{m.by?.name ?? '—'}</span>
                    <span>{new Date(m.at).toLocaleString('zh-CN', { hour12: false })}</span>
                    <span className={m.ok === false ? 'font-bold text-rose-300' : m.ok === true ? 'text-emerald-300' : 'text-slate-400'}>
                      {m.ok === false ? '⚠ 超出标准区间' : m.ok === true ? '合格' : '无限值仅留痕'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── 上传现场照片 ── */}
        <div className="mt-2.5 border-t border-white/10 pt-2" data-testid="equipment3d-field-photo-block">
          <div className="mb-1 text-[10px] tracking-wide text-slate-400">上传现场照片（拍下的零件直接进该零件档案）</div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            data-testid="equipment3d-field-photo-input"
            className="hidden"
            onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            data-testid="equipment3d-field-photo-pick"
            disabled={!recordable || busy !== null}
            onClick={() => fileRef.current?.click()}
            className={`inline-flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-[12px] font-bold transition ${
              recordable && busy === null
                ? 'cursor-pointer border-emerald-400/50 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/35'
                : 'border-white/10 bg-white/5 text-slate-600'
            }`}
          >
            {busy === 'photo' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
            {busy === 'photo' ? '上传留档中…' : '拍照 / 选择照片并关联零件'}
          </button>

          {partPhotos.length > 0 ? (
            <div className="mt-1.5 grid grid-cols-3 gap-1.5" data-testid="equipment3d-field-photo-list">
              {partPhotos.map((p) => (
                <a
                  key={p.id}
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  data-testid={`equipment3d-field-photo-row-${p.url}`}
                  title={`${p.by?.name ?? ''} · ${new Date(p.at).toLocaleString('zh-CN', { hour12: false })}`}
                  className="block overflow-hidden rounded-lg border border-cyan-400/30 bg-slate-900"
                >
                  <img src={p.url} alt={`${p.posNo} 现场照片`} className="h-16 w-full object-cover" loading="lazy" />
                  <div className="flex items-center gap-1 px-1 py-0.5 text-[8px] text-slate-400">
                    <ImageIcon className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate">{p.by?.name ?? '—'}</span>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <div className="mt-1.5 flex items-center gap-1.5 text-[9px] text-slate-500" data-testid="equipment3d-field-photo-empty">
              <Trash2 className="h-3 w-3" />
              该零件还没有现场照片
            </div>
          )}
        </div>

        {error && (
          <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-rose-400/50 bg-rose-500/15 px-2.5 py-2 text-[11px] text-rose-200" data-testid="equipment3d-field-capture-error">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0">{error}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default ExplodedFieldCapturePanel;
