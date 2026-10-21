// pages/ai-assistant/index.js
const { api } = require('../../utils/request.js');
const fmt = require('../../utils/format.js');

const HISTORY_LIMIT = 10;
const HISTORY_ITEM_MAX_CHARS = 2000;
const TRUNCATE_MARK = '…（已截断）';
const GRAPH_NODE_LIMIT = 12;
const GRAPH_EDGE_LIMIT = 10;
const VISION_BASE64_LIMIT = 1900000;

const QUICK_PROMPTS = [
  '齿轮箱振动超标如何排查？',
  '减速机轴承温度异常怎么处置？',
  '动火作业前需要哪些 LOTO 隔离？',
  '查询同类故障的检修规程'
];

const REPORT_TYPES = [
  { value: 'inspection', label: '巡检报告' },
  { value: 'maintenance', label: '检修报告' },
  { value: 'monthly', label: '月度设备运行报告' }
];

const TOOL_META = {
  rag: { title: 'RAG 知识检索', icon: '🔎' },
  workorder: { title: 'AI 工单草稿', icon: '📝' },
  rca: { title: '根因分析 RCA', icon: '🧠' },
  plan: { title: '检修方案生成', icon: '🛠️' },
  report: { title: '智能报告生成', icon: '📊' },
  vision: { title: 'AI 视觉诊断', icon: '📷' }
};

const NODE_TYPE_CLASS = {
  '设备': 'node-device',
  '故障': 'node-fault',
  '方法': 'node-method',
  '备件': 'node-spare',
  '部件': 'node-part'
};

function pad2(value) {
  return value < 10 ? '0' + value : String(value);
}

function nowTime() {
  const d = new Date();
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function todayOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.items)) return value.items;
  if (value && Array.isArray(value.data)) return value.data;
  if (value && Array.isArray(value.rows)) return value.rows;
  return [];
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'object') return String(JSON.stringify(value));
  return String(value);
}

function displayText(value) {
  const text = optionalText(value);
  return text || '—';
}

function clampContent(text) {
  const s = String(text || '');
  if (s.length <= HISTORY_ITEM_MAX_CHARS) return s;
  return s.slice(0, HISTORY_ITEM_MAX_CHARS - TRUNCATE_MARK.length) + TRUNCATE_MARK;
}

function mapStringItems(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item !== null && item !== undefined && item !== '')
    .map((item, index) => ({ id: 'item-' + index, text: displayText(item) }));
}

function mapParts(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item)
    .map((item, index) => {
      const name = optionalText(item.name) || '未命名备件';
      const spec = optionalText(item.spec);
      const qty = optionalText(item.qty);
      return { id: 'part-' + index, text: name + (spec ? ' · ' + spec : '') + (qty ? ' × ' + qty : '') };
    });
}

function normalizeWorkOrder(res) {
  const payload = res || {};
  const draft = payload.draft || {};
  const equipment = payload.equipment || {};
  const hours = draft.estimatedHours;
  return {
    kind: 'workorder',
    title: displayText(draft.title),
    description: displayText(draft.description),
    priorityText: fmt.priorityLabel(draft.priority),
    priorityReason: optionalText(draft.priorityReason),
    steps: mapStringItems(draft.suggestedSteps),
    parts: mapParts(draft.spareParts),
    estimatedHoursText: typeof hours === 'number' && isFinite(hours) ? hours + ' 小时' : '未提供',
    equipmentText: equipment.name
      ? displayText(equipment.name) + ' (' + displayText(equipment.code) + ')'
      : ''
  };
}

function normalizeRca(res) {
  const payload = res || {};
  const analysis = payload.analysis || {};
  const actions = analysis.correctiveActions || {};
  const whys = Array.isArray(analysis.fiveWhys)
    ? analysis.fiveWhys.map((item, index) => ({
        id: 'why-' + index,
        level: displayText(item.level !== undefined ? item.level : index + 1),
        question: displayText(item.question),
        reason: displayText(item.reason),
        evidence: optionalText(item.evidence)
      }))
    : [];
  const rootCauses = Array.isArray(analysis.rootCauses)
    ? analysis.rootCauses.map((item, index) => ({
        id: 'root-' + index,
        type: displayText(item.type),
        cause: displayText(item.cause),
        probability: optionalText(item.probability),
        evidence: optionalText(item.evidence)
      }))
    : [];
  return {
    kind: 'rca',
    summary: displayText(analysis.summary),
    whys,
    rootCauses,
    shortTerm: mapStringItems(actions.shortTerm),
    longTerm: mapStringItems(actions.longTerm),
    references: mapStringItems(analysis.references)
  };
}

function normalizePlan(res) {
  const payload = res || {};
  const plan = payload.plan || {};
  const safety = plan.safetyMeasures || {};
  const hours = plan.estimatedHours;
  const workers = plan.workers;
  const steps = Array.isArray(plan.steps)
    ? plan.steps.map((item, index) => ({
        id: 'step-' + index,
        step: displayText(item.step !== undefined ? item.step : index + 1),
        operation: displayText(item.operation || item.action),
        standard: optionalText(item.qualityStandard || item.standard)
      }))
    : [];
  const tools = Array.isArray(plan.tools)
    ? plan.tools.map((item, index) => ({
        id: 'tool-' + index,
        text: optionalText(item.name)
          ? optionalText(item.name) + (optionalText(item.spec) ? ' · ' + optionalText(item.spec) : '')
          : displayText(item)
      }))
    : [];
  return {
    kind: 'plan',
    overview: displayText(plan.overview),
    steps,
    lotoPoints: mapStringItems(safety.lotoPoints),
    ppe: mapStringItems(safety.ppe),
    highRiskNotes: mapStringItems(safety.highRiskNotes),
    tools,
    parts: mapParts(plan.spareParts),
    checkpoints: mapStringItems(plan.qualityCheckpoints),
    estimatedText:
      (typeof hours === 'number' && isFinite(hours) ? hours + ' 小时' : '未提供') +
      ' · ' +
      (typeof workers === 'number' && isFinite(workers) ? workers + ' 人' : '人数未提供'),
    safetyNotice: optionalText(payload.safetyNotice)
  };
}

function normalizeReport(res) {
  const payload = res || {};
  const report = payload.report || {};
  const meta = payload.meta || {};
  const stats = Array.isArray(report.statistics)
    ? report.statistics.map((item, index) => ({
        id: 'stat-' + index,
        label: displayText(item.label),
        value: displayText(item.value)
      }))
    : [];
  const issues = Array.isArray(report.topIssues)
    ? report.topIssues.map((item, index) => ({
        id: 'issue-' + index,
        title: displayText(item.title),
        countText: item.count !== undefined && item.count !== null ? displayText(item.count) + ' 项' : '',
        analysis: optionalText(item.analysis)
      }))
    : [];
  const metaText = [optionalText(meta.reportTypeLabel), optionalText(meta.startDate), optionalText(meta.endDate), optionalText(meta.workshop)]
    .filter(Boolean)
    .join(' · ');
  return {
    kind: 'report',
    summary: displayText(report.summary),
    highlights: mapStringItems(report.highlights),
    problems: mapStringItems(report.problems),
    statistics: stats,
    topIssues: issues,
    suggestions: mapStringItems(report.suggestions),
    markdown: optionalText(report.markdown),
    metaText,
    reviewId: optionalText(payload.reviewId)
  };
}

function normalizeVision(res) {
  const payload = res || {};
  const defect = payload.defectResult || {};
  const confidence = Number(defect.confidence);
  let confidenceText = '未提供';
  if (isFinite(confidence)) {
    confidenceText = (confidence >= 0 && confidence <= 1 ? Math.round(confidence * 100) : Math.round(confidence)) + '%';
  }
  return {
    kind: 'vision',
    imagePath: '',
    severity: displayText(defect.severity),
    defectType: displayText(defect.defectType),
    confidenceText,
    summary: displayText(defect.summary),
    location: displayText(defect.location),
    causes: mapStringItems(defect.probableCauses),
    recommendations: mapStringItems(defect.recommendations),
    safetyNotice: optionalText(defect.safetyNotice),
    engine: optionalText(payload.modelEngine || defect.modelEngine)
  };
}

Page({
  data: {
    contextLoading: true,
    contextError: '',
    equipments: [],
    equipmentOptions: [],
    equipmentIndex: 0,
    activeEquipment: null,
    graph: {
      loading: true,
      error: '',
      nodes: [],
      edges: [],
      nodeCount: 0,
      edgeCount: 0,
      modeLabel: '本设备实体',
      matched: true,
      empty: false,
      fallbackNote: '',
      sourceNote: 'knowledge_graph_nodes / knowledge_graph_edges'
    },
    chatHistory: [],
    isThinking: false,
    inputValue: '',
    quickPrompts: QUICK_PROMPTS,
    scrollIntoView: '',
    activeTool: '',
    activeToolTitle: '',
    activeToolIcon: '',
    toolLoading: false,
    toolError: '',
    toolResult: null,
    resultModel: '',
    resultDegraded: false,
    resultCache: false,
    ragQuery: '',
    reportTypes: REPORT_TYPES,
    toolForm: {
      abnormalDescription: '',
      faultDescription: '',
      reportTypeIndex: 0,
      reportTypeLabel: '巡检报告',
      startDate: todayOffset(-7),
      endDate: todayOffset(0),
      workshop: ''
    }
  },

  onLoad() {
    this.apiHistory = [];
    this.abnormalMap = {};
    this.loadContext();
  },

  onShow() {
    const pendingQuery = wx.getStorageSync('pendingAIQuery');
    if (pendingQuery) {
      wx.removeStorageSync('pendingAIQuery');
      this.sendUserQuestion(String(pendingQuery));
    }
  },

  onPullDownRefresh() {
    this.loadContext().then(() => {
      wx.stopPullDownRefresh();
    });
  },

  async loadContext() {
    this.setData({ contextLoading: true, contextError: '' });
    try {
      const results = await Promise.all([
        api.getEquipments(),
        api.getAbnormalEquipments('health').catch(() => null)
      ]);
      const list = asArray(results[0]).filter((item) => item && item.id);
      const abnormalPayload = results[1];
      const abnormalItems = asArray(abnormalPayload && abnormalPayload.items !== undefined ? abnormalPayload.items : abnormalPayload);
      const abnormalMap = {};
      abnormalItems.forEach((item) => {
        if (item && item.equipmentId) abnormalMap[item.equipmentId] = item;
      });
      this.abnormalMap = abnormalMap;

      if (!list.length) {
        this.setData({
          contextLoading: false,
          equipments: [],
          equipmentOptions: [],
          activeEquipment: null
        });
        return;
      }

      const options = list.map((item) => displayText(item.name) + ' · ' + displayText(item.code));
      let index = 0;
      const previousId = this.data.activeEquipment && this.data.activeEquipment.id;
      if (previousId) {
        const found = list.findIndex((item) => item.id === previousId);
        if (found >= 0) index = found;
      } else {
        const abnormalIndex = list.findIndex((item) => abnormalMap[item.id]);
        if (abnormalIndex >= 0) index = abnormalIndex;
      }

      this.setData(
        {
          contextLoading: false,
          equipments: list,
          equipmentOptions: options,
          equipmentIndex: index
        },
        () => {
          this.applyEquipment(index);
        }
      );
    } catch (err) {
      this.setData({
        contextLoading: false,
        contextError: (err && err.message) || '设备台账加载失败，请检查后端服务'
      });
    }
  },

  applyEquipment(index) {
    const eq = this.data.equipments[index];
    if (!eq) return;
    const abnormal = this.abnormalMap[eq.id] || null;
    const hasHealth = typeof eq.healthScore === 'number' && isFinite(eq.healthScore);
    let healthClass = 'health-unknown';
    if (hasHealth) {
      healthClass = eq.healthScore >= 75 ? 'health-good' : eq.healthScore >= 60 ? 'health-watch' : 'health-risk';
    }
    const abnormalPair = abnormal ? [optionalText(abnormal.metricLabel), optionalText(abnormal.metricValue)].filter(Boolean) : [];
    const active = {
      id: eq.id,
      name: displayText(eq.name),
      code: displayText(eq.code),
      workshop: displayText(eq.workshop),
      category: displayText(eq.category),
      location: displayText(eq.location),
      statusText: fmt.equipmentStatusLabel(eq.status),
      healthText: hasHealth ? fmt.healthText(eq.healthScore) : '未评估',
      healthLevel: fmt.healthLevel(eq.healthScore),
      healthKnown: hasHealth,
      healthClass,
      abnormalText: abnormal ? abnormalPair.length ? abnormalPair.join('：') : optionalText(abnormal.detail) || '健康度预警' : '',
      abnormalDetail: abnormal ? optionalText(abnormal.detail) : '',
      telemetry: eq.telemetry || null
    };
    const patch = {
      activeEquipment: active,
      equipmentIndex: index,
      'toolForm.workshop': optionalText(eq.workshop)
    };
    this.setData(patch);
    this.loadGraph(active.name);
  },

  handleEquipmentChange(e) {
    const index = Number(e.detail.value);
    if (!isFinite(index) || index < 0) return;
    this.applyEquipment(index);
  },

  handleRetryContext() {
    this.loadContext();
  },

  async loadGraph(equipmentName) {
    this.setData({
      graph: {
        loading: true,
        error: '',
        nodes: [],
        edges: [],
        nodeCount: 0,
        edgeCount: 0,
        modeLabel: '本设备实体',
        matched: true,
        empty: false,
        fallbackNote: '',
        sourceNote: 'knowledge_graph_nodes / knowledge_graph_edges'
      }
    });
    try {
      let res = await api.getKnowledgeGraph(equipmentName ? { equipment: equipmentName } : {});
      let nodes = asArray(res && res.nodes);
      let edges = asArray(res && res.edges);
      let modeLabel = '本设备实体';
      let matched = true;

      if (!nodes.length && equipmentName) {
        matched = false;
        res = await api.getKnowledgeGraph();
        nodes = asArray(res && res.nodes);
        edges = asArray(res && res.edges);
        modeLabel = nodes.length ? '全库图谱（未匹配本设备）' : '知识图谱';
      }

      const nodeNames = {};
      nodes.forEach((node) => {
        nodeNames[node.id] = displayText(node.entity_name || node.name);
      });

      const mappedNodes = nodes.slice(0, GRAPH_NODE_LIMIT).map((node, index) => {
        const type = displayText(node.entity_type || node.type || '实体');
        return {
          id: node.id || 'node-' + index,
          name: displayText(node.entity_name || node.name),
          type,
          typeClass: NODE_TYPE_CLASS[type] || 'node-default',
          articleTitle: optionalText(node.article_title)
        };
      });

      const mappedEdges = edges.slice(0, GRAPH_EDGE_LIMIT).map((edge, index) => ({
        id: edge.id || 'edge-' + index,
        source: nodeNames[edge.source_node_id] || displayText(edge.source),
        relation: displayText(edge.relation || '关联'),
        target: nodeNames[edge.target_node_id] || displayText(edge.target)
      }));

      this.setData({
        graph: {
          loading: false,
          error: '',
          nodes: mappedNodes,
          edges: mappedEdges,
          nodeCount: nodes.length,
          edgeCount: edges.length,
          modeLabel,
          matched,
          empty: nodes.length === 0,
          fallbackNote: !matched && nodes.length ? '按设备名称未匹配到图谱实体，已展示全库图谱。' : '',
          sourceNote: 'knowledge_graph_nodes / knowledge_graph_edges'
        }
      });
    } catch (err) {
      this.setData({
        graph: {
          loading: false,
          error: (err && err.message) || '知识图谱加载失败',
          nodes: [],
          edges: [],
          nodeCount: 0,
          edgeCount: 0,
          modeLabel: '知识图谱',
          matched: true,
          empty: false,
          fallbackNote: '',
          sourceNote: 'knowledge_graph_nodes / knowledge_graph_edges'
        }
      });
    }
  },

  handleReloadGraph() {
    const active = this.data.activeEquipment;
    this.loadGraph(active ? active.name : '');
  },

  handleInputChange(e) {
    this.setData({ inputValue: e.detail.value });
  },

  handlePromptClick(e) {
    const prompt = e.currentTarget.dataset.prompt;
    if (!prompt) return;
    this.sendUserQuestion(prompt);
  },

  handleSend() {
    const text = String(this.data.inputValue || '').trim();
    if (!text) {
      wx.showToast({ title: '请输入问题', icon: 'none' });
      return;
    }
    this.setData({ inputValue: '' });
    this.sendUserQuestion(text);
  },

  buildWireHistory() {
    return this.apiHistory.slice(-HISTORY_LIMIT).map((item) => ({
      role: item.role,
      content: clampContent(item.content)
    }));
  },

  sendUserQuestion(rawText) {
    const question = String(rawText || '').trim();
    if (!question) return;
    if (this.data.isThinking) {
      wx.showToast({ title: '上一问正在生成，请稍候', icon: 'none' });
      return;
    }

    const history = this.buildWireHistory();
    const active = this.data.activeEquipment;
    const contextData = active
      ? {
          equipment: {
            id: active.id,
            name: active.name,
            code: active.code,
            workshop: active.workshop
          }
        }
      : undefined;

    const userMessage = {
      id: 'u-' + Date.now(),
      sender: 'user',
      text: question,
      time: nowTime()
    };

    this.setData(
      {
        chatHistory: this.data.chatHistory.concat([userMessage]),
        isThinking: true
      },
      () => this.scrollChatToBottom()
    );

    const payload = { message: question, history };
    if (contextData) payload.contextData = contextData;

    api
      .aiChat(payload)
      .then((res) => {
        const reply = optionalText(res && res.reply);
        if (!reply) throw new Error('模型未返回有效内容');
        const aiMessage = {
          id: 'a-' + Date.now(),
          sender: 'ai',
          text: reply,
          time: nowTime(),
          model: optionalText(res && res.model) || '未标注模型',
          degraded: res && res.degraded === true
        };
        this.apiHistory.push({ role: 'user', content: question });
        this.apiHistory.push({ role: 'assistant', content: reply });
        if (this.apiHistory.length > HISTORY_LIMIT * 2) {
          this.apiHistory = this.apiHistory.slice(-HISTORY_LIMIT * 2);
        }
        this.setData(
          {
            chatHistory: this.data.chatHistory.concat([aiMessage]),
            isThinking: false
          },
          () => this.scrollChatToBottom()
        );
      })
      .catch((err) => {
        const errorMessage = {
          id: 'e-' + Date.now(),
          sender: 'error',
          text: 'AI 调用失败：' + ((err && err.message) || '请检查后端服务与模型配置'),
          time: nowTime()
        };
        this.setData(
          {
            chatHistory: this.data.chatHistory.concat([errorMessage]),
            isThinking: false
          },
          () => this.scrollChatToBottom()
        );
      });
  },

  scrollChatToBottom() {
    this.setData({ scrollIntoView: '' });
    setTimeout(() => {
      this.setData({ scrollIntoView: 'chat-end' });
    }, 30);
  },

  handleShowTools() {
    this.setData({ scrollIntoView: '' });
    setTimeout(() => {
      this.setData({ scrollIntoView: 'tools-section' });
    }, 30);
  },

  handleOpenTool(e) {
    const tool = e.currentTarget.dataset.tool;
    if (!tool) return;
    if (this.data.toolLoading) {
      wx.showToast({ title: '当前 AI 任务生成中', icon: 'none' });
      return;
    }
    if (this.data.contextLoading) {
      wx.showToast({ title: '设备台账加载中，请稍候', icon: 'none' });
      return;
    }
    if (tool !== 'rag' && tool !== 'report' && !this.data.activeEquipment) {
      wx.showToast({ title: '请先选择设备', icon: 'none' });
      return;
    }
    const meta = TOOL_META[tool] || { title: 'AI 工具', icon: '✨' };
    this.setData({
      activeTool: tool,
      activeToolTitle: meta.title,
      activeToolIcon: meta.icon,
      toolError: '',
      toolResult: null,
      resultModel: '',
      resultDegraded: false,
      resultCache: false
    });
  },

  handleCloseTool() {
    if (this.data.toolLoading) return;
    this.setData({
      activeTool: '',
      activeToolTitle: '',
      activeToolIcon: '',
      toolError: '',
      toolResult: null,
      resultModel: '',
      resultDegraded: false,
      resultCache: false
    });
  },

  noop() {},

  handleRagInput(e) {
    this.setData({ ragQuery: e.detail.value });
  },

  handleToolField(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    const patch = {};
    patch['toolForm.' + field] = e.detail.value;
    this.setData(patch);
  },

  handleReportTypeChange(e) {
    const index = Number(e.detail.value);
    const type = REPORT_TYPES[index] || REPORT_TYPES[0];
    this.setData({
      'toolForm.reportTypeIndex': index,
      'toolForm.reportTypeLabel': type.label
    });
  },

  handleDateChange(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    const patch = {};
    patch['toolForm.' + field] = e.detail.value;
    this.setData(patch);
  },

  beginToolRequest() {
    this.setData({
      toolLoading: true,
      toolError: '',
      toolResult: null,
      resultModel: '',
      resultDegraded: false,
      resultCache: false
    });
  },

  failToolRequest(err) {
    this.setData({
      toolLoading: false,
      toolError: (err && err.message) || 'AI 服务调用失败，请稍后重试'
    });
  },

  requireEquipment() {
    const eq = this.data.activeEquipment;
    if (!eq) {
      wx.showToast({ title: '请先选择设备', icon: 'none' });
      return null;
    }
    return eq;
  },

  async handleRagSearch() {
    const query = String(this.data.ragQuery || '').trim();
    if (!query) {
      wx.showToast({ title: '请输入检索问题', icon: 'none' });
      return;
    }
    this.beginToolRequest();
    try {
      let docs = [];
      try {
        docs = asArray(await api.getKnowledgeList({ search: query })).slice(0, 6);
      } catch (searchErr) {
        docs = [];
      }
      let fallbackUsed = false;
      if (!docs.length) {
        docs = asArray(await api.getKnowledgeList({})).slice(0, 5);
        fallbackUsed = true;
      }
      const knowledgeList = docs
        .filter((doc) => doc && doc.title)
        .map((doc) => ({
          title: optionalText(doc.title),
          category: optionalText(doc.category) || '未分类',
          summary: optionalText(doc.summary).slice(0, 500),
          content: clampContent(optionalText(doc.content))
        }));
      if (!knowledgeList.length) {
        throw new Error('知识库暂无已审核文档，无法执行 RAG 检索');
      }
      const res = await api.aiRagSearch({ query, knowledgeList });
      const rawHits = asArray(res && res.rawHits).map((hit, index) => ({
        id: 'hit-' + index,
        title: displayText(hit.title),
        category: optionalText(hit.category),
        excerpt: optionalText(hit.excerpt)
      }));
      const matched = res && typeof res.matchedDocCount === 'number' ? res.matchedDocCount : knowledgeList.length;
      this.setData({
        toolLoading: false,
        toolResult: {
          kind: 'rag',
          summary: optionalText(res && res.summary) || '后端未返回综合回答',
          matchedText: matched + ' 篇',
          docs: knowledgeList.map((doc) => doc.title),
          hits: rawHits,
          fallbackUsed
        },
        resultModel: optionalText(res && res.model) || '未标注模型',
        resultDegraded: res && res.degraded === true,
        resultCache: res && res.fromCache === true
      });
    } catch (err) {
      this.failToolRequest(err);
    }
  },

  async handleGenerateWorkOrder() {
    const eq = this.requireEquipment();
    if (!eq) return;
    const description = String(this.data.toolForm.abnormalDescription || '').trim();
    if (description.length < 2) {
      wx.showToast({ title: '请填写异常描述（至少 2 字）', icon: 'none' });
      return;
    }
    this.beginToolRequest();
    try {
      const payload = { equipmentId: eq.id, abnormalDescription: description };
      if (eq.telemetry && typeof eq.telemetry === 'object') {
        payload.telemetrySnapshot = eq.telemetry;
      }
      const res = await api.aiGenerateWorkOrder(payload);
      this.setData({
        toolLoading: false,
        toolResult: normalizeWorkOrder(res),
        resultModel: optionalText(res && res.model) || '未标注模型',
        resultCache: res && res.fromCache === true
      });
    } catch (err) {
      this.failToolRequest(err);
    }
  },

  async handleRootCauseAnalysis() {
    const eq = this.requireEquipment();
    if (!eq) return;
    const description = String(this.data.toolForm.faultDescription || '').trim();
    if (description.length < 2) {
      wx.showToast({ title: '请填写故障描述（至少 2 字）', icon: 'none' });
      return;
    }
    this.beginToolRequest();
    try {
      const res = await api.aiRootCauseAnalysis({
        equipmentId: eq.id,
        faultDescription: description
      });
      this.setData({
        toolLoading: false,
        toolResult: normalizeRca(res),
        resultModel: optionalText(res && res.model) || '未标注模型',
        resultCache: res && res.fromCache === true
      });
    } catch (err) {
      this.failToolRequest(err);
    }
  },

  async handleGenerateMaintenancePlan() {
    const eq = this.requireEquipment();
    if (!eq) return;
    const description = String(this.data.toolForm.faultDescription || '').trim();
    if (description.length < 2) {
      wx.showToast({ title: '请填写故障描述（至少 2 字）', icon: 'none' });
      return;
    }
    this.beginToolRequest();
    try {
      const res = await api.aiMaintenancePlan({
        equipmentId: eq.id,
        faultDescription: description
      });
      this.setData({
        toolLoading: false,
        toolResult: normalizePlan(res),
        resultModel: optionalText(res && res.model) || '未标注模型',
        resultCache: res && res.fromCache === true
      });
    } catch (err) {
      this.failToolRequest(err);
    }
  },

  async handleGenerateReport() {
    const form = this.data.toolForm;
    const type = REPORT_TYPES[form.reportTypeIndex] || REPORT_TYPES[0];
    if (!form.startDate || !form.endDate) {
      wx.showToast({ title: '请选择报告起止日期', icon: 'none' });
      return;
    }
    if (form.startDate > form.endDate) {
      wx.showToast({ title: '开始日期不能晚于结束日期', icon: 'none' });
      return;
    }
    this.beginToolRequest();
    try {
      const payload = {
        reportType: type.value,
        startDate: form.startDate,
        endDate: form.endDate
      };
      const workshop = String(form.workshop || '').trim();
      if (workshop) payload.workshop = workshop;
      const res = await api.aiGenerateReport(payload);
      this.setData({
        toolLoading: false,
        toolResult: normalizeReport(res),
        resultModel: optionalText(res && res.model) || '未标注模型',
        resultCache: res && res.fromCache === true
      });
    } catch (err) {
      this.failToolRequest(err);
    }
  },

  handleCameraDiagnostic() {
    if (this.data.toolLoading) {
      wx.showToast({ title: '当前 AI 任务生成中', icon: 'none' });
      return;
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      sizeType: ['compressed'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file || !file.tempFilePath) return;
        if (wx.compressImage) {
          wx.compressImage({
            src: file.tempFilePath,
            quality: 60,
            success: (compressed) => this.analyzeImage(compressed.tempFilePath || file.tempFilePath),
            fail: () => this.analyzeImage(file.tempFilePath)
          });
        } else {
          this.analyzeImage(file.tempFilePath);
        }
      }
    });
  },

  analyzeImage(imagePath) {
    let base64 = '';
    try {
      base64 = wx.getFileSystemManager().readFileSync(imagePath, 'base64');
    } catch (err) {
      wx.showToast({ title: '读取图片失败', icon: 'none' });
      return;
    }
    if (!base64) {
      wx.showToast({ title: '图片为空，请重新拍摄', icon: 'none' });
      return;
    }
    if (base64.length > VISION_BASE64_LIMIT) {
      wx.showToast({ title: '图片超过后端 2MB 限制，请压缩或重拍', icon: 'none' });
      return;
    }

    const meta = TOOL_META.vision;
    this.setData({
      activeTool: 'vision',
      activeToolTitle: meta.title,
      activeToolIcon: meta.icon,
      toolLoading: true,
      toolError: '',
      toolResult: null,
      resultModel: '',
      resultDegraded: false,
      resultCache: false
    });

    const eq = this.data.activeEquipment;
    const payload = { imageBase64: base64 };
    if (eq) payload.equipmentType = eq.category;

    api
      .aiVisionDetect(payload)
      .then((res) => {
        const result = normalizeVision(res);
        result.imagePath = imagePath;
        this.setData({
          toolLoading: false,
          toolResult: result,
          resultModel:
            optionalText(res && res.modelEngine) ||
            optionalText(res && res.defectResult && res.defectResult.modelEngine) ||
            '未标注模型',
          resultDegraded: res && res.degraded === true
        });
      })
      .catch((err) => {
        this.failToolRequest(err);
      });
  }
});
