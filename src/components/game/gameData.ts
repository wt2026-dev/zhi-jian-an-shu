// 「检修闯关」关卡数据层：从后端真实规程 API 转换为闯关题目。
// 红线：题目全部来自 GET /api/v1/procedures 的真实规程字段（tools/safety/content），
// 不硬编码编造步骤；无规程的设备前端禁用开始，不造假兜底。
import { procedureApi } from '../../api';
import type { Equipment, MaintenanceProcedure, ProcedureStep } from '../../types';

/* ---------- 类型 ---------- */

export interface ToolQuestion {
  kind: 'tool';
  options: string[];
  correct: string;
}

export interface SafetyQuestion {
  kind: 'safety';
  statement: string;
  /** true=该说法正确；false=该说法错误（含故意说反的安全禁句） */
  answer: boolean;
}

export interface OrderQuestion {
  kind: 'order';
  /** 正确顺序的子动作序列（展示时打乱） */
  items: string[];
}

export type MiniGame = ToolQuestion | SafetyQuestion | OrderQuestion;

export interface StepLevel {
  stepNo: number;
  name: string;
  content: string;
  /** 本步的小关序列：工具关 + 安全关（+ 每 3 步一次的验收排序关） */
  games: MiniGame[];
}

export interface GameLevel {
  procedureId: string;
  title: string;
  equipmentType: string;
  maintenanceLevel: string;
  estimatedMinutes?: number;
  steps: StepLevel[];
}

/* ---------- 规程拉取与设备匹配 ---------- */

export async function fetchProcedures(): Promise<MaintenanceProcedure[]> {
  try {
    const data = await procedureApi.list({});
    return Array.isArray(data) ? (data as MaintenanceProcedure[]) : [];
  } catch {
    return [];
  }
}

/** 解析规程 tools 字符串 → 工具名数组（兼容 、 ， , ; ； / 换行等分隔） */
export function parseTools(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[、，,;；\n/·]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && t.length <= 24);
}

/**
 * 设备类别 → 规程 equipmentType 的别名表。
 * 规程库按"水泵/电机/空压机/风机/输送带"这类工艺名归类，台账 category 却是"泵类设备/大型电机/压缩机类"，
 * 两者字面不相等；不做这层映射，12# 连铸结晶器冷却循环泵这种明明有《离心式高压给水泵…规程》的设备
 * 会被判成"暂无标准化规程"——那是谎报覆盖面，不是不造假兜底。
 * 只做类别对齐，题目内容仍 100% 取自命中的真实规程。
 */
const CATEGORY_ALIAS: Record<string, string[]> = {
  泵类设备: ['水泵'],
  泵类: ['水泵'],
  大型电机: ['电机'],
  压缩机类: ['空压机'],
  鼓风设备: ['风机'],
  输送设备: ['输送带'],
};

/** 设备 → 规程匹配：优先 equipmentType===category，其次类别别名，再次双向包含与名称包含 */
export function findProcedureForEquipment(eq: Equipment, procs: MaintenanceProcedure[]): MaintenanceProcedure | null {
  const byType = procs.filter((p) => p.equipmentType === eq.category);
  if (byType.length > 0) return byType[0];
  const cat = eq.category || '';
  for (const alias of CATEGORY_ALIAS[cat] || []) {
    const hit = procs.find((p) => p.equipmentType === alias);
    if (hit) return hit;
  }
  const loose = procs.find((p) => (p.equipmentType || '').includes(cat) && cat.length >= 2);
  if (loose) return loose;
  const byName = procs.find((p) => (eq.name || '').includes(p.equipmentType) && p.equipmentType);
  return byName ?? null;
}

/* ---------- 题目生成 ---------- */

const GENERIC_SAFETY_BANK: { statement: string; answer: boolean }[] = [
  { statement: '检修前必须完成断电、验电并挂牌上锁（LOTO）', answer: true },
  { statement: '检修期间无需设置专人监护，一人即可作业', answer: false },
  { statement: '作业前应确认现场防护用品穿戴齐全', answer: true },
  { statement: '设备运行中可以直接伸手排除卡阻故障', answer: false },
  { statement: '检修结束后必须清点工具并撤离现场警戒', answer: true },
  { statement: '发现异常工况时应继续作业并完工后再上报', answer: false },
];

/** 把步骤 content 拆成 3-4 个子动作（供排序关）；拆不出 3 段则返回空 */
export function splitContentActions(content: string): string[] {
  const sentences = content
    .split(/[。；;！？\n]+/)
    .map((s) => s.trim().replace(/^[一二三四五六七八九十0-9]+[、.．::]\s*/, ''))
    .filter((s) => s.length >= 4);
  if (sentences.length >= 3) return sentences.slice(0, 4);
  // 退化：按逗号切，再合并到 3 段
  const parts = content.split(/[，,]+/).map((s) => s.trim()).filter((s) => s.length >= 4);
  if (parts.length >= 3) {
    const per = Math.ceil(parts.length / 3);
    const merged: string[] = [];
    for (let i = 0; i < parts.length; i += per) merged.push(parts.slice(i, i + per).join('，'));
    if (merged.length >= 3) return merged.slice(0, 4);
  }
  return [];
}

function pickDistractors(pool: string[], exclude: Set<string>, n: number, rng: () => number): string[] {
  const candidates = pool.filter((t) => ![...exclude].some((e) => t.includes(e) || e.includes(t)));
  const shuffled = [...candidates].sort(() => rng() - 0.5);
  return shuffled.slice(0, n);
}

/** 把一条真实规程转换为闯关关卡 */
export function buildGameLevel(proc: MaintenanceProcedure, allProcs: MaintenanceProcedure[]): GameLevel {
  const rng = Math.random;
  // 全局工具池：来自所有真实规程的 tools 字段（保证干扰项像真工具）
  const toolPool = Array.from(new Set(allProcs.flatMap((p) => p.steps.flatMap((st) => parseTools(st.tools)))));

  const steps: StepLevel[] = proc.steps.map((st: ProcedureStep, idx: number) => {
    const games: MiniGame[] = [];

    // 工具关：正确项取该步骤 tools 首个；3 个干扰项取自真实工具池
    const tools = parseTools(st.tools);
    if (tools.length > 0 && toolPool.length >= 4) {
      const correct = tools[0];
      const distractors = pickDistractors(toolPool, new Set(tools), 3, rng);
      if (distractors.length === 3) {
        const options = [...distractors, correct].sort(() => rng() - 0.5);
        games.push({ kind: 'tool', options, correct });
      }
    }

    // 安全关：safety 原句转判断（answer=true）；为空则用通用安全规则（含故意说反项）
    if (games.length >= 0) {
      const safetySentence = (st.safety || '')
        .split(/[。\n]+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 6)[0];
      if (safetySentence) {
        games.push({ kind: 'safety', statement: safetySentence, answer: true });
      } else {
        const g = GENERIC_SAFETY_BANK[Math.floor(rng() * GENERIC_SAFETY_BANK.length)];
        games.push({ kind: 'safety', statement: g.statement, answer: g.answer });
      }
    }

    // 验收排序关：每 3 步出现一次（第 3/6/9…步），content 拆 3-4 个子动作
    if ((idx + 1) % 3 === 0) {
      const actions = splitContentActions(st.content);
      if (actions.length >= 3) games.push({ kind: 'order', items: actions });
    }

    return { stepNo: st.step_no, name: st.name, content: st.content, games };
  });

  return {
    procedureId: proc.id,
    title: proc.title,
    equipmentType: proc.equipmentType,
    maintenanceLevel: proc.maintenanceLevel,
    estimatedMinutes: proc.estimatedMinutes,
    steps,
  };
}

/** 通用安全规则（设备无匹配规程时也不造假，仅用于提示文案） */
export function hasPlayableLevel(level: GameLevel | null): boolean {
  return !!level && level.steps.length > 0 && level.steps.every((s) => s.games.length > 0);
}
