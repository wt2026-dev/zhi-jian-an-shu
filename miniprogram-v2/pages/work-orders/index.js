// pages/work-orders/index.js
const { api } = require('../../utils/request.js');
const { ensureLogin, getUser } = require('../../utils/auth.js');
const fmt = require('../../utils/format.js');

Page({
  data: {
    activeTab: 'ALL',
    stats: { all: 0, urgent: 0, inProgress: 0, pending: 0 },
    statsLoaded: false,
    statsDegraded: false,
    spotlight: null,
    orders: [],
    searchKeyword: '',
    loading: false,
    loadError: '',
    role: ''
  },

  onLoad() {
    if (!ensureLogin()) return;
    this.setData({ role: (getUser() || {}).role || '' });
    this.loadData();
  },

  onShow() {
    if (!ensureLogin()) return;
    this.loadData();
  },

  onUnload() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  },

  onPullDownRefresh() {
    this.loadData(() => {
      wx.stopPullDownRefresh();
    });
  },

  buildQuery() {
    const query = {};
    if (this.data.activeTab === 'URGENT') query.priority = 'urgent';
    if (this.data.activeTab === 'IN_PROGRESS') query.status = 'in_progress';
    if (this.data.activeTab === 'PENDING') query.status = 'created';
    const keyword = (this.data.searchKeyword || '').trim();
    if (keyword) query.search = keyword;
    return query;
  },

  computeStats(orders) {
    const stats = { all: orders.length, urgent: 0, inProgress: 0, pending: 0 };
    orders.forEach((order) => {
      if (!order) return;
      if (order.priority === 'urgent') stats.urgent += 1;
      if (order.status === 'in_progress') stats.inProgress += 1;
      if (order.status === 'created') stats.pending += 1;
    });
    return stats;
  },

  async loadData(callback) {
    this.setData({ loading: true, loadError: '', statsDegraded: false });
    try {
      const results = await Promise.all([
        api.getWorkOrderStats().catch(() => null),
        api.getWorkOrders(this.buildQuery()),
        api.getWorkOrders({ priority: 'urgent' })
      ]);
      const stats = results[0];
      const list = Array.isArray(results[1]) ? results[1] : [];
      const urgentList = Array.isArray(results[2]) ? results[2] : [];

      let viewList = list.map((order) => this.mapOrder(order));
      if (this.data.activeTab === 'URGENT') {
        viewList = viewList.filter((order) => order.status !== 'completed' && order.status !== 'cancelled');
      }

      const activeUrgent = urgentList
        .map((order) => this.mapOrder(order))
        .filter((order) => order.status !== 'completed' && order.status !== 'cancelled');

      let statsView;
      if (stats) {
        statsView = {
          all: stats.totalCount || 0,
          urgent: stats.urgentCount || 0,
          inProgress: stats.inProgressCount || 0,
          pending: stats.createdCount || 0
        };
      } else {
        let allOrders = list;
        if (this.data.activeTab !== 'ALL' || (this.data.searchKeyword || '').trim()) {
          allOrders = await api.getWorkOrders({});
        }
        statsView = this.computeStats(Array.isArray(allOrders) ? allOrders : []);
      }

      this.setData({
        statsLoaded: true,
        statsDegraded: !stats,
        stats: statsView,
        orders: viewList,
        spotlight: activeUrgent.length ? this.mapSpotlight(activeUrgent[0]) : null
      });
    } catch (err) {
      this.setData({
        loadError: (err && err.message) || '工单数据加载失败',
        orders: []
      });
    } finally {
      this.setData({ loading: false });
      if (callback) callback();
    }
  },

  mapOrder(order) {
    const priority = order.priority || '';
    const status = order.status || '';
    let priorityClass = 'chip-blue';
    if (priority === 'urgent') priorityClass = 'chip-critical';
    else if (priority === 'high') priorityClass = 'chip-gold';

    let statusClass = 'chip-cyan';
    if (status === 'created' || status === 'pending_acceptance') statusClass = 'chip-gold';
    if (status === 'cancelled') statusClass = 'chip-muted';

    return {
      id: order.id,
      orderNo: order.orderNo || '—',
      title: order.title || '未命名工单',
      equipmentId: order.equipmentId || '',
      equipmentName: order.equipmentName || '未关联设备',
      equipmentCode: order.equipmentCode || '—',
      workshop: order.workshop || '未标注车间',
      faultType: order.faultType || '未分类',
      priority,
      priorityText: fmt.priorityLabel(priority),
      priorityClass,
      status,
      statusText: fmt.statusLabel(status),
      statusClass,
      assignee: order.assignee || '未指派',
      creator: order.creator || '—',
      faultSummary: order.description || order.title || '暂无故障描述',
      createdAtText: fmt.formatDateTime(order.createdAt)
    };
  },

  mapSpotlight(order) {
    return {
      id: order.id,
      orderNo: order.orderNo,
      equipmentName: order.equipmentName,
      equipmentCode: order.equipmentCode,
      workshop: order.workshop,
      faultType: order.faultType,
      priorityText: order.priorityText,
      statusText: order.statusText,
      faultDesc: order.faultSummary,
      assignee: order.assignee,
      createdAtText: order.createdAtText
    };
  },

  handleTabChange(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.activeTab) return;
    this.setData({ activeTab: tab });
    this.loadData();
  },

  handleSearchInput(e) {
    const keyword = e.detail.value;
    this.setData({ searchKeyword: keyword });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.loadData();
    }, 350);
  },

  handleScanCode() {
    wx.scanCode({
      success: async (res) => {
        const text = (res.result || '').trim();
        if (!text) {
          wx.showToast({ title: '未识别到设备条码', icon: 'none' });
          return;
        }
        wx.showLoading({ title: '匹配设备台账…' });
        try {
          const list = await api.getEquipments({ search: text });
          const equipment = Array.isArray(list) && list.length ? list[0] : null;
          if (!equipment) {
            wx.showToast({ title: '设备台账中未找到该条码', icon: 'none' });
            return;
          }
          wx.navigateTo({
            url:
              '/pages/work-order-create/index?equipmentId=' +
              encodeURIComponent(equipment.id) +
              '&equipmentName=' +
              encodeURIComponent(equipment.name)
          });
        } catch (err) {
          // 请求层已提示，保持当前页
        } finally {
          wx.hideLoading();
        }
      },
      fail: () => {
        wx.showToast({ title: '扫码已取消或识别失败', icon: 'none' });
      }
    });
  },

  handleCreateOrder() {
    wx.navigateTo({ url: '/pages/work-order-create/index' });
  },

  handleRetry() {
    this.loadData();
  },

  handleAcceptUrgentOrder() {
    if (!this.data.spotlight) return;
    wx.navigateTo({ url: '/pages/work-order-detail/index?id=' + encodeURIComponent(this.data.spotlight.id) });
  },

  viewKnowledgeGraph() {
    wx.switchTab({ url: '/pages/ai-assistant/index' });
  },

  handleOrderClick(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/work-order-detail/index?id=' + encodeURIComponent(id) });
  }
});
