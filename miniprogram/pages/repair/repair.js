const { request, uploadImage } = require('../../utils/request.js');

Page({
  data: {
    loading: true,
    networkError: false,
    networkErrorMsg: '',
    submitting: false,
    deviceId: '',
    equipment: null,
    equipmentList: [],
    showManualSelect: false,
    
    // 表单字段
    faultType: '机械传动异响',
    faultDescription: '',
    priority: '一般',
    priorityValue: 'normal',
    reporterName: '',
    reporterPhone: '',
    photos: [],
    
    // 紧急程度单选选项 (Radio 样式)
    priorityOptions: [
      { value: 'normal', label: '普通响应', desc: '日常巡检发现，24小时内处置' },
      { value: 'high', label: '紧急处理', desc: '影响车间产能，4小时内到达现场' },
      { value: 'urgent', label: '特急抢修', desc: '停产或重大安全隐患，1小时内响应' }
    ],
    
    // 成功态
    isSuccess: false,
    createdOrderNo: '',
    
    // 候选列表
    faultTypes: ['机械传动异响', '轴承温度超标', '电气控制失灵', '润滑密封泄漏', '压力流量波动', '仪表传感器断路', '其他故障']
  },

  onLoad(options) {
    let deviceId = '';
    
    // 1. 处理小程序码 scene 场景参数 (例如: d=EQUIP-001&src=qr)
    if (options && options.scene) {
      try {
        const sceneStr = decodeURIComponent(options.scene);
        const params = {};
        sceneStr.split('&').forEach(pair => {
          const [k, v] = pair.split('=');
          if (k) params[k] = v || '';
        });
        deviceId = params.d || params.deviceId || params.id || '';
      } catch (e) {
        console.warn('解析 scene 场景参数失败:', e);
      }
    }
    
    // 2. 兼容普通 query 参数
    if (!deviceId && options) {
      deviceId = options.deviceId || options.equipmentId || options.id || '';
    }

    this.setData({ deviceId });
    this.initUserContact();
    this.loadEquipmentInfo(deviceId);
  },

  initUserContact() {
    try {
      const user = wx.getStorageSync('user') || {};
      this.setData({
        reporterName: user.name || user.username || '现场操作工',
        reporterPhone: user.phone || ''
      });
    } catch (e) {}
  },

  async loadEquipmentInfo(deviceId) {
    this.setData({ loading: true, networkError: false, networkErrorMsg: '' });
    try {
      if (deviceId) {
        // 请求后端 GET /api/v1/equipments/{deviceId} (已支持 ID 或编码)
        const eq = await request('/api/v1/equipments/' + encodeURIComponent(deviceId), { silent: true });
        if (eq && (eq.id || eq.code)) {
          this.setData({
            equipment: eq,
            deviceId: eq.id || deviceId,
            loading: false,
            showManualSelect: false,
            networkError: false
          });
          return;
        }
      }
      
      // 未匹配到或无设备ID：拉取设备列表供手动选择
      const list = await request('/api/v1/equipments', { silent: true });
      this.setData({
        equipmentList: Array.isArray(list) ? list : [],
        loading: false,
        showManualSelect: true,
        networkError: false
      });
    } catch (err) {
      console.error('加载设备信息异常:', err);
      this.setData({
        loading: false,
        networkError: true,
        networkErrorMsg: err.error || err.message || '网络连接超时或后端服务未就绪'
      });
    }
  },

  retryLoad() {
    this.loadEquipmentInfo(this.data.deviceId);
  },

  onTapBack() {
    wx.navigateBack({
      fail: () => {
        wx.switchTab({ url: '/pages/dashboard/dashboard', fail: () => wx.reLaunch({ url: '/pages/dashboard/dashboard' }) });
      }
    });
  },

  onSelectEquipment(e) {
    const idx = Number(e.detail.value);
    const eq = this.data.equipmentList[idx];
    if (eq) {
      this.setData({ equipment: eq, deviceId: eq.id });
    }
  },

  onFaultTypeChange(e) {
    const idx = Number(e.detail.value);
    this.setData({ faultType: this.data.faultTypes[idx] });
  },

  onSelectPriorityRadio(e) {
    const val = e.currentTarget.dataset.val;
    const label = e.currentTarget.dataset.label;
    this.setData({
      priorityValue: val,
      priority: label
    });
  },

  onInputDescription(e) {
    this.setData({ faultDescription: e.detail.value });
  },

  onInputReporter(e) {
    this.setData({ reporterName: e.detail.value });
  },

  onInputPhone(e) {
    this.setData({ reporterPhone: e.detail.value });
  },

  chooseImage() {
    const remaining = 3 - this.data.photos.length;
    if (remaining <= 0) return;

    wx.chooseMedia({
      count: remaining,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const files = res.tempFiles || [];
        files.forEach(f => {
          wx.showLoading({ title: '上传现场凭据中...' });
          uploadImage(f.tempFilePath).then(uploaded => {
            wx.hideLoading();
            const url = uploaded.url || uploaded.imageUrl || f.tempFilePath;
            this.setData({
              photos: [...this.data.photos, url]
            });
          }).catch((err) => {
            wx.hideLoading();
            console.warn('图片上传失败:', err);
            wx.showToast({ title: '图片上传失败，保留本地预览', icon: 'none' });
            this.setData({
              photos: [...this.data.photos, f.tempFilePath]
            });
          });
        });
      }
    });
  },

  previewPhoto(e) {
    const current = e.currentTarget.dataset.src;
    wx.previewImage({
      current,
      urls: this.data.photos
    });
  },

  removePhoto(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const photos = [...this.data.photos];
    photos.splice(idx, 1);
    this.setData({ photos });
  },

  async handleSubmit() {
    const { equipment, faultDescription, reporterName, reporterPhone, faultType, priorityValue, priority, photos, submitting } = this.data;
    
    // 防重复提交拦截
    if (submitting) return;

    if (!equipment || (!equipment.id && !equipment.code)) {
      wx.showToast({ title: '请选择或扫码指定报修设备', icon: 'none' });
      return;
    }

    if (!faultDescription.trim()) {
      wx.showToast({ title: '请填写故障现象描述', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    try {
      const openid = wx.getStorageSync('wx_openid') || '';
      const user = wx.getStorageSync('user') || {};

      // 调后端免登录快速报修接口 POST /api/v1/wx/repairs
      const payload = {
        deviceId: equipment.id || equipment.code,
        desc: faultDescription.trim(),
        level: priorityValue, // normal | high | urgent
        faultType: faultType || '故障报修',
        images: photos,
        reporter: reporterName || '微信扫码人员',
        phone: reporterPhone || '',
        openid: openid || undefined,
        userId: user.id || undefined
      };

      const res = await request('/api/v1/wx/repairs', {
        method: 'POST',
        data: payload,
        silent: true
      });

      this.setData({
        submitting: false,
        isSuccess: true,
        createdOrderNo: res.orderNo || res.id || 'WO-' + Date.now().toString().slice(-6)
      });
    } catch (err) {
      this.setData({ submitting: false });
      console.error('报修提交失败:', err);
      const errMsg = err.error || err.message || '报修提交失败，请检查网络后重试';
      wx.showModal({
        title: '报修提醒',
        content: errMsg,
        showCancel: false,
        confirmText: '我知道了'
      });
    }
  },

  copyOrderNo() {
    if (!this.data.createdOrderNo) return;
    wx.setClipboardData({
      data: this.data.createdOrderNo,
      success: () => {
        wx.showToast({ title: '工单号已复制到剪贴板', icon: 'success' });
      }
    });
  },

  goBackOrHome() {
    wx.switchTab({
      url: '/pages/dashboard/dashboard',
      fail: () => {
        wx.navigateBack({
          fail: () => wx.reLaunch({ url: '/pages/dashboard/dashboard' })
        });
      }
    });
  }
});
