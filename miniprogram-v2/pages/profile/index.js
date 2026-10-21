// pages/profile/index.js
const { api } = require('../../utils/request.js');
const { saveSession, clearSession, getToken, getUser, redirectToLogin } = require('../../utils/auth.js');
const fmt = require('../../utils/format.js');

const TOOLKIT_ITEMS = [
  {
    name: '交接班实时台账',
    desc: '汇总今日完工工单、巡检完成情况与在役安全锁',
    page: '/pages/shift-handover/index'
  },
  {
    name: '班组推送配置',
    desc: '企业微信群机器人通道（待接入）',
    page: '/pages/push-template/index'
  }
];

function certStatusMeta(status) {
  if (status === 'valid') return { text: '有效', className: 'chip-nominal' };
  if (status === 'review') return { text: '待复审', className: 'chip-gold' };
  if (status === 'expired') return { text: '已过期', className: 'chip-critical' };
  return { text: status ? String(status) : '状态未标注', className: 'chip-muted' };
}

function isMine(order, user) {
  if (!order || !user) return false;
  if (order.assigneeId && order.assigneeId === user.id) return true;
  return !!(order.assignee && user.name && order.assignee === user.name);
}

Page({
  data: {
    loading: true,
    error: '',
    user: {},
    stats: {
      myOpenOrders: 0,
      myCompletedToday: 0,
      myInspectionsToday: '0/0',
      activeLocks: 0,
      todayCompletedOrders: 0,
      todayCompletedInspections: '0/0',
      pendingHazards: 0
    },
    certifications: [],
    permissionTags: [],
    toolkitItems: TOOLKIT_ITEMS
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
        api.getWorkOrders({}).catch(() => []),
        api.getInspections({}).catch(() => []),
        api.getLotoLocks({}).catch(() => []),
        api.getHazards({}).catch(() => [])
      ]);

      let me = results[0];
      if (!me) {
        me = getUser();
        if (!me) {
          this.setData({ loading: false, error: '登录已失效，请重新登录' });
          setTimeout(redirectToLogin, 800);
          return;
        }
      } else {
        saveSession(getToken(), me);
      }

      const orders = Array.isArray(results[1]) ? results[1] : [];
      const inspections = Array.isArray(results[2]) ? results[2] : [];
      const locks = Array.isArray(results[3]) ? results[3] : [];
      const hazards = Array.isArray(results[4]) ? results[4] : [];

      const myOrders = orders.filter((order) => isMine(order, me));
      const myOpenOrders = myOrders.filter((order) => {
        return order.status !== 'completed' && order.status !== 'cancelled';
      });

      const completedToday = orders.filter((order) => {
        return order.status === 'completed' && (fmt.isToday(order.completedAt) || fmt.isToday(order.acceptedByInspectorAt));
      });
      const myCompletedToday = completedToday.filter((order) => isMine(order, me));

      const myInspectionsToday = inspections.filter((task) => {
        return task.inspectorId === me.id && (fmt.isToday(task.scheduledDate) || fmt.isToday(task.finishedAt));
      });
      const myInspectionsDone = myInspectionsToday.filter((task) => task.status === 'completed');

      const todayInspections = inspections.filter((task) => {
        return fmt.isToday(task.scheduledDate) || fmt.isToday(task.finishedAt);
      });
      const todayInspectionsDone = todayInspections.filter((task) => task.status === 'completed');

      const openHazards = hazards.filter((hazard) => hazard.status !== 'closed');
      const activeLocks = locks.filter((lock) => lock.status === 'locked');

      const certifications = Array.isArray(me.certifications)
        ? me.certifications.map((cert, index) => {
            const status = certStatusMeta(cert.status);
            return {
              id: 'cert-' + index,
              name: cert.name || '未命名证书',
              issuer: cert.issuer || '',
              expiry: cert.expiry || '',
              statusText: status.text,
              statusClass: status.className
            };
          })
        : [];

      const permissionTags = Array.isArray(me.permissions)
        ? me.permissions.map((permission) => fmt.permissionLabel(permission)).filter(Boolean)
        : [];

      this.setData({
        loading: false,
        error: '',
        user: {
          id: me.id || '',
          name: me.name || me.username || '未命名用户',
          initial: String(me.name || me.username || '?').slice(0, 1),
          username: me.username || '',
          role: me.role || '',
          roleTitle: me.roleTitle || fmt.roleLabel(me),
          department: me.department || '',
          phone: me.phone || '',
          email: me.email || '',
          avatar: me.avatar || ''
        },
        stats: {
          myOpenOrders: myOpenOrders.length,
          myCompletedToday: myCompletedToday.length,
          myInspectionsToday: myInspectionsDone.length + '/' + myInspectionsToday.length,
          activeLocks: activeLocks.length,
          todayCompletedOrders: completedToday.length,
          todayCompletedInspections: todayInspectionsDone.length + '/' + todayInspections.length,
          pendingHazards: openHazards.length
        },
        certifications,
        permissionTags
      });
    } catch (err) {
      this.setData({
        loading: false,
        error: (err && err.message) || '个人档案加载失败，请检查后端服务'
      });
    }
  },

  goToShiftHandover() {
    wx.navigateTo({ url: '/pages/shift-handover/index' });
  },

  goToPushTemplate() {
    wx.navigateTo({ url: '/pages/push-template/index' });
  },

  handleToolkitClick(e) {
    const page = e.currentTarget.dataset.page;
    if (page) {
      wx.navigateTo({ url: page });
      return;
    }
    wx.showToast({ title: '该工具暂未接入', icon: 'none' });
  },

  handleLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后需要重新登录才能查看业务数据。',
      confirmText: '退出登录',
      confirmColor: '#ba1a1a',
      success: (res) => {
        if (!res.confirm) return;
        api
          .logout()
          .catch(() => {})
          .then(() => {
            clearSession();
            wx.reLaunch({ url: '/pages/login/index' });
          });
      }
    });
  }
});
