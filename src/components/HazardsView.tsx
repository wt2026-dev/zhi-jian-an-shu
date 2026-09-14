import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  Clock,
  Search,
  Plus,
  Filter,
  Wrench,
  Check,
  Send,
  User,
  Calendar,
  X,
  RefreshCw,
  ArrowRight,
  Shield,
  Layers,
  AlertCircle,
  FileText,
  Flame,
} from 'lucide-react';
import { Hazard, Equipment, UserProfile } from '../types';
import { hazardsApi, equipmentApi } from '../api';

interface HazardsViewProps {
  currentUser: UserProfile;
  equipments: Equipment[];
  allUsers: UserProfile[];
  onNavigateToWorkOrders?: () => void;
}

export const HazardsView: React.FC<HazardsViewProps> = ({
  currentUser,
  equipments,
  allUsers,
  onNavigateToWorkOrders,
}) => {
  const [hazards, setHazards] = useState<Hazard[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
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
  const loadData = async () => {
    setIsLoading(true);
    try {
      const [listRes, metRes] = await Promise.all([
        hazardsApi.list(),
        hazardsApi.getMetrics(),
      ]);
      setHazards(listRes);
      setMetrics(metRes);
    } catch (e) {
      console.error('Failed to load hazards:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Filter and sort: Major hazards pinned to top, then sorted by date
  const filteredHazards = hazards
    .filter((h) => {
      const matchesStatus = activeStatusTab === 'all' || h.status === activeStatusTab;
      const matchesLevel = selectedLevel === 'all' || h.level === selectedLevel;
      const matchesSearch =
        h.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        h.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        h.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (h.equipment_name && h.equipment_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (h.location && h.location.toLowerCase().includes(searchQuery.toLowerCase()));

      return matchesStatus && matchesLevel && matchesSearch;
    })
    .sort((a, b) => {
      // 1. Major level first
      if (a.level === 'major' && b.level !== 'major') return -1;
      if (a.level !== 'major' && b.level === 'major') return 1;
      // 2. Pending first
      const statusWeight: Record<string, number> = {
        pending: 0,
        rectifying: 1,
        verifying: 2,
        closed: 3,
      };
      const swA = statusWeight[a.status] ?? 9;
      const swB = statusWeight[b.status] ?? 9;
      if (swA !== swB) return swA - swB;
      // 3. Newest first
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

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
      const eq = equipments.find((e) => e.id === newHazard.equipment_id);
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
      loadData();
    } catch (err: any) {
      setCreateError(err?.message || '上报隐患失败');
    } finally {
      setCreateSubmitting(false);
    }
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
      if (res && res.hazard) {
        setHazards((prev) => prev.map((h) => (h.id === res.hazard.id ? res.hazard : h)));
        setSelectedHazard(res.hazard);
      }
      setAssignModalOpen(false);
      loadData();
    } catch (err: any) {
      setAssignError(err?.message || '下发整改工单失败');
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
      if (res && res.hazard) {
        setHazards((prev) => prev.map((h) => (h.id === res.hazard.id ? res.hazard : h)));
        setSelectedHazard(res.hazard);
      }
      setVerifyModalOpen(false);
      loadData();
    } catch (err: any) {
      setVerifyError(err?.message || '复核操作失败');
    } finally {
      setVerifySubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return (
          <span className="px-2 py-0.5 rounded-full text-xs bg-orange-50 text-orange-700 border border-orange-200 flex items-center space-x-1 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span>
            <span>待整改</span>
          </span>
        );
      case 'rectifying':
        return (
          <span className="px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700 border border-blue-200 flex items-center space-x-1 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
            <span>整改中</span>
          </span>
        );
      case 'verifying':
        return (
          <span className="px-2 py-0.5 rounded-full text-xs bg-purple-50 text-purple-700 border border-purple-200 flex items-center space-x-1 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
            <span>待验收复核</span>
          </span>
        );
      case 'closed':
        return (
          <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center space-x-1 font-medium">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            <span>已闭环销号</span>
          </span>
        );
      default:
        return <span className="text-slate-600 font-medium">{status}</span>;
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center">
            <AlertTriangle className="w-5 h-5 mr-2 text-rose-600" />
            现场安全隐患闭环治理中枢
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            双重预防机制：重大隐患强制挂牌督办置顶，实现「上报 → 派发整改工单 → 现场消缺 → 复核闭环」全生命周期管控
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={loadData}
            className="p-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 hover:text-slate-900 transition-colors shadow-xs cursor-pointer"
            title="刷新隐患清单"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-blue-600' : ''}`} />
          </button>
          {canOperate ? (
            <button
              id="btn-create-hazard"
              onClick={() => setCreateModalOpen(true)}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 shadow-xs cursor-pointer transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>现场上报新隐患</span>
            </button>
          ) : (
            <span className="text-xs px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg border border-slate-200">
              现场隐患只读查阅
            </span>
          )}
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Pending */}
        <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between shadow-xs">
          <div>
            <div className="text-xs text-slate-500 font-medium">在控隐患总数</div>
            <div className="text-2xl font-bold text-slate-900 font-mono mt-1">
              {metrics?.total || hazards.length} 项
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              已闭环 {metrics?.closed || hazards.filter((h) => h.status === 'closed').length} 项
            </div>
          </div>
          <div className="w-11 h-11 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600">
            <Layers className="w-5 h-5" />
          </div>
        </div>

        {/* Major Hazards - Red Alert Card */}
        <div className="card-industrial bg-rose-50/40 border border-rose-200 rounded-lg p-4 flex items-center justify-between shadow-xs">
          <div>
            <div className="text-xs text-rose-700 font-medium flex items-center">
              <span>重大安全隐患</span>
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping ml-2"></span>
            </div>
            <div className="text-2xl font-bold text-rose-700 font-mono mt-1">
              {metrics?.major || hazards.filter((h) => h.level === 'major' && h.status !== 'closed').length} 项
            </div>
            <div className="text-[11px] text-rose-600 mt-1">厂级领导督办清单 (置顶)</div>
          </div>
          <div className="w-11 h-11 rounded-lg bg-rose-100 border border-rose-200 flex items-center justify-center text-rose-600">
            <ShieldAlert className="w-5 h-5" />
          </div>
        </div>

        {/* Pending Rectification */}
        <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between shadow-xs">
          <div>
            <div className="text-xs text-orange-700 font-medium">待派单 / 待整改</div>
            <div className="text-2xl font-bold text-orange-600 font-mono mt-1">
              {metrics?.pending || hazards.filter((h) => h.status === 'pending').length} 项
            </div>
            <div className="text-[11px] text-slate-500 mt-1">急需下发检修工单消缺</div>
          </div>
          <div className="w-11 h-11 rounded-lg bg-orange-50 border border-orange-200 flex items-center justify-center text-orange-600">
            <Clock className="w-5 h-5" />
          </div>
        </div>

        {/* Rectification In Progress */}
        <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between shadow-xs">
          <div>
            <div className="text-xs text-blue-700 font-medium">正在作业整改中</div>
            <div className="text-2xl font-bold text-blue-600 font-mono mt-1">
              {metrics?.rectifying || hazards.filter((h) => h.status === 'rectifying').length} 项
            </div>
            <div className="text-[11px] text-slate-500 mt-1">已挂牌关联检修工单</div>
          </div>
          <div className="w-11 h-11 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
            <Wrench className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Filter and State Machine Tabs */}
      <div className="card-industrial bg-white border border-slate-200 rounded-lg p-3 space-y-3 shadow-xs">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          {/* Status Tabs */}
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200">
            {[
              { id: 'all', label: '全部隐患' },
              { id: 'pending', label: '待整改' },
              { id: 'rectifying', label: '整改中' },
              { id: 'verifying', label: '待复核验收' },
              { id: 'closed', label: '已闭环销号' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveStatusTab(tab.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  activeStatusTab === tab.id
                    ? 'bg-white text-blue-600 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Level Filter */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setSelectedLevel('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                selectedLevel === 'all'
                  ? 'bg-slate-800 text-white font-medium'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              全部等级
            </button>
            <button
              onClick={() => setSelectedLevel('major')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center space-x-1 cursor-pointer transition-colors ${
                selectedLevel === 'major'
                  ? 'bg-rose-50 border-rose-300 text-rose-700 font-medium'
                  : 'bg-white border-slate-200 text-rose-600 hover:bg-rose-50/50'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>重大隐患</span>
            </button>
            <button
              onClick={() => setSelectedLevel('general')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                selectedLevel === 'general'
                  ? 'bg-slate-800 text-white font-medium'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              一般隐患
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="搜索隐患编号、隐患标题、具体风险征兆、设备位号或整改负责人..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-10 pr-4 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:bg-white transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Hazards List */}
      <div className="space-y-3">
        {filteredHazards.map((hazard) => {
          const isMajor = hazard.level === 'major';

          return (
            <div
              key={hazard.id}
              onClick={() => setSelectedHazard(hazard)}
              className={`p-4 rounded-lg border transition-all cursor-pointer shadow-xs ${
                isMajor
                  ? 'bg-rose-50/40 border-rose-200 hover:border-rose-300'
                  : 'bg-white border-slate-200 hover:border-blue-300 hover:shadow-sm'
              }`}
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="space-y-1.5 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Major Pin Badge */}
                    {isMajor && (
                      <span className="px-2 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold flex items-center space-x-1 shadow-xs">
                        <AlertTriangle className="w-3 h-3" />
                        <span>重大隐患 · 厂级督办</span>
                      </span>
                    )}

                    <span className="font-mono text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 font-semibold">
                      {hazard.code}
                    </span>

                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] border border-slate-200 font-medium">
                      {hazard.category}
                    </span>

                    {getStatusBadge(hazard.status)}
                  </div>

                  <h3 className="text-sm font-bold text-slate-900 flex items-center">
                    <span>{hazard.title}</span>
                  </h3>

                  <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                    {hazard.description}
                  </p>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 pt-1">
                    <span>关联设备: <strong className="text-slate-800 font-medium">{hazard.equipment_name || '公共区域'}</strong></span>
                    <span>区域: <span className="text-slate-700">{hazard.location || '厂区'}</span></span>
                    <span>上报人: <span className="text-slate-700">{hazard.reported_by}</span></span>
                    <span>要求整改期限: <strong className="text-orange-700 font-mono font-bold">{hazard.deadline || '即刻处置'}</strong></span>
                    {hazard.rectifier && (
                      <span>责任技师: <strong className="text-blue-700 font-medium">{hazard.rectifier}</strong></span>
                    )}
                  </div>
                </div>

                {/* Right Action Button */}
                <div className="flex items-center space-x-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100">
                  {canOperate && hazard.status === 'pending' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedHazard(hazard);
                        setAssignModalOpen(true);
                        setAssignForm({
                          assignee_id: allUsers.find((u) => u.role === 'technician')?.id || '',
                          deadline: hazard.deadline || '2026-03-12',
                          dispatch_note: `【安全隐患消缺工单】针对 ${hazard.title} 进行紧急整改检修`,
                        });
                      }}
                      className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center space-x-1 shadow-xs cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>下发整改单</span>
                    </button>
                  )}

                  {canOperate && hazard.status === 'verifying' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedHazard(hazard);
                        setVerifyModalOpen(true);
                      }}
                      className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center space-x-1 shadow-xs cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>复核销号</span>
                    </button>
                  )}

                  <button className="px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 text-xs border border-slate-200 flex items-center space-x-1 cursor-pointer font-medium shadow-xs">
                    <span>处理详情</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {filteredHazards.length === 0 && !isLoading && (
          <div className="card-industrial bg-white border border-slate-200 rounded-lg p-12 text-center text-slate-500 shadow-xs">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-2 text-emerald-600" />
            <p className="text-sm text-slate-800 font-semibold">该状态下暂无安全隐患</p>
            <p className="text-xs text-slate-500 mt-1">安全防线保持平稳，继续落实日常巡检与预防性维护</p>
          </div>
        )}
      </div>

      {/* Hazard Detail Drawer / Modal */}
      {selectedHazard && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-xl animate-in fade-in zoom-in-95">
            <div className="p-5 border-b border-slate-100 flex items-start justify-between">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 font-semibold">
                    {selectedHazard.code}
                  </span>
                  {selectedHazard.level === 'major' && (
                    <span className="px-2 py-0.5 rounded bg-rose-600 text-white text-xs font-bold shadow-xs">
                      重大隐患 · 厂级督办
                    </span>
                  )}
                  {getStatusBadge(selectedHazard.status)}
                </div>
                <h3 className="text-base font-bold text-slate-900 mt-2">{selectedHazard.title}</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  关联设备: {selectedHazard.equipment_name || '公共区域'} · 区域: {selectedHazard.location}
                </p>
              </div>

              <button
                onClick={() => setSelectedHazard(null)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 flex-1 overflow-y-auto space-y-4 text-xs">
              {/* Description */}
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 space-y-1.5">
                <span className="font-semibold text-slate-700 block">现场隐患征兆与风险特征描述</span>
                <p className="text-slate-600 leading-relaxed">{selectedHazard.description}</p>
              </div>

              {/* Grid detail */}
              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-4 rounded-lg border border-slate-200">
                <div>
                  <span className="text-slate-500 block">隐患分类</span>
                  <span className="text-slate-800 font-semibold">{selectedHazard.category}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">上报人 / 时间</span>
                  <span className="text-slate-800">{selectedHazard.reported_by} · {new Date(selectedHazard.created_at).toLocaleDateString()}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">要求整改截止时限</span>
                  <span className="text-orange-700 font-mono font-bold">{selectedHazard.deadline || '即刻整改'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">已下发工单</span>
                  <span className="text-blue-700 font-mono font-semibold">
                    {selectedHazard.work_order_id ? `工单 #${selectedHazard.work_order_id}` : '尚未下发工单'}
                  </span>
                </div>
              </div>

              {/* Rectification Details (If any) */}
              {selectedHazard.rectifier && (
                <div className="bg-blue-50/50 p-4 rounded-lg border border-blue-200 space-y-1.5">
                  <span className="font-semibold text-blue-900 block">整改消缺执行进度</span>
                  <div className="text-slate-700">主修责任人: <span className="font-medium text-slate-900">{selectedHazard.rectifier}</span></div>
                  {selectedHazard.rectify_desc && (
                    <div className="text-slate-700">消缺措施: {selectedHazard.rectify_desc}</div>
                  )}
                  {selectedHazard.rectified_at && (
                    <div className="text-[11px] text-slate-500 font-mono">
                      完工提交时间: {new Date(selectedHazard.rectified_at).toLocaleString()}
                    </div>
                  )}
                </div>
              )}

              {/* Verification Details (If Closed) */}
              {selectedHazard.verifier && (
                <div className="bg-emerald-50/50 p-4 rounded-lg border border-emerald-200 space-y-1.5">
                  <span className="font-semibold text-emerald-900 flex items-center">
                    <CheckCircle2 className="w-4 h-4 mr-1 text-emerald-600" />
                    复核验收闭环结论
                  </span>
                  <div className="text-slate-700">复核验收人: <span className="font-medium text-slate-900">{selectedHazard.verifier}</span></div>
                  {selectedHazard.verify_comment && (
                    <div className="text-slate-700">复核评价: {selectedHazard.verify_comment}</div>
                  )}
                </div>
              )}
            </div>

            {/* Footer Action Bar */}
            <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50 rounded-b-xl">
              <button
                onClick={() => setSelectedHazard(null)}
                className="px-4 py-2 rounded-lg bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-200 shadow-xs cursor-pointer"
              >
                关闭
              </button>

              <div className="flex items-center space-x-2">
                {canOperate && selectedHazard.status === 'pending' && (
                  <button
                    onClick={() => {
                      setAssignModalOpen(true);
                      setAssignForm({
                        assignee_id: allUsers.find((u) => u.role === 'technician')?.id || '',
                        deadline: selectedHazard.deadline || '2026-03-12',
                        dispatch_note: `【安全隐患消缺工单】针对 ${selectedHazard.title} 进行紧急整改检修`,
                      });
                    }}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 shadow-xs cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>一键派发整改工单</span>
                  </button>
                )}

                {canOperate && selectedHazard.status === 'rectifying' && (
                  <button
                    onClick={async () => {
                      // Move to verifying stage
                      try {
                        const updated = await hazardsApi.update(selectedHazard.id, {
                          status: 'verifying',
                          rectifier: currentUser.name,
                          rectify_desc: '现场消除隐患，更换备件并完成复位自检，申请主管复核验收。',
                        });
                        setHazards((prev) => prev.map((h) => (h.id === updated.id ? updated : h)));
                        setSelectedHazard(updated);
                        loadData();
                      } catch (e) {
                        console.error('Update hazard error:', e);
                      }
                    }}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 shadow-xs cursor-pointer"
                  >
                    <Wrench className="w-3.5 h-3.5" />
                    <span>提请复核验收</span>
                  </button>
                )}

                {canOperate && selectedHazard.status === 'verifying' && (
                  <button
                    onClick={() => setVerifyModalOpen(true)}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 shadow-xs cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>复核验收闭环</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Assign Work Order Modal */}
      {assignModalOpen && selectedHazard && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 space-y-4 shadow-xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900 flex items-center">
                <Send className="w-5 h-5 mr-2 text-blue-600" />
                派发隐患整改工单
              </h3>
              <button
                onClick={() => setAssignModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1 text-xs">
              <div className="font-semibold text-slate-800">{selectedHazard.title}</div>
              <div className="text-slate-500">设备: {selectedHazard.equipment_name} · 等级: {selectedHazard.level === 'major' ? '重大隐患' : '一般隐患'}</div>
            </div>

            <form onSubmit={handleAssignWorkOrder} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 mb-1 font-medium">指派主修技师 *</label>
                <select
                  value={assignForm.assignee_id}
                  onChange={(e) => setAssignForm({ ...assignForm, assignee_id: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  required
                >
                  {allUsers
                    .filter((u) => u.role === 'technician' || u.role === 'admin')
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.roleTitle || '维保技师'})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 mb-1 font-medium">整改截止时间 *</label>
                <input
                  type="date"
                  required
                  value={assignForm.deadline}
                  onChange={(e) => setAssignForm({ ...assignForm, deadline: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-700 mb-1 font-medium">整改调度说明 / 备件安全要求</label>
                <textarea
                  rows={3}
                  value={assignForm.dispatch_note}
                  onChange={(e) => setAssignForm({ ...assignForm, dispatch_note: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                ></textarea>
              </div>

              {assignError && (
                <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                  {assignError}
                </div>
              )}

              <div className="flex items-center justify-end space-x-3 pt-3">
                <button
                  type="button"
                  onClick={() => setAssignModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 cursor-pointer shadow-xs font-medium"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={assignSubmitting}
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold cursor-pointer disabled:opacity-50 shadow-xs"
                >
                  {assignSubmitting ? '正在派单...' : '确认下发工单'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Verify & Close Modal */}
      {verifyModalOpen && selectedHazard && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 space-y-4 shadow-xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900 flex items-center">
                <Check className="w-5 h-5 mr-2 text-emerald-600" />
                复核验收与隐患销号
              </h3>
              <button
                onClick={() => setVerifyModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleVerify} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 mb-1 font-medium">复核验收人</label>
                <input
                  type="text"
                  disabled
                  value={`${currentUser.name} (${currentUser.roleTitle || '安全总监/技术主管'})`}
                  className="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-slate-600"
                />
              </div>

              <div>
                <label className="block text-slate-700 mb-1 font-medium">验收结论 *</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setVerifyForm({ ...verifyForm, passed: true })}
                    className={`py-2 px-3 rounded-lg border font-semibold flex items-center justify-center space-x-1.5 cursor-pointer transition-all ${
                      verifyForm.passed
                        ? 'bg-emerald-600 border-emerald-600 text-white shadow-xs'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Check className="w-4 h-4" />
                    <span>合格准予销号</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setVerifyForm({ ...verifyForm, passed: false })}
                    className={`py-2 px-3 rounded-lg border font-semibold flex items-center justify-center space-x-1.5 cursor-pointer transition-all ${
                      !verifyForm.passed
                        ? 'bg-rose-600 border-rose-600 text-white shadow-xs'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <X className="w-4 h-4" />
                    <span>不合格退回重整</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 mb-1 font-medium">复核评价意见与试机证明 *</label>
                <textarea
                  rows={3}
                  required
                  value={verifyForm.comment}
                  onChange={(e) => setVerifyForm({ ...verifyForm, comment: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                ></textarea>
              </div>

              {verifyError && (
                <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                  {verifyError}
                </div>
              )}

              <div className="flex items-center justify-end space-x-3 pt-3">
                <button
                  type="button"
                  onClick={() => setVerifyModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 cursor-pointer shadow-xs font-medium"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={verifySubmitting}
                  className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer disabled:opacity-50 shadow-xs"
                >
                  {verifySubmitting ? '提交中...' : '确认复核归档'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create New Hazard Modal */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-6 space-y-4 shadow-xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900 flex items-center">
                <AlertTriangle className="w-5 h-5 mr-2 text-rose-600" />
                现场安全隐患实时上报建档
              </h3>
              <button
                onClick={() => setCreateModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateHazard} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 mb-1 font-medium">隐患评定等级 *</label>
                  <select
                    value={newHazard.level}
                    onChange={(e) => setNewHazard({ ...newHazard, level: e.target.value as any })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="general">一般隐患 (班组限期排查)</option>
                    <option value="major">重大隐患 (厂级督办置顶)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-700 mb-1 font-medium">专业分类</label>
                  <select
                    value={newHazard.category}
                    onChange={(e) => setNewHazard({ ...newHazard, category: e.target.value })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="机械安全">机械安全</option>
                    <option value="电气安全">电气安全</option>
                    <option value="压力容器">压力容器</option>
                    <option value="腐蚀渗漏">腐蚀渗漏</option>
                    <option value="消防安全">消防安全</option>
                    <option value="高空作业">高空作业</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 mb-1 font-medium">隐患标题 *</label>
                <input
                  type="text"
                  required
                  placeholder="例: 2号给水泵盘根填料严重滴漏伴随轴温异常"
                  value={newHazard.title}
                  onChange={(e) => setNewHazard({ ...newHazard, title: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 mb-1 font-medium">关联机组设备</label>
                  <select
                    value={newHazard.equipment_id}
                    onChange={(e) => setNewHazard({ ...newHazard, equipment_id: e.target.value })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  >
                    {equipments.map((eq) => (
                      <option key={eq.id} value={eq.id}>
                        {eq.name} ({eq.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-700 mb-1 font-medium">整改截止期限</label>
                  <input
                    type="date"
                    value={newHazard.deadline}
                    onChange={(e) => setNewHazard({ ...newHazard, deadline: e.target.value })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 mb-1 font-medium">现场隐患征兆与危害详细描述 *</label>
                <textarea
                  rows={3}
                  required
                  placeholder="详细描述现场安全隐患位置、可能造成的设备停机、火灾或人身电击次生灾害风险..."
                  value={newHazard.description}
                  onChange={(e) => setNewHazard({ ...newHazard, description: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                ></textarea>
              </div>

              {createError && (
                <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                  {createError}
                </div>
              )}

              <div className="flex items-center justify-end space-x-3 pt-3">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 cursor-pointer shadow-xs font-medium"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={createSubmitting}
                  className="px-5 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold cursor-pointer disabled:opacity-50 shadow-xs"
                >
                  {createSubmitting ? '上报中...' : '提交建档督办'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
