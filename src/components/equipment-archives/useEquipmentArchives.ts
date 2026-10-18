import React, { useState, useEffect, useMemo } from 'react';
import { Equipment } from '../../types';
import { equipmentApi, aiApi, AiEquipmentSummary } from '../../api';

export function useEquipmentArchives(
  equipments: Equipment[],
  onAddEquipment: (eq: Equipment) => void,
) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedWorkshop, setSelectedWorkshop] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  // Modals & Details
  const [activeEquipment, setActiveEquipment] = useState<Equipment | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [wechatQrFailedMap, setWechatQrFailedMap] = useState<Record<string, boolean>>({});
  const [isWeChatConfigured, setIsWeChatConfigured] = useState<boolean | null>(null);

  // 检查微信小程序凭证配置状态
  useEffect(() => {
    let mounted = true;
    fetch('/api/v1/wechat/token', { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        if (mounted) setIsWeChatConfigured(Boolean(data?.configured));
      })
      .catch(() => {
        if (mounted) setIsWeChatConfigured(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // New Equipment Form State
  const [formData, setFormData] = useState<Partial<Equipment>>({
    name: '',
    code: '',
    category: '泵类设备',
    model: '',
    workshop: '一号动力车间',
    location: '',
    manufacturer: '',
    criticality: '主要生产',
    status: 'running',
    healthScore: 90,
  });

  // AI 设备健康画像状态
  const [summaryState, setSummaryState] = useState<{
    open: boolean;
    loading: boolean;
    error: string | null;
    degraded?: boolean;
    data?: AiEquipmentSummary | null;
  }>({ open: false, loading: false, error: null });

  const handleEquipmentSummary = async (eq: Equipment) => {
    setSummaryState({ open: true, loading: true, error: null });
    try {
      const res = await aiApi.equipmentSummary({ equipmentId: eq.id });
      if (res.success && res.summary) {
        setSummaryState({ open: true, loading: false, error: null, data: res.summary });
      } else {
        setSummaryState({
          open: true,
          loading: false,
          error: res.message || res.error || 'AI 健康画像生成失败',
          degraded: res.degraded,
        });
      }
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setSummaryState({ open: true, loading: false, error: errorObj?.message || 'AI 调用失败' });
    }
  };

  // 新增设备提交状态与错误提示
  const [isCreatingEquipment, setIsCreatingEquipment] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const filteredEquipments = useMemo(() => {
    return (equipments || []).filter((eq) => {
      const q = (searchQuery || '').toLowerCase();
      const matchesSearch =
        !q ||
        (eq.name || '').toLowerCase().includes(q) ||
        (eq.code || '').toLowerCase().includes(q) ||
        (eq.model || '').toLowerCase().includes(q) ||
        (eq.manufacturer || '').toLowerCase().includes(q);

      const matchesWorkshop = selectedWorkshop === 'all' || eq.workshop === selectedWorkshop;
      const matchesCategory = selectedCategory === 'all' || eq.category === selectedCategory;
      const matchesStatus = selectedStatus === 'all' || eq.status === selectedStatus;

      return matchesSearch && matchesWorkshop && matchesCategory && matchesStatus;
    });
  }, [equipments, searchQuery, selectedWorkshop, selectedCategory, selectedStatus]);

  const handleCreateEquipment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.code) return;
    setIsCreatingEquipment(true);
    setCreateError(null);
    try {
      const created = await equipmentApi.create({
        code: formData.code,
        name: formData.name,
        category: (formData.category as string) || '泵类设备',
        model: formData.model,
        workshop: formData.workshop,
        location: formData.location,
        manufacturer: formData.manufacturer,
        status: (formData.status as string) || 'running',
        criticality: (formData.criticality as string) || '主要生产',
        specs: {
          '安装工段': formData.workshop || '一号动力车间',
        },
      });
      onAddEquipment(created);
      setShowAddModal(false);
      setFormData({
        name: '',
        code: '',
        category: '泵类设备',
        model: '',
        workshop: '一号动力车间',
        location: '',
        manufacturer: '',
      });
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setCreateError(errorObj?.message || '新增设备档案失败，请稍后重试');
    } finally {
      setIsCreatingEquipment(false);
    }
  };

  return {
    searchQuery,
    setSearchQuery,
    selectedWorkshop,
    setSelectedWorkshop,
    selectedCategory,
    setSelectedCategory,
    selectedStatus,
    setSelectedStatus,
    viewMode,
    setViewMode,
    activeEquipment,
    setActiveEquipment,
    showAddModal,
    setShowAddModal,
    showQrModal,
    setShowQrModal,
    wechatQrFailedMap,
    setWechatQrFailedMap,
    isWeChatConfigured,
    formData,
    setFormData,
    summaryState,
    setSummaryState,
    handleEquipmentSummary,
    isCreatingEquipment,
    createError,
    filteredEquipments,
    handleCreateEquipment,
  };
}
