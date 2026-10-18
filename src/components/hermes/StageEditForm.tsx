import type { EditableFieldSpec, FieldKind } from './stageEditSpecs';
import { groupValue, PRIORITY_LABEL } from './stageEditSpecs';

/** 确认闸门上的 AI 预填可改字段表单 */
export function EditForm({
  specs,
  raw,
  form,
  editable,
  onChange,
}: {
  specs: EditableFieldSpec[];
  raw: unknown;
  form: Record<string, string>;
  editable: boolean;
  onChange: (id: string, value: string) => void;
}) {
  if (!specs.length) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      {specs.map((f) => {
        const id = `${f.group}.${f.key}`;
        const base = groupValue(raw, f.group, f.key);
        const value = id in form ? form[id] : base;
        const dirty = value.trim() !== base.trim();
        return (
          <div key={id} className={f.span2 ? 'sm:col-span-2' : ''}>
            <LabeledField
              label={f.label}
              kind={f.kind}
              options={f.options}
              placeholder={f.placeholder}
              step={f.step}
              value={value}
              disabled={!editable}
              dirty={dirty}
              aiOriginal={base}
              onChange={(v) => onChange(id, v)}
            />
          </div>
        );
      })}
    </div>
  );
}

export function LabeledField({
  label,
  kind,
  options,
  placeholder,
  step,
  value,
  disabled,
  dirty,
  aiOriginal,
  onChange,
}: {
  label: string;
  kind: FieldKind;
  options?: string[];
  placeholder?: string;
  step?: string;
  value: string;
  disabled?: boolean;
  dirty?: boolean;
  aiOriginal?: string;
  onChange: (v: string) => void;
}) {
  const cls =
    'w-full text-xs rounded-lg border px-2.5 py-1.5 bg-white text-slate-800 outline-none transition-colors disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed focus:border-blue-400 focus:ring-2 focus:ring-blue-100 ' +
    (dirty ? 'border-blue-400' : 'border-slate-200');
  return (
    <label className="block space-y-1">
      <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
        <span className="font-medium">{label}</span>
        {dirty && (
          <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 border border-blue-200">
            已改
          </span>
        )}
      </span>
      {kind === 'select' ? (
        <select
          className={cls}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">（未填写）</option>
          {(options || []).map((o) => (
            <option key={o} value={o}>
              {label === '优先级' ? PRIORITY_LABEL[o] || o : o}
            </option>
          ))}
        </select>
      ) : kind === 'textarea' ? (
        <textarea
          className={cls}
          rows={2}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className={cls}
          type={kind === 'number' ? 'number' : 'text'}
          step={kind === 'number' ? step || '0.5' : undefined}
          min={kind === 'number' ? 0 : undefined}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {dirty && <span className="block text-[10px] text-slate-400">AI 原值：{aiOriginal || '（AI 未给出）'}</span>}
    </label>
  );
}

export function LabeledInput({
  label,
  kind,
  options,
  placeholder,
  value,
  disabled,
  onChange,
}: {
  label: string;
  kind: FieldKind;
  options?: string[];
  placeholder?: string;
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <LabeledField
      label={label}
      kind={kind}
      options={options}
      placeholder={placeholder}
      value={value}
      disabled={disabled}
      onChange={onChange}
    />
  );
}
