import React from 'react';
import { QrCode, X, CheckCircle2, AlertTriangle, Camera, Wrench } from 'lucide-react';
import { Equipment } from '../../types';

interface InspectionQrModalProps {
  open: boolean;
  equipments: Equipment[];
  selectedQrEquipId: string;
  qrScanSuccess: string | null;
  cameraActive: boolean;
  cameraError: string | null;
  scanning: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onStartCamera: () => void;
  onStopCamera: () => void;
  onChangeSelectedQrEquipId: (id: string) => void;
  onSelectEquipmentForInspection: (eq: Equipment) => void;
  onClose: () => void;
}

export const InspectionQrModal: React.FC<InspectionQrModalProps> = ({
  open,
  equipments,
  selectedQrEquipId,
  qrScanSuccess,
  cameraActive,
  cameraError,
  scanning,
  videoRef,
  canvasRef,
  onStartCamera,
  onStopCamera,
  onChangeSelectedQrEquipId,
  onSelectEquipmentForInspection,
  onClose,
}) => {
  if (!open) return null;

  const curEq = equipments.find((e) => e.id === selectedQrEquipId) || equipments[0];
  const qrUrl = `/api/v1/equipments/${selectedQrEquipId}/qrcode`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-900 flex items-center">
            <QrCode className="w-4 h-4 mr-1.5 text-blue-600" />
            设备二维码扫码识别
          </h3>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
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
                onClick={onStartCamera}
                disabled={scanning}
                className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium flex items-center justify-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
              >
                <Camera className="w-3.5 h-3.5" />
                {scanning ? '启动中...' : '开启摄像头扫码'}
              </button>
            ) : (
              <button
                type="button"
                onClick={onStopCamera}
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
              <Wrench className="w-3.5 h-3.5 text-slate-500" />
              手动选择设备
            </label>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
              演示模式（未扫码）
            </span>
          </div>

          <select
            value={selectedQrEquipId}
            onChange={(e) => onChangeSelectedQrEquipId(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            {(equipments || []).map((eq) => (
              <option key={eq.id} value={eq.id}>
                {eq.name} ({eq.code || eq.id}) - {eq.workshop}
              </option>
            ))}
          </select>

          {/* QR Code Plate Display */}
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
                  <div>健康度指数: <strong className="text-emerald-700 font-bold">{typeof curEq?.healthScore === 'number' ? `${curEq.healthScore}%` : '—'}</strong></div>
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
                onClick={() => curEq && onSelectEquipmentForInspection(curEq)}
                className="px-3.5 py-1.5 bg-slate-600 hover:bg-slate-700 text-white rounded-lg font-medium flex items-center space-x-1.5 cursor-pointer shadow-xs"
              >
                <Wrench className="w-3.5 h-3.5" />
                <span>选择此设备巡检</span>
              </button>
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-3 border-t border-slate-100">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-lg text-xs cursor-pointer shadow-xs font-medium"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
