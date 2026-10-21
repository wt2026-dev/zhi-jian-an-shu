// pages/work-order-create/index.js
const { api } = require('../../utils/request.js');
const { ensureLogin, getUser } = require('../../utils/auth.js');

const PRIORITY_OPTIONS = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'urgent', label: '紧急' }
];

const SAFETY_OPTIONS = ['穿戴劳保鞋与安全帽', '实施 LOTO 停电挂牌', '高处作业系安全带', '动火作业需审批'];

Page({
  data: {
    user: null,
    loadingEquipments: true,
    equipmentError: '',
    equipments: [],
    filteredEquipments: [],
    equipmentNames: [],
    equipmentIndex: 0,
    selectedEquipment: null,
    equipmentKeyword: '',
    priorityOptions: PRIORITY_OPTIONS,
    safetyOptions: SAFETY_OPTIONS.map((label, index) => ({ label, checked: index < 2 })),
    form: {
      title: '',
      faultType: '',
      priority: 'high',
      description: ''
    },
    submitting: false
  },

  onLoad(options) {
    if (!ensureLogin()) return;
    const user = getUser() || {};
    this.setData({ user });
    this.loadEquipments((options && options.equipmentId) || '', (options && options.equipmentName) || '');
  },

  async loadEquipments(prefillId, prefillName) {
    this.setData({ loadingEquipments: true, equipmentError: '' });
    try {
      const list = await api.getEquipments();
      const equipments = Array.isArray(list) ? list : [];
      this.setData({ equipments, loadingEquipments: false });
      this.applyFilter('', prefillId, prefillName);
    } catch (err) {
      this.setData({
        loadingEquipments: false,
        equipmentError: (err && err.message) || '设备台账加载失败'
      });
    }
  },

  applyFilter(keyword, keepSelectedId, fallbackName) {
    const kw = String(keyword || '').trim().toLowerCase();
    const all = this.data.equipments;
    const filtered = kw
      ? all.filter((eq) =>
          [eq.name, eq.code, eq.workshop, eq.location]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(kw)
        )
      : all;

    const currentId = keepSelectedId || (this.data.selectedEquipment && this.data.selectedEquipment.id) || '';
    let index = filtered.findIndex((eq) => eq.id === currentId);
    let selected = index >= 0 ? filtered[index] : null;

    if (!selected && keepSelectedId && fallbackName) {
      selected = { id: keepSelectedId, name: fallbackName, code: '', workshop: '' };
    }

    this.setData({
      filteredEquipments: filtered,
      equipmentNames: filtered.map((eq) => eq.name + '（' + (eq.code || '无编码') + ' · ' + (eq.workshop || '未标注车间') + '）'),
      equipmentIndex: index >= 0 ? index : 0,
      selectedEquipment: selected
    });
  },

  handleEquipmentSearch(e) {
    const keyword = e.detail.value;
    this.setData({ equipmentKeyword: keyword });
    this.applyFilter(keyword);
  },

  handleEquipmentChange(e) {
    const index = Number(e.detail.value) || 0;
    const selected = this.data.filteredEquipments[index] || null;
    this.setData({ equipmentIndex: index, selectedEquipment: selected });
  },

  clearEquipment() {
    this.setData({ selectedEquipment: null });
  },

  retryEquipments() {
    this.loadEquipments();
  },

  handleTitleInput(e) {
    this.setData({ 'form.title': e.detail.value });
  },

  handleFaultTypeInput(e) {
    this.setData({ 'form.faultType': e.detail.value });
  },

  selectFaultType(e) {
    const value = e.currentTarget.dataset.value || '';
    this.setData({ 'form.faultType': value });
  },

  handleDescriptionInput(e) {
    this.setData({ 'form.description': e.detail.value });
  },

  handlePriorityChange(e) {
    this.setData({ 'form.priority': e.currentTarget.dataset.value });
  },

  toggleSafety(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (!isFinite(index)) return;
    const key = 'safetyOptions[' + index + '].checked';
    this.setData({ [key]: !this.data.safetyOptions[index].checked });
  },

  handleReset() {
    this.setData({
      selectedEquipment: null,
      equipmentKeyword: '',
      form: { title: '', faultType: '', priority: 'high', description: '' },
      safetyOptions: SAFETY_OPTIONS.map((label, index) => ({ label, checked: index < 2 }))
    });
    this.applyFilter('');
  },

  handleSubmit() {
    const selected = this.data.selectedEquipment;
    const form = this.data.form;
    const title = form.title.trim();
    const description = form.description.trim();

    if (!selected) {
      wx.showToast({ title: '请选择报修设备', icon: 'none' });
      return;
    }
    if (!title) {
      wx.showToast({ title: '请填写工单标题', icon: 'none' });
      return;
    }
    if (!description) {
      wx.showToast({ title: '请填写故障描述', icon: 'none' });
      return;
    }

    const user = this.data.user || {};
    const payload = {
      title,
      equipmentId: selected.id,
      faultType: form.faultType.trim() || undefined,
      priority: form.priority,
      description,
      safetyRequirements: this.data.safetyOptions.filter((item) => item.checked).map((item) => item.label),
      creator: user.name || user.username || '现场人员'
    };
    this.createOrder(payload, false);
  },

  async createOrder(payload, forceSubmit) {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      const created = await api.createWorkOrder(Object.assign({}, payload, { forceSubmit: !!forceSubmit }));
      if (!created || !created.id) throw new Error('后端未返回已创建工单');
      wx.showToast({ title: '报修工单已创建', icon: 'success' });
      setTimeout(() => {
        wx.redirectTo({ url: '/pages/work-order-detail/index?id=' + encodeURIComponent(created.id) });
      }, 600);
    } catch (err) {
      const existing = err && err.data && err.data.existingOrder;
      if (err && err.statusCode === 409 && existing && existing.id) {
        wx.showModal({
          title: '检测到重复报单',
          content: err.message || '该设备近期已有处理中的工单。',
          confirmText: '查看已有工单',
          cancelText: '仍要提交',
          success: (res) => {
            if (res.confirm) {
              wx.redirectTo({ url: '/pages/work-order-detail/index?id=' + encodeURIComponent(existing.id) });
            } else {
              this.createOrder(payload, true);
            }
          }
        });
      }
    } finally {
      this.setData({ submitting: false });
    }
  }
});
