import React from 'react';
import {
  Activity,
  FileText,
  QrCode,
  Smartphone,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import { Equipment } from '../../types';
import { getStatusBadge } from './equipmentArchiveTypes';

interface EquipmentDetailDrawerProps {
  activeEquipment: Equipment | null;
  isWeChatConfigured: boolean | null;
  wechatQrFailedMap: Record<string, boolean>;
  onSetWechatQrFailed: (id: string) => void;
  onClose: () => void;
  onOpenQrModal: () => void;
  onOpenAiSummary: (eq: Equipment) => void;
  onOpenAiDiagnose: (eq: Equipment) => void;
  onOpenWorkOrder: (eq: Equipment) => void;
}

export const EquipmentDetailDrawer: React.FC<EquipmentDetailDrawerProps> = ({
  activeEquipment,
  isWeChatConfigured,
  wechatQrFailedMap,
  onSetWechatQrFailed,
  onClose,
  onOpenQrModal,
  onOpenAiSummary,
  onOpenAiDiagnose,
  onOpenWorkOrder,
}) => {
  if (!activeEquipment) return null;

  const statusBadge = getStatusBadge(activeEquipment.status);
  const useH5 = isWeChatConfigured === false || wechatQrFailedMap[activeEquipment.id];
  const qrSrc = useH5
    ? `/api/v1/wechat/h5-qrcode?deviceId=${encodeURIComponent(activeEquipment.id)}`
    : `/api/v1/wechat/repair-qrcode?deviceId=${encodeURIComponent(activeEquipment.id)}&width=430`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl space-y-6 card-industrial">
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-slate-100">
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-cyan-50 text-cyan-700 border border-cyan-200 font-semibold">
                {activeEquipment.code}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded border font-medium ${statusBadge.color}`}>
                {statusBadge.label}
              </span>
              <span className="text-xs font-mono font-bold text-emerald-700">
                健康评分: {activeEquipment.healthScore}分
              </span>
            </div>
            <button
              type="button"
              onClick={() => onOpenAiSummary(activeEquipment)}
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
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 cursor-pointer"
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
              设备遥测快照
            </h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 rounded bg-white border border-slate-200 shadow-xs">
                <span className="text-[10px] text-slate-500 block">轴承温度</span>
                <span className="font-mono text-sm font-bold text-slate-800">{activeEquipment.telemetry?.temperature ?? "—"} °C</span>
              </div>
              <div className="p-2 rounded bg-white border border-slate-200 shadow-xs">
                <span className="text-[10px] text-slate-500 block">振动速度 RMS</span>
                <span className="font-mono text-sm font-bold text-slate-800">{activeEquipment.telemetry?.vibration ?? "—"} mm/s</span>
              </div>
              <div className="p-2 rounded bg-white border border-slate-200 shadow-xs">
                <span className="text-[10px] text-slate-500 block">工作电压</span>
                <span className="font-mono text-sm font-bold text-slate-800">{activeEquipment.telemetry?.voltage ?? "—"} V</span>
              </div>
              <div className="p-2 rounded bg-white border border-slate-200 shadow-xs">
                <span className="text-[10px] text-slate-500 block">负荷率</span>
                <span className="font-mono text-sm font-bold text-slate-800">{activeEquipment.telemetry?.loadRate ?? "—"} %</span>
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

        {/* 扫码报修专属区块 */}
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
              onClick={onOpenQrModal}
              className="w-28 h-28 shrink-0 bg-slate-50 border border-slate-200 rounded-lg p-1.5 flex items-center justify-center cursor-pointer group hover:border-cyan-400 transition-all shadow-xs relative"
              title="点击放大预览、下载或打印"
            >
              <img
                src={qrSrc}
                alt="设备报修二维码"
                className="w-full h-full object-contain rounded"
                onError={() => {
                  if (!useH5) {
                    onSetWechatQrFailed(activeEquipment.id);
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
                  onClick={onOpenQrModal}
                  className="px-2.5 py-1 bg-cyan-50 hover:bg-cyan-100 text-cyan-700 rounded text-[11px] font-medium transition-colors border border-cyan-200 flex items-center space-x-1 cursor-pointer"
                >
                  <QrCode className="w-3 h-3" />
                  <span>放大预览并下载</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons in Modal */}
        <div className="flex items-center justify-between pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onOpenQrModal}
            className="px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg flex items-center space-x-1.5 cursor-pointer font-medium"
          >
            <QrCode className="w-4 h-4 text-cyan-600" />
            <span>查看设备电子标签</span>
          </button>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => {
                onOpenAiDiagnose(activeEquipment);
                onClose();
              }}
              className="px-3.5 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg flex items-center space-x-1.5 font-medium cursor-pointer shadow-xs"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI 智能诊断</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onOpenWorkOrder(activeEquipment);
                onClose();
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
  );
};
