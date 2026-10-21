// pages/work-order-detail/index.js
const { api } = require('../../utils/request.js');
const { ensureLogin, getUser } = require('../../utils/auth.js');
const fmt = require('../../utils/format.js');

const ACTION_LABELS = {
  CREATE: '创建工单',
  DISPATCH: '派发工单',
  CLAIM: '确认接单',
  COMPLETE: '完工上报',
  ACCEPT: '验收通过',
  REJECT: '验收驳回',
  TRANSITION: '状态流转'
};

const STEP_FLOW = ['created', 'dispatched', 'in_progress', 'pending_acceptance', 'completed'];

function normalizeSteps(value) {
  if (Array.isArray(value)) {
    return value
      .map((step, index) => {
        const text = typeof step === 'string' ? step : step && (step.text || step.step || JSON.stringify(step));
        return text ? index + 1 + '. ' + text : '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (typeof value === 'string' && value.trim()) return value;
  return '未填写';
}

function normalizeParts(value) {
  if (!Array.isArray(value) || value.length === 0) return '未申报备件';
  return value
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!part) return '';
      const name = part.name || part.partName || '';
      const qty = part.quantity || part.qty || '';
      if (name) return name + (qty ? ' × ' + qty : '');
      return JSON.stringify(part);
    })
    .filter(Boolean)
    .join('、') || '未申报备件';
}

Page({
  data: {
    id: '',
    loading: true,
    loadError: '',
    order: null,
    logs: [],
    logsError: '',
    role: '',
    roleTitle: '',
    userName: '',
    steps: [],
    actionPanel: '',
    submitting: false,
    technicians: [],
    technicianNames: [],
    technicianIndex: 0,
    dispatchForm: { estimatedHours: '2' },
    completeForm: { causeAnalysis: '', resolutionSteps: '', workHours: '2', remark: '' },
    acceptForm: { pass: true, score: '5', comment: '' },
    canDispatch: false,
    canClaim: false,
    canComplete: false,
    canAccept: false,
    canCancel: false,
    canReopen: false
  },

  onLoad(options) {
    if (!ensureLogin()) return;
    const id = (options && options.id) || '';
    const user = getUser() || {};
    this.setData({
      id,
      role: user.role || '',
      roleTitle: user.roleTitle || '',
      userName: user.name || user.username || ''
    });
    if (!id) {
      this.setData({ loading: false, loadError: '缺少工单 ID，无法加载详情' });
      return;
    }
    this.loadDetail();
  },

  onPullDownRefresh() {
    this.loadDetail(() => wx.stopPullDownRefresh());
  },

  async loadDetail(callback) {
    this.setData({ loading: true, loadError: '', logsError: '' });
    try {
      let logsError = '';
      const logsPromise = api
        .getWorkOrderLogs(this.data.id)
        .then((list) => (Array.isArray(list) ? list : []))
        .catch((err) => {
          logsError = (err && err.message) || '流转日志加载失败';
          return [];
        });
      const results = await Promise.all([api.getWorkOrder(this.data.id), logsPromise]);
      const raw = results[0] || null;
      if (!raw) throw new Error('工单不存在或已被删除');
      const order = this.mapOrder(raw);
      const logs = results[1].map((log) => this.mapLog(log));
      this.setData({
        order,
        logs,
        logsError,
        steps: this.buildSteps(order.status),
        ...this.buildPermissions(order.status)
      });
    } catch (err) {
      this.setData({ loadError: (err && err.message) || '工单详情加载失败', order: null });
    } finally {
      this.setData({ loading: false });
      if (callback) callback();
    }
  },

  mapOrder(raw) {
    const priority = raw.priority || '';
    const status = raw.status || '';
    const repair = raw.repairLog || null;
    const acceptance = raw.acceptance || null;

    let priorityClass = 'chip-blue';
    if (priority === 'urgent') priorityClass = 'chip-critical';
    else if (priority === 'high') priorityClass = 'chip-gold';

    let statusClass = 'chip-cyan';
    if (status === 'created' || status === 'pending_acceptance') statusClass = 'chip-gold';
    if (status === 'cancelled') statusClass = 'chip-muted';
    if (status === 'completed') statusClass = 'chip-nominal';

    return {
      id: raw.id,
      orderNo: raw.orderNo || '—',
      title: raw.title || '未命名工单',
      equipmentId: raw.equipmentId || '',
      equipmentName: raw.equipmentName || '未关联设备',
      equipmentCode: raw.equipmentCode || '—',
      workshop: raw.workshop || '未标注车间',
      faultType: raw.faultType || '未分类',
      priority,
      priorityText: fmt.priorityLabel(priority),
      priorityClass,
      status,
      statusText: fmt.statusLabel(status),
      statusClass,
      creator: raw.creator || '—',
      dispatcher: raw.dispatcher || '—',
      assignee: raw.assignee || '未指派',
      assigneeId: raw.assigneeId || '',
      description: raw.description || '暂无故障描述',
      createdAtText: fmt.formatDateTime(raw.createdAt),
      dispatchedAtText: fmt.formatDateTime(raw.dispatchedAt),
      acceptedAtText: fmt.formatDateTime(raw.acceptedAt),
      completedAtText: fmt.formatDateTime(raw.completedAt),
      acceptedByInspectorAtText: fmt.formatDateTime(raw.acceptedByInspectorAt),
      safetyRequirements: Array.isArray(raw.safetyRequirements) ? raw.safetyRequirements : [],
      photoCount: Array.isArray(raw.photos) ? raw.photos.length : 0,
      version: typeof raw.version === 'number' ? raw.version : 1,
      repairLog: repair
        ? {
            causeAnalysis: repair.causeAnalysis || '未填写',
            resolutionStepsText: normalizeSteps(repair.resolutionSteps),
            partsUsedText: normalizeParts(repair.partsUsed),
            workHoursText:
              typeof repair.workHours === 'number'
                ? repair.workHours + ' 小时'
                : repair.workHours
                  ? String(repair.workHours) + ' 小时'
                  : '未申报',
            remark: repair.remark || '',
            completionPhotoCount: Array.isArray(repair.completionPhotos) ? repair.completionPhotos.length : 0
          }
        : null,
      acceptance: acceptance
        ? {
            inspectorName: acceptance.inspectorName || '—',
            pass: acceptance.pass !== false,
            passText: acceptance.pass !== false ? '验收通过' : '验收驳回',
            passClass: acceptance.pass !== false ? 'chip-nominal' : 'chip-critical',
            scoreText: typeof acceptance.score === 'number' ? acceptance.score + ' / 5' : '—',
            comment: acceptance.comment || '',
            signatureDate: acceptance.signatureDate || '—'
          }
        : null
    };
  },

  mapLog(log) {
    const previous = log.previousStatus ? fmt.statusLabel(log.previousStatus) : '';
    const next = log.newStatus ? fmt.statusLabel(log.newStatus) : '';
    return {
      id: log.id,
      action: log.action || '',
      actionText: ACTION_LABELS[log.action] || log.action || '操作记录',
      operatorName: log.operatorName || '系统',
      comment: log.comment || '',
      transitionText: previous || next ? (previous || '—') + ' → ' + (next || '—') : '',
      createdAtText: fmt.formatDateTime(log.createdAt)
    };
  },

  buildSteps(status) {
    if (status === 'cancelled') {
      return [{ key: 'cancelled', label: '已取消', state: 'cancelled' }];
    }
    const index = STEP_FLOW.indexOf(status);
    return STEP_FLOW.map((step, i) => ({
      key: step,
      label: fmt.statusLabel(step),
      state: i < index ? 'done' : i === index ? (status === 'completed' ? 'done' : 'active') : 'todo'
    }));
  },

  buildPermissions(status) {
    const role = this.data.role;
    const isManager = role === 'manager' || role === 'admin';
    const isTech = role === 'technician' || role === 'inspector';
    return {
      canDispatch: isManager && status === 'created',
      canClaim: isTech && status === 'dispatched',
      canComplete: isTech && status === 'in_progress',
      canAccept: isManager && status === 'pending_acceptance',
      canCancel: isManager && ['created', 'dispatched', 'in_progress'].includes(status),
      canReopen: isManager && status === 'dispatched'
    };
  },

  handleRetry() {
    this.loadDetail();
  },

  handleRefresh() {
    this.loadDetail();
  },

  copyOrderNo() {
    if (!this.data.order) return;
    wx.setClipboardData({ data: this.data.order.orderNo });
  },

  noop() {},

  closePanel() {
    this.setData({ actionPanel: '' });
  },

  async openDispatchPanel() {
    this.setData({ actionPanel: 'dispatch' });
    if (this.data.technicians.length) return;
    try {
      const users = await api.getUsers();
      const technicians = (Array.isArray(users) ? users : []).filter(
        (u) => u.role === 'technician' || u.role === 'inspector'
      );
      if (!technicians.length) {
        wx.showToast({ title: '后端暂无可派单的技师账号', icon: 'none' });
        this.setData({ actionPanel: '' });
        return;
      }
      this.setData({
        technicians,
        technicianNames: technicians.map((u) => u.name + '（' + (u.roleTitle || fmt.roleLabel(u)) + '）'),
        technicianIndex: 0
      });
    } catch (err) {
      this.setData({ actionPanel: '' });
    }
  },

  handleTechnicianChange(e) {
    this.setData({ technicianIndex: Number(e.detail.value) || 0 });
  },

  handleDispatchHours(e) {
    this.setData({ 'dispatchForm.estimatedHours': e.detail.value });
  },

  async submitDispatch() {
    const order = this.data.order;
    const technician = this.data.technicians[this.data.technicianIndex];
    if (!order || !technician) {
      wx.showToast({ title: '请选择承接技师', icon: 'none' });
      return;
    }
    const hours = Number(this.data.dispatchForm.estimatedHours);
    if (!isFinite(hours) || hours <= 0) {
      wx.showToast({ title: '预估工时需大于 0', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    try {
      await api.dispatchWorkOrder(order.id, {
        assigneeId: technician.id,
        assigneeName: technician.name,
        dispatcher: this.data.userName,
        estimatedHours: hours,
        version: order.version
      });
      wx.showToast({ title: '已派发', icon: 'success' });
      this.setData({ actionPanel: '' });
      await this.loadDetail();
    } catch (err) {
      if (err && err.statusCode === 409) await this.loadDetail();
      this.setData({ actionPanel: '' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  handleClaim() {
    const order = this.data.order;
    if (!order) return;
    wx.showModal({
      title: '确认接单',
      content: '确认接单后将进入检修中，需先完成 LOTO 安全隔离。',
      confirmText: '确认接单',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '接单中…' });
        try {
          await api.claimWorkOrder(order.id, { operatorName: this.data.userName, version: order.version });
          wx.showToast({ title: '已接单', icon: 'success' });
          await this.loadDetail();
        } catch (err) {
          if (err && err.statusCode === 409) await this.loadDetail();
        } finally {
          wx.hideLoading();
        }
      }
    });
  },

  openCompletePanel() {
    this.setData({ actionPanel: 'complete' });
  },

  handleCompleteInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ ['completeForm.' + field]: e.detail.value });
  },

  async submitComplete() {
    const order = this.data.order;
    const form = this.data.completeForm;
    if (!order) return;
    if (!form.causeAnalysis.trim()) {
      wx.showToast({ title: '请填写故障原因分析', icon: 'none' });
      return;
    }
    if (!form.resolutionSteps.trim()) {
      wx.showToast({ title: '请填写检修处理步骤', icon: 'none' });
      return;
    }
    const hours = Number(form.workHours);
    if (!isFinite(hours) || hours <= 0) {
      wx.showToast({ title: '申报工时需大于 0', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    try {
      await api.completeWorkOrder(order.id, {
        causeAnalysis: form.causeAnalysis.trim(),
        resolutionSteps: form.resolutionSteps.trim(),
        partsUsed: [],
        workHours: hours,
        completionPhotos: [],
        remark: form.remark.trim(),
        operatorName: this.data.userName,
        version: order.version
      });
      wx.showToast({ title: '完工已上报', icon: 'success' });
      this.setData({ actionPanel: '' });
      await this.loadDetail();
    } catch (err) {
      if (err && err.statusCode === 409) await this.loadDetail();
      this.setData({ actionPanel: '' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  openAcceptPanel(e) {
    const pass = e && e.currentTarget && e.currentTarget.dataset.pass !== false;
    this.setData({ actionPanel: 'accept', 'acceptForm.pass': pass !== false });
  },

  handleAcceptPass(e) {
    this.setData({ 'acceptForm.pass': e.currentTarget.dataset.pass === true || e.currentTarget.dataset.pass === 'true' });
  },

  handleAcceptInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ ['acceptForm.' + field]: e.detail.value });
  },

  async submitAccept() {
    const order = this.data.order;
    const form = this.data.acceptForm;
    if (!order) return;
    const score = Number(form.score);
    if (!isFinite(score) || score < 1 || score > 5) {
      wx.showToast({ title: '评分需在 1-5 之间', icon: 'none' });
      return;
    }
    if (!form.pass && !form.comment.trim()) {
      wx.showToast({ title: '驳回时请填写原因', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    try {
      await api.acceptWorkOrder(order.id, {
        inspectorName: this.data.userName,
        pass: !!form.pass,
        score,
        comment: form.comment.trim(),
        version: order.version
      });
      wx.showToast({ title: form.pass ? '验收通过' : '已驳回', icon: 'success' });
      this.setData({ actionPanel: '' });
      await this.loadDetail();
    } catch (err) {
      if (err && err.statusCode === 409) await this.loadDetail();
      this.setData({ actionPanel: '' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  handleCancelOrder() {
    const order = this.data.order;
    if (!order) return;
    wx.showModal({
      title: '取消工单',
      editable: true,
      placeholderText: '请填写取消原因（可选）',
      confirmText: '确认取消',
      confirmColor: '#ba1a1a',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '提交中…' });
        try {
          await api.transitionWorkOrder(order.id, {
            targetStatus: 'cancelled',
            operatorName: this.data.userName,
            comment: (res.content || '').trim() || '现场取消工单',
            version: order.version
          });
          wx.showToast({ title: '工单已取消', icon: 'success' });
          await this.loadDetail();
        } catch (err) {
          if (err && err.statusCode === 409) await this.loadDetail();
        } finally {
          wx.hideLoading();
        }
      }
    });
  },

  handleReopen() {
    const order = this.data.order;
    if (!order) return;
    wx.showModal({
      title: '退回待派单',
      content: '工单将退回「待派单」状态，可由主管重新分配技师。',
      confirmText: '确认退回',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '提交中…' });
        try {
          await api.transitionWorkOrder(order.id, {
            targetStatus: 'created',
            operatorName: this.data.userName,
            comment: '退回待派单重新分配',
            version: order.version
          });
          wx.showToast({ title: '已退回待派单', icon: 'success' });
          await this.loadDetail();
        } catch (err) {
          if (err && err.statusCode === 409) await this.loadDetail();
        } finally {
          wx.hideLoading();
        }
      }
    });
  }
});
