/**
 * 备件库存联动服务 —— 把拆解视图 BOM 位号与真实备件库存（spare_parts 台账）对齐，
 * 供拆解页「零件详情库存四要素 + 库存不足红色预警 + 一键生成采购申请」。
 *
 * ## 数据来源（全部真实，不编造）
 *   · 库存：spare_parts 表真实台账 —— stock（当前库存）/ safe_stock（库存预警阈值）/
 *     location（仓库货架）/ price；一次 getAll 全量拉取后在本地按位号名/规格/别名做
 *     归一化互含匹配归属（与 partHistoryService 的备件命中同一条文本口径）。
 *   · 采购周期：库内没有前置期字段（已核 migrations/009），按分类规则配置给出参考
 *     （src/server/config/partProcurementConfig.ts，可环境变量调整），面板如实标注出处。
 *   · 低库存判定：stock ≤ safe_stock（与 SparePartsView / GET /spare-parts/low-stock
 *     同一条判定线，不做两套口径）。
 */
import { EquipmentRepository } from '../../db/repositories/index.ts';
import { SparePartsRepository } from '../../db/repositories/sparePartsRepository.ts';
import { EXPLODED_VIEW_FILES } from '../../components/equipment3d/explodedViewFiles.ts';
import { getCatalogForDevice, expandAliases, type CatalogPart } from './partMatchService.ts';
import {
  getPurchaseLeadRules,
  getDefaultPurchaseLeadDays,
  type PurchaseLeadRule,
} from '../config/partProcurementConfig.ts';

export interface PartInventoryMatch {
  /** spare_parts 行真实数据 */
  id: string;
  name: string;
  spec: string;
  model: string;
  unit: string;
  stock: number;
  safeStock: number;
  /** 缺口（safe_stock - stock，取整下限 0） */
  shortage: number;
  /** 低库存判定线与备件页/低库存接口同口径：stock ≤ safeStock */
  low: boolean;
  location: string;
  price: number;
  /** 采购前置期天数（分类配置口径，如实标注非库内字段） */
  purchaseLeadDays: number;
  purchaseLeadLabel: string;
}

export interface CatalogPartInventory {
  posNo: string;
  name: string;
  category?: string;
  /** 命中的真实备件台账行；无命中 = null（如实"无备件记录"，不编造） */
  inventory: PartInventoryMatch | null;
}

export interface PartInventoryDiagnostics {
  deviceId: string;
  deviceName: string;
  deviceCode: string;
  explodedViewFile: string | null;
  generatedAt: string;
  parts: CatalogPartInventory[];
  summary: {
    /** 库存不足（stock ≤ safe_stock）的零件数 */
    lowCount: number;
    /** 命中备件台账的零件数 */
    matchedCount: number;
    totalParts: number;
    /** 低库存零件的总缺口（件） */
    totalShortage: number;
  };
  dataNote: string;
}

function normalized(text: string): string {
  return String(text ?? '').toLowerCase().replace(/\s+/g, '');
}

/**
 * 位号名/规格/别名 ↔ 备件名/规格/型号 双向互含匹配（与 partHistoryService 的
 * parts_used 归属同一条文本口径，保证"维修历史命中的备件"与"库存联动命中的备件"
 * 对同一位号给出一致结果）。
 */
export function matchSpareInventory(
  tokens: string[],
  spare: { name: string; spec?: string; model?: string },
): boolean {
  const targets = tokens.map(normalized).filter((t) => t.length >= 2);
  if (!targets.length) return false;
  const candidates = [spare.name, spare.spec ?? '', spare.model ?? '']
    .filter(Boolean)
    .map(normalized)
    .filter((t) => t.length >= 2);
  if (!candidates.length) return false;
  return candidates.some((c) => targets.some((tgt) => c.includes(tgt) || tgt.includes(c)));
}

/** 备件 → 采购前置期配置（按名称/规格/型号关键词命中规则；未命中走兜底天数） */
export function resolvePurchaseLead(
  rules: PurchaseLeadRule[],
  spare: { name: string; spec?: string; model?: string },
): { leadDays: number; label: string } {
  const candidates = [spare.name, spare.spec ?? '', spare.model ?? ''].filter(Boolean);
  for (const rule of rules) {
    for (const kw of rule.keywords) {
      if (candidates.some((c) => c.includes(kw))) {
        return { leadDays: rule.leadDays, label: rule.label };
      }
    }
  }
  return { leadDays: getDefaultPurchaseLeadDays(), label: '通用默认采购周期（配置）' };
}

export async function getDevicePartInventory(deviceId: string): Promise<PartInventoryDiagnostics> {
  const eq = await EquipmentRepository.getById(deviceId);
  if (!eq) throw Object.assign(new Error('设备未找到'), { code: 'EQUIPMENT_NOT_FOUND' });

  const generatedAt = new Date();
  const explodedViewFile = EXPLODED_VIEW_FILES[deviceId] ?? null;
  const catalog = getCatalogForDevice(deviceId);
  if (!catalog.length) {
    return {
      deviceId,
      deviceName: eq.name ?? '',
      deviceCode: eq.code ?? '',
      explodedViewFile,
      generatedAt: generatedAt.toISOString(),
      parts: [],
      summary: { lowCount: 0, matchedCount: 0, totalParts: 0, totalShortage: 0 },
      dataNote: '该设备没有拆解视图 BOM 目录，无位号可关联备件库存（如实说明，不补假数据）。',
    };
  }

  // 真实备件台账一次拉全（表量级小），本地做位号归属匹配，避免逐位号查询
  const spares = await SparePartsRepository.getAll().catch(() => []);
  const rules = getPurchaseLeadRules();

  const parts: CatalogPartInventory[] = [];
  for (const part of catalog as CatalogPart[]) {
    const tokens: string[] = part.spec
      ? [part.name, ...expandAliases(part.name), part.spec]
      : [part.name, ...expandAliases(part.name)];
    // 与备件页 lookupSparePart 口径一致：互含命中候选里取名称最长的（最具体的）
    const matched = spares
      .filter((s) => matchSpareInventory(tokens, s))
      .sort((a, b) => normalized(b.name).length - normalized(a.name).length)[0];
    if (!matched) {
      parts.push({ posNo: part.posNo, name: part.name, category: part.category, inventory: null });
      continue;
    }
    const lead = resolvePurchaseLead(rules, matched);
    parts.push({
      posNo: part.posNo,
      name: part.name,
      category: part.category,
      inventory: {
        id: matched.id,
        name: matched.name,
        spec: matched.spec,
        model: matched.model,
        unit: matched.unit,
        stock: matched.stock,
        safeStock: matched.safeStock,
        shortage: Math.max(0, matched.safeStock - matched.stock),
        low: matched.stock <= matched.safeStock,
        location: matched.location,
        price: matched.price,
        purchaseLeadDays: lead.leadDays,
        purchaseLeadLabel: lead.label,
      },
    });
  }

  const matchedParts = parts.filter((p) => p.inventory != null);
  const lowParts = matchedParts.filter((p) => p.inventory!.low);
  // 排序：低库存在前（缺口大者先），其余命中台账的次之，未命中的垫底
  parts.sort((a, b) => {
    const al = a.inventory?.low ? 0 : a.inventory ? 1 : 2;
    const bl = b.inventory?.low ? 0 : b.inventory ? 1 : 2;
    return al - bl
      || (b.inventory?.shortage ?? -1) - (a.inventory?.shortage ?? -1);  });

  const notes: string[] = [
    '库存四要素全部取自 spare_parts 真实台账（当前库存 / 预警阈值 safe_stock / 存放位置仓库货架）。',
    `低库存判定线与备件库存页同一口径：当前库存 ≤ 预警阈值；匹配不到台账备件的位号如实显示"无备件记录"。`,
    '采购周期：库内没有采购前置期字段，按备件分类配置规则给出参考值（可经环境变量调整），不编造 DB 数据。',
  ];
  if (lowParts.length > 0) {
    notes.push(`共有 ${lowParts.length} 个零件的备件低于预警阈值，合计缺口 ${lowParts.reduce((acc, p) => acc + p.inventory!.shortage, 0)} 件。`);
  } else {
    notes.push('当前命中台账的备件库存全部高于预警阈值，无采购缺口。');
  }

  return {
    deviceId,
    deviceName: eq.name ?? '',
    deviceCode: eq.code ?? '',
    explodedViewFile,
    generatedAt: generatedAt.toISOString(),
    parts,
    summary: {
      lowCount: lowParts.length,
      matchedCount: matchedParts.length,
      totalParts: parts.length,
      totalShortage: lowParts.reduce((acc, p) => acc + p.inventory!.shortage, 0),
    },
    dataNote: notes.join(' '),
  };
}
