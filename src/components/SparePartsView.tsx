import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  AlertTriangle,
  Search,
  Plus,
  ArrowDownRight,
  ArrowUpRight,
  History,
  CheckCircle2,
  Filter,
  Layers,
  Wrench,
  RefreshCw,
  X,
  Package,
  ShieldAlert,
  ChevronRight,
} from 'lucide-react';
import { SparePart, SparePartMovement, UserProfile } from '../types';
import { sparePartsApi, type SpareProcurePrefill } from '../api';

interface SparePartsViewProps {
  currentUser: UserProfile;
  onNavigateToWorkOrders?: () => void;
  /**
   * 拆解视图库存联动 → 采购申请预填（F6）：真实备件台账命中的零件与缺口信息。
   * 本页消费后把「采购入库」弹窗按缺口预填，提交即生成真实出入库流水。
   */
  initialProcurePrefill?: SpareProcurePrefill | null;
  onProcurePrefillConsumed?: () => void;
}

export const SparePartsView: React.FC<SparePartsViewProps> = ({
  currentUser,
  onNavigateToWorkOrders,
  initialProcurePrefill = null,
  onProcurePrefillConsumed,
}) => {
  const [parts, setParts] = useState<SparePart[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [onlyLowStock, setOnlyLowStock] = useState(false);
  const canOperate = ['admin', 'manager', 'technician'].includes(currentUser.role);

  // In/Out Modal
  const [inOutPart, setInOutPart] = useState<SparePart | null>(null);
  const [inOutType, setInOutType] = useState<'in' | 'out'>('out');
  const [inOutQuantity, setInOutQuantity] = useState<number>(1);
  const [inOutReason, setInOutReason] = useState('');
  const [inOutSubmitting, setInOutSubmitting] = useState(false);
  const [inOutError, setInOutError] = useState<string | null>(null);

  // Movements History Modal
  const [historyPart, setHistoryPart] = useState<SparePart | null>(null);
  const [movements, setMovements] = useState<SparePartMovement[]>([]);
  const [loadingMovements, setLoadingMovements] = useState(false);

  // Create Modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newPart, setNewPart] = useState({
    code: '',
    name: '',
    specification: '',
    category: '轴承传动',
    unit: '件',
    stock: 10,
    safe_stock: 5,
    price: 150,
    location: 'A区-01货架',
    compatible_models: '',
  });
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Load parts
  const loadParts = async () => {
    setIsLoading(true);
    try {
      const data = await sparePartsApi.list();
      setParts(data);
    } catch (e: any) {
      console.error('Failed to load spare parts:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadParts();
  }, []);

  /**
   * 库存联动（F6）：消费「一键生成采购申请」预填 → 预填采购入库弹窗。
   * appliedRef 去重；无宿主深链场景从 sessionStorage 'spare-procure-prefill' 兜底取走；
   * parts 未加载完就先等待（不然 find 不到目标备件）。
   */
  const appliedProcurePrefillRef = useRef<SpareProcurePrefill | null>(null);
  useEffect(() => {
    let prefill = initialProcurePrefill;
    if (!prefill) {
      try {
        const raw = window.sessionStorage.getItem('spare-procure-prefill');
        if (raw) {
          prefill = JSON.parse(raw) as SpareProcurePrefill;
          window.sessionStorage.removeItem('spare-procure-prefill');
        }
      } catch {
        /* ignore */
      }
    }
    if (!prefill || isLoading || parts.length === 0) return;
    if (appliedProcurePrefillRef.current?.partId === prefill.partId) return;
    appliedProcurePrefillRef.current = prefill;
    // 预填入库弹窗：微任务延迟一轮（effect 内同步 setState 会触发级联渲染告警）
    queueMicrotask(() => {
      const target = parts.find((p) => p.id === prefill.partId);
      if (!target) {
        // 台账里查不到该备件：只清状态，不伪造——数据诚实口径
        onProcurePrefillConsumed?.();
        return;
      }
      setInOutPart(target);
      setInOutType('in');
      const shortage = Math.max(1, (target.safe_stock ?? 0) - (target.stock ?? 0));
      setInOutQuantity(prefill.qty && prefill.qty > 0 ? prefill.qty : shortage);
      setInOutReason(prefill.note || '拆解视图库存预警采购');
      setInOutError(null);
      onProcurePrefillConsumed?.();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProcurePrefill, isLoading, parts]);

  // Filtered parts
  const categories = Array.from(new Set(parts.map((p) => p.category))).filter(Boolean);

  const filteredParts = parts.filter((part) => {
    const matchesSearch =
      part.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      part.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      part.specification.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (part.location && part.location.toLowerCase().includes(searchTerm.toLowerCase())) ||
      Boolean(part.compatible_models && (Array.isArray(part.compatible_models) ? part.compatible_models.join(' ') : part.compatible_models).toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesCategory = selectedCategory === 'all' || part.category === selectedCategory;
    const matchesLowStock = !onlyLowStock || part.stock <= part.safe_stock;

    return matchesSearch && matchesCategory && matchesLowStock;
  });

  // Stats
  const totalKinds = parts.length;
  const totalStockCount = parts.reduce((acc, p) => acc + (p.stock || 0), 0);
  const lowStockParts = parts.filter((p) => p.stock <= p.safe_stock);
  const lowStockCount = lowStockParts.length;

  // Handle In/Out Stock submission
  const handleSubmitInOut = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inOutPart) return;
    if (inOutQuantity <= 0) {
      setInOutError('出入库数量必须大于 0');
      return;
    }
    if (inOutType === 'out' && inOutQuantity > inOutPart.stock) {
      setInOutError(`出库数量 (${inOutQuantity}) 超出当前可用库存 (${inOutPart.stock})`);
      return;
    }

    setInOutSubmitting(true);
    setInOutError(null);
    try {
      const res = await sparePartsApi.inOut(inOutPart.id, {
        type: inOutType,
        quantity: inOutQuantity,
        reason: inOutReason || (inOutType === 'in' ? '常规到货入库' : '检修现场作业领用'),
        operator: currentUser.name,
      });
      if (res && res.part) {
        setParts((prev) => prev.map((p) => (p.id === res.part.id ? res.part : p)));
      } else {
        await loadParts();
      }
      setInOutPart(null);
      setInOutQuantity(1);
      setInOutReason('');
    } catch (err: any) {
      setInOutError(err?.message || '出入库操作失败');
    } finally {
      setInOutSubmitting(false);
    }
  };

  // Open Movements Modal
  const handleOpenMovements = async (part: SparePart) => {
    setHistoryPart(part);
    setLoadingMovements(true);
    try {
      const list = await sparePartsApi.getMovements(part.id);
      setMovements(list);
    } catch (e) {
      console.error('Failed to load movements:', e);
    } finally {
      setLoadingMovements(false);
    }
  };

  // Handle Create Part
  const handleCreatePart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPart.code || !newPart.name) {
      setCreateError('请填写备件编号与名称');
      return;
    }
    setCreateSubmitting(true);
    setCreateError(null);
    try {
      const created = await sparePartsApi.create(newPart);
      setParts((prev) => [created, ...prev]);
      setCreateModalOpen(false);
      setNewPart({
        code: '',
        name: '',
        specification: '',
        category: '轴承传动',
        unit: '件',
        stock: 10,
        safe_stock: 5,
        price: 150,
        location: 'A区-01货架',
        compatible_models: '',
      });
    } catch (err: any) {
      setCreateError(err?.message || '创建备件失败');
    } finally {
      setCreateSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center">
            <Box className="w-5 h-5 mr-2 text-blue-600" />
            工业备品备件库存中枢
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            动态关联在役工业设备型号，支持精密备件出入库流水核销、安全阈值红色预警与工单领用联动
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={loadParts}
            className="p-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 hover:text-slate-900 transition-colors shadow-xs cursor-pointer"
            title="刷新备件库存"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-blue-600' : ''}`} />
          </button>
          {canOperate ? (
            <button
              id="btn-create-spare"
              onClick={() => setCreateModalOpen(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 shadow-xs cursor-pointer transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>新增备件入库</span>
            </button>
          ) : (
            <span className="text-xs px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg border border-slate-200">
              备件台账只读查阅
            </span>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between shadow-xs">
          <div>
            <div className="text-xs text-slate-500 font-medium">备件品种数</div>
            <div className="text-2xl font-bold text-slate-900 font-mono mt-1">{totalKinds} 种</div>
            <div className="text-[11px] text-slate-500 mt-1">涵盖机械/电气/密封</div>
          </div>
          <div className="w-11 h-11 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
            <Package className="w-5 h-5" />
          </div>
        </div>

        <div
          onClick={() => setOnlyLowStock(!onlyLowStock)}
          className={`card-industrial border rounded-lg p-4 flex items-center justify-between shadow-xs cursor-pointer transition-all ${
            lowStockCount > 0
              ? 'border-rose-200 bg-rose-50/50 hover:border-rose-300'
              : 'border-slate-200 bg-white hover:border-slate-300'
          }`}
        >
          <div>
            <div className="text-xs text-rose-700 font-medium flex items-center">
              <span>低库存告警</span>
              {lowStockCount > 0 && (
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping ml-2"></span>
              )}
            </div>
            <div className="text-2xl font-bold text-rose-700 font-mono mt-1">{lowStockCount} 项</div>
            <div className="text-[11px] text-rose-600 mt-1">低于安全库存红线 (点击过滤)</div>
          </div>
          <div className="w-11 h-11 rounded-lg bg-rose-100 border border-rose-200 flex items-center justify-center text-rose-600">
            <AlertTriangle className="w-5 h-5" />
          </div>
        </div>

        <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between shadow-xs">
          <div>
            <div className="text-xs text-slate-500 font-medium">在库总件数</div>
            <div className="text-2xl font-bold text-emerald-700 font-mono mt-1">{totalStockCount} 件</div>
            <div className="text-[11px] text-slate-500 mt-1">实物周转总余量</div>
          </div>
          <div className="w-11 h-11 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
            <Layers className="w-5 h-5" />
          </div>
        </div>

        <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between shadow-xs">
          <div>
            <div className="text-xs text-slate-500 font-medium">适配机组覆盖率</div>
            <div className="text-2xl font-bold text-purple-700 font-mono mt-1">100%</div>
            <div className="text-[11px] text-slate-500 mt-1">离心机/泵/压缩机全覆盖</div>
          </div>
          <div className="w-11 h-11 rounded-lg bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-600">
            <Wrench className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 flex flex-col md:flex-row items-center justify-between gap-4 shadow-xs">
        {/* Search */}
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="搜索备件编号、名称、规格型号、货架库位或适配设备..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-10 pr-4 py-2 text-xs text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:bg-white transition-colors"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Category Pills */}
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              selectedCategory === 'all'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            全部类别
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {cat}
            </button>
          ))}

          {/* Low Stock Toggle Button */}
          <button
            onClick={() => setOnlyLowStock(!onlyLowStock)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-colors cursor-pointer ${
              onlyLowStock
                ? 'bg-rose-600 text-white shadow-xs'
                : 'bg-white text-rose-600 hover:bg-rose-50 border border-rose-200'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>仅看低库存 ({lowStockCount})</span>
          </button>
        </div>
      </div>

      {/* Spare Parts Table */}
      <div className="card-industrial bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 font-semibold">
              <tr>
                <th className="py-3 px-4">备件编号 / 名称</th>
                <th className="py-3 px-4">规格型号</th>
                <th className="py-3 px-4">类别</th>
                <th className="py-3 px-4">在库余量 / 安全线</th>
                <th className="py-3 px-4">仓储库位</th>
                <th className="py-3 px-4">单价 (元)</th>
                <th className="py-3 px-4">适配设备型号</th>
                <th className="py-3 px-4 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredParts.map((part) => {
                const isLow = part.stock <= part.safe_stock;
                const stockPercent = Math.min(100, Math.round((part.stock / (part.safe_stock * 2 || 1)) * 100));

                return (
                  <tr
                    key={part.id}
                    className={`hover:bg-slate-50/80 transition-colors ${
                      isLow ? 'bg-rose-50/30' : ''
                    }`}
                  >
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900 flex items-center space-x-2">
                        <span>{part.name}</span>
                        {isLow && (
                          <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 text-[10px] font-bold border border-rose-200">
                            低库存
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5">{part.code}</div>
                    </td>

                    <td className="py-3 px-4 text-slate-700 font-mono">{part.specification}</td>

                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] border border-slate-200 font-medium">
                        {part.category}
                      </span>
                    </td>

                    <td className="py-3 px-4">
                      <div className="flex items-center space-x-2">
                        <span
                          className={`font-mono font-bold text-sm ${
                            isLow ? 'text-rose-600' : 'text-slate-900'
                          }`}
                        >
                          {part.stock}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          / {part.safe_stock} {part.unit}
                        </span>
                      </div>
                      {/* Mini Bar */}
                      <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1">
                        <div
                          className={`h-full rounded-full ${
                            isLow ? 'bg-rose-500' : 'bg-blue-600'
                          }`}
                          style={{ width: `${Math.max(5, stockPercent)}%` }}
                        ></div>
                      </div>
                    </td>

                    <td className="py-3 px-4 text-slate-700">
                      <span className="font-mono text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 font-medium">
                        {part.location || '待分配'}
                      </span>
                    </td>

                    <td className="py-3 px-4 font-mono text-slate-800 font-medium">
                      ¥{part.price ? part.price.toFixed(2) : '0.00'}
                    </td>

                    <td className="py-3 px-4 text-slate-600 text-[11px] max-w-xs truncate" title={Array.isArray(part.compatible_models) ? part.compatible_models.join(', ') : (part.compatible_models || '')}>
                      {(Array.isArray(part.compatible_models) ? part.compatible_models.join(', ') : part.compatible_models) || '通用工业标准件'}
                    </td>

                    <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                      {canOperate && (
                        <button
                          onClick={() => {
                            setInOutPart(part);
                            setInOutType('out');
                            setInOutQuantity(1);
                            setInOutReason('');
                            setInOutError(null);
                          }}
                          className="px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer shadow-xs transition-colors"
                        >
                          出入库
                        </button>
                      )}
                      <button
                        onClick={() => handleOpenMovements(part)}
                        className="px-2.5 py-1 rounded-md bg-white hover:bg-slate-50 text-slate-700 text-xs border border-slate-200 cursor-pointer shadow-xs transition-colors font-medium"
                      >
                        明细
                      </button>
                    </td>
                  </tr>
                );
              })}

              {filteredParts.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    <Package className="w-10 h-10 mx-auto mb-2 text-slate-500" />
                    未找到匹配的备件记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* In / Out Stock Modal */}
      {inOutPart && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 space-y-4 shadow-xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900 flex items-center">
                <Box className="w-5 h-5 mr-2 text-blue-600" />
                备件出入库操作
              </h3>
              <button
                onClick={() => setInOutPart(null)}
                className="text-slate-500 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1 text-xs">
              <div className="font-semibold text-slate-800">{inOutPart.name} ({inOutPart.code})</div>
              <div className="text-slate-500">规格: {inOutPart.specification} · 库位: {inOutPart.location}</div>
              <div className="flex items-center space-x-2 text-blue-700 font-mono font-medium">
                <span>当前库存: {inOutPart.stock} {inOutPart.unit}</span>
                <span>(安全库存: {inOutPart.safe_stock})</span>
              </div>
            </div>

            <form onSubmit={handleSubmitInOut} className="space-y-4 text-xs">
              {/* Type Switcher */}
              <div>
                <label className="block text-slate-700 mb-1.5 font-medium">变动类型</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setInOutType('out')}
                    className={`py-2 px-3 rounded-lg border font-semibold flex items-center justify-center space-x-1.5 cursor-pointer transition-all ${
                      inOutType === 'out'
                        ? 'bg-orange-600 border-orange-600 text-white shadow-xs'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <ArrowDownRight className="w-4 h-4" />
                    <span>出库领用 (现场检修)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setInOutType('in')}
                    className={`py-2 px-3 rounded-lg border font-semibold flex items-center justify-center space-x-1.5 cursor-pointer transition-all ${
                      inOutType === 'in'
                        ? 'bg-emerald-600 border-emerald-600 text-white shadow-xs'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <ArrowUpRight className="w-4 h-4" />
                    <span>到货入库 / 采购</span>
                  </button>
                </div>
              </div>

              {/* Quantity */}
              <div>
                <label className="block text-slate-700 mb-1 font-medium">
                  {inOutType === 'out' ? '领用出库数量' : '到货入库数量'} ({inOutPart.unit}) *
                </label>
                <input
                  type="number"
                  min="1"
                  max={inOutType === 'out' ? inOutPart.stock : 9999}
                  value={inOutQuantity}
                  onChange={(e) => setInOutQuantity(parseInt(e.target.value) || 1)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 font-mono text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  required
                />
              </div>

              {/* Reason */}
              <div>
                <label className="block text-slate-700 mb-1 font-medium">事由 / 领用说明</label>
                <input
                  type="text"
                  placeholder={inOutType === 'out' ? '例: 2号离心泵故障轴承更换' : '例: 批量采购补充安全库存'}
                  value={inOutReason}
                  onChange={(e) => setInOutReason(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Operator */}
              <div>
                <label className="block text-slate-700 mb-1 font-medium">经办人</label>
                <input
                  type="text"
                  disabled
                  value={`${currentUser.name} (${currentUser.roleTitle || '工程师'})`}
                  className="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-slate-600 cursor-not-allowed"
                />
              </div>

              {inOutError && (
                <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                  {inOutError}
                </div>
              )}

              <div className="flex items-center justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setInOutPart(null)}
                  className="px-4 py-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 cursor-pointer shadow-xs font-medium"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={inOutSubmitting}
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center space-x-1.5 shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {inOutSubmitting ? '正在提交...' : '确认核销'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Movements History Drawer/Modal */}
      {historyPart && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-xl animate-in fade-in zoom-in-95">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center">
                  <History className="w-5 h-5 mr-2 text-blue-600" />
                  出入库明细流水: {historyPart.name}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  编号: {historyPart.code} · 当前库存: {historyPart.stock} {historyPart.unit}
                </p>
              </div>
              <button
                onClick={() => setHistoryPart(null)}
                className="text-slate-500 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 flex-1 overflow-y-auto space-y-3">
              {loadingMovements && (
                <div className="py-8 text-center text-slate-500">正在查询流水台账...</div>
              )}

              {!loadingMovements && movements.length === 0 && (
                <div className="py-12 text-center text-slate-500">暂无出入库变动流水</div>
              )}

              {!loadingMovements &&
                movements.map((m) => (
                  <div
                    key={m.id}
                    className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center space-x-3">
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm ${
                          m.type === 'in'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-orange-50 text-orange-700 border border-orange-200'
                        }`}
                      >
                        {m.type === 'in' ? '+' : '-'}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-800">
                          {m.type === 'in' ? '采购到货入库' : '检修现场领用出库'}: {m.reason || '无'}
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center space-x-2 mt-0.5">
                          <span>经办: {m.operator || '系统'}</span>
                          {m.work_order_id && (
                            <span className="font-mono text-blue-700 font-medium">工单: {m.work_order_id}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <div
                        className={`font-mono font-bold text-sm ${
                          m.type === 'in' ? 'text-emerald-700' : 'text-orange-700'
                        }`}
                      >
                        {m.type === 'in' ? `+${m.quantity}` : `-${m.quantity}`} {historyPart.unit}
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        {m.created_at ? new Date(m.created_at).toLocaleString() : ''}
                      </div>
                    </div>
                  </div>
                ))}
            </div>

            <div className="p-4 border-t border-slate-100 text-right bg-slate-50/50 rounded-b-xl">
              <button
                onClick={() => setHistoryPart(null)}
                className="px-4 py-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold cursor-pointer shadow-xs"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create New Part Modal */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-6 space-y-4 shadow-xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900 flex items-center">
                <Plus className="w-5 h-5 mr-2 text-blue-600" />
                新增工业备件入库建档
              </h3>
              <button
                onClick={() => setCreateModalOpen(false)}
                className="text-slate-500 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreatePart} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 mb-1 font-medium">备件编号 *</label>
                  <input
                    type="text"
                    required
                    placeholder="例: SP-BEAR-6208"
                    value={newPart.code}
                    onChange={(e) => setNewPart({ ...newPart, code: e.target.value })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 mb-1 font-medium">备件名称 *</label>
                  <input
                    type="text"
                    required
                    placeholder="例: 深沟球轴承"
                    value={newPart.name}
                    onChange={(e) => setNewPart({ ...newPart, name: e.target.value })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 mb-1 font-medium">规格型号</label>
                  <input
                    type="text"
                    placeholder="例: 6208-2RS/C3"
                    value={newPart.specification}
                    onChange={(e) => setNewPart({ ...newPart, specification: e.target.value })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 mb-1 font-medium">类别</label>
                  <select
                    value={newPart.category}
                    onChange={(e) => setNewPart({ ...newPart, category: e.target.value })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="轴承传动">轴承传动</option>
                    <option value="密封密封件">密封密封件</option>
                    <option value="电气传感器">电气传感器</option>
                    <option value="滤芯过滤">滤芯过滤</option>
                    <option value="润滑流体">润滑流体</option>
                    <option value="标准紧固件">标准紧固件</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-700 mb-1 font-medium">初始库存</label>
                  <input
                    type="number"
                    min="0"
                    value={newPart.stock}
                    onChange={(e) => setNewPart({ ...newPart, stock: parseInt(e.target.value) || 0 })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 mb-1 font-medium">安全红线库存</label>
                  <input
                    type="number"
                    min="0"
                    value={newPart.safe_stock}
                    onChange={(e) => setNewPart({ ...newPart, safe_stock: parseInt(e.target.value) || 0 })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 mb-1 font-medium">单位</label>
                  <input
                    type="text"
                    value={newPart.unit}
                    onChange={(e) => setNewPart({ ...newPart, unit: e.target.value })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 mb-1 font-medium">库位位置</label>
                  <input
                    type="text"
                    placeholder="例: B区-03货架-02层"
                    value={newPart.location}
                    onChange={(e) => setNewPart({ ...newPart, location: e.target.value })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 mb-1 font-medium">单价 (元)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={newPart.price}
                    onChange={(e) => setNewPart({ ...newPart, price: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 mb-1 font-medium">适配机组型号</label>
                <input
                  type="text"
                  placeholder="例: ISG-100-200, DG85-67X8"
                  value={newPart.compatible_models}
                  onChange={(e) => setNewPart({ ...newPart, compatible_models: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
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
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold cursor-pointer disabled:opacity-50 shadow-xs"
                >
                  {createSubmitting ? '保存中...' : '确认建档'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
