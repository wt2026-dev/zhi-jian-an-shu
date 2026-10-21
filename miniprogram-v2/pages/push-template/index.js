// pages/push-template/index.js
// 后端暂无班组机器人推送模板/Webhook 路由：本页只保留配置 UI 与占位预览，
// 不读取、不写入任何本地伪配置，也不发送消息。
const TEMPLATE_DEFS = [
  {
    id: 'tpl-critical',
    code: 'TPL_CRITICAL_ALERT',
    name: '设备严重预警',
    desc: '设备健康分进入预警区间或关键遥测越限时通知班组',
    enabled: false
  },
  {
    id: 'tpl-order-timeout',
    code: 'TPL_ORDER_TIMEOUT',
    name: '工单超时提醒',
    desc: '检修工单超过约定工时仍未完成时提醒责任人',
    enabled: false
  },
  {
    id: 'tpl-inspection-near',
    code: 'TPL_INSPECTION_NEAR',
    name: '巡检临期提醒',
    desc: '巡检任务临近计划完成时间时提醒点检人员',
    enabled: false
  }
];

const PREVIEW_FIELDS = [
  { label: '涉及设备', value: '待接入后由真实业务数据填充' },
  { label: '严重程度', value: '待接入后由真实业务数据填充' },
  { label: '关键指标', value: '待接入后由真实业务数据填充' },
  { label: '负责班组', value: '待接入后由真实业务数据填充' }
];

Page({
  data: {
    templates: TEMPLATE_DEFS,
    activeTemplateId: 'tpl-critical',
    activeTemplate: TEMPLATE_DEFS[0],
    previewFields: PREVIEW_FIELDS,
    channelState: '未配置',
    webhookState: '未配置',
    groupState: '未绑定'
  },

  handleSelectTemplate(e) {
    const id = e.currentTarget.dataset.id;
    const template = TEMPLATE_DEFS.filter((item) => item.id === id)[0];
    if (!template) return;
    this.setData({
      activeTemplateId: id,
      activeTemplate: template
    });
  },

  handleToggleSwitch() {
    this.showNotConfigured();
  },

  handleTestSend() {
    this.showNotConfigured();
  },

  handleSaveConfig() {
    this.showNotConfigured();
  },

  showNotConfigured() {
    wx.showModal({
      title: '推送通道待接入',
      content: '需配置企业微信群机器人 Webhook。本轮小程序未接入后端推送通道，发送与保存操作均不可用。',
      showCancel: false,
      confirmText: '知晓',
      confirmColor: '#e8a33d'
    });
  }
});
