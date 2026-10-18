import { Loader2, RotateCcw } from 'lucide-react';
import type { LotoConfirmationItem, LotoFieldDraft } from './types';
import { LOTO_TYPES } from './stageEditSpecs';
import { LabeledInput } from './StageEditForm';

/** LOTO 单行：现场登记可改点位/要求/锁号/操作人，确认人仍只取登录身份 */
export function LotoRowEditor({
  item,
  form,
  editable,
  busy,
  onChangeField,
  onToggle,
  onSaveFields,
  onResetFields,
}: {
  item: LotoConfirmationItem;
  form?: LotoFieldDraft;
  editable: boolean;
  busy: boolean;
  onChangeField: (key: keyof LotoFieldDraft, value: string) => void;
  onToggle: (confirmed: boolean) => void;
  onSaveFields: () => void;
  onResetFields: () => void;
}) {
  const val = (key: keyof LotoFieldDraft) => String(form?.[key] ?? (item as any)[key] ?? '');
  const dirty = (['type', 'point', 'requirement', 'lockNumber', 'operator'] as const).some((k) => {
    const next = String(form?.[k] ?? '').trim();
    return next !== '' && next !== String((item as any)[k] ?? '').trim();
  });

  return (
    <div className={`rounded-xl border p-3 space-y-2 ${item.confirmed ? 'border-emerald-200 bg-emerald-50/25' : 'border-amber-200 bg-amber-50/20'}`}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-medium ${typeChip(item.type)}`}>{item.type}</span>
          <span className="text-xs font-semibold text-slate-900">{item.point}</span>
          {item.basis && item.basis !== 'JSA 评估输出' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">{item.basis}</span>
          )}
          {item.editedBy && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
              {item.editedBy} 现场登记 {item.editedAt || ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {dirty && editable && (
            <>
              <button
                type="button"
                onClick={onResetFields}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 px-2 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>还原</span>
              </button>
              <button
                type="button"
                onClick={onSaveFields}
                disabled={busy}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-white px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
              >
                {busy && <Loader2 className="w-3 h-3 animate-spin" />}
                <span>保存登记</span>
              </button>
            </>
          )}
          <label className={`inline-flex items-center gap-1.5 ${editable ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
            <input
              type="checkbox"
              checked={item.confirmed}
              disabled={!editable || busy}
              onChange={() => onToggle(!item.confirmed)}
              className="w-4 h-4 accent-emerald-600"
            />
            <span className="text-[11px] font-semibold text-slate-700">{item.confirmed ? '已确认' : '确认已隔离'}</span>
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <LabeledInput
          label="隔离类型"
          kind="select"
          options={LOTO_TYPES}
          value={val('type')}
          disabled={!editable || busy}
          onChange={(v) => onChangeField('type', v)}
        />
        <LabeledInput
          label="隔离点位"
          kind="text"
          value={val('point')}
          disabled={!editable || busy}
          onChange={(v) => onChangeField('point', v)}
        />
        <div className="sm:col-span-2">
          <LabeledInput
            label="操作要求与规范"
            kind="textarea"
            value={val('requirement')}
            disabled={!editable || busy}
            onChange={(v) => onChangeField('requirement', v)}
          />
        </div>
        <LabeledInput
          label="锁具/牌号（留空显示「现场登记」）"
          kind="text"
          value={val('lockNumber')}
          disabled={!editable || busy}
          onChange={(v) => onChangeField('lockNumber', v)}
        />
        <LabeledInput
          label="现场操作人（实际挂牌的人）"
          kind="text"
          value={val('operator')}
          disabled={!editable || busy}
          onChange={(v) => onChangeField('operator', v)}
        />
      </div>

      <div className="text-[10px] text-slate-500 leading-relaxed">
        确认人：{item.confirmedBy || '待确认'}
        {item.confirmed ? ` · ${item.confirmTime || ''}` : ''}；本行由登录身份记账，不可手填。
        {item.lockNumber ? '' : ' 锁具未匹配台账，请填写实际牌号后保存。'}
      </div>
      {dirty && !editable && <div className="text-[10px] text-slate-400">当前角色或环节状态不允许修改登记内容。</div>}
    </div>
  );
}

function typeChip(type: string) {
  if (type === '电气隔离') return 'bg-blue-50 text-blue-700 border border-blue-200/60';
  if (type === '气源隔离') return 'bg-cyan-50 text-cyan-700 border border-cyan-200/60';
  if (type === '残余能量') return 'bg-amber-50 text-amber-700 border border-amber-200/60';
  if (type === '液压隔离') return 'bg-sky-50 text-sky-700 border border-sky-200/60';
  return 'bg-slate-50 text-slate-600 border border-slate-200/60';
}
