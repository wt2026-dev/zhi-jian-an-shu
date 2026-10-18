import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Hazard, Equipment, UserProfile } from '../../types';
import { hazardsApi } from '../../api';

export interface HazardMetrics {
  total?: number;
  closed?: number;
  major?: number;
  pending?: number;
  rectifying?: number;
}

export function useHazards(
  currentUser: UserProfile,
  equipments: Equipment[],
  allUsers: UserProfile[],
) {
  const [hazards, setHazards] = useState<Hazard[]>([]);
  const [metrics, setMetrics] = useState<HazardMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const canOperate = ['admin', 'manager', 'technician', 'inspector'].includes(currentUser.role);

  // Filters
  const [activeStatusTab, setActiveStatusTab] = useState<string>('all');
  const [selectedLevel, setSelectedLevel] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Selected Hazard for Detail Drawer
  const [selectedHazard, setSelectedHazard] = useState<Hazard | null>(null);

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);

  // Form states
  const [newHazard, setNewHazard] = useState({
    code: '',
    title: '',
    level: 'general' as 'major' | 'general',
    category: '机械安全',
    equipment_id: equipments[0]?.id || '',
    equipment_name: equipments[0]?.name || '',
    location: '循环泵房',
    description: '',
    reported_by: currentUser.name,
    deadline: '',
  });
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Assign form
  const [assignForm, setAssignForm] = useState({
    assignee_id: allUsers.find((u) => u.role === 'technician')?.id || '',
    deadline: '',
    dispatch_note: '',
  });
  const [assignSubmitting, setAssignSubmitting] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  // Verify form
  const [verifyForm, setVerifyForm] = useState({
    passed: true,
    comment: '现场复核隐患隐蔽工程已消除，各紧固件与绝缘良好，准予验收关闭。',
  });
  const [verifySubmitting, setVerifySubmitting] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Load hazards & metrics
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [listRes, metRes] = await Promise.all([
        hazardsApi.list(),
        hazardsApi.getMetrics(),
      ]);
      setHazards(listRes || []);
      setMetrics(metRes || null);
    } catch {
      // 容错处理
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadData);
  }, [loadData]);

  // Filter and sort: Major hazards pinned to top, then sorted by date
  const filteredHazards = useMemo(() => {
    return hazards
      .filter((h) => {
        const matchesStatus = activeStatusTab === 'all' || h.status === activeStatusTab;
        const matchesLevel = selectedLevel === 'all' || h.level === selectedLevel;
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          !query ||
          h.title.toLowerCase().includes(query) ||
          h.code.toLowerCase().includes(query) ||
          h.description.toLowerCase().includes(query) ||
          (h.equipment_name && h.equipment_name.toLowerCase().includes(query)) ||
          (h.location && h.location.toLowerCase().includes(query));

        return matchesStatus && matchesLevel && matchesSearch;
      })
      .sort((a, b) => {
        if (a.level === 'major' && b.level !== 'major') return -1;
        if (a.level !== 'major' && b.level === 'major') return 1;
        const statusWeight: Record<string, number> = {
          pending: 0,
          rectifying: 1,
          verifying: 2,
          closed: 3,
        };
        const swA = statusWeight[a.status] ?? 9;
        const swB = statusWeight[b.status] ?? 9;
        if (swA !== swB) return swA - swB;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [hazards, activeStatusTab, selectedLevel, searchQuery]);

  // Handle Create Hazard
  const handleCreateHazard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHazard.title || !newHazard.description) {
      setCreateError('请填写隐患标题与现场描述');
      return;
    }
    setCreateSubmitting(true);
    setCreateError(null);
    try {
      const code = newHazard.code || `HAZ-${Date.now().toString().slice(-6)}`;
      const eq = equipments.find((item) => item.id === newHazard.equipment_id);
      const created = await hazardsApi.create({
        ...newHazard,
        code,
        equipment_name: eq?.name || newHazard.equipment_name,
        reported_by: currentUser.name,
      });
      setHazards((prev) => [created, ...prev]);
      setCreateModalOpen(false);
      setNewHazard({
        code: '',
        title: '',
        level: 'general',
        category: '机械安全',
        equipment_id: equipments[0]?.id || '',
        equipment_name: equipments[0]?.name || '',
        location: '循环泵房',
        description: '',
        reported_by: currentUser.name,
        deadline: '',
      });
      void loadData();
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setCreateError(errorObj?.message || '上报隐患失败');
    } finally {
      setCreateSubmitting(false);
    }
  };

  const openAssignModal = (hazard: Hazard) => {
    setSelectedHazard(hazard);
    setAssignForm({
      assignee_id: allUsers.find((u) => u.role === 'technician')?.id || '',
      deadline: hazard.deadline || '2026-03-12',
      dispatch_note: `【安全隐患消缺工单】针对 ${hazard.title} 进行紧急整改检修`,
    });
    setAssignModalOpen(true);
  };

  const openVerifyModal = (hazard: Hazard) => {
    setSelectedHazard(hazard);
    setVerifyModalOpen(true);
  };

  // Handle Assign Work Order
  const handleAssignWorkOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedHazard) return;
    setAssignSubmitting(true);
    setAssignError(null);
    try {
      const res = await hazardsApi.assign(selectedHazard.id, {
        assignee_id: assignForm.assignee_id,
        deadline: assignForm.deadline,
        dispatch_note: assignForm.dispatch_note,
      });
      if (res?.hazard) {
        setHazards((prev) => prev.map((h) => (h.id === res.hazard.id ? res.hazard : h)));
        setSelectedHazard(res.hazard);
      }
      setAssignModalOpen(false);
      void loadData();
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setAssignError(errorObj?.message || '下发整改工单失败');
    } finally {
      setAssignSubmitting(false);
    }
  };

  // Handle Verify & Close
  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedHazard) return;
    setVerifySubmitting(true);
    setVerifyError(null);
    try {
      const res = await hazardsApi.verify(selectedHazard.id, {
        verifier: currentUser.name,
        comment: verifyForm.comment,
        passed: verifyForm.passed,
      });
      if (res?.hazard) {
        setHazards((prev) => prev.map((h) => (h.id === res.hazard.id ? res.hazard : h)));
        setSelectedHazard(res.hazard);
      }
      setVerifyModalOpen(false);
      void loadData();
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setVerifyError(errorObj?.message || '复核操作失败');
    } finally {
      setVerifySubmitting(false);
    }
  };

  // Request verify (technician moves from rectifying to verifying)
  const handleRequestVerify = async () => {
    if (!selectedHazard) return;
    try {
      const updated = await hazardsApi.update(selectedHazard.id, {
        status: 'verifying',
        rectifier: currentUser.name,
        rectify_desc: '现场消除隐患，更换备件并完成复位自检，申请主管复核验收。',
      });
      setHazards((prev) => prev.map((h) => (h.id === updated.id ? updated : h)));
      setSelectedHazard(updated);
      void loadData();
    } catch {
      // 容错处理
    }
  };

  const openCreateModal = () => {
    if (equipments[0]?.id && !newHazard.equipment_id) {
      setNewHazard((prev) => ({
        ...prev,
        equipment_id: equipments[0].id,
        equipment_name: equipments[0].name,
      }));
    }
    setCreateModalOpen(true);
  };

  return {
    hazards,
    metrics,
    isLoading,
    canOperate,
    activeStatusTab,
    setActiveStatusTab,
    selectedLevel,
    setSelectedLevel,
    searchQuery,
    setSearchQuery,
    filteredHazards,
    selectedHazard,
    setSelectedHazard,
    createModalOpen,
    setCreateModalOpen,
    openCreateModal,
    assignModalOpen,
    setAssignModalOpen,
    verifyModalOpen,
    setVerifyModalOpen,
    newHazard,
    setNewHazard,
    createSubmitting,
    createError,
    handleCreateHazard,
    assignForm,
    setAssignForm,
    assignSubmitting,
    assignError,
    handleAssignWorkOrder,
    verifyForm,
    setVerifyForm,
    verifySubmitting,
    verifyError,
    handleVerify,
    handleRequestVerify,
    openAssignModal,
    openVerifyModal,
    loadData,
  };
}
