/**
 * 拆解零件匹配服务 —— 把"工单文本（真实 DB 字段）"与"拆解页 BOM 位号（真实拆解页原文）"对齐。
 *
 * ## 数据来源（全部真实，不编造）
 *   · 工单侧：work_orders 表的 title / description / fault_type / repair_log.parts_used
 *     （完工上报时技师真实填写的"耗用备件"记录）。
 *   · 零件侧：explodedCatalog.generated.ts —— 由 scripts/extract-exploded-catalog.mjs
 *     从 9 份拆解页的零件数组原文自动提取，位号/名称/规格与页面 BOM 完全一致。
 *
 * ## 匹配口径（确定性算法，无随机）
 *   分数 = 备件Record命中分 + 描述关键词命中分。命中证据记录在 result 的 matchedBy 里，
 *   未达阈值的返回 null（前端会展示"未识别到具体零件"，不强行高亮）。
 *
 * ## 数据缺口（如实说明，不补假数据）
 *   数据库目前**没有独立的"零件级维修台账表"**（没有按拆解位号 P01… 落库的故障/更换记录，
 *   也没有位号 ↔ 备件 SKU 的绑定表）。零件维修历史只能从工单 repair_log.parts_used 的
 *   名称/型号与拆解位号名称做文本匹配推导 —— 这是唯一真实可用的零件级数据来源。
 *   要支持"按位号直接查历史"，需要后续新增 part_maintenance_records
 *   （装配位号 ↔ 更换事件）与 BOM 位号绑定关系表。
 */
import { EXPLODED_CATALOG_BY_FILE, type ExplodedCatalogPart } from './explodedCatalog.generated.ts';
import { EXPLODED_VIEW_FILES } from '../../components/equipment3d/explodedViewFiles.ts';

export interface CatalogPart extends ExplodedCatalogPart {
  /** 所属拆解页文件名 */
  file: string;
}

/** 按设备台账 ID 取该设备的真实 BOM 位号清单（无拆解页的设备返回空数组）。 */
export function getCatalogForDevice(deviceId: string): CatalogPart[] {
  const file = EXPLODED_VIEW_FILES[deviceId];
  if (!file) return [];
  return (EXPLODED_CATALOG_BY_FILE[file] ?? []).map((p) => ({ ...p, file }));
}

/** 词形归一：去空白/中英标点、转小写；处理拆解页名称与工单名常见的全半角差异。 */
export function normalizeText(input: string): string[] {
  return String(input || '')
    .toLowerCase()
    .replace(/[()（）〔〕\[\]【】、，。,,·.\-—_/\\:*"'！!?？]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * 行业惯用别名表：工单口语（"机封""轴瓦"）→ 拆解页书面名（"机械密封""轴承"）。
 * 只做**查询重写**，不制造任何记录；用于让真实 nickname 与真实书面 BOM 名对上。
 */
const ALIASES: Record<string, string[]> = {
  机械密封: ['机械密封', '机封', '轴封', '密封'],
  机封: ['机械密封', '机封', '轴封', '密封'],
  轴封: ['机械密封', '机封', '轴封', '密封'],
  轴承: ['轴承', '轴承座', '轴承箱'],
  轴承组: ['轴承', '轴承座', '轴承箱'],
  轴承座: ['轴承', '轴承座', '轴承箱'],
  平衡盘: ['平衡盘', '平衡鼓', '耐磨环'],
  叶轮: ['叶轮'],
  导叶: ['导叶', '扩散器', '压水室'],
  齿圈: ['齿圈', '内齿圈'],
  太阳轮: ['太阳轮', '中心轮'],
  行星轮: ['行星轮'],
  联轴器: ['联轴器', '膜片联轴器', '弹性联轴器', '半联轴节'],
  转子: ['转子'],
  蜗壳: ['蜗壳', '泵体'],
  机械臂: ['机械臂', '机器人'],
  减速器: ['减速器', '减速机', 'rv减速器'],
  伺服电机: ['伺服电机', '电机'],
  电磁阀: ['电磁阀'],
  碟簧: ['碟簧', '碟形弹簧'],
  吸盘: ['吸盘', '真空吸盘'],
  滤芯: ['滤芯', '过滤器', '滤网'],
  油封: ['油封', '密封'],
  密封件: ['密封', '油封', '机械密封'],
  齿轮: ['齿轮', '太阳轮', '行星轮'],
  曲轴: ['曲轴'],
  活塞: ['活塞'],
  阀片: ['阀片', '气阀'],
  轴瓦: ['轴瓦', '轴承'],
  端盖: ['端盖', '顶盖'],
  泵轴: ['泵轴', '主轴', '轴'],
  主轴: ['主轴', '泵轴'],
  螺杆: ['螺杆', '阴阳转子', '转子'],
  换热器: ['换热器', '冷却器'],
  冷油器: ['冷油器', '冷却器'],
  传感器: ['传感器'],
  防坠安全销: ['防坠', '安全销'],
  制动器: ['制动器', '刹车'],
  编码器: ['编码器'],
  拉刀机构: ['拉刀', '碟形弹簧', '碟簧'],
  空滤芯: ['空滤', '空滤芯', '滤芯', '空气滤清器', '滤清器'],
  排气阀: ['排气阀', '阀'],
};

/** 展开一个查询词为别名集合（保底包含原词）。 */
export function expandAliases(term: string): string[] {
  const n = term.trim();
  if (!n) return [];
  const direct = ALIASES[n];
  if (direct) return Array.from(new Set(direct));
  // 词内命中别名关键字的（如 "平衡盘耐磨环" 命中 "平衡盘"）也展开
  for (const [key, values] of Object.entries(ALIASES)) {
    if (n.includes(key)) return Array.from(new Set([...values, n]));
  }
  return [n];
}

export interface WorkOrderPartUsage {
  id?: string;
  name?: string;
  code?: string;
  spec?: string;
  qty?: number;
  unit?: string;
  unitPrice?: number;
}

export interface WorkOrderCore {
  id: string;
  orderNo: string;
  title: string;
  description: string;
  faultType: string;
  status: string;
  repairLog: { partsUsed?: WorkOrderPartUsage[] } | null;
  [key: string]: unknown;
}

export interface PartMatch {
  posNo: string;
  name: string;
  category?: string;
  spec?: string;
  score: number;
  matchedBy: string[];
}

/** 两个中文短语之间按"别名词条互相包含"计命中。 */
function hitTerms(a: string[], b: string[]): string[] {
  const hits: string[] = [];
  for (const x of a) {
    if (!x) continue;
    for (const y of b) {
      if (!y) continue;
      if (x.includes(y) || y.includes(x)) {
        hits.push(y.length > x.length ? y : x);
      }
    }
  }
  return Array.from(new Set(hits));
}

function scoreTextOverlap(orderText: string, part: CatalogPart): { score: number; by: string[] } {
  const orderNorm = normalizeText(orderText).join('');
  const nameTokens = normalizeText(part.name);
  const specTokens = normalizeText(part.spec ?? '');
  const score = nameTokens.reduce((acc, t) => {
    if (t.length < 2) return acc;
    if (!orderNorm.includes(t)) return acc;
    // 越长的命中介值越高（"机械密封" 比 "密封" 可信）
    return acc + Math.min(t.length, 6);
  }, 0);
  const by = nameTokens.filter((t) => t.length >= 2 && orderNorm.includes(t));
  const specHits = specTokens.filter((t) => t.length >= 2 && orderNorm.includes(t));
  return { score: score + specHits.length, by: by.length ? by : specHits.slice(0, 1) };
}

/**
 * 为一张工单，在设备拆解页的真实 BOM 中定位"要拆/要换"的目标零件。
 *
 * @param deviceId       台账设备 id（决定用哪份 BOM 目录）
 * @param texts          待匹配的工单文本（title、description、faultType 等），按权重排序
 * @param partsUsed      工单 repair_log.parts_used 里真实填写的备件记录（可选）
 * @param excludePosNos  排除的位号（如通用底座/螺栓误命中时排除用）
 */
export function matchOrderToCatalogPart(
  deviceId: string,
  texts: string[],
  partsUsed: WorkOrderPartUsage[] = [],
  excludePosNos: string[] = []
): PartMatch | null {
  const catalog = getCatalogForDevice(deviceId);
  if (!catalog.length) return null;

  // ---- 1) parts_used 备件 Record 命中：技师的完工上报是最强证据（weight 3）----
  const usageHits = new Set<string>();
  for (const used of partsUsed) {
    if (!used?.name) continue;
    const usedTokens = [
      ...normalizeText(used.name),
      ...normalizeText(used.code ?? ''),
      ...expandAliases(used.name),
    ];
    for (const part of catalog) {
      const partTexts = [
        ...normalizeText(part.name),
        ...normalizeText(part.spec ?? ''),
        ...normalizeText(part.material ?? ''),
      ];
      const hits = hitTerms(usedTokens, partTexts).filter(
        (h) => h.length >= 2 && h !== '轴承' // 泛词单独命中999分太低，见下
      );
      if (hits.length > 0) usageHits.add(part.posNo);
    }
  }

  // ---- 2) 工单描述文本命中（weight 1~2：title > description）----
  const best = new Map<string, PartMatch>();
  const consider = (part: CatalogPart, score: number, by: string[]) => {
    if (excludePosNos.includes(part.posNo)) return;
    const prev = best.get(part.posNo);
    if (!prev || score > prev.score) {
      best.set(part.posNo, {
        posNo: part.posNo,
        name: part.name,
        category: part.category,
        spec: part.spec,
        score,
        matchedBy: by,
      });
    }
  };

  texts.forEach((text, idx) => {
    if (!text) return;
    for (const part of catalog) {
      const { score, by } = scoreTextOverlap(text, part);
      if (!by.length) continue;
      // 泛词（如"密封"）权重减半，防误命中；title 权重 ×1.2
      const generic = by.every((t) => ['密封', '轴承', '轴', '油', '件', '泵体'].includes(t));
      const weight = (idx === 0 ? 1.2 : 0.6) * (generic ? 0.5 : 1);
      consider(part, (score + idx) * weight + (usageHits.has(part.posNo) ? 30 : 0), by);
    }
  });

  const ranked = Array.from(best.values()).sort((a, b) => b.score - a.score);
  const top = ranked[0];
  // 阈值：把"分值低、证据弱"的命中判为不成立。usage 命中(≥30) 或 长词命中(≥6) 才算可信。
  if (!top || (top.score < 6 && !usageHits.has(top.posNo))) return null;
  return top;
}
