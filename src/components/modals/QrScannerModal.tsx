import React, { useState } from 'react';
import { QrCode, Scan, X } from 'lucide-react';
import type { Equipment } from '../../types';

export interface QrScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  equipments: Equipment[];
  onSelectEquipmentForInspection: (equipmentId: string) => void;
  onNavigateToEquipments: () => void;
}

/**
 * 全局设备扫码巡检 / 电子铭牌真机二维码 Modal。
 * 支持桌面端模拟识别与真机电子铭牌二维码生成展示。
 */
export const QrScannerModal: React.FC<QrScannerModalProps> = ({
  isOpen,
  onClose,
  equipments,
  onSelectEquipmentForInspection,
  onNavigateToEquipments,
}) => {
  const [qrModalTab, setQrModalTab] = useState<'simulate' | 'real_qrcode'>('simulate');
  const [selectedQrEquipId, setSelectedQrEquipId] = useState<string>('');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-5 shadow-2xl space-y-4 card-industrial">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg border border-blue-100">
              <Scan className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">工业设备电子铭牌与扫码中心</h3>
              <p className="text-[11px] text-slate-500">桌面端快捷核验模拟 · 手机端微信真机扫码直达</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-600 p-1.5 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 模式切换 Tab */}
        <div className="flex rounded-lg bg-slate-100 p-1 text-xs">
          <button
            type="button"
            onClick={() => setQrModalTab('simulate')}
            className={`flex-1 py-1.5 rounded-md font-medium text-center transition-all cursor-pointer ${
              qrModalTab === 'simulate'
                ? 'bg-white text-blue-600 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            桌面虚拟扫码模拟
          </button>
          <button
            type="button"
            onClick={() => {
              setQrModalTab('real_qrcode');
              if (!selectedQrEquipId && equipments.length > 0) {
                setSelectedQrEquipId(equipments[0].id);
              }
            }}
            className={`flex-1 py-1.5 rounded-md font-medium text-center transition-all cursor-pointer ${
              qrModalTab === 'real_qrcode'
                ? 'bg-white text-blue-600 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            真机电子铭牌二维码
          </button>
        </div>

        {qrModalTab === 'simulate' ? (
          <>
            {/* 模拟摄像头取景器 */}
            <div className="relative h-40 bg-slate-50 rounded-lg border border-slate-200 flex flex-col items-center justify-center overflow-hidden">
              <div className="w-32 h-32 border-2 border-dashed border-blue-400/80 rounded-lg relative flex items-center justify-center bg-white/80">
                <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-blue-500 to-transparent absolute top-1/2 -translate-y-1/2 animate-pulse" />
                <QrCode className="w-14 h-14 text-blue-500/30" />
              </div>
              <span className="text-[11px] text-blue-600 font-mono mt-2 z-10 font-medium">
                摄像头取景中 · 请在下方点击设备模拟扫码识别
              </span>
            </div>

            {/* 快捷识别模拟列表 */}
            <div className="space-y-2 text-xs">
              <span className="text-slate-500 font-medium block">点击机组立即模拟识别入单：</span>
              <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                {equipments.map((eq) => (
                  <button
                    key={eq.id}
                    onClick={() => {
                      onClose();
                      onSelectEquipmentForInspection(eq.id);
                    }}
                    className="w-full flex items-center justify-between p-2.5 rounded-lg bg-white hover:bg-blue-50/60 border border-slate-200 hover:border-blue-300 text-left transition-colors cursor-pointer group"
                  >
                    <div>
                      <div className="font-semibold text-slate-700 group-hover:text-blue-600">{eq.name}</div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        {eq.code} | {eq.workshop} · {eq.location}
                      </div>
                    </div>
                    <span className="text-[11px] px-2 py-1 bg-blue-50 text-blue-600 rounded font-medium group-hover:bg-blue-600 group-hover:text-white transition-colors border border-blue-100">
                      识别入单
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          /* 真机扫码与电子铭牌二维码视图 */
          <div className="space-y-3 text-xs">
            <div>
              <label className="text-slate-600 font-medium block mb-1.5">选择目标机组以生成现场二维码：</label>
              <select
                value={selectedQrEquipId || (equipments[0]?.id ?? '')}
                onChange={(e) => setSelectedQrEquipId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-blue-200"
              >
                {equipments.map((eq) => (
                  <option key={eq.id} value={eq.id}>
                    {eq.name}（{eq.code}）- {eq.workshop}
                  </option>
                ))}
              </select>
            </div>

            {/* 动态二维码展示区 */}
            {(() => {
              const currId = selectedQrEquipId || equipments[0]?.id;
              const currEq = equipments.find((e) => e.id === currId) || equipments[0];
              if (!currEq) return null;
              return (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex flex-col sm:flex-row items-center gap-3.5">
                  <div className="w-32 h-32 bg-white p-2 border border-slate-200 rounded-lg shrink-0 shadow-xs flex items-center justify-center">
                    <img
                      src={`/api/v1/equipments/${currEq.id}/qrcode`}
                      alt={`${currEq.name} 专属二维码`}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="font-bold text-slate-900 text-sm truncate">{currEq.name}</div>
                    <div className="text-[11px] font-mono text-blue-600 font-semibold">{currEq.code}</div>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      ✅ 真实工业二维码：手机微信或工业 PDA 扫码直达现场巡检或报修工单。
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onNavigateToEquipments();
                      }}
                      className="text-[11px] text-blue-600 hover:underline font-medium cursor-pointer block mt-1"
                    >
                      前往设备档案查看高清打印铭牌 →
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
};
