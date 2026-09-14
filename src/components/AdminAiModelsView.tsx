import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Loader2,
  PlugZap,
  Plus,
  Power,
  RefreshCw,
  Route,
  XCircle,
} from 'lucide-react';
import { adminAiModelApi, AiModelConfig } from '../api';

const CAP_LABELS: Record<string, string> = { chat: '对话', vision: '视觉', video: '视频' };

const HEALTH_META: Record<string, { label: string; cls: string }> = {
  healthy: { label: '健康', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  unhealthy: { label: '异常', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  unknown: { label: '未检测', cls: 'bg-slate-50 text-slate-500 border-slate-200' },
};

interface TestResult {
  id: string;
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export const AdminAiModelsView: React.FC = () => {
  const [models, setModels] = useState<AiModelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [acting, setActing] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AiModelConfig | null>(null);
  const [form, setForm] = useState({
    provider: 'dashscope',
    displayName: '',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelName: '',
    apiKey: '',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    capabilities: ['chat'] as ('chat' | 'vision' | 'video')[],
    enabled: true,
  });

  const fetchList = async () => {
    setLoading(true);
    try {
      setModels(await adminAiModelApi.list());
      setError(null);
    } catch (e: any) {
      setError(e?.data?.message || e?.message || '模型配置列表加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
  }, []);

  const toggleEnabled = async (m: AiModelConfig) => {
    setActing(true);
    try {
      await adminAiModelApi.upsert({
        id: m.id,
        provider: m.provider,
        displayName: m.displayName,
        baseUrl: m.baseUrl,
        modelName: m.modelName,
        capabilities: m.capabilities,
        enabled: !m.enabled,
      });
      await fetchList();
    } catch (e: any) {
      setError(e?.data?.message || e?.message || '启停操作失败');
    } finally {
      setActing(false);
    }
  };

  const move = async (index: number, dir: -1 | 1) => {
    const next = [...models];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setModels(next);
    try {
      const res = await adminAiModelApi.reorder(next.map((m) => m.id));
      setModels(res.configs);
    } catch (e: any) {
      setError(e?.data?.message || e?.message || '排序失败');
      await fetchList();
    }
  };

  const handleTest = async (m: AiModelConfig) => {
    setTesting(m.id);
    try {
      const res = await adminAiModelApi.test(m.id);
      setTestResults((prev) => ({
        ...prev,
        [m.id]: { id: m.id, ok: res.success, latencyMs: res.latencyMs, error: res.error },
      }));
      await fetchList();
    } catch (e: any) {
      setTestResults((prev) => ({ ...prev, [m.id]: { id: m.id, ok: false, error: e?.data?.message || e?.message } }));
    } finally {
      setTesting(null);
    }
  };

  const openForm = (m?: AiModelConfig) => {
    setEditing(m || null);
    setForm(
      m
        ? {
            provider: m.provider,
            displayName: m.displayName,
            baseUrl: m.baseUrl,
            modelName: m.modelName,
            apiKey: '',
            apiKeyEnv: '',
            capabilities: m.capabilities,
            enabled: m.enabled,
          }
        : {
            provider: 'dashscope',
            displayName: '',
            baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            modelName: '',
            apiKey: '',
            apiKeyEnv: 'DASHSCOPE_API_KEY',
            capabilities: ['chat'],
            enabled: true,
          }
    );
    setFormOpen(true);
  };

  const handleSave = async () => {
    // Unicode NFC 规范化 + trim：防止粘贴入异常编码字符（如分解形字符）或首尾空白入库产生乱码观感
    const clean = (s: string) => s.normalize("NFC").trim();
    if (!clean(form.displayName) || !clean(form.modelName) || !form.capabilities.length) {
      setError('名称、模型名、能力至少一项能力为必填');
      return;
    }
    setActing(true);
    try {
      await adminAiModelApi.upsert({
        id: editing?.id,
        provider: clean(form.provider),
        displayName: clean(form.displayName),
        baseUrl: form.baseUrl.trim(),
        modelName: clean(form.modelName),
        capabilities: form.capabilities,
        enabled: form.enabled,
        ...(form.apiKeyEnv ? { apiKeyEnv: form.apiKeyEnv.trim() } : {}),
        ...(form.apiKey ? { apiKey: form.apiKey.trim() } : {}),
      });
      setFormOpen(false);
      await fetchList();
    } catch (e: any) {
      setError(e?.data?.message || e?.message || '保存失败');
    } finally {
      setActing(false);
    }
  };

  const toggleCap = (cap: 'chat' | 'vision' | 'video') => {
    setForm((f) => ({
      ...f,
      capabilities: f.capabilities.includes(cap)
        ? f.capabilities.filter((c) => c !== cap)
        : [...f.capabilities, cap],
    }));
  };

  return (
    <div className="p-4 md:p-6 max-w-[1100px] mx-auto">
      {/* 页头 */}
      <div className="glass-card p-5 shadow-sm mb-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900 flex items-center">
              <Route className="w-5 h-5 mr-2 text-blue-600" />
              AI 模型路由
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              多模型接入与降级顺序管理：按优先级依次尝试，失败（超时/5xx/鉴权失败）自动切换下一候选，全链路审计可查
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={fetchList}
              className="p-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 hover:text-blue-600 transition-colors cursor-pointer"
              title="刷新"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-600' : ''}`} />
            </button>
            <button
              onClick={() => openForm()}
              className="px-3.5 py-1.5 rounded-lg btn-gradient text-xs font-medium flex items-center space-x-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>新增模型</span>
            </button>
          </div>
        </div>
      </div>

      {error && (
        <p className="mb-3 text-xs text-rose-600 flex items-center">
          <AlertTriangle className="w-3.5 h-3.5 mr-1" />
          {error}
        </p>
      )}

      {/* 模型卡片列表（按降级优先级排序） */}
      {loading ? (
        <div className="glass-card p-10 flex flex-col items-center text-slate-400 text-xs">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500 mb-2" />
          加载模型配置…
        </div>
      ) : (
        <div className="space-y-2.5">
          {models.map((m, i) => {
            const hm = HEALTH_META[m.healthStatus] || HEALTH_META.unknown;
            const tr = testResults[m.id];
            return (
              <div
                key={m.id}
                className={`glass-card p-4 shadow-sm flex items-start justify-between gap-3 border-l-4 ${
                  m.enabled ? 'border-l-blue-500' : 'border-l-slate-300 opacity-70'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[10px] text-slate-400 font-bold">#{i + 1}</span>
                    <span className="text-sm font-bold text-slate-900">{m.displayName}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${hm.cls}`}>
                      {hm.label}
                    </span>
                    {m.capabilities.map((c) => (
                      <span key={c} className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-semibold">
                        {CAP_LABELS[c] || c}
                      </span>
                    ))}
                    {!m.enabled && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200 text-[10px] font-semibold">
                        已停用
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500 font-mono truncate">
                    {m.provider} · {m.modelName} · {m.baseUrl}
                  </p>
                  <p className="mt-0.5 text-[10px] text-slate-400 font-mono">
                    密钥：{m.apiKeyMasked}
                    {m.lastCheckedAt ? ` · 最近检测 ${new Date(m.lastCheckedAt).toLocaleString('zh-CN')}` : ''}
                  </p>
                  {tr && (
                    <p className={`mt-1 text-[11px] flex items-center ${tr.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {tr.ok ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}
                      {tr.ok ? `连接正常，耗时 ${tr.latencyMs}ms` : `连接失败：${tr.error}`}
                    </p>
                  )}
                </div>

                {/* 操作区：排序 / 测试 / 启停 / 编辑 */}
                <div className="flex flex-col gap-1.5 shrink-0">
                  <div className="flex gap-1">
                    <button
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      className="p-1.5 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-blue-600 cursor-pointer disabled:opacity-40"
                      title="提高优先级"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => move(i, 1)}
                      disabled={i === models.length - 1}
                      className="p-1.5 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-blue-600 cursor-pointer disabled:opacity-40"
                      title="降低优先级"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <button
                    onClick={() => handleTest(m)}
                    disabled={testing === m.id}
                    className="px-2.5 py-1.5 rounded-lg bg-white border border-blue-200 text-blue-600 hover:bg-blue-50 text-[11px] font-semibold cursor-pointer disabled:opacity-60 flex items-center justify-center"
                  >
                    {testing === m.id ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <PlugZap className="w-3 h-3 mr-1" />}
                    测试连接
                  </button>
                  <div className="flex gap-1">
                    <button
                      onClick={() => toggleEnabled(m)}
                      disabled={acting}
                      className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer disabled:opacity-60 flex items-center justify-center border ${
                        m.enabled
                          ? 'bg-white border-slate-200 text-slate-600 hover:text-rose-600'
                          : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      }`}
                      title={m.enabled ? '停用该模型' : '启用该模型'}
                    >
                      <Power className="w-3 h-3 mr-1" />
                      {m.enabled ? '停用' : '启用'}
                    </button>
                    <button
                      onClick={() => openForm(m)}
                      className="flex-1 px-2 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 hover:text-blue-600 text-[11px] font-semibold cursor-pointer"
                    >
                      编辑
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {models.length === 0 && (
            <div className="glass-card p-10 text-center">
              <Activity className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              <p className="text-xs text-slate-500">暂无模型配置，AI 调用将回退使用环境变量（DASHSCOPE_*）</p>
            </div>
          )}
        </div>
      )}

      {/* 新增/编辑表单弹层 */}
      {formOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={() => setFormOpen(false)}>
          <div className="w-full max-w-md glass-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-slate-800 flex items-center mb-3">
              <Route className="w-4 h-4 mr-1.5 text-blue-600" />
              {editing ? '编辑模型配置' : '新增模型配置'}
            </h3>
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-500 block mb-1">Provider *</label>
                  <input
                    value={form.provider}
                    onChange={(e) => setForm({ ...form, provider: e.target.value })}
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="dashscope / openai / deepseek…"
                  />
                </div>
                <div>
                  <label className="text-slate-500 block mb-1">显示名称 *</label>
                  <input
                    value={form.displayName}
                    onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="如：DeepSeek V3（备用）"
                  />
                </div>
              </div>
              <div>
                <label className="text-slate-500 block mb-1">模型名（model）*</label>
                <input
                  value={form.modelName}
                  onChange={(e) => setForm({ ...form, modelName: e.target.value })}
                  className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="如：deepseek-chat / qwen-plus"
                />
              </div>
              <div>
                <label className="text-slate-500 block mb-1">Base URL（OpenAI 兼容）</label>
                <input
                  value={form.baseUrl}
                  onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                  className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-500 block mb-1">API Key（明文，加密入库）</label>
                  <input
                    type="password"
                    value={form.apiKey}
                    onChange={(e) => setForm({ ...form, apiKey: e.target.value, apiKeyEnv: '' })}
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="留空则不修改"
                  />
                </div>
                <div>
                  <label className="text-slate-500 block mb-1">或引用环境变量名</label>
                  <input
                    value={form.apiKeyEnv}
                    onChange={(e) => setForm({ ...form, apiKeyEnv: e.target.value, apiKey: '' })}
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="DASHSCOPE_API_KEY"
                  />
                </div>
              </div>
              <div>
                <label className="text-slate-500 block mb-1">能力（多选）</label>
                <div className="flex gap-2">
                  {(['chat', 'vision', 'video'] as const).map((cap) => (
                    <button
                      key={cap}
                      type="button"
                      onClick={() => toggleCap(cap)}
                      className={`px-3 py-1.5 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                        form.capabilities.includes(cap)
                          ? 'bg-blue-50 border-blue-300 text-blue-700'
                          : 'bg-white border-slate-200 text-slate-500'
                      }`}
                    >
                      {CAP_LABELS[cap]}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center space-x-2 text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                  className="rounded"
                />
                <span>启用该模型（参与路由与降级）</span>
              </label>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={handleSave}
                disabled={acting}
                className="flex-1 py-2.5 rounded-lg btn-gradient text-xs font-semibold text-white cursor-pointer disabled:opacity-60 flex items-center justify-center"
              >
                {acting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
                保存
              </button>
              <button
                onClick={() => setFormOpen(false)}
                className="flex-1 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-xs font-semibold cursor-pointer"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
