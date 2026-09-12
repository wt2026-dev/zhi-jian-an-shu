var { request } = require("../../utils/request.js");

Page({
  data: {
    loading: false,
    loadError: "",
    descExpanded: true,
    submitting: false,
    detail: {}
  },

  onLoad: function (options) {
    this._orderId = options.id || "";
    if (this._orderId) this.loadDetail();
  },

  loadDetail: function () {
    var that = this;
    that.setData({ loading: true, loadError: "" });
    request("/api/v1/work-orders/" + that._orderId).then(function (o) {
      that.setData({
        loading: false,
        detail: {
          id: o.id,
          orderNo: o.orderNo || o.id,
          title: o.title || "--",
          equipmentName: o.equipmentName || "--",
          status: o.status || "--",
          priority: o.priority || "medium",
          description: o.description || "",
          assignee: o.assignee || "--",
          createdAt: o.createdAt || "--",
          causeAnalysis: o.causeAnalysis || "",
          resolutionSteps: o.resolutionSteps || "",
          partsUsed: o.partsUsed || ""
        }
      });
    }).catch(function (e) {
      that.setData({ loading: false, loadError: (e && (e.error || e.message)) || "加载失败，请确认后端服务已启动" });
    });
  },

  onBack: function () { wx.navigateBack(); },
  toggleDesc: function () { this.setData({ descExpanded: !this.data.descExpanded }); },

  onAddSpare: function () {
    wx.showToast({ title: "追加备件/外协", icon: "none" });
  },

  onSubmit: function () {
    if (this.data.submitting) return;
    var that = this;
    this.setData({ submitting: true });
    request("/api/v1/work-orders/" + that._orderId + "/complete", {
      method: "POST",
      data: { operatorName: (wx.getStorageSync("user") || {}).name || "" }
    }).then(function () {
      that.setData({ submitting: false });
      wx.showToast({ title: "已移交质检站", icon: "success" });
    }).catch(function () {
      that.setData({ submitting: false });
      wx.showToast({ title: "提交失败，请重试", icon: "none" });
    });
  }
});
