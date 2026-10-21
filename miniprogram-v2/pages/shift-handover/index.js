// pages/shift-handover/index.js
const { api } = require('../../utils/request.js');
const { getUser } = require('../../utils/auth.js');
const fmt = require('../../utils/format.js');

const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 };
const NOTE_LIMIT = 24;

function listOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

Page({
  data: {
    loading: true,
    error: '',
    dateText: '',
    generatedAt: '',
    outgoing: {
      name: '',
      roleTitle: '',
      department: ''
    },
    incoming: {
      name: '待现场确认',
      note: '后端暂无交接班签署数据'
    },
    metrics: {
      completedOrders: 0,
      completedInspections: '0/0',
      abnormalInspections: 0,
      openHazards: 0,
      activeLocks: 0
    },
    notes: [],
    summaryText: ''
  },

  onLoad() {
    this.loadData();
  },

  onPullDownRefresh() {
    this.loadData().then(() => {
      wx.stopPullDownRefresh();
    });
  },

  handleRetry() {
    this.loadData();
  },

  async loadData() {
    this.setData({ loading: true, error: '' });
    try {
      const results = await Promise.all([
        api.getMe(),
        api.getWorkOrders({}),
        api.getInspections({}),
        api.getLotoLocks({}),
        api.getHazards({})
      ]);

      const me = results[0] || getUser() || {};
      const orders = listOrEmpty(results[1]);
      const inspections = listOrEmpty(results[2]);
      const locks = listOrEmpty(results[3]);
      const hazards = listOrEmpty(results[4]);

      const completedOrdersToday = orders.filter((order) => {
        return order.status === 'completed' && (fmt.isToday(order.completedAt) || fmt.isToday(order.acceptedByInspectorAt));
      });

      const inspectionsToday = inspections.filter((task) => {
        return fmt.isToday(task.scheduledDate) || fmt.isToday(task.finishedAt);
      });
      const inspectionsDone = inspectionsToday.filter((task) => task.status === 'completed');
      const abnormalInspections = inspectionsToday.filter((task) => Number(task.abnormalCount) > 0);

      const openOrders = orders
        .filter((order) => order.status !== 'completed' && order.status !== 'cancelled')
        .sort((a, b) => {
          const rankA = PRIORITY_RANK[a.priority] !== undefined ? PRIORITY_RANK[a.priority] : 9;
          const rankB = PRIORITY_RANK[b.priority] !== undefined ? PRIORITY_RANK[b.priority] : 9;
          if (rankA !== rankB) return rankA - rankB;
          return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
        });

      const openHazards = hazards.filter((hazard) => hazard.status !== 'closed');
      const activeLocks = locks.filter((lock) => lock.status === 'locked');

      const notes = [];
      openOrders.slice(0, 8).forEach((order, index) => {
        notes.push({
          id: 'order-' + index,
          typeText: order.priority === 'urgent' ? '紧急工单' : '在办工单',
          typeClass: order.priority === 'urgent' ? 'chip-critical' : 'chip-gold',
          title: (order.orderNo || '无编号') + ' · ' + (order.title || '未命名工单'),
          desc:
            '设备：' +
            (order.equipmentName || '未关联') +
            ' · 状态：' +
            fmt.statusLabel(order.status) +
            ' · 负责人：' +
            (order.assignee || '未派单')
        });
      });

      abnormalInspections.slice(0, 6).forEach((task, index) => {
        notes.push({
          id: 'inspection-' + index,
          typeText: '巡检异常',
          typeClass: 'chip-gold',
          title: (task.taskNo || '无编号') + ' · ' + (task.title || '未命名巡检任务'),
          desc:
            '异常项 ' +
            (task.abnormalCount !== null && task.abnormalCount !== undefined ? task.abnormalCount : '—') +
            ' · 进度 ' +
            (task.completedPoints !== null && task.completedPoints !== undefined ? task.completedPoints : '—') +
            '/' +
            (task.totalPoints !== null && task.totalPoints !== undefined ? task.totalPoints : '—') +
            ' · 点检人 ' +
            (task.inspectorName || '未指派')
        });
      });

      openHazards.slice(0, 6).forEach((hazard, index) => {
        notes.push({
          id: 'hazard-' + index,
          typeText: hazard.level === 'major' ? '重大隐患' : '一般隐患',
          typeClass: hazard.level === 'major' ? 'chip-critical' : 'chip-gold',
          title: (hazard.no || '无编号') + ' · ' + (hazard.title || '未命名隐患'),
          desc:
            '状态：' +
            fmt.hazardStatusLabel(hazard.status) +
            ' · 位置：' +
            (hazard.location || '未登记') +
            ' · 发现人：' +
            (hazard.discoverer || '未登记')
        });
      });

      activeLocks.slice(0, 8).forEach((lock, index) => {
        notes.push({
          id: 'lock-' + index,
          typeText: '在役安全锁',
          typeClass: 'chip-cyan',
          title: (lock.lockNo || '无编号') + ' · ' + (lock.pointName || lock.permitTitle || '未命名隔离点'),
          desc:
            '位置：' +
            (lock.location || lock.workshop || '未登记') +
            ' · 上锁人：' +
            (lock.lockedBy || '未登记') +
            ' · 时间：' +
            fmt.formatDateTime(lock.lockedAt)
        });
      });

      const metrics = {
        completedOrders: completedOrdersToday.length,
        completedInspections: inspectionsDone.length + '/' + inspectionsToday.length,
        abnormalInspections: abnormalInspections.length,
        openHazards: openHazards.length,
        activeLocks: activeLocks.length
      };

      const dateText = fmt.formatDate(new Date().toISOString());
      const generatedAt = fmt.formatDateTime(new Date().toISOString());
      const outgoing = {
        name: me.name || me.username || '未登录用户',
        roleTitle: me.roleTitle || fmt.roleLabel(me),
        department: me.department || '未登记部门'
      };

      const summaryLines = [
        '【交接班实时台账】' + dateText,
        '交班负责人：' + outgoing.name + '（' + outgoing.roleTitle + '）',
        '生成时间：' + generatedAt,
        '今日完工工单：' + metrics.completedOrders + ' 项',
        '今日巡检完成：' + metrics.completedInspections + '，异常批次 ' + metrics.abnormalInspections + ' 个',
        '未闭环隐患：' + metrics.openHazards + ' 项',
        '在役安全锁：' + metrics.activeLocks + ' 把',
        '重点移交事项：'
      ];
      if (notes.length) {
        notes.forEach((note, index) => {
          summaryLines.push(index + 1 + '. [' + note.typeText + '] ' + note.title + ' — ' + note.desc);
        });
      } else {
        summaryLines.push('无');
      }
      summaryLines.push('注：本摘要由小程序实时聚合，后端暂无交接班单据接口。');

      this.setData({
        loading: false,
        error: '',
        dateText,
        generatedAt,
        outgoing,
        metrics,
        notes: notes.slice(0, NOTE_LIMIT),
        summaryText: summaryLines.join('\n')
      });
    } catch (err) {
      this.setData({
        loading: false,
        error: (err && err.message) || '交接班实时数据加载失败，请检查后端服务'
      });
    }
  },

  handleRefreshData() {
    this.loadData();
  },

  handleCopySummary() {
    if (!this.data.summaryText) {
      wx.showToast({ title: '暂无可复制的台账摘要', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: this.data.summaryText,
      success: () => {
        wx.showToast({ title: '台账摘要已复制', icon: 'success' });
      }
    });
  },

  handlePushToBot() {
    wx.showModal({
      title: '推送通道待接入',
      content: '需配置企业微信群机器人 Webhook。本轮小程序未接入后端推送通道，消息不会发送。',
      showCancel: false,
      confirmText: '知晓',
      confirmColor: '#e8a33d'
    });
  }
});
