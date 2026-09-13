import React, { useCallback, useEffect, useRef, useState } from 'react';
import { EquipmentPoint, DutyTechnician, DispatchRecommendationItem } from '../api';

/**
 * 高德地图调度渲染组件（JS API 2.0）
 * - 依赖 .env 中 VITE_AMAP_KEY（Web端 JS API Key），禁止硬编码进组件。
 * - 无 Key / 网络不可达 / 脚本加载失败 → 回调 onFail()，由父组件降级为平面 SVG 示意图，不白屏。
 * - 设备故障点位：红色脉冲 Marker；师傅位置：绿色（空闲）/ 蓝色（在岗）Marker + 姓名标签。
 * - 选中工单后：绘制推荐师傅到故障点的虚线连线与真实距离文本。
 */

const AMAP_KEY: string = (import.meta.env.VITE_AMAP_KEY as string) || '';
/** 厂区中心（与迁移 019 的示例中心一致） */
const FACTORY_CENTER: [number, number] = [113.31, 23.12];

declare global {
  interface Window {
    AMap: any;
  }
}

interface AmapDispatchMapProps {
  equipmentPoints: EquipmentPoint[];
  technicians: DutyTechnician[];
  selectedEqPoint: EquipmentPoint | null;
  recommendations: DispatchRecommendationItem[];
  onFail: () => void;
  onHoverTech?: (t: DutyTechnician | null) => void;
  onHoverEq?: (p: EquipmentPoint | null) => void;
}

const dotStyle = (color: string, pulse = false): string => `
  width:14px;height:14px;border-radius:50%;
  background:${color};border:2.5px solid #fff;
  box-shadow:0 1px 4px rgba(0,0,0,.35);position:relative;
`;
const pulseKeyframes = `
  @keyframes amapFaultPulse {
    0% { transform: scale(.8); opacity:.85; }
    70% { transform: scale(2.1); opacity:0; }
    100% { transform: scale(2.1); opacity:0; }
  }
`;

export const AmapDispatchMap: React.FC<AmapDispatchMapProps> = ({
  equipmentPoints,
  technicians,
  selectedEqPoint,
  recommendations,
  onFail,
  onHoverTech,
  onHoverEq,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  /** 清空旧叠加层（避免数据刷新后点位堆积） */
  const clearOverlays = useCallback(() => {
    if (!mapRef.current) return;
    overlaysRef.current.forEach((o) => mapRef.current.remove(o));
    overlaysRef.current = [];
  }, []);

  /** 初始化地图（script 就绪后调用，最多一次） */
  const initMap = useCallback(() => {
    if (mapRef.current || !containerRef.current || !window.AMap) return;
    try {
      const map = new window.AMap.Map(containerRef.current, {
        center: FACTORY_CENTER,
        zoom: 16,
        resizeEnable: true,
        mapStyle: 'amap://styles/light',
      });
      mapRef.current = map;
      setStatus('ready');
    } catch (e) {
      console.error('[AmapDispatchMap] 初始化失败', e);
      setStatus('failed');
      onFail();
    }
  }, [onFail]);

  // 加载高德 JS API 脚本
  useEffect(() => {
    if (!AMAP_KEY) {
      setStatus('failed');
      onFail();
      return;
    }
    if (window.AMap) {
      initMap();
      return;
    }
    const s = document.createElement('script');
    s.src = `https://webapi.amap.com/maps?v=2.0&key=${AMAP_KEY}`;
    s.async = true;
    const onOk = () => {
      window.clearTimeout(timer);
      initMap();
    };
    const onErr = () => {
      window.clearTimeout(timer);
      setStatus('failed');
      onFail();
    };
    s.addEventListener('load', onOk);
    s.addEventListener('error', onErr);
    document.head.appendChild(s);
    // 安全兜底：12 秒内未就绪视为加载失败（离线 / Key 无效）
    const timer = window.setTimeout(() => {
      if (!window.AMap || !mapRef.current) {
        setStatus('failed');
        onFail();
      }
    }, 12000);
    return () => {
      window.clearTimeout(timer);
      s.removeEventListener('load', onOk);
      s.removeEventListener('error', onErr);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 数据变化 → 重绘点位与连线
  useEffect(() => {
    if (status !== 'ready' || !mapRef.current) return;
    const map = mapRef.current;
    clearOverlays();
    if (!window.AMap) return;

    // 样式注入（脉冲动画）
    if (!document.getElementById('amap-fault-style')) {
      const st = document.createElement('style');
      st.id = 'amap-fault-style';
      st.textContent = pulseKeyframes;
      document.head.appendChild(st);
    }

    // 故障设备：红色脉冲 Marker
    equipmentPoints.forEach((p) => {
      const lng = p.geoLng ?? null;
      const lat = p.geoLat ?? null;
      if (lng == null || lat == null) return;
      const isFaulty = p.openOrders > 0 || ['fault', 'warning', 'overhauling'].includes(p.status);
      const inner = isFaulty
        ? `<div style="${dotStyle('#ef4444', true)}">
             <span style="position:absolute;inset:-6px;border-radius:50%;background:rgba(239,68,68,.4);animation:amapFaultPulse 1.8s ease-out infinite;"></span>
           </div>`
        : `<div style="${dotStyle('#cbd5e1')}"></div>`;
      const marker = new window.AMap.Marker({
        position: [lng, lat],
        content: inner,
        offset: new window.AMap.Pixel(-7, -7),
        zIndex: 30,
        title: `${p.name}（${p.workshop || '未标定'}）`,
      });
      marker.on('mouseover', () => onHoverEq?.(p));
      marker.on('mouseout', () => onHoverEq?.(null));
      map.add(marker);
      overlaysRef.current.push(marker);
    });

    // 在岗师傅：绿（空闲）/ 蓝（在岗）Marker + 姓名标签
    technicians.forEach((t) => {
      const lng = t.geoLng ?? null;
      const lat = t.geoLat ?? null;
      if (lng == null || lat == null) return;
      const color = t.onlineStatus === 'idle' ? '#10b981' : '#3b82f6';
      const marker = new window.AMap.Marker({
        position: [lng, lat],
        content: `<div style="${dotStyle(color)}"></div>`,
        offset: new window.AMap.Pixel(-7, -7),
        zIndex: 40,
        label: {
          content: `${t.name}（${t.onlineStatus === 'idle' ? '空闲' : '在岗'}）`,
          direction: 'top',
          offset: new window.AMap.Pixel(0, -6),
          style: {
            fontSize: '11px',
            fontWeight: '700',
            color: '#0f172a',
            background: 'rgba(255,255,255,.92)',
            border: `1px solid ${color}`,
            borderRadius: '6px',
            padding: '1px 6px',
            whiteSpace: 'nowrap',
          },
        },
      });
      marker.on('mouseover', () => onHoverTech?.(t));
      marker.on('mouseout', () => onHoverTech?.(null));
      map.add(marker);
      overlaysRef.current.push(marker);
    });

    // 推荐连线：选中设备 → 推荐师傅（虚线 + 距离文本）
    if (selectedEqPoint && selectedEqPoint.geoLng != null && selectedEqPoint.geoLat != null) {
      recommendations.slice(0, 3).forEach((r, idx) => {
        const t = r.technician;
        if (t.geoLng == null || t.geoLat == null) return;
        const line = new window.AMap.Polyline({
          path: [
            [selectedEqPoint.geoLng, selectedEqPoint.geoLat],
            [t.geoLng, t.geoLat],
          ],
          strokeColor: idx === 0 ? '#3b82f6' : '#94a3b8',
          strokeWeight: idx === 0 ? 4 : 2,
          strokeOpacity: 0.85,
          strokeStyle: 'dashed',
          strokeDasharray: [8, 6],
          zIndex: 20,
        });
        map.add(line);
        overlaysRef.current.push(line);

        const midLng = ((selectedEqPoint.geoLng + t.geoLng) / 2);
        const midLat = ((selectedEqPoint.geoLat + t.geoLat) / 2);
        const dist = new window.AMap.Text({
          position: [midLng, midLat],
          content: `<div style="font-size:11px;font-weight:600;color:${idx === 0 ? '#1d4ed8' : '#475569'};background:rgba(255,255,255,.94);border:1px solid #cbd5e1;border-radius:6px;padding:1px 6px;white-space:nowrap;">${r.distanceLabel}</div>`,
          offset: new window.AMap.Pixel(0, -8),
          zIndex: 50,
        });
        map.add(dist);
        overlaysRef.current.push(dist);
      });
    }

    map.setFitView(null, false, [60, 60, 60, 60], 300);
  }, [status, equipmentPoints, technicians, selectedEqPoint, recommendations, clearOverlays, onHoverTech, onHoverEq]);

  // 卸载时销毁地图
  useEffect(() => {
    return () => {
      try {
        mapRef.current?.destroy?.();
        mapRef.current = null;
      } catch {
        /* noop */
      }
    };
  }, []);

  return (
    <div className="relative w-full h-[420px] md:h-[480px] rounded-xl overflow-hidden border border-slate-200">
      {status === 'loading' && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-[#f1f5f9] text-xs text-slate-400">
          正在加载高德地图…
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
};
