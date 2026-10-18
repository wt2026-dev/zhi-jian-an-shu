import { useState, useEffect, useCallback } from 'react';
import { adminAiModelApi, AiModelConfig } from '../../api';
import { CapabilityType, ModelFormData, TestResult } from './aiModelTypes';

const INITIAL_FORM: ModelFormData = {
  provider: 'dashscope',
  displayName: '',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  modelName: '',
  apiKey: '',
  apiKeyEnv: 'DASHSCOPE_API_KEY',
  capabilities: ['chat'],
  enabled: true,
};

export function useAdminAiModels() {
  const [models, setModels] = useState<AiModelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [acting, setActing] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AiModelConfig | null>(null);
  const [form, setForm] = useState<ModelFormData>(INITIAL_FORM);

  const fetchList = useCallback(async () => {
    try {
      const data = await adminAiModelApi.list();
      setModels(data);
      setError(null);
    } catch (e: unknown) {
      const err = e as { data?: { message?: string }; message?: string };
      setError(err?.data?.message || err?.message || '模型配置列表加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    void fetchList();
  }, [fetchList]);

  useEffect(() => {
    let ignore = false;
    void adminAiModelApi
      .list()
      .then((data) => {
        if (!ignore) {
          setModels(data);
          setError(null);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (!ignore) {
          const err = e as { data?: { message?: string }; message?: string };
          setError(err?.data?.message || err?.message || '模型配置列表加载失败');
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
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
    } catch (e: unknown) {
      const err = e as { data?: { message?: string }; message?: string };
      setError(err?.data?.message || err?.message || '启停操作失败');
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
    } catch (e: unknown) {
      const err = e as { data?: { message?: string }; message?: string };
      setError(err?.data?.message || err?.message || '排序失败');
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
    } catch (e: unknown) {
      const err = e as { data?: { message?: string }; message?: string };
      setTestResults((prev) => ({
        ...prev,
        [m.id]: { id: m.id, ok: false, error: err?.data?.message || err?.message },
      }));
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
        : { ...INITIAL_FORM }
    );
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
  };

  const handleSave = async () => {
    // Unicode NFC 规范化 + trim：防止异常编码字符或首尾空白入库
    const clean = (s: string) => s.normalize('NFC').trim();
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
    } catch (e: unknown) {
      const err = e as { data?: { message?: string }; message?: string };
      setError(err?.data?.message || err?.message || '保存失败');
    } finally {
      setActing(false);
    }
  };

  const toggleCap = (cap: CapabilityType) => {
    setForm((f) => ({
      ...f,
      capabilities: f.capabilities.includes(cap)
        ? f.capabilities.filter((c) => c !== cap)
        : [...f.capabilities, cap],
    }));
  };

  const setFormField = <K extends keyof ModelFormData>(field: K, value: ModelFormData[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const totalCount = models.length;
  const enabledCount = models.filter((m) => m.enabled).length;
  const healthyCount = models.filter((m) => m.healthStatus === 'healthy').length;
  const unhealthyCount = models.filter((m) => m.healthStatus === 'unhealthy').length;
  const unknownCount = models.filter((m) => m.healthStatus === 'unknown' || !m.healthStatus).length;

  return {
    models,
    loading,
    error,
    testing,
    testResults,
    acting,
    formOpen,
    editing,
    form,
    fetchList,
    refresh,
    toggleEnabled,
    move,
    handleTest,
    openForm,
    closeForm,
    handleSave,
    toggleCap,
    setFormField,
    totalCount,
    enabledCount,
    healthyCount,
    unhealthyCount,
    unknownCount,
  };
}
