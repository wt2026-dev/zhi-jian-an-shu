import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Plus,
  Play,
  MapPin,
  Clock,
  QrCode,
  Sparkles,
  Wrench,
  Camera,
  Check,
  X,
  ChevronRight,
  Shield,
  ShieldAlert,
  Layers,
  ArrowRight,
  ExternalLink,
  Copy,
  ClipboardCheck,
} from 'lucide-react';
import jsQR from 'jsqr';
import { InspectionTask, InspectionItem, UserProfile, Equipment, WorkOrder } from '../types';
import { aiApi, hazardsApi } from '../api';
import { AiWorkOrderDraftModal } from './ai/AiWorkOrderDraftModal';
import { AiResultModal } from './ai/AiResultModal';
import { AiReport } from '../api';
import { AiWorkOrderDraft } from '../api';

interface InspectionViewProps {
  currentUser: UserProfile;
  inspections: InspectionTask[];
  equipments: Equipment[];
  targetEquipmentId?: string;
  onUpdateInspection: (task: InspectionTask) => void;
  onConvertAbnormalToWorkOrder: (point: InspectionItem, equipmentName: string) => void;
  onCreateWorkOrder?: (wo: WorkOrder) => void;
}

export const InspectionView: React.FC<InspectionViewProps> = ({
  currentUser,
  inspections = [],
  equipments = [],
  targetEquipmentId,
  onUpdateInspection,
  onConvertAbnormalToWorkOrder,
  onCreateWorkOrder,
}) => {
  const [activeTaskId, setActiveTaskId] = useState<string>(inspections[0]?.id || '');
  const [selectedPoint, setSelectedPoint] = useState<InspectionItem | null>(null);
  const [onlyMyTasks, setOnlyMyTasks] = useState<boolean>(currentUser.role === 'inspector');

  useEffect(() => {
    if (currentUser.role === 'inspector') {
      setOnlyMyTasks(true);
    }
  }, [currentUser.id, currentUser.role]);

  const myName = (currentUser.name || '').trim();
  const myId = (currentUser.id || '').trim();

  const isMyTask = (t: InspectionTask) => {
    const insp = (t as any).inspector || t.inspectorId || '';
    const ass = (t as any).assignee || '';
    return (
      Boolean(insp && (insp.includes(myName) || (myId && insp.includes(myId)))) ||
      Boolean(ass && (ass.includes(myName) || (myId && ass.includes(myId)))) ||
      Boolean((t as any).inspectorId && (t as any).inspectorId === myId)
    );
  };

  const displayInspections = onlyMyTasks ? (inspections || []).filter(isMyTask) : (inspections || []);

  // 默认选中有效列表中的第一个巡检任务
  useEffect(() => {
    if (displayInspections.length > 0) {
      if (!activeTaskId || !displayInspections.some((t) => t.id === activeTaskId)) {
        setActiveTaskId(displayInspections[0].id);
      }
    }
  }, [displayInspections, activeTaskId]);

  // AI 巡检报告状态
  const [reportState, setReportState] = useState<{ open: boolean; loading: boolean; error: string | null; degraded?: boolean; data?: AiReport | null }>({ open: false, loading: false, error: null });
  const [hazardNotice, setHazardNotice] = useState<string | null>(null);
  const [createHazardOnSave, setCreateHazardOnSave] = useState(false);
  const [hazardLevelOnSave, setHazardLevelOnSave] = useState<'general' | 'major'>('general');

  const handleConvertAbnormalToHazard = async (pt: InspectionItem) => {
    try {
      await hazardsApi.create({
        code: `HAZ-INSP-${Date.now().toString().slice(-5)}`,
        title: `【巡检发现异常】${pt.equipmentName} ${pt.checkPoint || pt.checkItem}超标`,
        level: 'general',
        category: '机械安全',
        equipment_id: pt.equipmentId,
        equipment_name: pt.equipmentName,
        location: '巡检现场',
        description: `日常巡检中发现测点异常：标准要求「${pt.standard}」，实测值「${pt.recordedValue || '超标'} ${pt.unit || ''}」，已超出安全控制阈值。`,
        reported_by: currentUser.name,
        deadline: '2026-03-15',
      });
      setHazardNotice(`✅ 测点 [${pt.equipmentName} - ${pt.checkPoint || pt.checkItem}] 已成功转入现场安全隐患闭环治理中枢！`);
      setTimeout(() => setHazardNotice(null), 3500);
    } catch (err: any) {
      alert(`转报隐患失败: ${err?.message || '网络异常'}`);
    }
  };

  const handleInspectionReport = async () => {
    const end = new Date();
    const start = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const fmt = (dt: Date) => dt.toISOString().slice(0, 10);
    setReportState({ open: true, loading: true, error: null });
    try {
      const res = await aiApi.generateReport({
        reportType: 'inspection',
        startDate: fmt(start),
        endDate: fmt(end),
        workshop: activeTask?.workshop,
      });
      if (res.success && res.report) {
        setReportState({ open: true, loading: false, error: null, data: res.report });
      } else {
        setReportState({ open: true, loading: false, error: res.message || res.error || '报告生成失败', degraded: res.degraded });
      }
    } catch (err: any) {
      setReportState({ open: true, loading: false, error: err?.message || 'AI 调用失败' });
    }
  };

  // AI 智能工单草稿状态 (功能 1：巡检异常 → AI 生成工单草稿)
  const [aiDraftState, setAiDraftState] = useState<{
    open: boolean; loading: boolean; error: string | null; degraded?: boolean;
    draft?: AiWorkOrderDraft | null; equipment?: { id: string; name: string; code: string; workshop: string } | null;
  }>({ open: false, loading: false, error: null });

  const handleAiGenerateWorkOrder = async (point: InspectionItem) => {
    const eq = equipments.find((e) => e.id === point.equipmentId) || equipments.find((e) => e.name === point.equipmentName) || equipments[0];
    if (!eq) return;
    const desc = `巡检点检发现异常: ${point.checkPoint || point.checkItem || point.equipmentName} 实测 ${point.recordedValue ?? '异常'} ${point.unit || ''} (标准 ${point.standard || point.minVal + '~' + point.maxVal || '限值'})，备注: ${point.notes || '无'}`;
    setAiDraftState({ open: true, loading: true, error: null, draft: null, equipment: { id: eq.id, name: eq.name, code: eq.code, workshop: eq.workshop } });
    try {
      const res = await aiApi.generateWorkOrder({
        equipmentId: eq.id,
        abnormalDescription: desc,
        inspectionPointId: point.id,
        telemetrySnapshot: eq.telemetry,
      });
      if (res.success && res.draft) {
        setAiDraftState((prev) => ({ ...prev, loading: false, draft: res.draft }));
      } else {
        setAiDraftState((prev) => ({ ...prev, loading: false, error: res.message || res.error || 'AI 生成失败', degraded: res.degraded }));
      }
    } catch (err: any) {
      setAiDraftState((prev) => ({ ...prev, loading: false, error: err?.message || 'AI 调用失败' }));
    }
  };

  // Meter Reading Input
  const [pointReading, setPointReading] = useState<{
    value: number;
    notes: string;
    isAbnormal: boolean;
  }>({
    value: 0,
    notes: '',
    isAbnormal: false,
  });

  // QR Code & Barcode Scanner State
  const [showQrModal, setShowQrModal] = useState(false);
  const [selectedQrEquipId, setSelectedQrEquipId] = useState<string>(equipments[0]?.id || 'EQ-001');
  const [qrScanSuccess, setQrScanSuccess] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState<boolean>(false);

  // Real camera scanning state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanAnimRef = useRef<number>(0);
  const scanTimeoutRef = useRef<any>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  // Cleanup camera on unmount or modal close
  const stopCamera = useCallback(() => {
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = null;
    }
    if (scanAnimRef.current) {
      cancelAnimationFrame(scanAnimRef.current);
      scanAnimRef.current = 0;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
    setScanning(false);
  }, []);

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  useEffect(() => {
    if (!showQrModal) stopCamera();
  }, [showQrModal, stopCamera]);

  // Match scanned code to equipment (supports equipment code, json payload, or jump url)
  const matchEquipmentByCode = (code: string): Equipment | null => {
    let target = code.trim();
    // 1. Try URL parsing: extract equipmentId / targetEquipmentId / id
    try {
      if (target.includes('?') || target.startsWith('http://') || target.startsWith('https://')) {
        const urlObj = new URL(target, window.location.origin);
        const eqId =
          urlObj.searchParams.get('equipmentId') ||
          urlObj.searchParams.get('targetEquipmentId') ||
          urlObj.searchParams.get('id');
        if (eqId) target = eqId;
      }
    } catch (_) {}

    // 2. Try JSON parsing
    try {
      if (target.startsWith('{') && target.endsWith('}')) {
        const obj = JSON.parse(target);
        if (obj.code || obj.id) {
          const m = equipments.find(
            (e) =>
              e.code?.toUpperCase() === (obj.code || '').toUpperCase() ||
              e.id?.toUpperCase() === (obj.id || '').toUpperCase()
          );
          if (m) return m;
        }
      }
    } catch (_) {}

    const normalized = target.toUpperCase();
    return (
      equipments.find(
        (eq) =>
          eq.code?.toUpperCase() === normalized ||
          eq.id?.toUpperCase() === normalized ||
          eq.name?.toUpperCase().includes(normalized)
      ) || null
    );
  };

  // Start real camera scanning with 20s timeout and error fallback
  const startCamera = async () => {
    stopCamera();
    setCameraError(null);
    setScanning(true);

    // 20s 识别超时保护：超时自动降级为手动选择下方设备
    scanTimeoutRef.current = setTimeout(() => {
      stopCamera();
      setCameraError('未识别到设备码，可手动选择下方设备');
    }, 20000);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraActive(true);
        // Start scanning loop
        scanFrame();
      }
    } catch (err: any) {
      stopCamera();
      const msg =
        err?.name === 'NotAllowedError'
          ? '未识别到设备码，可手动选择下方设备（摄像头权限被拒绝）'
          : err?.name === 'NotFoundError'
          ? '未识别到设备码，可手动选择下方设备（未检测到可用摄像头）'
          : '未识别到设备码，可手动选择下方设备（' + (err?.message || '未知错误') + '）';
      setCameraError(msg);
    }
  };

  // Scan a single frame from video
  const scanFrame = () => {
    if (!videoRef.current || !canvasRef.current || !streamRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx || video.readyState !== video.HAVE_ENOUGH_DATA) {
      scanAnimRef.current = requestAnimationFrame(scanFrame);
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'dontInvert',
    });
    if (code && code.data) {
      // Found a QR code
      handleScanResult(code.data);
      return;
    }
    scanAnimRef.current = requestAnimationFrame(scanFrame);
  };

  // Handle scanned result
  const handleScanResult = (rawCode: string) => {
    stopCamera();
    const matched = matchEquipmentByCode(rawCode);
    if (matched) {
      setSelectedQrEquipId(matched.id);
      setQrScanSuccess(`已扫码识别设备: ${matched.name} (${matched.code || matched.id})`);
      // Auto-match inspection task
      const matchedTask = inspections.find((t) =>
        t.title.includes(matched.name) || (t.route && t.route.includes(matched.workshop))
      );
      if (matchedTask) setActiveTaskId(matchedTask.id);
      setTimeout(() => setShowQrModal(false), 1500);
    } else {
      setQrScanSuccess(null);
      setCameraError(`未识别到设备码，可手动选择下方设备（已扫码: ${rawCode}，未匹配系统设备）`);
    }
  };

  // 打开扫码直达巡检弹窗并优先自动启动真实摄像头
  const openQrModal = () => {
    setShowQrModal(true);
    setQrScanSuccess(null);
    setCameraError(null);
    setTimeout(() => {
      startCamera();
    }, 150);
  };

  // 手机扫码直达巡检：监听 targetEquipmentId 自动定位
  useEffect(() => {
    if (targetEquipmentId) {
      const eq = equipments.find((e) => e.id === targetEquipmentId || e.code === targetEquipmentId);
      if (eq) {
        setSelectedQrEquipId(eq.id);
        const matchedTask = inspections.find((t) =>
          t.title.includes(eq.name) || (t.route && t.route.includes(eq.workshop))
        );
        if (matchedTask) {
          setActiveTaskId(matchedTask.id);
        }
        setQrScanSuccess(`【手机扫码直达】已通过二维码电子铭牌精准核验设备：${eq.name} (${eq.code})，已载入巡检作业表单！`);
      }
    }
  }, [targetEquipmentId, equipments, inspections]);


  const activeTask = displayInspections.find((t) => t.id === activeTaskId) || displayInspections[0] || inspections.find((t) => t.id === activeTaskId) || inspections[0];
  const itemsList: InspectionItem[] = activeTask
    ? (activeTask.items || (activeTask as any).points || [])
    : [];

  const handleSelectPoint = (pt: InspectionItem) => {
    setSelectedPoint(pt);
    const minV = pt.minLimit ?? pt.minVal;
    const maxV = pt.maxLimit ?? pt.maxVal;
    const defaultValue = typeof pt.recordedValue === 'number'
      ? pt.recordedValue
      : (minV !== undefined && maxV !== undefined ? (minV + maxV) / 2 : 25);

    const isAbnormalInit = pt.isPass === false || pt.status === 'abnormal';
    setCreateHazardOnSave(isAbnormalInit);
    setHazardLevelOnSave('general');

    setPointReading({
      value: defaultValue,
      notes: pt.notes || '',
      isAbnormal: isAbnormalInit,
    });
  };

  const handleSavePointRecord = () => {
    if (!activeTask || !selectedPoint) return;

    const maxVal = selectedPoint.maxLimit ?? selectedPoint.maxVal;
    const minVal = selectedPoint.minLimit ?? selectedPoint.minVal;

    const isAbnormal =
      (maxVal !== undefined && pointReading.value > maxVal) ||
      (minVal !== undefined && pointReading.value < minVal) ||
      pointReading.isAbnormal;

    // 勾选同步登记为现场安全隐患
    if (createHazardOnSave) {
      hazardsApi.create({
        code: `HAZ-INSP-${Date.now().toString().slice(-5)}`,
        title: `【巡检发现异常】${selectedPoint.equipmentName} ${selectedPoint.checkPoint || selectedPoint.checkItem}超标`,
        level: hazardLevelOnSave,
        category: '设备安全',
        equipment_id: selectedPoint.equipmentId,
        equipment_name: selectedPoint.equipmentName,
        location: '现场巡检位',
        description: `日常巡检测点实测超标/异常。标准要求「${selectedPoint.standard}」，现场实测「${pointReading.value} ${selectedPoint.unit || ''}」${pointReading.notes ? `，现场备注：${pointReading.notes}` : ''}。`,
        reported_by: currentUser.name,
        discoverer: currentUser.name,
      } as any).then(() => {
        setHazardNotice(`✅ 测点 [${selectedPoint.equipmentName} - ${selectedPoint.checkPoint || selectedPoint.checkItem}] 已同步登记为现场隐患并纳入闭环！`);
        setTimeout(() => setHazardNotice(null), 3500);
      }).catch((e) => console.error('登记隐患失败:', e));
    }

    const currentItems = activeTask.items || (activeTask as any).points || [];
    const updatedItems = currentItems.map((p: InspectionItem) => {
      if (p.id === selectedPoint.id) {
        return {
          ...p,
          status: (isAbnormal ? 'abnormal' : 'normal') as any,
          isPass: !isAbnormal,
          recordedValue: Number(pointReading.value),
          recordedTime: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          notes: pointReading.notes,
        };
      }
      return p;
    });

    const completedCount = updatedItems.filter(
      (p: InspectionItem) =>
        (p.status !== undefined && p.status !== 'pending') ||
        (p.recordedValue !== undefined && p.recordedValue !== '') ||
        p.isPass !== undefined
    ).length;
    const abnormalCount = updatedItems.filter(
      (p: InspectionItem) => p.isPass === false || p.status === 'abnormal'
    ).length;

    const updatedTask: InspectionTask = {
      ...activeTask,
      items: updatedItems,
      ...({ points: updatedItems } as any),
      completedPoints: completedCount,
      abnormalCount: abnormalCount,
      status: completedCount === updatedItems.length ? 'completed' : 'in_progress',
    };

    onUpdateInspection(updatedTask);
    setSelectedPoint(null);
  };

  const totalPointsCount = (inspections || []).reduce((sum, t) => sum + (t.totalPoints || 0), 0) || 40;
  const completedPointsCount = (inspections || []).reduce((sum, t) => sum + (t.completedPoints || 0), 0) || 25;
  const totalAbnormalCount = (inspections || []).reduce((sum, t) => sum + (t.abnormalCount || 0), 0) || 14;
  const overallRate = totalPointsCount > 0 ? Math.round((completedPointsCount / totalPointsCount) * 100) : 63;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Top Header */}
      <div className="shrink-0 bg-white/95 backdrop-blur z-10 border-b border-slate-200/80 sticky top-0 pb-3 mb-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-slate-900 flex items-center">
              <CheckCircle2 className="w-5 h-5 mr-2 text-blue-600" />
              工业设备点巡检作业与异常一键闭环
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              路线—测点两级结构、高精度测温测振抄表、限值比对、现场异常一键生成报修单
            </p>
          </div>

          <div className="flex items-center space-x-2.5">
            <button
              onClick={openQrModal}
              className="px-3.5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center space-x-1.5 shadow-xs cursor-pointer"
              title="打开摄像头扫码，自动识别设备并载入巡检作业表单"
            >
              <QrCode className="w-4 h-4 text-white" />
              <span>扫码直达巡检</span>
            </button>

            <span className="text-xs text-slate-500 hidden sm:inline">当前巡检员:</span>
            <span className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 font-semibold text-xs border border-slate-200">
              {currentUser.name} ({currentUser.roleTitle})
            </span>
          </div>
        </div>

        {/* 巡检特色：顶部路线与测点数据条 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full">
          {/* 1. 今日巡检测点数 */}
          <div className="p-2.5 bg-slate-50/90 border border-slate-200/80 rounded-xl flex items-center justify-between shadow-xs">
            <div className="flex items-center space-x-2.5">
              <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                <MapPin className="w-3.5 h-3.5" />
              </div>
              <div>
                <span className="text-[11px] text-slate-500 block">今日巡检测点</span>
                <div className="text-sm font-bold text-slate-900 font-mono">
                  {completedPointsCount} <span className="text-xs text-slate-400 font-normal">/ {totalPointsCount} 点</span>
                </div>
              </div>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-medium">
              标准路线
            </span>
          </div>

          {/* 2. 巡检打卡完成率 */}
          <div className="p-2.5 bg-slate-50/90 border border-slate-200/80 rounded-xl flex items-center justify-between shadow-xs">
            <div className="flex items-center space-x-2.5">
              <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5" />
              </div>
              <div>
                <span className="text-[11px] text-slate-500 block">打卡完成率</span>
                <div className="text-sm font-bold text-emerald-700 font-mono">
                  {overallRate}%
                </div>
              </div>
            </div>
            <div className="w-24 bg-slate-200 h-2 rounded-full overflow-hidden">
              <div className="bg-emerald-500 h-full rounded-full transition-all" style={{ width: `${overallRate}%` }} />
            </div>
          </div>

          {/* 3. 现场异常数 */}
          <div className="p-2.5 bg-slate-50/90 border border-slate-200/80 rounded-xl flex items-center justify-between shadow-xs">
            <div className="flex items-center space-x-2.5">
              <div className="w-7 h-7 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-3.5 h-3.5" />
              </div>
              <div>
                <span className="text-[11px] text-slate-500 block">发现异常测点</span>
                <div className="text-sm font-bold text-rose-600 font-mono">
                  {totalAbnormalCount} <span className="text-xs font-normal">处待治理</span>
                </div>
              </div>
            </div>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${totalAbnormalCount > 0 ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
              {totalAbnormalCount > 0 ? '超标告警' : '平稳正常'}
            </span>
          </div>
        </div>
      </div>

      {/* 下方巡检路线/任务列表与作业工作台：单独滚动 */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 pb-6">
        {/* Master-Detail Layout: Left Tasks List (5 cols), Right Inspection Points Workbench (7 cols) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Task Navigation Cards */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-bold text-slate-800 flex items-center">
              <ClipboardCheck className="w-4 h-4 mr-1.5 text-blue-600" />
              点巡检路线与任务 ({displayInspections.length})
            </h3>
            <button
              id="btn-toggle-my-tasks"
              type="button"
              onClick={() => setOnlyMyTasks(!onlyMyTasks)}
              className={`text-xs px-2.5 py-1 rounded-md border flex items-center space-x-1.5 cursor-pointer transition-colors ${
                onlyMyTasks
                  ? 'bg-blue-50 text-blue-700 border-blue-200 font-semibold'
                  : 'bg-white text-slate-500 border-slate-200 hover:text-slate-800'
              }`}
              title="切换仅看与我相关的巡检任务"
            >
              <span>只看我的任务</span>
              {onlyMyTasks && <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />}
            </button>
          </div>

          <div className="space-y-3 max-h-[720px] overflow-y-auto pr-1">
            {displayInspections.length === 0 ? (
              <div className="card-industrial bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-500 text-sm shadow-xs">
                {onlyMyTasks ? '暂无与我相关的巡检任务' : '暂无巡检任务'}
              </div>
            ) : (
              displayInspections.map((task) => {
                const isActive = task.id === (activeTask?.id || activeTaskId);
                const isComplete = task.status === 'completed';
                const progress = Math.round((task.completedPoints / (task.totalPoints || 1)) * 100);

                return (
                  <div
                    key={task.id}
                    onClick={() => {
                      setActiveTaskId(task.id);
                      setSelectedPoint(null);
                    }}
                    className={`p-4 rounded-lg border transition-all cursor-pointer flex flex-col justify-between ${
                      isActive
                        ? 'bg-blue-50/70 border-blue-500 shadow-sm ring-1 ring-blue-500/40'
                        : 'card-industrial bg-white border-slate-200 hover:border-slate-300 hover:shadow-xs'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 font-semibold">
                          {task.taskNo}
                        </span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded border font-medium ${
                            isComplete
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : task.status === 'in_progress'
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}
                        >
                          {isComplete ? '已巡检完毕' : task.status === 'in_progress' ? '巡检执行中' : '未开始'}
                        </span>
                      </div>
                      <h3 className="text-sm font-bold text-slate-900">{task.title}</h3>
                      <div className="text-xs text-slate-500 mt-1 flex items-center space-x-2">
                        <MapPin className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                        <span className="truncate">{task.route}</span>
                      </div>
                    </div>
                    <div className="mt-3 pt-2.5 border-t border-slate-100">
                      <div className="flex justify-between text-xs mb-1.5">
                        <span className="text-slate-500">
                          测点进度: <strong className="text-slate-800">{task.completedPoints}/{task.totalPoints}</strong> ({progress}%)
                        </span>
                        {task.abnormalCount > 0 ? (
                          <span className="text-rose-600 font-bold flex items-center">
                            <AlertTriangle className="w-3.5 h-3.5 mr-1" />
                            发现 {task.abnormalCount} 处异常
                          </span>
                        ) : (
                          <span className="text-emerald-700 font-medium">无异常</span>
                        )}
                      </div>

                      <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            task.abnormalCount > 0 ? 'bg-orange-500' : 'bg-blue-600'
                          }`}
                          style={{ width: `${progress}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Active Task Inspection Points Workbench (7 cols) */}
        <div className="lg:col-span-7">
          {activeTask ? (
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-5 space-y-4 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-base font-bold text-slate-900 flex items-center">
                    <span className="w-2 h-2 rounded-full bg-blue-600 mr-2 animate-pulse"></span>
                    {activeTask.title} - 点巡检测点明细清单
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    责任巡检员: {activeTask.inspectorName || (activeTask as any).inspector || '现场巡检员'} | 计划执行时段: {activeTask.scheduledDate}
                  </p>
                </div>
                <div className="flex items-center space-x-2 text-xs">
                  <span className="px-2 py-1 rounded-md bg-slate-100 text-slate-700 border border-slate-200 font-medium">
                    测点总数: {activeTask.totalPoints}
                  </span>
                  <button
                    onClick={handleInspectionReport}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium flex items-center space-x-1 cursor-pointer shadow-xs"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>AI 巡检报告</span>
                  </button>
                </div>
              </div>

              {hazardNotice && (
                <div className="p-2.5 rounded-lg bg-orange-50 border border-orange-200 text-orange-800 text-xs flex items-center justify-between">
                  <span>{hazardNotice}</span>
                  <button onClick={() => setHazardNotice(null)} className="text-slate-400 hover:text-slate-700">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Points List */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[660px] overflow-y-auto pr-1">
                {itemsList.map((pt, idx) => {
                  const isAbnormal = pt.isPass === false || pt.status === 'abnormal';
                  const isNormal = pt.isPass === true || pt.status === 'normal';
                  const checkTitle = pt.checkPoint || pt.checkItem || '重点部件监测';
                  const maxLimitVal = pt.maxLimit ?? pt.maxVal;

                  return (
                    <div
                      key={pt.id || idx}
                      className={`p-3.5 rounded-xl border transition-all flex flex-col justify-between ${
                        isAbnormal
                          ? 'bg-rose-50/70 border-rose-300 ring-1 ring-rose-200 shadow-xs'
                          : isNormal
                          ? 'bg-emerald-50/40 border-emerald-200'
                          : 'bg-white border-slate-200 hover:border-blue-300 shadow-xs'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center space-x-2">
                            <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-700 text-[11px] font-mono font-bold flex items-center justify-center border border-slate-200">
                              {idx + 1}
                            </span>
                            <span className="text-xs font-bold text-slate-800">{pt.equipmentName}</span>
                          </div>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded border font-medium ${
                              isAbnormal
                                ? 'bg-rose-100 text-rose-700 border-rose-200 font-bold'
                                : isNormal
                                ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                                : 'bg-slate-100 text-slate-600 border-slate-200'
                            }`}
                          >
                            {isAbnormal ? '🔴 测点超标异常' : isNormal ? '🟢 合格已打卡' : '待点检'}
                          </span>
                        </div>

                        <div className="text-xs text-slate-800 font-medium">{checkTitle}</div>
                        <div className="text-[11px] text-slate-500 mt-1 flex items-center space-x-2">
                          <span>标准要求: <strong className="text-slate-700">{pt.standard}</strong></span>
                          {maxLimitVal !== undefined && (
                            <span>限值: <strong className="text-orange-700 font-mono">&le; {maxLimitVal}{pt.unit || ''}</strong></span>
                          )}
                        </div>

                        {/* Recorded value if checked */}
                        {pt.recordedValue !== undefined && pt.recordedValue !== '' && (
                          <div className="mt-2 p-2 rounded bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
                            <span className="text-slate-500">实测读数:</span>
                            <span
                              className={`font-mono font-bold ${
                                isAbnormal ? 'text-rose-600 text-sm' : 'text-emerald-700'
                              }`}
                            >
                              {pt.recordedValue} {pt.unit || ''}
                            </span>
                          </div>
                        )}
                        {pt.notes && (
                          <p className="text-[11px] text-rose-600 mt-1">备注: {pt.notes}</p>
                        )}
                      </div>

                      {/* Actions for this Point */}
                      <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
                        <button
                          onClick={() => handleSelectPoint(pt)}
                          className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg transition-colors flex items-center space-x-1 cursor-pointer font-medium shadow-xs"
                        >
                          <span>{(pt.recordedValue !== undefined && pt.recordedValue !== '') ? '修改读数' : '现场打卡抄表'}</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>

                        {isAbnormal && (
                          <div className="flex items-center space-x-1.5">
                            <button
                              onClick={() => onConvertAbnormalToWorkOrder(pt, pt.equipmentName)}
                              className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-md font-medium flex items-center space-x-1 shadow-xs cursor-pointer text-[11px]"
                            >
                              <Wrench className="w-3 h-3" />
                              <span>转工单</span>
                            </button>
                            <button
                              onClick={() => handleConvertAbnormalToHazard(pt)}
                              className="px-2 py-1 bg-orange-600 hover:bg-orange-700 text-white rounded-md font-medium flex items-center space-x-1 shadow-xs cursor-pointer text-[11px]"
                              title="上报至安全隐患闭环清单"
                            >
                              <AlertTriangle className="w-3 h-3" />
                              <span>转隐患</span>
                            </button>
                            <button
                              onClick={() => handleAiGenerateWorkOrder(pt)}
                              className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium flex items-center space-x-1 shadow-xs cursor-pointer text-[11px]"
                            >
                              <Sparkles className="w-3 h-3" />
                              <span>AI</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-12 text-center text-slate-500 shadow-xs">
              <ClipboardCheck className="w-12 h-12 text-slate-400 mx-auto mb-3" />
              <h4 className="text-sm font-semibold text-slate-800">请选择左侧巡检任务</h4>
              <p className="text-xs text-slate-500 mt-1">选择任务后将在此展开现场测点清单与数据采集工作台</p>
            </div>
          )}
        </div>
      </div>
      </div>

      {/* AI 智能工单草稿弹窗 (功能 1) */}
      <AiWorkOrderDraftModal
        open={aiDraftState.open}
        title="AI 智能生成检修工单草稿"
        loading={aiDraftState.loading}
        error={aiDraftState.error}
        degraded={aiDraftState.degraded}
        draft={aiDraftState.draft || undefined}
        equipment={aiDraftState.equipment}
        operatorName={`${currentUser.name} (${currentUser.roleTitle})`}
        onClose={() => setAiDraftState((prev) => ({ ...prev, open: false }))}
        onCreated={(wo) => onCreateWorkOrder?.(wo)}
      />

      {/* AI 巡检报告弹窗 */}
      <AiResultModal
        open={reportState.open}
        title="AI 巡检报告（近 7 天真实数据聚合）"
        loading={reportState.loading}
        error={reportState.error}
        degraded={reportState.degraded}
        data={reportState.data}
        onClose={() => setReportState((prev) => ({ ...prev, open: false }))}
      />

      {/* Modal: Record Reading & Verification */}
      {selectedPoint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900 flex items-center">
                <QrCode className="w-4 h-4 mr-1.5 text-blue-600" />
                现场测点打卡与仪表抄表
              </h3>
              <button
                onClick={() => setSelectedPoint(null)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs space-y-3">
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <div className="font-bold text-slate-800">{selectedPoint.equipmentName}</div>
                <div className="text-blue-700 font-medium mt-0.5">{selectedPoint.checkPoint || selectedPoint.checkItem}</div>
                <div className="text-slate-500 mt-1">标准要求: {selectedPoint.standard}</div>
                {(selectedPoint.maxLimit !== undefined || selectedPoint.maxVal !== undefined) && (
                  <div className="text-orange-700 font-mono mt-0.5 font-bold">
                    预警上限: {selectedPoint.maxLimit ?? selectedPoint.maxVal} {selectedPoint.unit || ''}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-slate-700 mb-1 font-semibold">
                  实测数值 ({selectedPoint.unit || '数值'}) *
                </label>
                <input
                  type="number"
                  step="0.1"
                  required
                  value={pointReading.value}
                  onChange={(e) => setPointReading({ ...pointReading, value: Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono text-base font-bold"
                />
              </div>

              <div>
                <label className="block text-slate-700 mb-1">现场异常描述/巡检备注</label>
                <textarea
                  rows={2}
                  placeholder="如发现异常振动、漏油、摩擦声响请在此记录..."
                  value={pointReading.notes}
                  onChange={(e) => setPointReading({ ...pointReading, notes: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                ></textarea>
              </div>

              <div className="flex items-center space-x-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <input
                  type="checkbox"
                  id="chk-manual-abnormal"
                  checked={pointReading.isAbnormal}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setPointReading({ ...pointReading, isAbnormal: checked });
                    if (checked) setCreateHazardOnSave(true);
                  }}
                  className="w-4 h-4 text-rose-600 rounded bg-white border-slate-300 focus:ring-rose-500"
                />
                <label htmlFor="chk-manual-abnormal" className="text-xs text-rose-700 font-medium cursor-pointer">
                  标记为此测点发现人为直观异常 (如杂音/破损)
                </label>
              </div>

              {/* 登记为现场安全隐患 (功能四：隐患闭环管理联动) */}
              <div className="space-y-2 p-2.5 rounded-lg bg-rose-50/60 border border-rose-200">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="chk-create-hazard-modal"
                    checked={createHazardOnSave}
                    onChange={(e) => setCreateHazardOnSave(e.target.checked)}
                    className="w-4 h-4 text-rose-600 rounded bg-white border-slate-300 focus:ring-rose-500"
                  />
                  <label htmlFor="chk-create-hazard-modal" className="text-xs text-rose-700 font-semibold cursor-pointer flex items-center">
                    <ShieldAlert className="w-3.5 h-3.5 mr-1 text-rose-600" />
                    登记为现场安全隐患 (纳入闭环管理)
                  </label>
                </div>
                {createHazardOnSave && (
                  <div className="pt-1 flex items-center space-x-2">
                    <span className="text-[11px] text-slate-700">隐患等级:</span>
                    <select
                      value={hazardLevelOnSave}
                      onChange={(e) => setHazardLevelOnSave(e.target.value as any)}
                      className="bg-white border border-slate-200 text-xs text-slate-800 rounded px-2 py-1 focus:outline-none focus:border-rose-500"
                    >
                      <option value="general">一般隐患 (限期班组消缺)</option>
                      <option value="major">重大隐患 (厂级重点督办)</option>
                    </select>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
              <button
                onClick={() => setSelectedPoint(null)}
                className="px-4 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-lg text-xs font-medium cursor-pointer shadow-xs"
              >
                取消
              </button>
              <button
                onClick={handleSavePointRecord}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold cursor-pointer shadow-xs"
              >
                保存测点打卡
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Equipment QR Code Plate & Field Scanner */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900 flex items-center">
                <QrCode className="w-4 h-4 mr-1.5 text-blue-600" />
                设备二维码扫码识别
              </h3>
              <button
                onClick={() => setShowQrModal(false)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {qrScanSuccess && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-xs flex items-center space-x-2 animate-in fade-in">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                <span>{qrScanSuccess}</span>
              </div>
            )}

            {cameraError && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-xs flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                <span>{cameraError}</span>
              </div>
            )}

            {/* Camera Scanner Section */}
            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-slate-700 flex items-center gap-1.5">
                  <Camera className="w-3.5 h-3.5 text-blue-600" />
                  摄像头扫码识别设备
                </label>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200">
                  优先使用
                </span>
              </div>

              {/* Camera Video Feed */}
              <div className="relative bg-slate-900 rounded-lg overflow-hidden" style={{ minHeight: 200 }}>
                <video
                  ref={videoRef}
                  className="w-full h-auto rounded-lg"
                  style={{ display: cameraActive ? 'block' : 'none' }}
                  playsInline
                  muted
                />
                <canvas ref={canvasRef} className="hidden" />
                {!cameraActive && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
                    <Camera className="w-10 h-10 mb-2 opacity-50" />
                    <p className="text-xs text-slate-300">
                      {scanning ? '正在启动摄像头...' : '点击下方按钮启动摄像头扫码'}
                    </p>
                  </div>
                )}
                {cameraActive && scanning && (
                  <div className="absolute top-2 left-2 right-2">
                    <div className="bg-blue-600/80 text-white text-[10px] px-2 py-1 rounded text-center">
                      请将设备二维码对准摄像头...
                    </div>
                  </div>
                )}
              </div>

              {/* Camera Control Button */}
              <div className="flex gap-2">
                {!cameraActive ? (
                  <button
                    type="button"
                    onClick={startCamera}
                    disabled={scanning}
                    className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium flex items-center justify-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    {scanning ? '启动中...' : '开启摄像头扫码'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="flex-1 px-3 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-lg font-medium flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <X className="w-3.5 h-3.5" />
                    停止扫码
                  </button>
                )}
              </div>
            </div>

            {/* Demo Mode Section (Fallback) */}
            <div className="space-y-3 text-xs pt-3 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-slate-700 flex items-center gap-1.5">
                  <Wrench className="w-3.5 h-3.5 text-slate-400" />
                  手动选择设备
                </label>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                  演示模式（未扫码）
                </span>
              </div>

              <select
                value={selectedQrEquipId}
                onChange={(e) => {
                  setSelectedQrEquipId(e.target.value);
                  setQrScanSuccess(null);
                }}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                {(equipments || []).map((eq) => (
                  <option key={eq.id} value={eq.id}>
                    {eq.name} ({eq.code || eq.id}) - {eq.workshop}
                  </option>
                ))}
              </select>

              {/* QR Code Plate Display */}
              {(() => {
                const curEq = equipments.find((e) => e.id === selectedQrEquipId) || equipments[0];
                const qrUrl = `/api/v1/equipments/${selectedQrEquipId}/qrcode`;

                return (
                  <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
                    <div className="flex flex-col sm:flex-row items-center gap-4 bg-white p-4 rounded-lg border border-slate-200 shadow-xs">
                      <div className="bg-white p-2 border border-slate-200 rounded-lg shrink-0 shadow-xs">
                        <img
                          src={qrUrl}
                          alt="Equipment QR Code"
                          className="w-32 h-32 object-contain"
                        />
                      </div>

                      <div className="space-y-1.5 text-left flex-1">
                        <div className="text-xs font-mono px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 inline-block font-semibold">
                          {curEq?.code || curEq?.id}
                        </div>
                        <h4 className="text-sm font-bold text-slate-900">{curEq?.name}</h4>
                        <div className="text-[11px] text-slate-500 space-y-0.5">
                          <div>车间位置: <span className="text-slate-800">{curEq?.workshop} / {curEq?.location || '生产A线'}</span></div>
                          <div>规格型号: <span className="text-slate-800">{curEq?.model || '工业重型标准型'}</span></div>
                          <div>健康度指数: <strong className="text-emerald-700 font-bold">{curEq?.healthScore || 92}%</strong></div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <a
                        href={qrUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:text-blue-700 font-medium flex items-center space-x-1"
                      >
                        <QrCode className="w-3.5 h-3.5" />
                        <span>查看高清电子铭牌</span>
                      </a>

                      <button
                        type="button"
                        onClick={() => {
                          setQrScanSuccess(`演示模式：已选择 ${curEq?.name} (${curEq?.code})，巡检表单已就绪。`);
                          const matchedTask = inspections.find((t) =>
                            t.title.includes(curEq?.name || '') ||
                            (t.route && t.route.includes(curEq?.workshop || ''))
                          );
                          if (matchedTask) setActiveTaskId(matchedTask.id);
                          setShowQrModal(false);
                        }}
                        className="px-3.5 py-1.5 bg-slate-600 hover:bg-slate-700 text-white rounded-lg font-medium flex items-center space-x-1.5 cursor-pointer shadow-xs"
                      >
                        <Wrench className="w-3.5 h-3.5" />
                        <span>选择此设备巡检</span>
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="flex justify-end pt-3 border-t border-slate-100">
              <button
                onClick={() => setShowQrModal(false)}
                className="px-4 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-lg text-xs cursor-pointer shadow-xs font-medium"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
