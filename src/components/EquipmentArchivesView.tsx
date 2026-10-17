import React, { useState } from 'react';
import {
  Layers,
  Plus,
  Search,
  Filter,
  Activity,
  Wrench,
  Sparkles,
  QrCode,
  Calendar,
  MapPin,
  Tag,
  Shield,
  Clock,
  CheckCircle2,
  AlertTriangle,
  FileText,
  X,
  Edit2,
  Trash2,
  Printer,
  ChevronRight,
  Download,
  Smartphone,
} from 'lucide-react';
import { Equipment, EquipmentStatus, UserProfile } from '../types';
import { equipmentApi, aiApi } from '../api';
import { AiResultModal } from './ai/AiResultModal';
import { AiEquipmentSummary } from '../api';

interface EquipmentArchivesViewProps {
  currentUser: UserProfile;
  equipments: Equipment[];
  onAddEquipment: (eq: Equipment) => void;
  onUpdateEquipment: (eq: Equipment) => void;
  onDeleteEquipment: (id: string) => void;
  onOpenWorkOrderForEquipment: (eq: Equipment) => void;
  onOpenAiDiagnoseForEquipment: (eq: Equipment) => void;
}

export const EquipmentArchivesView: React.FC<EquipmentArchivesViewProps> = ({
  currentUser,
  equipments,
  onAddEquipment,
  onUpdateEquipment,
  onDeleteEquipment,
  onOpenWorkOrderForEquipment,
  onOpenAiDiagnoseForEquipment,
}) => {
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
  React.useEffect(() => {
    fetch('/api/v1/wechat/token', { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        setIsWeChatConfigured(Boolean(data?.configured));
      })
      .catch(() => {
        setIsWeChatConfigured(false);
      });
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

  // AI 设备健康画像状态 (功能 8)
  const [summaryState, setSummaryState] = useState<{ open: boolean; loading: boolean; error: string | null; degraded?: boolean; data?: AiEquipmentSummary | null }>({ open: false, loading: false, error: null });

  const handleEquipmentSummary = async (eq: Equipment) => {
    setSummaryState({ open: true, loading: true, error: null });
    try {
      const res = await aiApi.equipmentSummary({ equipmentId: eq.id });
      if (res.success && res.summary) {
        setSummaryState({ open: true, loading: false, error: null, data: res.summary });
      } else {
        setSummaryState({ open: true, loading: false, error: res.message || res.error || 'AI 健康画像生成失败', degraded: res.degraded });
      }
    } catch (err: any) {
      setSummaryState({ open: true, loading: false, error: err?.message || 'AI 调用失败' });
    }
  };

  // 新增设备提交状态与错误提示 (真实接口调用)
  const [isCreatingEquipment, setIsCreatingEquipment] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const workshops = ['all', '一号动力车间', '二号机加车间', '智能装配线', '储运与气体动力站'];
  const categories = ['all', '泵类设备', '压缩机', '传动减速机', '大型电机', '数控机床', '工业机器人'];
  const statuses: { id: string; label: string }[] = [
    { id: 'all', label: '全部状态' },
    { id: 'running', label: '正常运行' },
    { id: 'warning', label: '预警关注' },
    { id: 'fault', label: '故障待修' },
    { id: 'overhauling', label: '检修作业中' },
    { id: 'standby', label: '停机备用' },
  ];

  const filteredEquipments = (equipments || []).filter((eq) => {
    const q = (searchQuery || '').toLowerCase();
    const matchesSearch =
      (eq.name || '').toLowerCase().includes(q) ||
      (eq.code || '').toLowerCase().includes(q) ||
      (eq.model || '').toLowerCase().includes(q) ||
      (eq.manufacturer || '').toLowerCase().includes(q);

    const matchesWorkshop = selectedWorkshop === 'all' || eq.workshop === selectedWorkshop;
    const matchesCategory = selectedCategory === 'all' || eq.category === selectedCategory;
    const matchesStatus = selectedStatus === 'all' || eq.status === selectedStatus;

    return matchesSearch && matchesWorkshop && matchesCategory && matchesStatus;
  });

  const getStatusBadge = (status: EquipmentStatus) => {
    switch (status) {
      case 'running':
        return { label: '正常运行', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
      case 'warning':
        return { label: '预警关注', color: 'bg-orange-50 text-orange-700 border-orange-200' };
      case 'fault':
        return { label: '故障待修', color: 'bg-red-50 text-red-700 border-red-200' };
      case 'overhauling':
        return { label: '检修中', color: 'bg-blue-50 text-blue-700 border-blue-200' };
      case 'standby':
        return { label: '停机备用', color: 'bg-slate-100 text-slate-600 border-slate-200' };
      default:
        return { label: '报废', color: 'bg-slate-100 text-slate-600 border-slate-200' };
    }
  };

  const handleCreateEquipment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.code) return;
    setIsCreatingEquipment(true);
    setCreateError(null);
    try {
      // 真实落库：通过后端接口新增设备档案 (RBAC: 管理员/主管)
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
    } catch (err: any) {
      setCreateError(err?.message || '新增设备档案失败，请稍后重试');
    } finally {
      setIsCreatingEquipment(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header & Search Tools */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center">
            <Layers className="w-5 h-5 mr-2 text-cyan-600" />
            工业设备资产档案与全生命周期台账
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            共收录 <strong className="text-cyan-700 font-mono font-bold">{equipments.length}</strong> 台重点工业机组，覆盖运行状态、遥测实时数据、大修履历与电子二维码标签
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {currentUser.role === 'admin' && (
            <button
              id="btn-add-equipment"
              onClick={() => setShowAddModal(true)}
              className="px-3.5 py-2 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-colors flex items-center space-x-1.5 shadow-xs cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>新增设备档案</span>
            </button>
          )}

          <div className="flex rounded-lg bg-slate-100 p-1 border border-slate-200">
            <button
              onClick={() => setViewMode('grid')}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                viewMode === 'grid' ? 'bg-white text-cyan-700 font-medium shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              卡片视图
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                viewMode === 'table' ? 'bg-white text-cyan-700 font-medium shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              表格视图
            </button>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-3 shadow-xs card-industrial">
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="搜索设备名称、位号编码、型号规格、制造厂商..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:bg-white"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Workshop Filter */}
          <div className="flex items-center space-x-1.5 text-xs text-slate-600 shrink-0">
            <MapPin className="w-3.5 h-3.5 text-cyan-600" />
            <select
              value={selectedWorkshop}
              onChange={(e) => setSelectedWorkshop(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-xs text-slate-800 focus:outline-none focus:border-cyan-500 focus:bg-white cursor-pointer"
            >
              <option value="all">全部车间工段</option>
              {workshops.filter((w) => w !== 'all').map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </div>

          {/* Category Filter */}
          <div className="flex items-center space-x-1.5 text-xs text-slate-600 shrink-0">
            <Tag className="w-3.5 h-3.5 text-blue-600" />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-xs text-slate-800 focus:outline-none focus:border-cyan-500 focus:bg-white cursor-pointer"
            >
              <option value="all">全部分类</option>
              {categories.filter((c) => c !== 'all').map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div className="flex items-center space-x-1.5 text-xs text-slate-600 shrink-0">
            <Activity className="w-3.5 h-3.5 text-emerald-600" />
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-xs text-slate-800 focus:outline-none focus:border-cyan-500 focus:bg-white cursor-pointer"
            >
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Equipment View: Grid vs Table */}
      {filteredEquipments.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center shadow-xs card-industrial">
          <Layers className="w-12 h-12 text-slate-500 mx-auto mb-3" />
          <h4 className="text-sm font-semibold text-slate-700">未检索到匹配的工业设备</h4>
          <p className="text-xs text-slate-500 mt-1">请尝试更换搜索关键字或重置筛选条件</p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredEquipments.map((eq) => {
            const statusBadge = getStatusBadge(eq.status);
            const isAlarm = eq.healthScore < 60 || eq.status === 'fault';
            const isWarn = eq.healthScore >= 60 && eq.healthScore < 80;

            return (
              <div
                key={eq.id}
                onClick={() => setActiveEquipment(eq)}
                className="bg-white border border-slate-200 hover:border-cyan-400 rounded-xl p-4 transition-all hover:shadow-md flex flex-col justify-between group cursor-pointer card-industrial shadow-xs"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-cyan-50 text-cyan-700 border border-cyan-200 font-semibold">
                      {eq.code}
                    </span>
                    <div className="flex items-center space-x-1.5">
                      <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${statusBadge.color}`}>
                        {statusBadge.label}
                      </span>
                      <span
                        className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded ${
                          isAlarm ? 'bg-rose-50 text-rose-700 border border-rose-200' : isWarn ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}
                      >
                        {eq.healthScore}分
                      </span>
                    </div>
                  </div>
                  <h3 className="text-sm font-bold text-slate-800 group-hover:text-cyan-700 transition-colors">{eq.name}</h3>
                  <p className="text-xs text-slate-500 font-mono mt-0.5 line-clamp-1">{eq.model}</p>
                  <div className="mt-3 space-y-1 text-xs text-slate-600">
                    <div className="flex items-center text-slate-500">
                      <MapPin className="w-3.5 h-3.5 mr-1.5 text-cyan-600 shrink-0" />
                      <span className="truncate">{eq.workshop} · {eq.location}</span>
                    </div>
                    <div className="flex items-center text-slate-500">
                      <Shield className="w-3.5 h-3.5 mr-1.5 text-purple-600 shrink-0" />
                      <span>重要等级: <strong className="text-slate-700">{eq.criticality}</strong></span>
                    </div>
                  </div>
                  <div className="mt-3 p-2 rounded-lg bg-slate-50 border border-slate-200 grid grid-cols-3 gap-2 text-[11px]">
                    <div>
                      <span className="text-slate-500 block text-[10px]">轴温</span>
                      <span className={`font-mono font-semibold ${eq.telemetry.temperature > 75 ? 'text-rose-600' : 'text-slate-700'}`}>
                        {eq.telemetry.temperature}°C
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">振动RMS</span>
                      <span className={`font-mono font-semibold ${eq.telemetry.vibration > 4.5 ? 'text-rose-600' : 'text-slate-700'}`}>
                        {eq.telemetry.vibration}mm/s
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">运行电流</span>
                      <span className="font-mono font-semibold text-slate-700">{eq.telemetry.current}A</span>
                    </div>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="text-cyan-600 hover:text-cyan-700 font-semibold flex items-center">
                    <span>详细台账</span>
                    <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                  </span>
                  <div className="flex items-center space-x-1.5">
                    <button onClick={(e) => { e.stopPropagation(); onOpenAiDiagnoseForEquipment(eq); }} title="AI智能诊断" className="p-1.5 rounded-lg bg-blue-50 hover:bg-blue-600 text-blue-600 hover:text-white transition-colors cursor-pointer border border-blue-200">
                      <Sparkles className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); onOpenWorkOrderForEquipment(eq); }} title="快速报修开单" className="p-1.5 rounded-lg bg-amber-50 hover:bg-amber-600 text-amber-600 hover:text-white transition-colors cursor-pointer border border-amber-200">
                      <Wrench className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Table View */
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs card-industrial">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-[11px] text-slate-600 uppercase tracking-wider border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">位号编码</th>
                  <th className="px-4 py-3">设备名称 / 型号</th>
                  <th className="px-4 py-3">车间位置</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">健康度</th>
                  <th className="px-4 py-3">关键遥测 (温/振/电)</th>
                  <th className="px-4 py-3">下次点检</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {filteredEquipments.map((eq) => {
                  const statusBadge = getStatusBadge(eq.status);
                  return (
                    <tr key={eq.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-4 py-3 font-mono font-bold text-cyan-700">
                        {eq.code}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-800">{eq.name}</div>
                        <div className="text-[10px] text-slate-500 font-mono">{eq.model}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {eq.workshop}
                        <div className="text-[10px] text-slate-500">{eq.location}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] px-2 py-0.5 rounded border ${statusBadge.color}`}>
                          {statusBadge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono font-bold">
                        <span
                          className={
                            eq.healthScore < 60
                              ? 'text-rose-600'
                              : eq.healthScore < 80
                              ? 'text-amber-600'
                              : 'text-emerald-600'
                          }
                        >
                          {eq.healthScore}分
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] space-x-2">
                        <span className={eq.telemetry.temperature > 75 ? 'text-rose-600' : 'text-slate-700'}>
                          {eq.telemetry.temperature}°C
                        </span>
                        <span className="text-slate-300">|</span>
                        <span className={eq.telemetry.vibration > 4.5 ? 'text-rose-600' : 'text-slate-700'}>
                          {eq.telemetry.vibration}mm/s
                        </span>
                        <span className="text-slate-300">|</span>
                        <span className="text-slate-700">{eq.telemetry.current}A</span>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-500">{eq.nextInspectionDate}</td>
                      <td className="px-4 py-3 text-right space-x-1.5">
                        <button
                          onClick={() => setActiveEquipment(eq)}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-cyan-50 text-slate-700 hover:text-cyan-700 rounded border border-slate-200 transition-colors cursor-pointer"
                        >
                          详情
                        </button>
                        <button
                          onClick={() => onOpenWorkOrderForEquipment(eq)}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-amber-50 text-slate-700 hover:text-amber-700 rounded border border-slate-200 transition-colors cursor-pointer"
                        >
                          报修
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Equipment Detailed Drawer Modal */}
      {activeEquipment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl space-y-6 card-industrial">
            {/* Header */}
            <div className="flex items-start justify-between pb-4 border-b border-slate-100">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-cyan-50 text-cyan-700 border border-cyan-200 font-semibold">
                    {activeEquipment.code}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded border font-medium ${getStatusBadge(activeEquipment.status).color}`}>
                    {getStatusBadge(activeEquipment.status).label}
                  </span>
                  <span className="text-xs font-mono font-bold text-emerald-700">
                    健康评分: {activeEquipment.healthScore}分
                  </span>
                </div>
                <button
                  onClick={() => handleEquipmentSummary(activeEquipment)}
                  className="mt-2 px-3 py-1.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-lg text-[11px] font-semibold flex items-center space-x-1.5 cursor-pointer shadow-xs transition-all"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>AI 健康画像</span>
                </button>
                <h3 className="text-lg font-bold text-slate-800 mt-1">
                  {activeEquipment.name}
                </h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">{activeEquipment.model}</p>
              </div>

              <button
                onClick={() => setActiveEquipment(null)}
                className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Spec & Basic Info Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
                <h4 className="font-semibold text-slate-800 flex items-center">
                  <FileText className="w-3.5 h-3.5 mr-1.5 text-cyan-600" />
                  基础制造与安装参数
                </h4>
                <div className="grid grid-cols-2 gap-y-1.5 text-slate-600">
                  <span className="text-slate-500">制造厂商:</span>
                  <span className="text-slate-800 font-medium">{activeEquipment.manufacturer}</span>
                  <span className="text-slate-500">投产日期:</span>
                  <span className="font-mono text-slate-800">{activeEquipment.installDate}</span>
                  <span className="text-slate-500">所属车间:</span>
                  <span className="text-slate-800">{activeEquipment.workshop}</span>
                  <span className="text-slate-500">机位坐标:</span>
                  <span className="text-slate-800">{activeEquipment.location}</span>
                  <span className="text-slate-500">责任维保技师:</span>
                  <span className="text-amber-700 font-semibold">{activeEquipment.assignedTechnician || '未指定'}</span>
                </div>
              </div>

              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
                <h4 className="font-semibold text-slate-800 flex items-center">
                  <Activity className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
                  实时遥测数据流 (IoT Gateway)
                </h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 rounded bg-white border border-slate-200 shadow-xs">
                    <span className="text-[10px] text-slate-500 block">轴承温度</span>
                    <span className="font-mono text-sm font-bold text-slate-800">{activeEquipment.telemetry.temperature} °C</span>
                  </div>
                  <div className="p-2 rounded bg-white border border-slate-200 shadow-xs">
                    <span className="text-[10px] text-slate-500 block">振动速度 RMS</span>
                    <span className="font-mono text-sm font-bold text-slate-800">{activeEquipment.telemetry.vibration} mm/s</span>
                  </div>
                  <div className="p-2 rounded bg-white border border-slate-200 shadow-xs">
                    <span className="text-[10px] text-slate-500 block">工作电压</span>
                    <span className="font-mono text-sm font-bold text-slate-800">{activeEquipment.telemetry.voltage} V</span>
                  </div>
                  <div className="p-2 rounded bg-white border border-slate-200 shadow-xs">
                    <span className="text-[10px] text-slate-500 block">负荷率</span>
                    <span className="font-mono text-sm font-bold text-slate-800">{activeEquipment.telemetry.loadRate} %</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Technical Specs Key-Value */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
              <h4 className="text-xs font-semibold text-slate-800">关键技术规格与易损备件标准</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-600">
                {Object.entries(activeEquipment.specs).map(([key, val]) => (
                  <div key={key} className="flex justify-between p-2 rounded bg-white border border-slate-200">
                    <span className="text-slate-500">{key}:</span>
                    <span className="font-mono font-medium text-slate-800">{val}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Maintenance History */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
              <h4 className="text-xs font-semibold text-slate-800 flex items-center justify-between">
                <span className="flex items-center">
                  <Wrench className="w-3.5 h-3.5 mr-1.5 text-amber-600" />
                  历史检修与维保履历档案 ({activeEquipment.maintenanceHistory.length} 次大修)
                </span>
              </h4>

              {activeEquipment.maintenanceHistory.length === 0 ? (
                <p className="text-xs text-slate-500 italic">暂无历史大修记录，新投产设备状态优良。</p>
              ) : (
                <div className="space-y-2">
                  {activeEquipment.maintenanceHistory.map((rec) => (
                    <div key={rec.id} className="p-3 bg-white rounded-lg border border-slate-200 text-xs space-y-1 shadow-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-800">{rec.type} ({rec.orderNo})</span>
                        <span className="text-slate-500 font-mono">{rec.date}</span>
                      </div>
                      <p className="text-slate-600 text-[11px]">{rec.summary}</p>
                      <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1">
                        <span>主修人: {rec.technician} | 工时: {rec.durationHours}h</span>
                        <span>费用: ¥{rec.cost.toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 扫码报修专属区块 (微信小程序码 / H5 智能报修过渡码) */}
            {(() => {
              const useH5 = isWeChatConfigured === false || wechatQrFailedMap[activeEquipment.id];
              const qrSrc = useH5
                ? `/api/v1/wechat/h5-qrcode?deviceId=${encodeURIComponent(activeEquipment.id)}`
                : `/api/v1/wechat/repair-qrcode?deviceId=${encodeURIComponent(activeEquipment.id)}&width=430`;

              return (
                <div className="bg-gradient-to-br from-cyan-50/70 via-blue-50/40 to-slate-50 p-4 rounded-xl border border-cyan-200/80 space-y-3 shadow-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <div className="w-6 h-6 rounded-md bg-cyan-600 text-white flex items-center justify-center shadow-xs">
                        <Smartphone className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-slate-900">设备专属扫码报修码</h4>
                        <p className="text-[11px] text-slate-500">现场操作工扫码直达一键故障申报与拍照凭证</p>
                      </div>
                    </div>

                    <span
                      className={`text-[10px] px-2 py-0.5 rounded border font-medium ${
                        useH5
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}
                    >
                      {useH5 ? '网页版H5码' : '微信小程序码'}
                    </span>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center gap-4 bg-white p-3 rounded-lg border border-slate-200/90">
                    <div
                      onClick={() => setShowQrModal(true)}
                      className="w-28 h-28 shrink-0 bg-slate-50 border border-slate-200 rounded-lg p-1.5 flex items-center justify-center cursor-pointer group hover:border-cyan-400 transition-all shadow-xs relative"
                      title="点击放大预览、下载或打印"
                    >
                      <img
                        src={qrSrc}
                        alt="设备报修二维码"
                        className="w-full h-full object-contain rounded"
                        onError={() => {
                          if (!useH5) {
                            setWechatQrFailedMap((prev) => ({ ...prev, [activeEquipment.id]: true }));
                          }
                        }}
                      />
                      <div className="absolute inset-0 bg-slate-900/40 rounded opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-medium backdrop-blur-xs">
                        点击放大
                      </div>
                    </div>

                    <div className="flex-1 space-y-1.5 text-xs text-slate-600">
                      <div className="font-semibold text-slate-800 flex items-center space-x-1.5">
                        <span>扫码直达：</span>
                        <span className="font-mono text-cyan-700">{activeEquipment.code}</span>
                        <span className="text-slate-500">({activeEquipment.name})</span>
                      </div>
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        {useH5
                          ? '小程序凭证待配置，当前生效为企业 H5 快速报修流式向导。'
                          : '微信扫一扫即可进入《智检安枢》小程序 pages/repair/repair。'}
                      </p>
                      <div className="pt-1 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShowQrModal(true)}
                          className="px-2.5 py-1 bg-cyan-50 hover:bg-cyan-100 text-cyan-700 rounded text-[11px] font-medium transition-colors border border-cyan-200 flex items-center space-x-1 cursor-pointer"
                        >
                          <QrCode className="w-3 h-3" />
                          <span>放大预览并下载</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Action Buttons in Modal */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-100">
              <button
                onClick={() => setShowQrModal(true)}
                className="px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg flex items-center space-x-1.5 cursor-pointer font-medium"
              >
                <QrCode className="w-4 h-4 text-cyan-600" />
                <span>查看设备电子标签</span>
              </button>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => {
                    const target = activeEquipment;
                    setActiveEquipment(null);
                    onOpenAiDiagnoseForEquipment(target);
                  }}
                  className="px-3.5 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg flex items-center space-x-1.5 font-medium cursor-pointer shadow-xs"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>AI 智能诊断</span>
                </button>
                <button
                  onClick={() => {
                    const target = activeEquipment;
                    setActiveEquipment(null);
                    onOpenWorkOrderForEquipment(target);
                  }}
                  className="px-3.5 py-1.5 text-xs bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg flex items-center space-x-1.5 font-medium cursor-pointer shadow-xs"
                >
                  <Wrench className="w-3.5 h-3.5" />
                  <span>开具检修工单</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* QR Code Printable Badge & Mini-program Repair Modal */}
      {showQrModal && activeEquipment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 text-center shadow-2xl space-y-4 card-industrial">
            <div className="flex justify-between items-center pb-2 border-b border-slate-100">
              <div className="flex items-center space-x-1.5 text-slate-800">
                <Smartphone className="w-4 h-4 text-cyan-600" />
                <span className="text-xs font-bold">微信扫码 · 直达设备报修</span>
              </div>
              <button
                onClick={() => setShowQrModal(false)}
                className="text-slate-500 hover:text-slate-600 p-1 rounded hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {(() => {
              const useH5 = isWeChatConfigured === false || wechatQrFailedMap[activeEquipment.id];
              const qrSrc = useH5
                ? `/api/v1/wechat/h5-qrcode?deviceId=${encodeURIComponent(activeEquipment.id)}`
                : `/api/v1/wechat/repair-qrcode?deviceId=${encodeURIComponent(activeEquipment.id)}&width=430`;

              const handleDownload = () => {
                const a = document.createElement('a');
                a.href = qrSrc;
                a.download = `设备报修码_${activeEquipment.code}_${activeEquipment.name}.png`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
              };

              const handlePrint = () => {
                const win = window.open('', '_blank');
                if (win) {
                  win.document.write(`
                    <html>
                      <head>
                        <title>打印设备报修标牌 - ${activeEquipment.name} (${activeEquipment.code})</title>
                        <style>
                          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
                          .tag-card { border: 2px solid #0f172a; border-radius: 12px; padding: 24px; text-align: center; width: 340px; }
                          .title { font-size: 16px; font-weight: bold; margin-bottom: 4px; }
                          .sub { font-size: 12px; color: #64748b; margin-bottom: 16px; }
                          .qr-box img { width: 220px; height: 220px; object-fit: contain; }
                          .info { margin-top: 16px; text-align: left; font-size: 12px; line-height: 1.6; border-top: 1px dashed #cbd5e1; padding-top: 12px; }
                          .highlight { font-weight: bold; color: #0284c7; }
                        </style>
                      </head>
                      <body>
                        <div class="tag-card">
                          <div class="title">工业设备智能扫码报修标牌</div>
                          <div class="sub">微信扫码直达小程序 · 故障一键申报</div>
                          <div class="qr-box"><img src="${qrSrc}" /></div>
                          <div class="info">
                            <div>设备名称: <b>${activeEquipment.name}</b></div>
                            <div>设备位号: <span class="highlight font-mono">${activeEquipment.code}</span></div>
                            <div>安装车间: ${activeEquipment.workshop} · ${activeEquipment.location}</div>
                            <div>责任技师: ${activeEquipment.assignedTechnician || '生产保全部'}</div>
                          </div>
                        </div>
                        <script>
                          window.onload = () => { window.print(); window.close(); };
                        </script>
                      </body>
                    </html>
                  `);
                  win.document.close();
                }
              };

              return (
                <>
                  <div className="p-4 bg-slate-50 rounded-2xl inline-block border border-slate-200 shadow-inner">
                    <div className="w-52 h-52 bg-white p-3 rounded-xl flex flex-col items-center justify-center text-slate-800 border border-slate-200 shadow-sm relative">
                      <img
                        src={qrSrc}
                        alt="微信报修码"
                        className="w-full h-full object-contain rounded"
                        onError={() => {
                          if (!useH5) {
                            setWechatQrFailedMap((prev) => ({ ...prev, [activeEquipment.id]: true }));
                          }
                        }}
                      />
                    </div>
                  </div>

                  <div className="text-xs text-left bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="font-bold text-slate-900 text-sm">{activeEquipment.name}</p>
                      <span className="text-[10px] px-2 py-0.5 rounded border bg-white text-cyan-800 font-mono font-semibold">
                        {activeEquipment.code}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      位置: {activeEquipment.workshop} · {activeEquipment.location}
                    </p>
                    <p className="text-[11px] text-cyan-700 font-medium pt-1">
                      {useH5
                        ? 'ℹ️ 小程序码待配置，当前为临时 H5 扫码报修页'
                        : '✅ 微信扫码 → 直达设备专属小程序快速报修'}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={handleDownload}
                      className="py-2 px-3 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-medium flex items-center justify-center space-x-1.5 cursor-pointer shadow-xs transition-colors"
                    >
                      <Download className="w-3.5 h-3.5 text-blue-600" />
                      <span>下载码图 PNG</span>
                    </button>
                    <button
                      type="button"
                      onClick={handlePrint}
                      className="py-2 px-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-medium flex items-center justify-center space-x-1.5 cursor-pointer shadow-xs transition-colors"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>打印设备防水标牌</span>
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Add Equipment Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
          <form
            onSubmit={handleCreateEquipment}
            className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 card-industrial"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-800 flex items-center">
                <Plus className="w-4 h-4 mr-1.5 text-cyan-600" />
                录入新工业设备资产档案
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-slate-500 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-700 mb-1 font-medium">设备名称 *</label>
                <input
                  type="text"
                  required
                  placeholder="例如: 2#循环水冷却泵"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-slate-700 mb-1 font-medium">位号编码 (KKS/Tag) *</label>
                <input
                  type="text"
                  required
                  placeholder="例如: PUMP-B202"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:bg-white font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-700 mb-1 font-medium">设备类别</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value as any })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-cyan-500 focus:bg-white"
                >
                  {categories.filter((c) => c !== 'all').map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 mb-1 font-medium">规格型号</label>
                <input
                  type="text"
                  placeholder="例如: ISG 150-315A"
                  value={formData.model}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:bg-white font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-700 mb-1 font-medium">所属车间工段</label>
                <select
                  value={formData.workshop}
                  onChange={(e) => setFormData({ ...formData, workshop: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-cyan-500 focus:bg-white"
                >
                  {workshops.filter((w) => w !== 'all').map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 mb-1 font-medium">详细机位安装位置</label>
                <input
                  type="text"
                  placeholder="例如: B区-02号机位"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:bg-white"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-slate-700 mb-1 font-medium">制造厂家</label>
                <input
                  type="text"
                  placeholder="例如: 凯泉泵业集团有限公司"
                  value={formData.manufacturer}
                  onChange={(e) => setFormData({ ...formData, manufacturer: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:bg-white"
                />
              </div>
            </div>

            {createError && (
              <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-[11px] text-rose-700">
                {createError}
              </div>
            )}

            <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isCreatingEquipment}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
              >
                {isCreatingEquipment ? '保存中...' : '保存建档'}
              </button>
            </div>
          </form>
        </div>
      )}
      {/* AI 设备健康画像弹窗 (功能 8) */}
      <AiResultModal
        open={summaryState.open}
        title="AI 设备健康画像 (档案 + 遥测 + 工单 + 巡检综合摘要)"
        loading={summaryState.loading}
        error={summaryState.error}
        degraded={summaryState.degraded}
        data={summaryState.data}
        onClose={() => setSummaryState((prev) => ({ ...prev, open: false }))}
      />
    </div>
  );
};
