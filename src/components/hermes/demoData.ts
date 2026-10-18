/**
 * Hermes 智能业务管家 - 演示数据与类型定义
 * 
 * 真实生产环境对应的后端调用映射：
 * - 环节 1 (现场报修): POST /api/ai/generate-work-order
 * - 环节 2 (高危作业票): POST /api/ai/safety-risk-assessment
 * - 环节 3 (LOTO能量隔离): GET /api/loto-locks & POST /api/ai/safety-risk-assessment
 * - 环节 4 (检修执行): POST /api/ai/generate-maintenance-plan
 * - 环节 5 (完工): POST /api/ai/generate-report
 * - 环节 6 (质检归档): POST /api/ai/suggest-contribution & POST /api/knowledge/contributions
 */

export type StageId = 
  | 'stage_report'       // 1. 现场报修
  | 'stage_permit'       // 2. 高危作业票
  | 'stage_loto'         // 3. LOTO能量隔离
  | 'stage_execution'    // 4. 检修执行
  | 'stage_completion'   // 5. 完工
  | 'stage_archive';     // 6. 质检归档

export type StageStatus = 'completed' | 'in_progress' | 'pending';

export interface StageStepMeta {
  id: StageId;
  order: number;
  title: string;
  status: StageStatus;
  aiBadge: string;
  outputSummary: string;
  targetPage: string;
  targetTabKey: string;
  duration: string;
  completedTime?: string;
}

export interface LotoConfirmationItem {
  id: string;
  type: string;
  point: string;
  requirement: string;
  lockNumber: string;
  confirmed: boolean;
  operator: string;
  confirmTime?: string;
}

export interface ArtifactItem {
  id: string;
  code: string;
  name: string;
  stageId: StageId;
  status: 'ready' | 'pending';
  category: string;
  previewContent: string;
}

export interface ButlerSuggestion {
  id: string;
  type: 'todo' | 'risk' | 'next';
  title: string;
  content: string;
  tag: string;
  actionText?: string;
}

export interface HistoryLoopItem {
  id: string;
  loopCode: string;
  targetGoal: string;
  equipmentName: string;
  status: 'completed' | 'archived';
  duration: string;
  artifactCount: number;
  knowledgeCount: number;
  closedDate: string;
  leadUser: string;
}

export interface BusinessClosedLoopData {
  id: string;
  loopCode: string;
  businessGoal: string;
  equipment: {
    id: string;
    code: string;
    name: string;
    model: string;
    workshop: string;
    status: 'warning' | 'normal' | 'danger';
    temperature: number;
    temperatureThreshold: number;
    vibration: number;
    loadRate: number;
    healthScore: number;
  };
  initiator: {
    name: string;
    role: string;
    time: string;
  };
  progress: {
    currentStageOrder: number;
    totalStages: number;
    percent: number;
    estimatedTotalHours: number;
    elapsedHours: number;
  };
  stages: StageStepMeta[];
  lotoItems: LotoConfirmationItem[];
  artifacts: ArtifactItem[];
  suggestions: ButlerSuggestion[];
  historyLoops: HistoryLoopItem[];
}

/** 初始闭环演示数据（以 3#离心式空压机 轴温高故障闭环为例） */
export const INITIAL_HERMES_LOOP_DATA: BusinessClosedLoopData = {
  id: 'loop-2025-0618-042',
  loopCode: 'PL-28250618-042',
  businessGoal: '3号空压机轴承温度高，帮我走检修流程',
  equipment: {
    id: 'eq-ac-003',
    code: 'EQ-2024-003',
    name: '3#离心式空压机',
    model: 'Atlas Copco ZH-1000',
    workshop: '动力一车间 · 压缩空气工段',
    status: 'warning',
    temperature: 68.4,
    temperatureThreshold: 65.0,
    vibration: 3.8,
    loadRate: 82,
    healthScore: 74,
  },
  initiator: {
    name: '陈主管',
    role: '动力车间主管',
    time: '今日 09:42',
  },
  progress: {
    currentStageOrder: 3,
    totalStages: 6,
    percent: 33,
    estimatedTotalHours: 3.5,
    elapsedHours: 1.2,
  },
  stages: [
    {
      id: 'stage_report',
      order: 1,
      title: '现场报修',
      status: 'completed',
      aiBadge: 'AI 诊断',
      outputSummary: 'AI诊断结论 · 检修工单',
      targetPage: '检修工单',
      targetTabKey: 'work_orders',
      duration: '15min',
      completedTime: '09:45',
    },
    {
      id: 'stage_permit',
      order: 2,
      title: '高危作业票',
      status: 'completed',
      aiBadge: 'JSA 识别',
      outputSummary: 'JSA风险等级 · 安全与LOTO',
      targetPage: '安全与LOTO',
      targetTabKey: 'safety',
      duration: '25min',
      completedTime: '10:10',
    },
    {
      id: 'stage_loto',
      order: 3,
      title: 'LOTO能量隔离',
      status: 'in_progress',
      aiBadge: 'LOTO 规则',
      outputSummary: 'LOTO隔离清单 · 安全与LOTO',
      targetPage: '安全与LOTO',
      targetTabKey: 'safety',
      duration: '预计 30min',
    },
    {
      id: 'stage_execution',
      order: 4,
      title: '检修执行',
      status: 'pending',
      aiBadge: 'SOP 推理',
      outputSummary: '检修方案 · 作业指引',
      targetPage: '作业指引',
      targetTabKey: 'procedures',
      duration: '预计 90min',
    },
    {
      id: 'stage_completion',
      order: 5,
      title: '完工',
      status: 'pending',
      aiBadge: '巡检比对',
      outputSummary: '完工验收 · 巡检作业',
      targetPage: '巡检作业',
      targetTabKey: 'inspections',
      duration: '预计 30min',
    },
    {
      id: 'stage_archive',
      order: 6,
      title: '质检归档',
      status: 'pending',
      aiBadge: '知识提炼',
      outputSummary: '质检报告 · 知识库',
      targetPage: '知识库',
      targetTabKey: 'knowledge',
      duration: '预计 20min',
    },
  ],
  lotoItems: [
    {
      id: 'loto-1',
      type: '电气隔离',
      point: 'QF-03 主电源进线断路器',
      requirement: '分闸断电、用兆欧表/验电笔三相验电无电压、挂红底白字「禁止合闸有人工作」警示牌、锁闭并保管钥匙',
      lockNumber: 'LK-EL-408',
      confirmed: true,
      operator: '李工 (电气一等技师)',
      confirmTime: '10:22',
    },
    {
      id: 'loto-2',
      type: '气源隔离',
      point: 'V-301 压缩空气排气总管入口截止阀',
      requirement: '完全顺时针旋转手轮至关闭位、加装法兰锁闭夹具套件、挂安全警示锁扣、严禁擅自开阀',
      lockNumber: 'LK-PN-112',
      confirmed: true,
      operator: '王工 (管路钳工技师)',
      confirmTime: '10:25',
    },
    {
      id: 'loto-3',
      type: '残余能量',
      point: '压缩空气蓄能管路及冷却器腔体',
      requirement: '顺时针缓慢开启手动泄压阀 SP-02，实测就地双金属压力表指示彻底归零 (0.00 MPa)，现场拍照存证',
      lockNumber: 'TAG-PRS-001',
      confirmed: false,
      operator: '待现场确认',
    },
  ],
  artifacts: [
    {
      id: 'art-1',
      code: 'WO-2025-0618-042',
      name: '智能检修工单',
      stageId: 'stage_report',
      status: 'ready',
      category: '检修工单',
      previewContent: '【工单编号】WO-2025-0618-042\n【报修设备】3#离心式空压机 (Atlas Copco ZH-1000)\n【故障现象】非驱动端轴承温度 68.4℃ 越限触发黄色报警\n【AI诊断】润滑脂热退化导致滚动体局部点蚀，建议停机检修并更换轴承润滑脂。\n【派工对象】李工 (主修) / 王工 (辅修)\n【开单时间】2025-06-18 09:45:12',
    },
    {
      id: 'art-2',
      code: 'HWP-250618-011',
      name: '高危作业安全许可票',
      stageId: 'stage_permit',
      status: 'ready',
      category: '安全许可',
      previewContent: '【作业票号】HWP-250618-011\n【作业类别】机械设备高风险拆装检修 (涉及高压电与受压容器)\n【JSA等级】Level II (中度高危)\n【安全措施】1. 380V进线彻底断电验电；2. 储气腔卸压至常压；3. 配备防高温手套与安全护目镜；4. 现场配置 4kg ABC干粉灭火器。\n【审批签署】安监专员 赵工 (已签发 10:10)',
    },
    {
      id: 'art-3',
      code: 'LOT-250618-009',
      name: 'LOTO 能量隔离挂牌清单',
      stageId: 'stage_loto',
      status: 'ready',
      category: '能量隔离',
      previewContent: '【隔离清单】LOT-250618-009\n【隔离点位】3 处 (电气 1 处、气动 1 处、机械残余能量 1 处)\n【执行锁具】LK-EL-408 / LK-PN-112 / TAG-PRS-001\n【当前确认】2/3 已完成核准，残余气压泄压确认中。\n【执行标准】符合 GB/T 33579-2017《机械安全 危险能量控制方法 锁定/挂牌》',
    },
    {
      id: 'art-4',
      code: 'SOP-250618-A',
      name: '离心机轴承检修作业指引',
      stageId: 'stage_execution',
      status: 'pending',
      category: '作业标准',
      previewContent: '【指引编号】SOP-AC-008-REV3\n【核心工序】1. 联轴器对中检测；2. 电磁感应加热拆卸轴承内圈；3. 轴颈微米级跳动测量 (公差 ≤ 0.015mm)；4. 涂抹美孚 Mobilith SHC 220；5. 定扭紧固 (扭矩 185 N·m)。',
    },
    {
      id: 'art-5',
      code: 'ACC-250618-01',
      name: '修后现场质量验收记录',
      stageId: 'stage_completion',
      status: 'pending',
      category: '现场验收',
      previewContent: '【验收表单】ACC-250618-01\n【检验项目】1. 手动盘车顺畅度；2. 30分钟空载试验温度温升；3. 振动加速度频谱分析；4. 现场 5S 与工完料净场地清。\n【验收要求】轴温稳定在 40~45℃ 之间，振动 RMS < 2.0 mm/s。',
    },
    {
      id: 'art-6',
      code: 'QC-250618-03',
      name: '综合质检闭环评估报告',
      stageId: 'stage_archive',
      status: 'pending',
      category: '质量评估',
      previewContent: '【质检报告】QC-250618-03\n【评估结论】检修工序符合规程，机组指标全面回升，消缺彻底。\n【综合评分】98.5 分 (优良)\n【质检员】刘总工 (核准签署待执行)',
    },
    {
      id: 'art-7',
      code: 'KB-250618-088',
      name: '轴承热失效快速排查案例',
      stageId: 'stage_archive',
      status: 'pending',
      category: '知识沉淀',
      previewContent: '【知识条目】KB-250618-088\n【案例分类】离心式空压机常见故障库 / 润滑与轴承\n【沉淀价值】固化了空压机轴温突变在 30 分钟内的多重隔离防护与快速换脂 SOP，自动入库企业级 RAG 向量知识库。',
    },
    {
      id: 'art-8',
      code: 'PKG-28250618-042',
      name: '闭环电子档案综合包 (ZIP)',
      stageId: 'stage_archive',
      status: 'pending',
      category: '全量档案',
      previewContent: '【全案归档包】包含本次闭环的工单、动火高危票、LOTO签单、现场遥测温升曲线、修前修后振动图谱、验收单与知识包，已生成数字签名防篡改 Hash。',
    },
  ],
  suggestions: [
    {
      id: 'sug-1',
      type: 'todo',
      title: '待办提醒：11:00 前完成 LOTO 三点确认',
      content: '当前白班生产压缩空气供应平稳，请在 11:00 计划停机窗口前核实压力表归零，确保检修班组准时开工。',
      tag: '时间窗口',
      actionText: '去确认泄压',
    },
    {
      id: 'sug-2',
      type: 'risk',
      title: '风险提示：轴承表面温度 68℃ 防烫伤',
      content: '停机初期轴承端盖与轴瓦仍有高温蓄热，现场操作技师必须佩戴耐温绝缘手套，禁止徒手触摸外圈。',
      tag: '高危预警',
      actionText: '查看防护要求',
    },
    {
      id: 'sug-3',
      type: 'next',
      title: '下一步引导：确认隔离后自动下发检修作业',
      content: '人工在下方表格勾选确认「残余能量泄压」后，管家将立即下发《离心机轴承检修作业指引》至李工手持终端。',
      tag: '自动编排',
      actionText: '查看预备方案',
    },
  ],
  historyLoops: [
    {
      id: 'hl-1',
      loopCode: 'PL-20250610-019',
      targetGoal: '2# 循环水泵机封泄漏综合处置',
      equipmentName: '2# 循环冷却水泵',
      status: 'archived',
      duration: '2.8h',
      artifactCount: 8,
      knowledgeCount: 1,
      closedDate: '2025-06-10 16:40',
      leadUser: '张主管',
    },
    {
      id: 'hl-2',
      loopCode: 'PL-20250528-007',
      targetGoal: '1# 离心风机动平衡失衡振动校正',
      equipmentName: '1# 离心引风机',
      status: 'archived',
      duration: '4.6h',
      artifactCount: 8,
      knowledgeCount: 2,
      closedDate: '2025-05-28 17:15',
      leadUser: '王主管',
    },
    {
      id: 'hl-3',
      loopCode: 'PL-20250515-033',
      targetGoal: '4# 进料输送机传动链条断裂抢修',
      equipmentName: '4# 链斗式输送机',
      status: 'archived',
      duration: '5.2h',
      artifactCount: 8,
      knowledgeCount: 1,
      closedDate: '2025-05-15 14:20',
      leadUser: '李主管',
    },
  ],
};
