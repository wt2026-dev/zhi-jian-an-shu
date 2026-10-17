// 重构说明：多厂区层级 API（Migration 025 配套）。
// 数据纪律：广州主厂为真实数据；南京/成都/武汉 is_demo=true（演示数据），
// 不伪造工业产值/人员规模等运营指标。
import { FactoryRepository } from "../../db/repositories/factoryRepository.ts";

function toFactoryDto(row: Awaited<ReturnType<typeof FactoryRepository.listFactories>>[number]) {
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    region: row.region,
    geo: { lng: row.geo_lng, lat: row.geo_lat },
    address: row.address,
    status: row.status,
    isDemo: row.is_demo,
    stats: {
      equipmentCount: row.equipment_count,
      faultCount: row.fault_count,
      alertCount: row.alert_count,
      avgHealth: row.avg_health,
    },
  };
}

/** GET /api/v1/factories?city=xxx 可选按城市过滤 */
export async function handleListFactories(req: any, res: any) {
  try {
    const rows = await FactoryRepository.listFactories();
    const city = typeof req.query?.city === "string" ? req.query.city.trim() : "";
    const list = (city ? rows.filter((r) => r.city === city) : rows).map(toFactoryDto);
    res.json(list);
  } catch (err) {
    console.error("[factoryController] 厂区列表查询失败:", err);
    res.status(500).json({ error: "厂区列表查询失败" });
  }
}

/** GET /api/v1/factories/geo/summary 全国区域级聚合 */
export async function handleFactoryGeoSummary(_req: any, res: any) {
  try {
    const regions = await FactoryRepository.getRegionSummary();
    const list = await FactoryRepository.listFactories();
    res.json({
      regions,
      totals: {
        factoryCount: list.length,
        equipmentCount: list.reduce((s, r) => s + r.equipment_count, 0),
        faultCount: list.reduce((s, r) => s + r.fault_count, 0),
        alertCount: list.reduce((s, r) => s + r.alert_count, 0),
        avgHealth:
          list.length > 0
            ? Math.round((list.reduce((s, r) => s + r.avg_health, 0) / list.length) * 10) / 10
            : 0,
      },
    });
  } catch (err) {
    console.error("[factoryController] 全国聚合查询失败:", err);
    res.status(500).json({ error: "全国聚合查询失败" });
  }
}

/** GET /api/v1/factories/:id 单厂区详情 + 设备列表 */
export async function handleGetFactoryById(req: any, res: any) {
  try {
    const factory = await FactoryRepository.getFactoryById(req.params.id);
    if (!factory) {
      res.status(404).json({ error: "厂区不存在" });
      return;
    }
    const equipments = await FactoryRepository.listFactoryEquipments(req.params.id);
    res.json({ ...toFactoryDto(factory), equipments });
  } catch (err) {
    console.error("[factoryController] 厂区详情查询失败:", err);
    res.status(500).json({ error: "厂区详情查询失败" });
  }
}
