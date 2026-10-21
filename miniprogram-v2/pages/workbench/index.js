// pages/workbench/index.js
const { api } = require('../../utils/request.js');
const { ensureLogin, getUser } = require('../../utils/auth.js');
const fmt = require('../../utils/format.js');

const QUICK_TAGS = ['轴承温度异常排查', '齿轮箱振动超标', 'LOTO 上锁挂牌要求', '巡检异常闭环'];

Page({
  data: {
    loading: true,
    metricsLoaded: false,
    abnormalLoaded: false,
    lotoLoaded: false,
    graphLoaded: false,
    loadError: '',
    metrics: {},
    updatedAtText: '—',
    healthIsNumber: false,
    healthDisplay: '未评估',
    healthLevel: '未评估',
    healthPercent: 0,
    inspectionProgress: 0,
    urgentPercent: 0,
    abnormal: [],
    abnormalCount: 0,
    primaryAlert: null,
    lotoActive: 0,
    lotoTotal: 0,
    graphNodeCount: 0,
    graphEdgeCount: 0,
    quickTags: QUICK_TAGS,
    user: {}
  },

  onLoad() {
    if (!ensureLogin()) return;
    this.setData({ user: getUser() || {} });
    this.loadData();
  },

  onShow() {
    if (!ensureLogin()) return;
    this.setData({ user: getUser() || {} });
  },

  onPullDownRefresh() {
    this.loadData(() => {
      wx.stopPullDownRefresh();
    });
  },

  async loadData(callback) {
    this.setData({ loading: true, loadError: '' });
    try {
      const metrics = await api.getCockpitMetrics();
      const abnormalRes = await api.getAbnormalEquipments('health');
      this.applyMetrics(metrics || {});
      this.applyAbnormal((abnormalRes && abnormalRes.items) || []);
    } catch (err) {
      this.setData({
        loadError: (err && err.message) || '工作台数据加载失败',
        metricsLoaded: false
      });
    }

    const extras = await Promise.all([
      api.getLotoLocks().catch(() => null),
      api.getKnowledgeGraph().catch(() => null)
    ]);
    const locks = extras[0];
    const graph = extras[1];
    if (Array.isArray(locks)) {
      const active = locks.filter((lock) => lock.status === 'locked').length;
      this.setData({ lotoLoaded: true, lotoActive: active, lotoTotal: locks.length });
    }
    if (graph && Array.isArray(graph.nodes)) {
      this.setData({
        graphLoaded: true,
        graphNodeCount: graph.nodes.length,
        graphEdgeCount: Array.isArray(graph.edges) ? graph.edges.length : 0
      });
    }

    this.setData({ loading: false });
    if (callback) callback();
  },

  applyMetrics(metrics) {
    const avg = metrics.equipmentHealthAvg;
    const avgIsNumber = typeof avg === 'number' && isFinite(avg);
    const healthPercent = avgIsNumber ? Math.max(0, Math.min(100, avg)) : 0;
    const inspectionProgress = fmt.progressWidth(metrics.inspectionCompleted, metrics.inspectionTotal);
    const urgent = fmt.toNumberOrNull(metrics.workOrderUrgent);
    const orderTotal = fmt.toNumberOrNull(metrics.workOrderTotal);
    const urgentPercent =
      urgent !== null && orderTotal !== null && orderTotal > 0
        ? Math.max(0, Math.min(100, (urgent / orderTotal) * 100))
        : 0;

    this.setData({
      metricsLoaded: true,
      metrics,
      updatedAtText: fmt.formatDateTime(metrics.timestamp),
      healthIsNumber: avgIsNumber,
      healthDisplay: avgIsNumber ? String(Math.round(avg)) : '未评估',
      healthLevel: fmt.healthLevel(avg),
      healthPercent: Math.round(healthPercent * 10) / 10,
      inspectionProgress,
      urgentPercent: Math.round(urgentPercent * 10) / 10
    });
  },

  applyAbnormal(items) {
    const abnormal = items.map((item, index) => {
      const healthScore =
        typeof item.healthScore === 'number' && isFinite(item.healthScore) ? item.healthScore : null;
      return {
        key: String(item.equipmentId || item.equipmentCode || item.equipmentName || 'abnormal-' + index),
        equipmentId: item.equipmentId || '',
        equipmentName: item.equipmentName || '未命名设备',
        equipmentCode: item.equipmentCode || '—',
        workshop: item.workshop || '未标注车间',
        abnormalType: item.abnormalType || '异常',
        detail: item.detail || '',
        metricLabel: item.metricLabel || '',
        metricValue:
          item.metricValue === null || item.metricValue === undefined || item.metricValue === ''
            ? '—'
            : item.metricValue,
        lastInspectionText: fmt.formatDateTime(item.lastInspectionAt),
        healthScore,
        healthDisplay: fmt.healthText(healthScore),
        healthIsNumber: healthScore !== null,
        severity: item.severity || 'medium',
        severityLabel: fmt.severityLabel(item.severity),
        severityClass: item.severity === 'high' ? 'chip-critical' : 'chip-gold'
      };
    });

    this.setData({
      abnormalLoaded: true,
      abnormal,
      abnormalCount: abnormal.length,
      primaryAlert: abnormal.length ? abnormal[0] : null
    });
  },

  handleRefresh() {
    this.loadData(() => {
      wx.showToast({ title: '已重新拉取后端数据', icon: 'none' });
    });
  },

  handleAbnormalClick(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.abnormal[index];
    if (!item || !item.equipmentId) {
      wx.showToast({ title: '该异常未关联设备档案', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url:
        '/pages/work-order-create/index?equipmentId=' +
        encodeURIComponent(item.equipmentId) +
        '&equipmentName=' +
        encodeURIComponent(item.equipmentName)
    });
  },

  handleDispatchNow() {
    wx.switchTab({ url: '/pages/work-orders/index' });
  },

  goToAIAssistant() {
    wx.switchTab({ url: '/pages/ai-assistant/index' });
  },

  goToInspections() {
    wx.switchTab({ url: '/pages/inspections/index' });
  },

  handleTagClick(e) {
    const tag = e.currentTarget.dataset.tag;
    wx.setStorageSync('pendingAIQuery', tag);
    wx.switchTab({ url: '/pages/ai-assistant/index' });
  }
});
