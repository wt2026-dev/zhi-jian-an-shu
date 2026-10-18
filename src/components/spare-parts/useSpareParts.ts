import { useState, useEffect, useMemo, useCallback } from 'react';
import { SparePart, SparePartMovement, UserProfile } from '../../types';
import { sparePartsApi } from '../../api';
import { logger } from '../../utils/logger';
import { NewPartFormData } from './sparePartTypes';

interface UseSparePartsParams {
  currentUser: UserProfile;
}

export function useSpareParts({ currentUser }: UseSparePartsParams) {
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
  const [newPart, setNewPart] = useState<NewPartFormData>({
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
  const loadParts = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await sparePartsApi.list();
      setParts(data);
    } catch (e: unknown) {
      logger.error('Failed to load spare parts:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      await loadParts();
    });
    return () => {
      active = false;
    };
  }, [loadParts]);

  // Filtered parts
  const categories = useMemo(() => {
    return Array.from(new Set(parts.map((p) => p.category))).filter(Boolean);
  }, [parts]);

  const filteredParts = useMemo(() => {
    return parts.filter((part) => {
      const q = searchTerm.toLowerCase();
      const matchesSearch =
        part.name.toLowerCase().includes(q) ||
        part.code.toLowerCase().includes(q) ||
        part.specification.toLowerCase().includes(q) ||
        (part.location && part.location.toLowerCase().includes(q)) ||
        Boolean(
          part.compatible_models &&
            (Array.isArray(part.compatible_models)
              ? part.compatible_models.join(' ')
              : part.compatible_models
            )
              .toLowerCase()
              .includes(q)
        );

      const matchesCategory = selectedCategory === 'all' || part.category === selectedCategory;
      const matchesLowStock = !onlyLowStock || part.stock <= part.safe_stock;

      return matchesSearch && matchesCategory && matchesLowStock;
    });
  }, [parts, searchTerm, selectedCategory, onlyLowStock]);

  // Stats
  const totalKinds = parts.length;
  const totalStockCount = useMemo(() => parts.reduce((acc, p) => acc + (p.stock || 0), 0), [parts]);
  const lowStockParts = useMemo(() => parts.filter((p) => p.stock <= p.safe_stock), [parts]);
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '出入库操作失败';
      setInOutError(message);
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
    } catch (e: unknown) {
      logger.error('Failed to load movements:', e);
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '创建备件失败';
      setCreateError(message);
    } finally {
      setCreateSubmitting(false);
    }
  };

  return {
    parts,
    isLoading,
    searchTerm,
    setSearchTerm,
    selectedCategory,
    setSelectedCategory,
    onlyLowStock,
    setOnlyLowStock,
    canOperate,
    categories,
    filteredParts,
    totalKinds,
    totalStockCount,
    lowStockCount,
    loadParts,
    inOutPart,
    setInOutPart,
    inOutType,
    setInOutType,
    inOutQuantity,
    setInOutQuantity,
    inOutReason,
    setInOutReason,
    inOutSubmitting,
    inOutError,
    handleSubmitInOut,
    historyPart,
    setHistoryPart,
    movements,
    loadingMovements,
    handleOpenMovements,
    createModalOpen,
    setCreateModalOpen,
    newPart,
    setNewPart,
    createSubmitting,
    createError,
    handleCreatePart,
  };
}
