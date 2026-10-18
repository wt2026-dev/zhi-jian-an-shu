import React from 'react';
import { Download, Printer, Smartphone, X } from 'lucide-react';
import { Equipment } from '../../types';

interface EquipmentQrModalProps {
  isOpen: boolean;
  activeEquipment: Equipment | null;
  isWeChatConfigured: boolean | null;
  wechatQrFailedMap: Record<string, boolean>;
  onSetWechatQrFailed: (id: string) => void;
  onClose: () => void;
}

export const EquipmentQrModal: React.FC<EquipmentQrModalProps> = ({
  isOpen,
  activeEquipment,
  isWeChatConfigured,
  wechatQrFailedMap,
  onSetWechatQrFailed,
  onClose,
}) => {
  if (!isOpen || !activeEquipment) return null;

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 text-center shadow-2xl space-y-4 card-industrial">
        <div className="flex justify-between items-center pb-2 border-b border-slate-100">
          <div className="flex items-center space-x-1.5 text-slate-800">
            <Smartphone className="w-4 h-4 text-cyan-600" />
            <span className="text-xs font-bold">微信扫码 · 直达设备报修</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-600 p-1 rounded hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 bg-slate-50 rounded-2xl inline-block border border-slate-200 shadow-inner">
          <div className="w-52 h-52 bg-white p-3 rounded-xl flex flex-col items-center justify-center text-slate-800 border border-slate-200 shadow-sm relative">
            <img
              src={qrSrc}
              alt="微信报修码"
              className="w-full h-full object-contain rounded"
              onError={() => {
                if (!useH5) {
                  onSetWechatQrFailed(activeEquipment.id);
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
      </div>
    </div>
  );
};
