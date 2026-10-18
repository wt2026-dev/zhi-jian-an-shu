export const REGION_COLORS: string[] = [
  'rgba(59,130,246,0.10)',
  'rgba(16,185,129,0.10)',
  'rgba(245,158,11,0.10)',
  'rgba(139,92,246,0.10)',
  'rgba(6,182,212,0.10)',
  'rgba(236,72,153,0.10)',
  'rgba(132,204,22,0.10)',
  'rgba(244,114,182,0.10)',
  'rgba(148,163,184,0.12)',
];

export interface RegionBox {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface RecommendMeta {
  workOrder?: { orderNo: string; title: string; faultType: string | null; priority: string };
  equipment?: { id: string; name: string; code: string; workshop: string | null; mapX: number; mapY: number };
}

export interface DispatchToastState {
  ok: boolean;
  text: string;
}

export interface DispatchStats {
  onlineCount: number;
  idleCount: number;
  pendingCount: number;
  avgDistance: number | null;
}
