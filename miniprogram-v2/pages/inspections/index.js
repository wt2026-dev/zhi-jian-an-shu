// pages/inspections/index.js
const { api } = require('../../utils/request.js');
const { ensureLogin, getUser } = require('../../utils/auth.js');
const fmt = require('../../utils/format.js');

const STATUS_TABS = [
  { value: 'ALL', label: '全部批次' },
  { value: 'in_progress', label: '进行中' },
  { value: 'pending', label: '待开始' },
  { value: 'completed', label: '已完成' }
];

const TYPE_LABELS = {
  daily: '日常点检',
  weekly: '周检',
  monthly: '月检',
  special: '专项巡检'
};

function itemStatusClass(status) {
  if (status === 'abnormal') return 'chip-critical';
  if (status === 'normal') return 'chip-nominal';
  return 'chip-muted';
}

function decorateItem(item) {
  const status = item.draftStatus || 'pending';
  return Object.assign({}, item, {
    statusText: fmt.inspectionItemStatusLabel(status),
    statusClass: itemStatusClass(status)
  });
}

function buildLimitText(raw) {
  const unit = raw.unit || '';
  const min = typeof raw.minLimit === 'number' ? raw.minLimit : null;
  const max = typeof raw.maxLimit === 'number' ? raw.maxLimit : null;
  if (min !== null && max !== null) return min + ' ~ ' + max + (unit ? ' ' + unit : '');
  if (max !== null) return '≤ ' + max + (unit ? ' ' + unit : '');
  if (min !== null) return '≥ ' + min + (unit ? ' ' + unit : '');
  return '';
}

Page({
  data: {
    user: null,
    statusTabs: STATUS_TABS,
    activeStatus: 'ALL',
    batches: [],
    selectedBatchId: '',
    batch: null,
    items: [],
    loadingBatches: true,
    loadingBatch: false,
    loadError: '',
    saving: false
  },

  onLoad() {
    if (!ensureLogin()) return;
    this.setData({ user: getUser() || null });
  },

  onShow() {
    if (!ensureLogin()) return;
    this.loadBatches(this.data.selectedBatchId);
  },

  onPullDownRefresh() {
    this.loadBatches(this.data.selectedBatchId, () => wx.stopPullDownRefresh());
  },

  async loadBatches(selectId, callback) {
    this.setData({ loadingBatches: true, loadError: '' });
    try {
      const query = {};
      if (this.data.activeStatus !== 'ALL') query.status = this.data.activeStatus;
      const list = await api.getInspections(query);
      const batches = (Array.isArray(list) ? list : []).map((raw) => this.mapBatch(raw));

      const preferredId = selectId || this.data.selectedBatchId;
      const selected = batches.find((b) => b.id === preferredId) || batches[0] || null;

      this.setData({
        batches,
        selectedBatchId: selected ? selected.id : ''
      });

      if (selected) {
        await this.loadBatch(selected.id);
      } else {
        this.setData({ batch: null, items: [] });
      }
    } catch (err) {
      this.setData({
        loadError: (err && err.message) || '巡检批次加载失败',
        batches: [],
        selectedBatchId: '',
        batch: null,
        items: []
      });
    } finally {
      this.setData({ loadingBatches: false });
      if (callback) callback();
    }
  },

  mapBatch(raw) {
    const status = raw.status || 'pending';
    let statusClass = 'chip-cyan';
    if (status === 'pending') statusClass = 'chip-gold';
    if (status === 'completed') statusClass = 'chip-nominal';
    if (status === 'cancelled') statusClass = 'chip-muted';

    const total = typeof raw.totalPoints === 'number' ? raw.totalPoints : 0;
    const completed = typeof raw.completedPoints === 'number' ? raw.completedPoints : 0;

    return {
      id: raw.id,
      taskNo: raw.taskNo || '—',
      title: raw.title || '未命名巡检任务',
      type: raw.type || '',
      typeText: TYPE_LABELS[raw.type] || raw.type || '巡检',
      workshop: raw.workshop || '未标注车间',
      status,
      statusText: fmt.inspectionStatusLabel(status),
      statusClass,
      totalPoints: total,
      completedPoints: completed,
      abnormalCount: typeof raw.abnormalCount === 'number' ? raw.abnormalCount : 0,
      progressWidth: fmt.progressWidth(completed, total),
      progressText: completed + ' / ' + total
    };
  },

  async loadBatch(id) {
    this.setData({ loadingBatch: true, selectedBatchId: id });
    try {
      const raw = await api.getInspection(id);
      if (!raw) throw new Error('巡检任务不存在');
      const rawItems = Array.isArray(raw.items) ? raw.items : Array.isArray(raw.points) ? raw.points : [];
      const batch = this.mapBatch(raw);
      batch.workshop = raw.workshop || '未标注车间';
      batch.route = raw.route || '';
      batch.inspectorName = raw.inspectorName || '未标注巡检人';
      batch.scheduledDate = raw.scheduledDate || '—';
      batch.startedAtText = raw.startedAt ? fmt.formatDateTime(raw.startedAt) : '—';
      batch.finishedAtText = raw.finishedAt ? fmt.formatDateTime(raw.finishedAt) : '—';
      batch.summary = raw.summary || '';

      this.setData({
        batch,
        items: rawItems.map((item, index) => this.mapItem(item, index))
      });
    } catch (err) {
      this.setData({
        batch: null,
        items: [],
        loadError: (err && err.message) || '巡检任务详情加载失败'
      });
    } finally {
      this.setData({ loadingBatch: false });
    }
  },

  mapItem(raw, index) {
    const status = raw.status === 'normal' || raw.status === 'abnormal' ? raw.status : 'pending';
    const hasRecord = typeof raw.recordedValue === 'number' && isFinite(raw.recordedValue);
    const limitText = buildLimitText(raw);

    return decorateItem({
      id: raw.id || 'item-' + index,
      index: index + 1,
      equipmentId: raw.equipmentId || '',
      equipmentName: raw.equipmentName || '未关联设备',
      equipmentCode: raw.equipmentCode || '—',
      location: raw.location || '',
      checkPoint: raw.checkPoint || raw.checkItem || '未命名检查项',
      standard: raw.standard || '—',
      method: raw.method || '—',
      unit: raw.unit || '',
      minLimit: typeof raw.minLimit === 'number' ? raw.minLimit : null,
      maxLimit: typeof raw.maxLimit === 'number' ? raw.maxLimit : null,
      limitText,
      hasLimits: typeof raw.maxLimit === 'number' || typeof raw.minLimit === 'number',
      hasRecord,
      recordedValueText: hasRecord ? String(raw.recordedValue) + (raw.unit ? ' ' + raw.unit : '') : '暂无记录',
      draftValue: hasRecord ? String(raw.recordedValue) : '',
      notes: raw.notes || '',
      draftStatus: status,
      raw
    });
  },

  handleStatusChange(e) {
    const value = e.currentTarget.dataset.value;
    if (value === this.data.activeStatus) return;
    this.setData({ activeStatus: value, selectedBatchId: '' });
    this.loadBatches('');
  },

  handleBatchSelect(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || id === this.data.selectedBatchId) return;
    this.loadBatch(id);
  },

  handleRetry() {
    this.loadBatches(this.data.selectedBatchId);
  },

  handleTouchRFID() {
    wx.showModal({
      title: 'RFID 打卡说明',
      content:
        '小程序当前未接入现场 RFID/NFC 读写器，无法读取真实标签。巡检点位、设备与标准值均来自后端巡检任务，现场读数请以设备仪表为准并手动录入。',
      showCancel: false,
      confirmText: '知道了'
    });
  },

  handleItemValueInput(e) {
    const id = e.currentTarget.dataset.id;
    const value = e.detail.value;
    const items = this.data.items.map((item) => {
      if (item.id !== id) return item;
      const next = Object.assign({}, item, { draftValue: value });
      if (value === '') {
        next.draftStatus = 'pending';
      } else if (item.hasLimits) {
        const num = Number(value);
        if (isFinite(num)) {
          const lowerOk = item.minLimit === null || num >= item.minLimit;
          const upperOk = item.maxLimit === null || num <= item.maxLimit;
          next.draftStatus = lowerOk && upperOk ? 'normal' : 'abnormal';
        }
      }
      return decorateItem(next);
    });
    this.setData({ items });
  },

  handleItemMark(e) {
    const id = e.currentTarget.dataset.id;
    const status = e.currentTarget.dataset.status;
    if (status !== 'normal' && status !== 'abnormal' && status !== 'pending') return;
    const items = this.data.items.map((item) => {
      if (item.id !== id) return item;
      return decorateItem(Object.assign({}, item, { draftStatus: status }));
    });
    this.setData({ items });
  },

  handleItemNotes(e) {
    const id = e.currentTarget.dataset.id;
    const value = e.detail.value;
    const items = this.data.items.map((item) => (item.id === id ? Object.assign({}, item, { notes: value }) : item));
    this.setData({ items });
  },

  async handleSaveProgress() {
    const batch = this.data.batch;
    if (!batch || this.data.saving) return;
    if (!this.data.items.length) {
      wx.showToast({ title: '该批次没有可打卡的巡检项', icon: 'none' });
      return;
    }

    const payloadItems = [];
    let invalid = false;
    this.data.items.forEach((item) => {
      const raw = Object.assign({}, item.raw);
      if (item.draftStatus === 'pending') {
        raw.status = 'pending';
        raw.isPass = null;
        raw.recordedValue = null;
        payloadItems.push(raw);
        return;
      }
      const num = item.draftValue === '' ? NaN : Number(item.draftValue);
      if (item.draftValue !== '' && !isFinite(num)) {
        invalid = true;
        return;
      }
      raw.recordedValue = isFinite(num) ? num : raw.recordedValue;
      raw.isPass = item.draftStatus === 'normal';
      raw.status = item.draftStatus;
      raw.notes = item.notes || '';
      payloadItems.push(raw);
    });

    if (invalid) {
      wx.showToast({ title: '存在无法识别的实测值', icon: 'none' });
      return;
    }

    const completedPoints = payloadItems.filter((item) => item.status === 'normal' || item.status === 'abnormal').length;
    const abnormalCount = payloadItems.filter((item) => item.status === 'abnormal').length;
    const totalPoints = payloadItems.length;
    let status = batch.status;
    if (totalPoints > 0 && completedPoints >= totalPoints) status = 'completed';
    else if (completedPoints > 0) status = 'in_progress';

    const payload = {
      items: payloadItems,
      totalPoints,
      completedPoints,
      abnormalCount,
      status
    };
    if (status === 'completed' && !batch.finishedAtText) payload.finishedAt = new Date().toISOString();
    if (status === 'in_progress' && batch.startedAtText === '—') payload.startedAt = new Date().toISOString();

    this.setData({ saving: true });
    try {
      await api.updateInspection(batch.id, payload);
      wx.showToast({ title: '巡检进度已保存', icon: 'success' });
      await this.loadBatches(batch.id);
    } catch (err) {
      // 请求层已提示错误
    } finally {
      this.setData({ saving: false });
    }
  },

  handleReportHazard() {
    const batch = this.data.batch;
    if (!batch) {
      wx.showToast({ title: '请先选择巡检批次', icon: 'none' });
      return;
    }
    const candidates = this.data.items;
    const target =
      candidates.find((item) => item.draftStatus === 'abnormal') ||
      candidates.find((item) => item.hasRecord) ||
      candidates[0] ||
      null;

    wx.showModal({
      title: '上报设备缺陷/隐患',
      editable: true,
      placeholderText: target ? '例如：' + target.checkPoint + ' 发现异常，请描述现场情况' : '请描述现场发现的隐患',
      confirmText: '提交隐患',
      confirmColor: '#ef4444',
      success: async (res) => {
        if (!res.confirm) return;
        const description = (res.content || '').trim();
        if (!description) {
          wx.showToast({ title: '请填写隐患描述', icon: 'none' });
          return;
        }
        const user = this.data.user || {};
        const payload = {
          title: target ? '巡检发现隐患：' + target.checkPoint : '巡检发现现场隐患',
          location: (target && target.location) || batch.workshop,
          level: 'general',
          description,
          discoverer: user.name || user.username || '巡检人员',
          source: 'inspection'
        };
        if (target && target.equipmentId) payload.equipmentId = target.equipmentId;

        wx.showLoading({ title: '提交中…' });
        try {
          await api.createHazard(payload);
          wx.showToast({ title: '隐患已上报', icon: 'success' });
        } catch (err) {
          // 请求层已提示错误
        } finally {
          wx.hideLoading();
        }
      }
    });
  }
});
