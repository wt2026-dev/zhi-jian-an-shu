// 多厂区层级 API 客户端（配合 Migration 025 / GET /api/v1/factories*）。
// 独立成文件的原因：src/api/index.ts 当前持有他人未提交改动，遵循小步提交约定，
// 本模块自包含 fetch 封装，不改动既有 api/index.ts。
export interface FactoryStats {
  equipmentCount: number;
  faultCount: number;
  alertCount: number;
  avgHealth: number;
}

export interface FactorySummary {
  id: string;
  name: string;
  city: string;
  region: string;
  geo: { lng: number; lat: number };
  address: string;
  status: string;
  isDemo: boolean;
  stats: FactoryStats;
}

export interface FactoryEquipmentBrief {
  id: string;
  code: string;
  name: string;
  category: string;
  model: string;
  workshop: string;
  status: string;
  health_score: number;
  factory_id: string;
}

export interface FactoryDetail extends FactorySummary {
  equipments: FactoryEquipmentBrief[];
}

export interface FactoryRegionSummary {
  region: string;
  factory_count: number;
  equipment_count: number;
  fault_count: number;
  alert_count: number;
  avg_health: number;
}

export interface FactoryGeoSummary {
  regions: FactoryRegionSummary[];
  totals: {
    factoryCount: number;
    equipmentCount: number;
    faultCount: number;
    alertCount: number;
    avgHealth: number;
  };
}

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`/api/v1${path}`, { credentials: "include" });
  if (!res.ok) {
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      /* 非 JSON 响应体，忽略 */
    }
    throw Object.assign(new Error((data && data.error) || `请求失败 ${res.status}`), { status: res.status, data });
  }
  return res.json() as Promise<T>;
}

export const factoryApi = {
  /** 全部厂区列表（可按城市过滤），含设备数/故障数/告警数/健康分真实聚合 */
  list: (city?: string) => request<FactorySummary[]>(`/factories${city ? `?city=${encodeURIComponent(city)}` : ""}`),
  /** 全国区域级聚合（华南/华东/西南/华中） */
  geoSummary: () => request<FactoryGeoSummary>("/factories/geo/summary"),
  /** 单厂区详情 + 设备列表 */
  getById: (id: string) => request<FactoryDetail>(`/factories/${encodeURIComponent(id)}`),
};
